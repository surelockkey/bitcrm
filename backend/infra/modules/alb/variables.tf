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

variable "services" {
  description = "Map of service name -> { port, priority, path_pattern } for target group + listener rule creation"
  type = map(object({
    port         = number
    priority     = number
    path_pattern = string
  }))
}

variable "extra_rules" {
  description = "Extra path-based listener rules that forward to an EXISTING target group (referenced by service key in var.services). Use for cross-service routes like /api/docs."
  type = map(object({
    priority       = number
    path_pattern   = string
    target_service = string
  }))
  default = {}
}
