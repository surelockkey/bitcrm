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
  description = <<-EOT
    Task CPU units for the PLACEHOLDER task definition only. The task
    definitions that actually run are registered by CI from
    services/<svc>/taskdef.json (+ scripts/render-taskdef.sh), and the service
    ignores task_definition changes — keep the two in step by hand.
  EOT
  type        = number
  default     = 256
}

variable "memory" {
  description = "Task memory (MiB) for the placeholder task definition — see `cpu`."
  type        = number
  default     = 1024
}

variable "capacity_provider" {
  description = <<-EOT
    FARGATE_SPOT (default, ~70% cheaper, interruptible) or FARGATE (on-demand)
    for the services the UI cannot do without. The AWS provider changes the
    capacity provider of an existing service only together with a forced
    deployment: when switching one, add `force_new_deployment = true` to
    aws_ecs_service.main for that apply (it rolls onto the task definition CI
    registered), then remove it again.
  EOT
  type        = string
  default     = "FARGATE_SPOT"

  validation {
    condition     = contains(["FARGATE", "FARGATE_SPOT"], var.capacity_provider)
    error_message = "capacity_provider must be FARGATE or FARGATE_SPOT."
  }
}

variable "desired_count" {
  description = <<-EOT
    Task count at CREATION only: the service ignores desired_count afterwards
    (lifecycle.ignore_changes), so on an existing service the lever is
    min_capacity on the autoscaling target — keep min_capacity >= this.
  EOT
  type        = number
  default     = 1
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
