output "user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "user_pool_client_id" {
  description = "Cognito User Pool Client ID (api client - direct app login flows)"
  value       = aws_cognito_user_pool_client.api.id
}

output "alb_client_id" {
  description = "Cognito User Pool Client ID for ALB authenticate-cognito action"
  value       = aws_cognito_user_pool_client.alb.id
}

output "alb_client_secret" {
  description = "Cognito User Pool Client secret for ALB authenticate-cognito action"
  value       = aws_cognito_user_pool_client.alb.client_secret
  sensitive   = true
}

output "domain" {
  description = "Cognito Hosted UI domain prefix (full domain is <domain>.auth.<region>.amazoncognito.com)"
  value       = aws_cognito_user_pool_domain.main.domain
}

output "domain_full" {
  description = "Full Cognito Hosted UI domain"
  value       = "${aws_cognito_user_pool_domain.main.domain}.auth.us-east-1.amazoncognito.com"
}
