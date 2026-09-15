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
  description = <<-EOT
    Map of queue key -> config.
      topic_subscriptions        - topic keys (from var.topics) fanned into this queue; may be
                                   empty for a queue the owning service fills itself
      fifo                       - FIFO queue (name gets the mandatory .fifo suffix, so does its
                                   DLQ). Standard SNS topics cannot deliver to FIFO queues, so
                                   topic_subscriptions must be empty
      visibility_timeout_seconds - how long a received message stays hidden; must exceed the
                                   consumer's worst-case handling time or SQS redelivers mid-work
  EOT
  type = map(object({
    topic_subscriptions        = list(string)
    fifo                       = optional(bool, false)
    visibility_timeout_seconds = optional(number, 30)
  }))
  default = {}

  validation {
    condition = alltrue([
      for k, q in var.queues : !(q.fifo && length(q.topic_subscriptions) > 0)
    ])
    error_message = "A FIFO queue cannot subscribe to a standard SNS topic; leave topic_subscriptions empty for fifo = true."
  }
}
