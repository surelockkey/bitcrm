variable "project" {
  description = "Project name"
  type        = string
  default     = "bitcrm"
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "domain_name" {
  description = "Public domain that ALB serves on (used for Cognito callback URLs)"
  type        = string
}
