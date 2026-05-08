variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "domain_name" {
  description = "Public domain (e.g. bitcrm.tech-slk.com) for ACM cert + Route 53 alias"
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Public subnet IDs (must span at least 2 AZs)"
  type        = list(string)
}

variable "alb_sg_id" {
  description = "Security group ID for the ALB"
  type        = string
}

variable "parent_zone_id" {
  description = "Route 53 hosted zone ID containing var.domain_name (e.g. tech-slk.com zone)"
  type        = string
}

variable "cognito_user_pool_arn" {
  description = "Cognito User Pool ARN for authenticate-cognito action"
  type        = string
}

variable "cognito_alb_client_id" {
  description = "Cognito User Pool Client ID (the ALB-flow client with secret)"
  type        = string
}

variable "cognito_domain" {
  description = "Cognito Hosted UI domain prefix (just the prefix, e.g. 'bitcrm-dev', NOT the full FQDN)"
  type        = string
}

variable "services" {
  description = "Map of service name -> { port, priority, path_pattern } for target group + listener rule creation"
  type = map(object({
    port         = number
    priority     = number
    path_pattern = string
  }))
}
