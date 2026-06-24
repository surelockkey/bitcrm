terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

module "cognito" {
  source      = "../modules/cognito"
  project     = var.project
  environment = var.environment
}

module "github_oidc" {
  source      = "../modules/github-oidc"
  project     = var.project
  environment = var.environment
  github_repo = var.github_repo
  aws_region  = var.aws_region
  account_id  = data.aws_caller_identity.current.account_id
}

module "network" {
  source      = "../modules/network"
  project     = var.project
  environment = var.environment
}

locals {
  services = {
    user      = { port = 4001, priority = 100, path_pattern = "/api/users/*" }
    crm       = { port = 4002, priority = 200, path_pattern = "/api/crm/*" }
    deal      = { port = 4003, priority = 300, path_pattern = "/api/deals/*" }
    inventory = { port = 4004, priority = 400, path_pattern = "/api/inventory/*" }
  }
}

module "alb" {
  source         = "../modules/alb"
  project        = var.project
  environment    = var.environment
  domain_name    = var.domain_name
  vpc_id         = module.network.vpc_id
  subnet_ids     = module.network.public_subnet_ids
  alb_sg_id      = module.network.alb_sg_id
  parent_zone_id = data.aws_route53_zone.parent.zone_id
  services       = local.services
  extra_rules = {
    docs = { priority = 50, path_pattern = "/api/docs*", target_service = "user" }
  }
}
