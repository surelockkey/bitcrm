output "service_name" {
  value = aws_ecs_service.main.name
}

output "service_arn" {
  value = aws_ecs_service.main.id
}

output "task_definition_family" {
  value = aws_ecs_task_definition.main.family
}

output "execution_role_arn" {
  value = aws_iam_role.exec.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.service.name
}
