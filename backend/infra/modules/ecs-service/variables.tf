variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "service_name" {
  description = "Short service name, e.g. user, crm, deal, inventory"
  type        = string
}

variable "aws_region" {
  type = string
}

variable "cluster_id" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "service_connect_namespace_arn" {
  type = string
}

variable "target_group_arn" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "service_sg_id" {
  type = string
}

variable "port" {
  type = number
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 1024
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "min_capacity" {
  type    = number
  default = 1
}

variable "max_capacity" {
  type    = number
  default = 2
}

variable "log_retention_days" {
  type    = number
  default = 7
}

variable "task_role_policy_json" {
  description = "JSON policy for the task role (the app's runtime permissions)"
  type        = string
}

variable "placeholder_image" {
  description = "Image used until CI/CD takes over via lifecycle.ignore_changes on container_definitions"
  type        = string
  default     = "public.ecr.aws/docker/library/nginx:alpine"
}
