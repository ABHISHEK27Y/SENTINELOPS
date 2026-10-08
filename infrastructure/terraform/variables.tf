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
  type    = string
  default = "1.30"
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
  default     = "change_me_in_production"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t3.small"
}

variable "kafka_instance_type" {
  type    = string
  default = "kafka.t3.small"
}
