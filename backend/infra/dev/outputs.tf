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
