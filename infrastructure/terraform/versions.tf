terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
  # Configure a remote backend for real use:
  # backend "s3" {
  #   bucket = "sentinelops-tfstate"
  #   key    = "prod/terraform.tfstate"
  #   region = "us-east-1"
  # }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "sentinelops"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
