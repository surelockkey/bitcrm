variable "project" {
  description = "Project name (used for resource naming)"
  type        = string
}

variable "environment" {
  description = "Environment name (e.g. dev, prod) — must match the GitHub Environment used by workflows"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository in 'owner/repo' form, e.g. surelockkey/bitcrm"
  type        = string
}

variable "aws_region" {
  description = "AWS region (used for resource ARN scoping)"
  type        = string
}

variable "account_id" {
  description = "AWS account ID (used for resource ARN scoping)"
  type        = string
}
