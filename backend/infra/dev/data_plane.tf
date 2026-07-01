locals {
  # All services use a single-table design: composite PK/SK key plus per-entity
  # GSIs named GSI<n>PK (HASH) / GSI<n>SK (RANGE), projecting ALL. The `gsis` map
  # value lists each index's display name and number, matching the repositories.
  ddb_tables = {
    # users table also holds role items (ROLES_TABLE == USERS_TABLE) and
    # technician profile items (indexed by TechnicianIndex / GSI3).
    users = { gsis = [
      { name = "RoleIndex", n = 1 },
      { name = "DepartmentIndex", n = 2 },
      { name = "TechnicianIndex", n = 3 },
      { name = "SkillStatusIndex", n = 4 },
    ] }
    companies = { gsis = [
      { name = "ClientTypeIndex", n = 1 },
    ] }
    contacts = { gsis = [
      { name = "CompanyIndex", n = 1 },
    ] }
    deals = { gsis = [
      { name = "StageIndex", n = 1 },
      { name = "TechIndex", n = 2 },
      { name = "ContactIndex", n = 3 },
      { name = "DispatcherIndex", n = 4 },
    ] }
    deal-products    = { gsis = [] }
    timeline-entries = { gsis = [] }
    addresses        = { gsis = [] } # currently unused by code, kept for parity
  }

  data_plane_tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# ---------- DynamoDB tables (single-table design: PK/SK + per-entity GSIs) ----------

module "ddb" {
  source   = "../modules/ddb-table"
  for_each = local.ddb_tables

  name      = "${var.project}-${var.environment}-${each.key}"
  hash_key  = "PK"
  range_key = "SK"

  attributes = concat(
    [
      { name = "PK", type = "S" },
      { name = "SK", type = "S" },
    ],
    flatten([
      for g in each.value.gsis : [
        { name = "GSI${g.n}PK", type = "S" },
        { name = "GSI${g.n}SK", type = "S" },
      ]
    ])
  )

  gsis = [
    for g in each.value.gsis : {
      name            = g.name
      hash_key        = "GSI${g.n}PK"
      range_key       = "GSI${g.n}SK"
      projection_type = "ALL"
    }
  ]

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

# ---------- KMS key for technician documents + sensitive fields ----------

module "kms_documents" {
  source      = "../modules/kms-key"
  alias_name  = "${var.project}-${var.environment}-documents"
  description = "Encrypts technician documents (S3 SSE-KMS) and sensitive fields (SSN/bank)."
  tags        = local.data_plane_tags
}

# ---------- SNS / SQS ----------

module "sns_sqs" {
  source      = "../modules/sns-sqs"
  project     = var.project
  environment = var.environment

  topics = {
    deal-events    = {}
    contact-events = {}
    user-events    = {}
  }

  queues = {
    deal-events-to-inventory = {
      topic_subscriptions = ["deal-events"]
    }
    contact-events-to-user = {
      topic_subscriptions = ["contact-events"]
    }
    # user-events fan-out: inventory provisions technician containers on
    # user.activated; deal-service projects technician eligibility from
    # tech.approved / tech.updated.
    user-events-to-inventory = {
      topic_subscriptions = ["user-events"]
    }
    user-events-to-deal = {
      topic_subscriptions = ["user-events"]
    }
  }
}
