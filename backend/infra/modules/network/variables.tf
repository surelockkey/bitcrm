variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnets" {
  description = "List of public subnet CIDRs + AZs (must be at least 2 AZs for ALB)"
  type = list(object({
    az   = string
    cidr = string
  }))
  default = [
    { az = "us-east-1a", cidr = "10.20.1.0/24" },
    { az = "us-east-1b", cidr = "10.20.2.0/24" },
  ]
}

variable "service_port_range_start" {
  description = "Lowest container port for service SG ingress from ALB"
  type        = number
  default     = 4000
}

variable "service_port_range_end" {
  description = "Highest container port for service SG ingress from ALB"
  type        = number
  default     = 4010
}
