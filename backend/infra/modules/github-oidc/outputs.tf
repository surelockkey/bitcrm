output "role_arn" {
  description = "IAM role ARN to assume from GitHub Actions — paste into repo variable AWS_DEPLOY_ROLE_ARN_DEV"
  value       = aws_iam_role.deploy.arn
}

output "role_name" {
  description = "IAM role name"
  value       = aws_iam_role.deploy.name
}

output "oidc_provider_arn" {
  description = "OIDC provider ARN — shared across environments if multiple roles use it"
  value       = aws_iam_openid_connect_provider.github.arn
}
