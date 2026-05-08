output "vpc_id" {
  value = aws_vpc.main.id
}

output "vpc_cidr" {
  value = aws_vpc.main.cidr_block
}

output "public_subnet_ids" {
  description = "Ordered by AZ name for stable iteration"
  value       = [for s in sort(keys(aws_subnet.public)) : aws_subnet.public[s].id]
}

output "alb_sg_id" {
  value = aws_security_group.alb.id
}

output "service_sg_id" {
  value = aws_security_group.service.id
}
