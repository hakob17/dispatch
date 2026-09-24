# cp example.tfvars prod.tfvars && terraform apply -var-file=prod.tfvars
region          = "eu-west-1"
environment     = "prod"
domain_name     = "dispatch.example.com"
certificate_arn = "arn:aws:acm:eu-west-1:123456789012:certificate/xxxxxxxx"
ses_from_email  = "alerts@example.com"
image_tag       = "latest"

extra_environment = {
  # APNS_KEY_ID          = "ABC123DEFG"
  # APNS_TEAM_ID         = "TEAM123456"
  # APNS_BUNDLE_ID       = "com.example.news"
  # SDK_REQUIRE_USER_TOKEN = "true"
  # OIDC_ISSUER            = "https://login.microsoftonline.com/<tenant>/v2.0"   (or configure SSO in Settings)
  # OIDC_CLIENT_ID         = "…"
  # OIDC_ALLOWED_DOMAINS   = "example.com"
  # OIDC_ADMIN_GROUPS      = "<entra-group-object-id>"
  # REQUIRE_MFA            = "true"
  # LAUNCH_PARTITIONS      = "16"
  # SDK_CORS_ORIGINS     = "https://www.example.com"
  # MESSAGE_RETENTION_DAYS = "395"
  # EVENT_RETENTION_DAYS   = "395"
}
