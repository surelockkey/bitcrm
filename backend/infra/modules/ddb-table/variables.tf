variable "name" {
  type = string
}

variable "hash_key" {
  type    = string
  default = "id"
}

variable "range_key" {
  type    = string
  default = null
}

variable "attributes" {
  description = "List of attribute definitions used by hash_key, range_key, or any GSI key"
  type = list(object({
    name = string
    type = string # "S" | "N" | "B"
  }))
  default = [
    { name = "id", type = "S" }
  ]
}

variable "gsis" {
  description = "Global secondary indexes"
  type = list(object({
    name            = string
    hash_key        = string
    range_key       = optional(string)
    projection_type = string
  }))
  default = []
}

variable "enable_pitr" {
  description = "Enable point-in-time recovery (off by default for dev)"
  type        = bool
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
