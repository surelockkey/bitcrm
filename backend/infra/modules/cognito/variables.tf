variable "project" {
  description = "Project name"
  type        = string
  default     = "bitcrm"
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "app_url" {
  description = "Where people sign in (https://<web domain>) — the invitation email's link and address."
  type        = string
}

variable "app_name" {
  description = "The product's name as the invitation email prints it."
  type        = string
  default     = "BitCRM"
}

variable "invite_support_line" {
  description = "The invitation email's last line: whom to ask."
  type        = string
  default     = "Questions? Ask your dispatcher or your manager."
}

variable "ses_source_arn" {
  description = "Send Cognito's emails through SES from this identity (arn:aws:ses:…:identity/<domain>). null = Cognito's own sender (no-reply@verificationemail.com, ~50 emails a day). Only once the identity is verified and out of the SES sandbox."
  type        = string
  default     = null
}

variable "from_email_address" {
  description = "The sender when ses_source_arn is set, e.g. \"BitCRM <no-reply@example.com>\" — an address on that identity's domain."
  type        = string
  default     = null
}
