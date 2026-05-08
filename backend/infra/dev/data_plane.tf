locals {
  ddb_tables = [
    "users",
    "companies",
    "contacts",
    "deals",
    "deal-products",
    "addresses",
    "timeline-entries",
  ]

  data_plane_tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# ---------- DynamoDB tables (one per entity, hash_key=id, no GSIs yet) ----------

module "ddb" {
  source   = "../modules/ddb-table"
  for_each = toset(local.ddb_tables)

  name = "${var.project}-${var.environment}-${each.key}"
  tags = local.data_plane_tags
}

# ---------- ElastiCache Redis ----------

module "redis" {
  source        = "../modules/redis"
  project       = var.project
  environment   = var.environment
  vpc_id        = module.network.vpc_id
  subnet_ids    = module.network.public_subnet_ids
  service_sg_id = module.network.service_sg_id
}

# ---------- S3 app bucket ----------

module "s3_app" {
  source = "../modules/s3-bucket"
  name   = "${var.project}-${var.environment}-app-${data.aws_caller_identity.current.account_id}"
  tags   = local.data_plane_tags
}

# ---------- SNS / SQS ----------

module "sns_sqs" {
  source      = "../modules/sns-sqs"
  project     = var.project
  environment = var.environment

  topics = {
    deal-events    = {}
    contact-events = {}
  }

  queues = {
    deal-events-to-inventory = {
      topic_subscriptions = ["deal-events"]
    }
    contact-events-to-user = {
      topic_subscriptions = ["contact-events"]
    }
  }
}
