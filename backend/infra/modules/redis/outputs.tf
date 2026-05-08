output "endpoint" {
  description = "Redis primary endpoint hostname"
  value       = aws_elasticache_cluster.main.cache_nodes[0].address
}

output "port" {
  value = aws_elasticache_cluster.main.cache_nodes[0].port
}

output "connection_url" {
  description = "redis://host:port — convenient for app config"
  value       = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.cache_nodes[0].port}"
}

output "security_group_id" {
  value = aws_security_group.redis.id
}
