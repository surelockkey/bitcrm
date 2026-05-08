variable "name" {
  type = string
}

variable "enable_versioning" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
