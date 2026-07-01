variable "alias_name" {
  type        = string
  description = "Alias name (without the 'alias/' prefix)."
}

variable "description" {
  type    = string
  default = "Managed KMS key"
}

variable "deletion_window_in_days" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
