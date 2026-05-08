variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  description = "Subnet IDs (must be in same VPC; for dev single-AZ is fine)"
  type        = list(string)
}

variable "service_sg_id" {
  description = "Security group ID allowed to connect on 6379"
  type        = string
}

variable "node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "engine_version" {
  type    = string
  default = "7.1"
}

variable "parameter_group_name" {
  type    = string
  default = "default.redis7"
}
