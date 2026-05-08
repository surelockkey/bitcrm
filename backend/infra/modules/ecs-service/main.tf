locals {
  full_name = "${var.project}-${var.environment}-${var.service_name}"

  common_tags = {
    Project     = var.project
    Environment = var.environment
    Service     = var.service_name
  }
}

# ---------- Log group ----------

resource "aws_cloudwatch_log_group" "service" {
  name              = "/ecs/${local.full_name}"
  retention_in_days = var.log_retention_days

  tags = local.common_tags
}

# ---------- IAM: execution role (used by ECS agent to pull image, write logs, read SSM) ----------

data "aws_iam_policy_document" "exec_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "exec" {
  name               = "${local.full_name}-exec"
  assume_role_policy = data.aws_iam_policy_document.exec_assume.json

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "exec_managed" {
  role       = aws_iam_role.exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ---------- IAM: task role (the application's runtime permissions) ----------

resource "aws_iam_role" "task" {
  name               = "${local.full_name}-task"
  assume_role_policy = data.aws_iam_policy_document.exec_assume.json

  tags = local.common_tags
}

resource "aws_iam_role_policy" "task_inline" {
  name   = "${local.full_name}-task"
  role   = aws_iam_role.task.id
  policy = var.task_role_policy_json
}

# ---------- Task definition (placeholder image; CI/CD owns container_definitions) ----------

resource "aws_ecs_task_definition" "main" {
  family                   = local.full_name
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.exec.arn
  task_role_arn            = aws_iam_role.task.arn

  container_definitions = jsonencode([
    {
      name      = var.service_name
      image     = var.placeholder_image
      essential = true
      portMappings = [
        {
          name          = var.service_name
          containerPort = var.port
          protocol      = "tcp"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.service.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])

  lifecycle {
    ignore_changes = [container_definitions]
  }

  tags = local.common_tags
}

# ---------- ECS service ----------

resource "aws_ecs_service" "main" {
  name            = local.full_name
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.main.arn
  desired_count   = var.desired_count

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 100
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.service_sg_id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = var.service_name
    container_port   = var.port
  }

  service_connect_configuration {
    enabled   = true
    namespace = var.service_connect_namespace_arn

    service {
      port_name      = var.service_name
      discovery_name = var.service_name

      client_alias {
        port     = var.port
        dns_name = var.service_name
      }
    }
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  health_check_grace_period_seconds = 60

  enable_execute_command = true

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = local.common_tags
}

# ---------- Autoscaling target (no policies; just registers the service for later) ----------

resource "aws_appautoscaling_target" "main" {
  service_namespace  = "ecs"
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.main.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_capacity
  max_capacity       = var.max_capacity
}
