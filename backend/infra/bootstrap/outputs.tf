output "state_bucket_name" {
  description = "S3 bucket holding all Terraform state — reference in backend.tf"
  value       = aws_s3_bucket.tfstate.id
}

output "lock_table_name" {
  description = "DynamoDB table for Terraform state locking — reference in backend.tf"
  value       = aws_dynamodb_table.tflock.name
}

output "account_id" {
  description = "Resolved AWS account ID"
  value       = data.aws_caller_identity.current.account_id
}
