output "alb_arn" {
  value = aws_lb.main.arn
}

output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "alb_zone_id" {
  value = aws_lb.main.zone_id
}

output "target_group_arns" {
  description = "Map of service name -> target group ARN, for ECS service load_balancer block"
  value       = { for k, tg in aws_lb_target_group.svc : k => tg.arn }
}

output "certificate_arn" {
  value = aws_acm_certificate_validation.main.certificate_arn
}
