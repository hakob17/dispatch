terraform {
  required_version = ">= 1.5"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.70" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Configure remote state for real environments, e.g.:
  # backend "s3" { bucket = "my-tf-state" key = "dispatch/prod.tfstate" region = "eu-west-1" dynamodb_table = "tf-locks" }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "dispatch", Environment = var.environment, ManagedBy = "terraform" }
  }
}
