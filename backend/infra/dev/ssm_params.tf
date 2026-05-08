locals {
  ssm_prefix = "/${var.project}/${var.environment}"
}

# ---------- DynamoDB table names ----------

resource "aws_ssm_parameter" "ddb_table_name" {
  for_each = module.ddb

  name  = "${local.ssm_prefix}/dynamodb/${each.key}/table-name"
  type  = "String"
  value = each.value.name

  tags = local.data_plane_tags
}

# ---------- Redis ----------

resource "aws_ssm_parameter" "redis_endpoint" {
  name  = "${local.ssm_prefix}/redis/endpoint"
  type  = "String"
  value = module.redis.endpoint

  tags = local.data_plane_tags
}

resource "aws_ssm_parameter" "redis_url" {
  name  = "${local.ssm_prefix}/redis/url"
  type  = "String"
  value = module.redis.connection_url

  tags = local.data_plane_tags
}

# ---------- Cognito (non-secret only) ----------

resource "aws_ssm_parameter" "cognito_user_pool_id" {
  name  = "${local.ssm_prefix}/cognito/user-pool-id"
  type  = "String"
  value = module.cognito.user_pool_id

  tags = local.data_plane_tags
}

resource "aws_ssm_parameter" "cognito_client_id" {
  name  = "${local.ssm_prefix}/cognito/client-id"
  type  = "String"
  value = module.cognito.user_pool_client_id

  tags = local.data_plane_tags
}

resource "aws_ssm_parameter" "cognito_region" {
  name  = "${local.ssm_prefix}/cognito/region"
  type  = "String"
  value = var.aws_region

  tags = local.data_plane_tags
}

# ---------- S3 ----------

resource "aws_ssm_parameter" "s3_app_bucket" {
  name  = "${local.ssm_prefix}/s3/app/name"
  type  = "String"
  value = module.s3_app.name

  tags = local.data_plane_tags
}

# ---------- SNS topic ARNs ----------

resource "aws_ssm_parameter" "sns_topic_arn" {
  for_each = module.sns_sqs.topic_arns

  name  = "${local.ssm_prefix}/sns/${each.key}/arn"
  type  = "String"
  value = each.value

  tags = local.data_plane_tags
}

# ---------- SQS queue URLs and ARNs ----------

resource "aws_ssm_parameter" "sqs_queue_url" {
  for_each = module.sns_sqs.queue_urls

  name  = "${local.ssm_prefix}/sqs/${each.key}/url"
  type  = "String"
  value = each.value

  tags = local.data_plane_tags
}

resource "aws_ssm_parameter" "sqs_queue_arn" {
  for_each = module.sns_sqs.queue_arns

  name  = "${local.ssm_prefix}/sqs/${each.key}/arn"
  type  = "String"
  value = each.value

  tags = local.data_plane_tags
}

# ---------- App-level config ----------

resource "aws_ssm_parameter" "app_domain" {
  name  = "${local.ssm_prefix}/app/domain"
  type  = "String"
  value = var.domain_name

  tags = local.data_plane_tags
}
