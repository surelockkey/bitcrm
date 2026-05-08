data "aws_caller_identity" "current" {}

data "aws_route53_zone" "parent" {
  name         = "tech-slk.com."
  private_zone = false
}
