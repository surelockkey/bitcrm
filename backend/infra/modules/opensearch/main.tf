locals {
  # Domain names must be <= 28 chars, lowercase. "bitcrm-dev-search" = 17.
  domain_name = "${var.project}-${var.environment}-search"
}

# Public endpoint, IAM-gated: any principal in the account that ALSO holds
# es:ESHttp* in its own IAM policy may call the domain (the search task role does;
# admins running create-index/backfill do). Requests are SigV4-signed by the app.
data "aws_iam_policy_document" "access" {
  statement {
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.account_id}:root"]
    }
    actions   = ["es:ESHttp*"]
    resources = ["arn:aws:es:${var.aws_region}:${var.account_id}:domain/${local.domain_name}/*"]
  }
}

resource "aws_opensearch_domain" "this" {
  domain_name    = local.domain_name
  engine_version = var.engine_version

  cluster_config {
    instance_type  = var.instance_type
    instance_count = var.instance_count
  }

  ebs_options {
    ebs_enabled = true
    volume_size = var.volume_size
    volume_type = "gp3"
  }

  node_to_node_encryption {
    enabled = true
  }

  encrypt_at_rest {
    enabled = true
  }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  access_policies = data.aws_iam_policy_document.access.json

  tags = var.tags
}
