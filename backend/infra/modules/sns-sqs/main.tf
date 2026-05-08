locals {
  name_prefix = "${var.project}-${var.environment}"

  common_tags = {
    Project     = var.project
    Environment = var.environment
  }

  # Flatten queue -> topic subscriptions for resource for_each
  subscriptions = merge([
    for q_key, q_cfg in var.queues : {
      for t_key in q_cfg.topic_subscriptions : "${q_key}__${t_key}" => {
        queue_key = q_key
        topic_key = t_key
      }
    }
  ]...)
}

# ---------- Topics ----------

resource "aws_sns_topic" "this" {
  for_each = var.topics

  name = "${local.name_prefix}-${each.key}"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-${each.key}"
  })
}

# ---------- Queues + DLQs ----------

resource "aws_sqs_queue" "dlq" {
  for_each = var.queues

  name                       = "${local.name_prefix}-${each.key}-dlq"
  message_retention_seconds  = 1209600 # 14 days
  visibility_timeout_seconds = 30

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-${each.key}-dlq"
  })
}

resource "aws_sqs_queue" "main" {
  for_each = var.queues

  name                       = "${local.name_prefix}-${each.key}"
  visibility_timeout_seconds = 30
  message_retention_seconds  = 345600 # 4 days

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = 5
  })

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-${each.key}"
  })
}

# ---------- SNS -> SQS subscriptions ----------

resource "aws_sns_topic_subscription" "main" {
  for_each = local.subscriptions

  topic_arn = aws_sns_topic.this[each.value.topic_key].arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.main[each.value.queue_key].arn

  raw_message_delivery = true
}

# Allow each topic to send to the queues subscribed to it
data "aws_iam_policy_document" "queue_from_sns" {
  for_each = var.queues

  statement {
    sid    = "AllowSNS"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.main[each.key].arn]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [for t_key in each.value.topic_subscriptions : aws_sns_topic.this[t_key].arn]
    }
  }
}

resource "aws_sqs_queue_policy" "main" {
  for_each = var.queues

  queue_url = aws_sqs_queue.main[each.key].id
  policy    = data.aws_iam_policy_document.queue_from_sns[each.key].json
}
