variable "name" {
  type = string
}

variable "enable_versioning" {
  type    = bool
  default = false
}

# Origins allowed to PUT/GET directly against the bucket from a browser
# (presigned document upload/download). Empty = no CORS rule (no browser access).
variable "cors_allowed_origins" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
