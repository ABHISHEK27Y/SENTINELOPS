variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (development|staging|production)"
  type        = string
  default     = "staging"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "cluster_name" {
  type    = string
  default = "sentinelops"
}

variable "kubernetes_version" {
  description = "Select an EKS-supported Kubernetes version for the target region at deployment time."
  type    = string
}

variable "kafka_version" {
  description = "Select an MSK-supported Kafka version at deployment time."
  type = string
}

variable "node_instance_type" {
  type    = string
  default = "t3.large"
}

variable "node_desired_size" {
  type    = number
  default = 3
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.medium"
}

variable "db_password" {
  description = "RDS master password (supply via TF_VAR_db_password / secrets manager)"
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.db_password) >= 24 && !strcontains(lower(var.db_password), "change_me")
    error_message = "Supply a unique database password of at least 24 characters."
  }
}

variable "cluster_public_access_cidrs" {
  description = "Optional administrator CIDRs for the EKS public API; empty keeps it private."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for cidr in var.cluster_public_access_cidrs : can(cidrnetmask(cidr)) && cidr != "0.0.0.0/0"])
    error_message = "Use explicit administrator IPv4 CIDRs, never the whole Internet."
  }
}

variable "redis_node_type" {
  type    = string
  default = "cache.t3.small"
}

variable "kafka_instance_type" {
  type    = string
  default = "kafka.t3.small"
}
