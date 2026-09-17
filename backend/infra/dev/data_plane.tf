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
    # One item per call (PK=CALL#<sid>, SK=METADATA). AgentIndex is an agent's
    # own history; AllCallsIndex is the global time-ordered log the calls page
    # pages through (GSI2PK is the constant 'CALL#ALL').
    calls = { gsis = [
      { name = "AgentIndex", n = 1 },
      { name = "AllCallsIndex", n = 2 },
      # PartyIndex: every call with one client, company or teammate, without
      # scanning the global log. Keys are written when the association is
      # frozen, so only associated calls appear here.
      { name = "PartyIndex", n = 3 },
    ] }
    # Call groups: PK='GROUP', SK='GROUP#<id>' — one partition holds every
    # group, so listing is a single Query. Tens of items, never thousands.
    call-groups = { gsis = [] }
    # Call flows: what a caller hears before anyone answers. Same shape as
    # call-groups — PK='FLOW', one Query lists them all.
    call-flows       = { gsis = [] }
    deal-products    = { gsis = [] }
    timeline-entries = { gsis = [] }
    addresses        = { gsis = [] } # currently unused by code, kept for parity
    # Messaging inbox (messaging-service): conversations CONV#<id>/METADATA,
    # messages CONV#<id>/MSG#<createdAt>#<msgId>, plus lookup rows (CONVOF#,
    # ADDR#, PSID#, CLIENTMSG#, OPTOUT#, TEMPLATE#). There is deliberately no
    # global message index — every inbox view is its own partition, split by
    # year, so no key ever holds the whole 2.3M-message history (the CALL#ALL
    # lesson). GSI2, GSI4, GSI5 and GSI6 are sparse: only unread / job-linked /
    # flagged / categorised rows carry those keys.
    messaging = {
      gsis = [
        { name = "InboxIndex", n = 1 },           # INBOX#<open|archived>#<YYYY> / <lastMessageAt>#<conversationId>
        { name = "UnreadIndex", n = 2 },          # UNREAD#<YYYY> — open unread conversations only
        { name = "CategoryIndex", n = 3 },        # CAT#<kind>#<YYYY>; also CATALOG#MESSAGE_TEMPLATE for templates
        { name = "JobIndex", n = 4 },             # JOB#<dealId> / <createdAt>#<messageId> — messages of a job
        { name = "FlagIndex", n = 5 },            # FLAG#conversation, FLAG#message#<YYYY>
        { name = "AccountCategoryIndex", n = 6 }, # ACCTCAT#<categoryId>#<YYYY>
      ]
      # First TTL use in BitCRM: CLIENTMSG# idempotency rows expire after 7 days.
      ttl_attribute = "expiresAt"
      # 2.3M imported messages with no other copy once the Workiz account closes.
      enable_pitr = true
    }
    # Billing (billing-service): invoices INVOICE#<dealId>, estimates
    # ESTIMATE#<id> (+ ITEM#<lineId> rows), document templates, business
    # profile, template image assets, portal tokens (PORTAL#<sha256>) and
    # per-deal estimate counters. GSI3 is sparse (estimates only).
    billing = {
      gsis = [
        { name = "ListIndex", n = 1 },    # INVOICES | ESTIMATES | TEMPLATES / <createdAt>
        { name = "ContactIndex", n = 2 }, # CONTACT#<contactId> / INVOICE#<createdAt> | ESTIMATE#<createdAt>
        { name = "DealIndex", n = 3 },    # DEAL#<dealId> / ESTIMATE#<createdAt>
      ]
      # Invoices and estimates are client-facing financial records.
      enable_pitr = true
    }
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

  # Per-table opt-ins; tables that don't set them keep the module defaults
  # (no TTL, PITR off), so this adds nothing to their plan.
  ttl_attribute = try(each.value.ttl_attribute, null)
  enable_pitr   = try(each.value.enable_pitr, false)

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
  # Presigned document upload/download runs in the browser, cross-origin to the
  # bucket. Allow the FRONTEND origins (the web app + local dev) — NOT the API
  # domain (var.domain_name is the ALB/API host, where no browser runs).
  cors_allowed_origins = [
    "https://bitcrm.tech-slk.com",
    "http://localhost:3000",
    "http://localhost:3002",
  ]
  tags = local.data_plane_tags
}

# ---------- OpenSearch (global search CQRS index) ----------

module "opensearch" {
  source      = "../modules/opensearch"
  project     = var.project
  environment = var.environment
  aws_region  = var.aws_region
  account_id  = data.aws_caller_identity.current.account_id
  tags        = local.data_plane_tags
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
    # Published by inventory-service (Phase 2); the search indexer subscribes now
    # so it starts indexing inventory the moment those events go live.
    inventory-events = {}
    # call.started / call.completed / call.recording_ready from telephony-service.
    # No consumers yet — the live calls UI is fed by SSE, not SNS (see EVENTS.md).
    call-events = {}
    # message.received / message.sent / message.status_changed /
    # conversation.updated / opt_out.changed from messaging-service. Search
    # consumes conversation.updated; the inbox UI itself is fed by SSE.
    message-events = {}
    # invoice.* / estimate.* from billing-service. No consumers yet.
    billing-events = {}
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
    # Global search CQRS index: one queue fanned out from every domain topic.
    search-index = {
      topic_subscriptions = ["deal-events", "contact-events", "user-events", "inventory-events", "message-events"]
    }

    # ---- messaging-service (SSM /sqs/<key>/url -> <KEY>_QUEUE_URL) ----
    # Outbound SMS/MMS/email: the API accepts a message (202), the worker
    # sends it. FIFO keeps one conversation's messages in order
    # (MessageGroupId = conversationId) and dedupes on messageId. The Twilio
    # call plus the "did the previous attempt already send it?" lookup can
    # take well over the 30s default, so the visibility timeout is 90s — a
    # redelivery mid-send is a duplicate SMS to a customer.
    messaging-outbound = {
      topic_subscriptions        = []
      fifo                       = true
      visibility_timeout_seconds = 90
    }
    # Inbound MMS: copy each media URL Twilio gives us into S3 (messaging/*,
    # SSE-KMS) off the webhook's critical path. Filled by the service itself.
    messaging-media = {
      topic_subscriptions = []
    }
    # contact.merged / contact.updated from crm: rewrite CONVOF#/ADDR# rows so
    # inbound texts keep landing on the right conversation.
    contact-events-to-messaging = {
      topic_subscriptions = ["contact-events"]
    }
    # Every deal event from deal-service: the built-in "New job" SMS to the
    # assigned technician (deal.tech_assigned / deal.updated) and the rule
    # engine (deal.created / deal.status_changed / deal.tech_assigned /
    # deal.updated, plus deal.scheduled_changed once deal-service publishes
    # one). The queue subscribes to the whole topic — no filter policy — so a
    # new event type needs a handler, not a subscription.
    deal-events-to-messaging = {
      topic_subscriptions = ["deal-events"]
    }
    # call.completed from telephony: the Workiz "missed call" / "completed
    # call" rules that text the caller back (4 103 + 2 332 firings in the
    # imported account). The live calls UI stays on SSE — only the
    # automations consume this.
    call-events-to-messaging = {
      topic_subscriptions = ["call-events"]
    }

    # ---- billing-service ----
    # deal.product_* / deal.updated refresh an invoice's totals snapshot,
    # deal.status_changed (canceled) archives open estimates, deal.deleted
    # removes the job's invoice and estimates.
    billing-deal-events = {
      topic_subscriptions = ["deal-events"]
    }
  }
}
