# ---------------------------------------------------------------------------
# Email for messaging-service — SES, variant A of the design (§5, M17/M18).
#
# Everything here is gated on var.messaging_email_domain. With the default
# ("") NOT ONE resource is created and the task role gains nothing, so this
# file is inert until the owner picks the domain (O12) and applies. The
# owner must then add the DNS records `terraform output
# messaging_email_dns_records` prints (DKIM, MAIL FROM, MX for the replies
# subdomain, DMARC) — see backend/README.md, "Email over SES".
#
#   outbound   messaging task --ses:SendEmail--> SES identity <domain>
#              configuration set --events--> SNS messaging-email-events
#                --> SQS messaging-email-events (+dlq) --> messaging task
#   inbound    MX <reply>.<domain> --> SES receipt rule --> S3 app bucket
#              messaging/inbound-email/<sesId> --notify--> SNS messaging-inbound-email
#                --> SQS messaging-inbound-email (+dlq) --> messaging task
#
# Env the task reads (all via SSM auto-mapping in render-taskdef.sh):
#   MESSAGING_EMAIL_FROM, MESSAGING_EMAIL_DOMAIN, MESSAGING_EMAIL_REPLY_DOMAIN,
#   SES_CONFIGURATION_SET, MESSAGING_EMAIL_EVENTS_QUEUE_URL,
#   MESSAGING_INBOUND_EMAIL_QUEUE_URL.
# ---------------------------------------------------------------------------

variable "messaging_email_domain" {
  description = "Domain the workspace mails from (becomes the SES domain identity). Empty = email disabled: nothing in this file is created."
  type        = string
  default     = ""
}

variable "messaging_reply_subdomain" {
  description = "Subdomain of messaging_email_domain whose MX points at SES; replies to `c-<conversationId>@<sub>.<domain>` thread back."
  type        = string
  default     = "reply"
}

variable "messaging_email_from_local_part" {
  description = "Local part of the default sender, `<local>@<messaging_email_domain>` (MESSAGING#SETTINGS.companyEmail on the same domain wins at runtime)."
  type        = string
  default     = "office"
}

variable "messaging_mail_from_subdomain" {
  description = "Subdomain of messaging_email_domain SES uses as the MAIL FROM (bounce) domain. Must be a name nothing else holds: a CNAME there (Google Workspace parks `mail.` on ghs.googlehosted.com) cannot share the name with the MX + TXT SES needs."
  type        = string
  default     = "mail"
}

locals {
  email_enabled = var.messaging_email_domain != ""

  email_domain         = var.messaging_email_domain
  email_reply_domain   = "${var.messaging_reply_subdomain}.${var.messaging_email_domain}"
  email_from_address   = "${var.messaging_email_from_local_part}@${var.messaging_email_domain}"
  email_mail_from      = "${var.messaging_mail_from_subdomain}.${var.messaging_email_domain}"
  email_inbound_prefix = "messaging/inbound-email/"
  email_config_set     = "${var.project}-${var.environment}-messaging"
  email_rule_set       = "${var.project}-${var.environment}-messaging"

  # ARNs the task policy needs without forcing the resources to exist first.
  email_identity_arn_prefix = "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:identity/"
  email_identity_arn        = "${local.email_identity_arn_prefix}${var.messaging_email_domain}"
  email_config_set_arn      = "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:configuration-set/${local.email_config_set}"
  email_rule_set_arn        = "arn:aws:ses:${var.aws_region}:${data.aws_caller_identity.current.account_id}:receipt-rule-set/${local.email_rule_set}"

  # Splat + merge/flatten read as empty when the module / resource has count 0,
  # so outputs and SSM parameters below never index a missing instance.
  email_queue_urls  = merge(module.email_sns_sqs[*].queue_urls...)
  email_queue_arns  = merge(module.email_sns_sqs[*].queue_arns...)
  email_topic_arns  = merge(module.email_sns_sqs[*].topic_arns...)
  email_dkim_tokens = flatten(aws_sesv2_email_identity.messaging[*].dkim_signing_attributes[*].tokens)
}

# ---------- Sending: domain identity + Easy DKIM + custom MAIL FROM ----------

resource "aws_sesv2_configuration_set" "messaging" {
  count = local.email_enabled ? 1 : 0

  configuration_set_name = local.email_config_set

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }

  tags = local.data_plane_tags
}

resource "aws_sesv2_email_identity" "messaging" {
  count = local.email_enabled ? 1 : 0

  email_identity         = local.email_domain
  configuration_set_name = aws_sesv2_configuration_set.messaging[0].configuration_set_name

  # Easy DKIM: SES generates three CNAME tokens the owner publishes under
  # <token>._domainkey.<domain>; the identity verifies once they resolve.
  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  tags = local.data_plane_tags
}

# A MAIL FROM on our own domain aligns SPF with the From: domain (DMARC).
# Needs MX + TXT on mail.<domain>; on MX failure SES falls back to its own.
resource "aws_sesv2_email_identity_mail_from_attributes" "messaging" {
  count = local.email_enabled ? 1 : 0

  email_identity         = aws_sesv2_email_identity.messaging[0].email_identity
  mail_from_domain       = local.email_mail_from
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

# ---------- Topics + queues: one instance of the sns-sqs module, email only ----------

module "email_sns_sqs" {
  source = "../modules/sns-sqs"
  count  = local.email_enabled ? 1 : 0

  project     = var.project
  environment = var.environment

  topics = {
    # Send / Delivery / Bounce / Complaint / Reject / Open / Click from the configuration set.
    messaging-email-events = {}
    # "A mail landed in S3" from the receipt rule's S3 action.
    messaging-inbound-email = {}
  }

  queues = {
    messaging-email-events = {
      topic_subscriptions = ["messaging-email-events"]
    }
    # Each message means: fetch the raw mail from S3, parse it, copy the
    # attachments into S3 with KMS, one DynamoDB transaction — well over the
    # 30 s default for a mail with a few photos.
    messaging-inbound-email = {
      topic_subscriptions        = ["messaging-inbound-email"]
      visibility_timeout_seconds = 120
    }
  }
}

# SES publishes to both topics as ses.amazonaws.com; the module creates the
# topics without a policy, so grant it here, scoped to this account.
data "aws_iam_policy_document" "email_topics_from_ses" {
  for_each = local.email_topic_arns

  statement {
    sid    = "AllowSES"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }

    actions   = ["sns:Publish"]
    resources = [each.value]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "email_topics_from_ses" {
  for_each = local.email_topic_arns

  arn    = each.value
  policy = data.aws_iam_policy_document.email_topics_from_ses[each.key].json
}

resource "aws_sesv2_configuration_set_event_destination" "messaging" {
  count = local.email_enabled ? 1 : 0

  configuration_set_name = aws_sesv2_configuration_set.messaging[0].configuration_set_name
  event_destination_name = "${local.email_config_set}-events"

  event_destination {
    enabled = true
    matching_event_types = [
      "SEND", "REJECT", "BOUNCE", "COMPLAINT", "DELIVERY",
      "OPEN", "CLICK", "RENDERING_FAILURE", "DELIVERY_DELAY",
    ]

    sns_destination {
      topic_arn = local.email_topic_arns["messaging-email-events"]
    }
  }

  depends_on = [aws_sns_topic_policy.email_topics_from_ses]
}

# ---------- Receiving: MX <reply>.<domain> → receipt rule → S3 + SNS ----------

# SES may only write into the bucket when its policy says so. The app bucket
# has no other bucket policy (the s3-bucket module sets none), so this is the
# bucket's one and only policy resource — extend it here rather than adding a
# second aws_s3_bucket_policy elsewhere (a bucket holds exactly one).
data "aws_iam_policy_document" "app_bucket_ses_inbound" {
  count = local.email_enabled ? 1 : 0

  statement {
    sid    = "AllowSESInboundMail"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }

    actions   = ["s3:PutObject"]
    resources = ["${module.s3_app.arn}/${local.email_inbound_prefix}*"]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["${local.email_rule_set_arn}:receipt-rule/*"]
    }
  }
}

resource "aws_s3_bucket_policy" "app_ses_inbound" {
  count = local.email_enabled ? 1 : 0

  bucket = module.s3_app.name
  policy = data.aws_iam_policy_document.app_bucket_ses_inbound[0].json
}

resource "aws_ses_receipt_rule_set" "messaging" {
  count = local.email_enabled ? 1 : 0

  rule_set_name = local.email_rule_set
}

# An account has ONE active receipt rule set per region. Activating this one
# deactivates whatever was active before (nothing, in this account today).
resource "aws_ses_active_receipt_rule_set" "messaging" {
  count = local.email_enabled ? 1 : 0

  rule_set_name = aws_ses_receipt_rule_set.messaging[0].rule_set_name
}

resource "aws_ses_receipt_rule" "messaging_inbound" {
  count = local.email_enabled ? 1 : 0

  name          = "${local.email_rule_set}-inbound"
  rule_set_name = aws_ses_receipt_rule_set.messaging[0].rule_set_name
  recipients    = [local.email_reply_domain]
  enabled       = true
  scan_enabled  = true
  tls_policy    = "Optional"

  # The raw mail, under the prefix the messaging task may read
  # (S3MessagingObjects in compute.tf covers messaging/*). Stored with the
  # bucket's default SSE-S3: SES cannot use the documents CMK without a key
  # policy grant, and the attachments are re-written under that key by the
  # service anyway. `topic_arn` is what feeds the inbound queue.
  s3_action {
    bucket_name       = module.s3_app.name
    object_key_prefix = local.email_inbound_prefix
    topic_arn         = local.email_topic_arns["messaging-inbound-email"]
    position          = 1
  }

  depends_on = [aws_s3_bucket_policy.app_ses_inbound, aws_sns_topic_policy.email_topics_from_ses]
}

# ---------- SSM parameters → task environment (render-taskdef.sh auto-mapping) ----------

# /bitcrm/dev/messaging/email-from → MESSAGING_EMAIL_FROM
resource "aws_ssm_parameter" "messaging_email_from" {
  count = local.email_enabled ? 1 : 0

  name  = "${local.ssm_prefix}/messaging/email-from"
  type  = "String"
  value = local.email_from_address

  tags = local.data_plane_tags
}

# /bitcrm/dev/messaging/email-domain → MESSAGING_EMAIL_DOMAIN
resource "aws_ssm_parameter" "messaging_email_domain" {
  count = local.email_enabled ? 1 : 0

  name  = "${local.ssm_prefix}/messaging/email-domain"
  type  = "String"
  value = local.email_domain

  tags = local.data_plane_tags
}

# /bitcrm/dev/messaging/email-reply-domain → MESSAGING_EMAIL_REPLY_DOMAIN
resource "aws_ssm_parameter" "messaging_email_reply_domain" {
  count = local.email_enabled ? 1 : 0

  name  = "${local.ssm_prefix}/messaging/email-reply-domain"
  type  = "String"
  value = local.email_reply_domain

  tags = local.data_plane_tags
}

# /bitcrm/dev/ses/configuration-set → SES_CONFIGURATION_SET
resource "aws_ssm_parameter" "ses_configuration_set" {
  count = local.email_enabled ? 1 : 0

  name  = "${local.ssm_prefix}/ses/configuration-set"
  type  = "String"
  value = local.email_config_set

  tags = local.data_plane_tags
}

# /bitcrm/dev/sqs/messaging-email-events/url → MESSAGING_EMAIL_EVENTS_QUEUE_URL
# /bitcrm/dev/sqs/messaging-inbound-email/url → MESSAGING_INBOUND_EMAIL_QUEUE_URL
resource "aws_ssm_parameter" "email_sqs_queue_url" {
  for_each = local.email_queue_urls

  name  = "${local.ssm_prefix}/sqs/${each.key}/url"
  type  = "String"
  value = each.value

  tags = local.data_plane_tags
}

resource "aws_ssm_parameter" "email_sqs_queue_arn" {
  for_each = local.email_queue_arns

  name  = "${local.ssm_prefix}/sqs/${each.key}/arn"
  type  = "String"
  value = each.value

  tags = local.data_plane_tags
}

resource "aws_ssm_parameter" "email_sns_topic_arn" {
  for_each = local.email_topic_arns

  name  = "${local.ssm_prefix}/sns/${each.key}/arn"
  type  = "String"
  value = each.value

  tags = local.data_plane_tags
}

# ---------- Outputs: what the owner must publish in DNS, and what the task sees ----------

output "messaging_email_dns_records" {
  description = "DNS records the owner must add before email works (O12). Empty until messaging_email_domain is set."
  value = local.email_enabled ? concat(
    [for token in local.email_dkim_tokens : {
      purpose = "DKIM (identity verification + signing)"
      name    = "${token}._domainkey.${local.email_domain}"
      type    = "CNAME"
      value   = "${token}.dkim.amazonses.com"
    }],
    [
      {
        purpose = "MAIL FROM (SPF alignment)"
        name    = local.email_mail_from
        type    = "MX"
        value   = "10 feedback-smtp.${var.aws_region}.amazonses.com"
      },
      {
        purpose = "MAIL FROM (SPF)"
        name    = local.email_mail_from
        type    = "TXT"
        value   = "v=spf1 include:amazonses.com ~all"
      },
      {
        purpose = "Inbound replies"
        name    = local.email_reply_domain
        type    = "MX"
        value   = "10 inbound-smtp.${var.aws_region}.amazonaws.com"
      },
      {
        purpose = "DMARC (start at p=none, tighten once reports are clean)"
        name    = "_dmarc.${local.email_domain}"
        type    = "TXT"
        value   = "v=DMARC1; p=none; rua=mailto:${local.email_from_address}"
      },
    ],
  ) : []
}

output "messaging_email_config" {
  description = "What the messaging task will read once applied (mirrors the SSM parameters)."
  value = local.email_enabled ? {
    MESSAGING_EMAIL_FROM              = local.email_from_address
    MESSAGING_EMAIL_DOMAIN            = local.email_domain
    MESSAGING_EMAIL_REPLY_DOMAIN      = local.email_reply_domain
    SES_CONFIGURATION_SET             = local.email_config_set
    MESSAGING_EMAIL_EVENTS_QUEUE_URL  = lookup(local.email_queue_urls, "messaging-email-events", null)
    MESSAGING_INBOUND_EMAIL_QUEUE_URL = lookup(local.email_queue_urls, "messaging-inbound-email", null)
  } : null
}
