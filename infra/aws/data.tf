# ---------------------------------------------------------------- Postgres (RDS)

resource "random_password" "db" {
  length  = 32
  special = false # keeps the connection URL free of escaping issues
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name}-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "main" {
  name   = "${var.name}-${var.environment}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000" # log queries slower than 1s
  }
}

resource "aws_db_instance" "main" {
  identifier                   = "${var.name}-${var.environment}"
  engine                       = "postgres"
  engine_version               = "16"
  instance_class               = var.db_instance_class
  allocated_storage            = var.db_allocated_storage
  max_allocated_storage        = var.db_allocated_storage * 10
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = "dispatch"
  username                     = "dispatch"
  password                     = random_password.db.result
  db_subnet_group_name         = aws_db_subnet_group.main.name
  vpc_security_group_ids       = [aws_security_group.db.id]
  parameter_group_name         = aws_db_parameter_group.main.name
  multi_az                     = var.db_multi_az
  backup_retention_period      = var.db_backup_retention_days
  backup_window                = "02:00-03:00"
  maintenance_window           = "sun:03:30-sun:04:30"
  copy_tags_to_snapshot        = true
  deletion_protection          = true
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${var.name}-${var.environment}-final"
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
  apply_immediately            = false
}

# ---------------------------------------------------------------- Secrets

resource "random_password" "tracking" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "database_url" {
  name = "${var.name}/${var.environment}/DATABASE_URL"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  # connection_limit: Prisma pool size per task — keep tasks × limit under RDS max_connections
  secret_string = "postgresql://dispatch:${random_password.db.result}@${aws_db_instance.main.address}:5432/dispatch?sslmode=require&connection_limit=20"
}

resource "random_password" "mfa" {
  length  = 64
  special = false
}

# Encrypts users' TOTP secrets; independent of TRACKING_SECRET so that one can rotate freely
resource "aws_secretsmanager_secret" "mfa_key" {
  name = "${var.name}/${var.environment}/MFA_ENCRYPTION_KEY"
}

resource "aws_secretsmanager_secret_version" "mfa_key" {
  secret_id     = aws_secretsmanager_secret.mfa_key.id
  secret_string = random_password.mfa.result
}

resource "aws_secretsmanager_secret" "tracking_secret" {
  name = "${var.name}/${var.environment}/TRACKING_SECRET"
}

resource "aws_secretsmanager_secret_version" "tracking_secret" {
  secret_id     = aws_secretsmanager_secret.tracking_secret.id
  secret_string = random_password.tracking.result
}

# Push credentials: created empty; put the values in with
#   aws secretsmanager put-secret-value --secret-id <arn> --secret-string file://service-account.json
# Until a value exists the app falls back to the Settings page.
resource "aws_secretsmanager_secret" "push" {
  for_each = toset(["FCM_SERVICE_ACCOUNT_JSON", "APNS_PRIVATE_KEY"])
  name     = "${var.name}/${var.environment}/${each.key}"
}

# ---------------------------------------------------------------- Container registry

resource "aws_ecr_repository" "app" {
  name                 = "${var.name}-${var.environment}"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "keep last 30 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

# ---------------------------------------------------------------- S3: media (via CloudFront) + exports

resource "aws_s3_bucket" "media" {
  bucket_prefix = "${var.name}-${var.environment}-media-"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${var.name}-${var.environment}-media"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  comment         = "${var.name} ${var.environment} media (push images, email assets)"
  price_class     = "PriceClass_100"
  is_ipv6_enabled = true

  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "media"
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
    compress               = true
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.media.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.media.arn } }
    }]
  })
}

resource "aws_s3_bucket" "exports" {
  bucket_prefix = "${var.name}-${var.environment}-exports-"
}

resource "aws_s3_bucket_public_access_block" "exports" {
  bucket                  = aws_s3_bucket.exports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "exports" {
  bucket = aws_s3_bucket.exports.id
  rule {
    id     = "expire-exports"
    status = "Enabled"
    filter {}
    expiration { days = 30 }
  }
}
