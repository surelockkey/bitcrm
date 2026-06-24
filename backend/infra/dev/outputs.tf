output "user_pool_id" {
  description = "Cognito User Pool ID — use as COGNITO_USER_POOL_ID in .env"
  value       = module.cognito.user_pool_id
}

output "user_pool_client_id" {
  description = "Cognito User Pool Client ID — use as COGNITO_CLIENT_ID in .env"
  value       = module.cognito.user_pool_client_id
}

output "aws_region" {
  description = "AWS Region — use as AWS_REGION in .env"
  value       = var.aws_region
}

output "deploy_role_arn" {
  description = "IAM role ARN for GitHub Actions — paste into repo variable AWS_DEPLOY_ROLE_ARN_DEV at https://github.com/surelockkey/bitcrm/settings/variables/actions"
  value       = module.github_oidc.role_arn
}

output "alb_dns_name" {
  description = "ALB DNS name (Route 53 record points at this)"
  value       = module.alb.alb_dns_name
}

output "app_url" {
  description = "Public URL for the dev environment"
  value       = "https://${var.domain_name}"
}

output "ecr_repository_urls" {
  description = "Map of service name -> ECR repository URL (push images here)"
  value       = { for k, r in aws_ecr_repository.svc : k => r.repository_url }
}

output "ecs_cluster_name" {
  value = module.ecs_cluster.cluster_name
}

output "ecs_service_names" {
  value = { for k, m in module.ecs_service : k => m.service_name }
}


output "account_id" {
  description = "Resolved AWS account ID"
  value       = data.aws_caller_identity.current.account_id
}
