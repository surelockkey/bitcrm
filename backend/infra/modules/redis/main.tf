locals {
  name_prefix = "${var.project}-${var.environment}"

  common_tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-redis"
  description = "ElastiCache Redis - ingress from service SG only"
  vpc_id      = var.vpc_id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis"
  })
}

resource "aws_vpc_security_group_ingress_rule" "from_service" {
  security_group_id            = aws_security_group.redis.id
  description                  = "Redis from service SG"
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  referenced_security_group_id = var.service_sg_id
}

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name_prefix
  subnet_ids = var.subnet_ids

  tags = local.common_tags
}

resource "aws_elasticache_cluster" "main" {
  cluster_id           = local.name_prefix
  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  num_cache_nodes      = 1
  parameter_group_name = var.parameter_group_name
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]

  apply_immediately = true

  tags = merge(local.common_tags, {
    Name = local.name_prefix
  })
}
