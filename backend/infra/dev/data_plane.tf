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

# inventory-svc uses a single-table design (PK/SK + 4 GSIs), so it can't be
# expressed via the generic hash_key=id loop above.
module "ddb_inventory" {
  source = "../modules/ddb-table"

  name      = "${var.project}-${var.environment}-inventory"
  hash_key  = "PK"
  range_key = "SK"

  attributes = [
    { name = "PK", type = "S" },
    { name = "SK", type = "S" },
    { name = "GSI1PK", type = "S" },
    { name = "GSI1SK", type = "S" },
    { name = "GSI2PK", type = "S" },
    { name = "GSI2SK", type = "S" },
    { name = "GSI3PK", type = "S" },
    { name = "GSI3SK", type = "S" },
    { name = "GSI4PK", type = "S" },
    { name = "GSI4SK", type = "S" },
  ]

  gsis = [
    { name = "CategoryIndex", hash_key = "GSI1PK", range_key = "GSI1SK", projection_type = "ALL" },
    { name = "TypeIndex", hash_key = "GSI2PK", range_key = "GSI2SK", projection_type = "ALL" },
    { name = "OwnerIndex", hash_key = "GSI3PK", range_key = "GSI3SK", projection_type = "ALL" },
    { name = "TransferEntityIndex", hash_key = "GSI4PK", range_key = "GSI4SK", projection_type = "ALL" },
  ]

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
