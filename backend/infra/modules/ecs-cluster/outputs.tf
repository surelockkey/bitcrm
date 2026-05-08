output "cluster_id" {
  value = aws_ecs_cluster.main.id
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.main.arn
}

output "service_connect_namespace_arn" {
  value = aws_service_discovery_http_namespace.main.arn
}

output "service_connect_namespace_name" {
  value = aws_service_discovery_http_namespace.main.name
}
