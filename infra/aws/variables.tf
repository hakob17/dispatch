variable "region" {
  type        = string
  description = "AWS region for everything (pick one that keeps data in the required jurisdiction)."
  default     = "eu-west-1"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "name" {
  type        = string
  description = "Resource name prefix."
  default     = "dispatch"
}

variable "image_tag" {
  type        = string
  description = "Tag of the image in the ECR repository created by this stack (see scripts/aws-deploy.sh)."
  default     = "latest"
}

variable "domain_name" {
  type        = string
  description = "Public hostname for the console/API, e.g. dispatch.example.com. Used for APP_BASE_URL."
}

variable "certificate_arn" {
  type        = string
  description = "ACM certificate ARN for domain_name (same region). Empty = HTTP only (not for production)."
  default     = ""
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "single_nat_gateway" {
  type        = bool
  description = "One NAT gateway (cheaper) instead of one per AZ (no single point of failure)."
  default     = false
}

variable "db_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "db_allocated_storage" {
  type    = number
  default = 100
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "db_backup_retention_days" {
  type    = number
  default = 14
}

variable "web_cpu" {
  type    = number
  default = 1024
}

variable "web_memory" {
  type    = number
  default = 2048
}

variable "web_min_count" {
  type    = number
  default = 2
}

variable "web_max_count" {
  type    = number
  default = 10
}

variable "worker_cpu" {
  type    = number
  default = 2048
}

variable "worker_memory" {
  type    = number
  default = 4096
}

variable "worker_min_count" {
  type    = number
  default = 2
}

variable "worker_max_count" {
  type    = number
  default = 20
}

variable "ses_from_email" {
  type        = string
  description = "Verified SES sender, e.g. news@example.com (domain must be verified in SES)."
  default     = ""
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "extra_environment" {
  type        = map(string)
  description = "Extra plain env vars for both services (e.g. MESSAGE_RETENTION_DAYS, API_RATE_LIMIT_SERVER_PER_MIN)."
  default     = {}
}

variable "enable_fcm_secret" {
  type        = bool
  description = "Inject FCM_SERVICE_ACCOUNT_JSON from Secrets Manager. Set true only after putting a value in the secret (ECS can't start with an empty secret)."
  default     = false
}

variable "enable_apns_secret" {
  type        = bool
  description = "Inject APNS_PRIVATE_KEY from Secrets Manager (also set APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID in extra_environment)."
  default     = false
}

variable "alert_email" {
  type        = string
  description = "Where CloudWatch alarms are emailed (confirm the SNS subscription email). Empty = alarms only notify the SNS topic."
  default     = ""
}

variable "queue_backlog_alarm" {
  type        = number
  description = "Alarm when this many due jobs are waiting (each push job = up to 500 messages)."
  default     = 2000
}
