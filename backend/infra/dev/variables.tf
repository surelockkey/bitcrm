variable "project" {
  description = "Project name"
  type        = string
  default     = "bitcrm"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "dev"
}

variable "github_repo" {
  description = "GitHub repository in 'owner/repo' form for OIDC trust"
  type        = string
}

variable "domain_name" {
  description = "Public domain served by ALB (must already exist as a Route 53 zone or subdomain)"
  type        = string
}
