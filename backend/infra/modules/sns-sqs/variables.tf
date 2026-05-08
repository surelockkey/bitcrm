variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "topics" {
  description = "Map of topic key -> config (currently empty object; reserved for future per-topic settings)"
  type        = map(object({}))
  default     = {}
}

variable "queues" {
  description = "Map of queue key -> { topic_subscriptions = [topic-keys-from-var.topics] }"
  type = map(object({
    topic_subscriptions = list(string)
  }))
  default = {}
}
