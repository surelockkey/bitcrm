locals {
  service_names = keys(local.services)
}

# ---------- ECR repositories ----------

resource "aws_ecr_repository" "svc" {
  for_each             = toset(local.service_names)
  name                 = "${var.project}-${each.key}"
  image_tag_mutability = "MUTABLE"

  tags = {
    Project     = var.project
    Environment = var.environment
    Service     = each.key
  }
}

resource "aws_ecr_lifecycle_policy" "svc" {
  for_each   = aws_ecr_repository.svc
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 untagged images"
      selection = {
        tagStatus   = "untagged"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ---------- ECS cluster ----------

module "ecs_cluster" {
  source      = "../modules/ecs-cluster"
  project     = var.project
  environment = var.environment
}

# ---------- Per-service task role policies (least-privilege) ----------

# Shared SSM read policy: any service can read its own config under /bitcrm/dev/*
data "aws_iam_policy_document" "ssm_read_dev" {
  statement {
    sid    = "SSMReadDevConfig"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    resources = ["arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project}/${var.environment}/*"]
  }
}

# user-svc: DDB users + Cognito admin + SSM
data "aws_iam_policy_document" "task_user" {
  source_policy_documents = [data.aws_iam_policy_document.ssm_read_dev.json]

  statement {
    sid    = "DDBUsers"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = [
      module.ddb["users"].arn,
      "${module.ddb["users"].arn}/index/*",
    ]
  }

  statement {
    sid    = "CognitoAdmin"
    effect = "Allow"
    actions = [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminUpdateUserAttributes",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminInitiateAuth",
      "cognito-idp:AdminRespondToAuthChallenge",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:ListUsers",
      "cognito-idp:ListGroups",
    ]
    resources = [module.cognito.user_pool_arn]
  }

  statement {
    sid       = "ConsumeContactEvents"
    effect    = "Allow"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [module.sns_sqs.queue_arns["contact-events-to-user"]]
  }
}

# crm-svc: DDB companies, contacts, addresses + SNS contact-events publish
data "aws_iam_policy_document" "task_crm" {
  source_policy_documents = [data.aws_iam_policy_document.ssm_read_dev.json]

  statement {
    sid    = "DDBContactsCompaniesAddresses"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = flatten([
      for k in ["companies", "contacts", "addresses"] : [
        module.ddb[k].arn,
        "${module.ddb[k].arn}/index/*",
      ]
    ])
  }

  statement {
    sid       = "PublishContactEvents"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [module.sns_sqs.topic_arns["contact-events"]]
  }
}

# deal-svc: DDB deals + deal-products + timeline + SNS deal-events publish + SQS consume
data "aws_iam_policy_document" "task_deal" {
  source_policy_documents = [data.aws_iam_policy_document.ssm_read_dev.json]

  statement {
    sid    = "DDBDeals"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = flatten([
      for k in ["deals", "deal-products", "timeline-entries"] : [
        module.ddb[k].arn,
        "${module.ddb[k].arn}/index/*",
      ]
    ])
  }

  statement {
    sid       = "PublishDealEvents"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [module.sns_sqs.topic_arns["deal-events"]]
  }
}

# inventory-svc: S3 app bucket + SQS consume deal-events-to-inventory
data "aws_iam_policy_document" "task_inventory" {
  source_policy_documents = [data.aws_iam_policy_document.ssm_read_dev.json]

  statement {
    sid     = "S3App"
    effect  = "Allow"
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [
      module.s3_app.arn,
      "${module.s3_app.arn}/*",
    ]
  }

  statement {
    sid       = "ConsumeDealEvents"
    effect    = "Allow"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [module.sns_sqs.queue_arns["deal-events-to-inventory"]]
  }
}

locals {
  task_role_policies = {
    user      = data.aws_iam_policy_document.task_user.json
    crm       = data.aws_iam_policy_document.task_crm.json
    deal      = data.aws_iam_policy_document.task_deal.json
    inventory = data.aws_iam_policy_document.task_inventory.json
  }
}

# ---------- ECS services ----------

module "ecs_service" {
  source   = "../modules/ecs-service"
  for_each = local.services

  project     = var.project
  environment = var.environment
  aws_region  = var.aws_region

  service_name                  = each.key
  cluster_id                    = module.ecs_cluster.cluster_id
  cluster_name                  = module.ecs_cluster.cluster_name
  service_connect_namespace_arn = module.ecs_cluster.service_connect_namespace_arn

  target_group_arn = module.alb.target_group_arns[each.key]
  port             = each.value.port

  subnet_ids    = module.network.public_subnet_ids
  service_sg_id = module.network.service_sg_id

  task_role_policy_json = local.task_role_policies[each.key]
}
