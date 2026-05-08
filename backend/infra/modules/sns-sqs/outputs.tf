output "topic_arns" {
  description = "Map of topic key -> ARN"
  value       = { for k, t in aws_sns_topic.this : k => t.arn }
}

output "queue_urls" {
  description = "Map of queue key -> URL"
  value       = { for k, q in aws_sqs_queue.main : k => q.url }
}

output "queue_arns" {
  description = "Map of queue key -> ARN"
  value       = { for k, q in aws_sqs_queue.main : k => q.arn }
}

output "dlq_arns" {
  value = { for k, q in aws_sqs_queue.dlq : k => q.arn }
}
