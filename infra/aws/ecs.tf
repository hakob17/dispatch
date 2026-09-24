locals {
  prefix     = "${var.name}-${var.environment}"
  image      = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
  https      = var.certificate_arn != ""
  public_url = "${local.https ? "https" : "http"}://${var.domain_name}"
  ses_domain = var.ses_from_email != "" ? split("@", var.ses_from_email)[1] : ""
  environment = merge({
    NODE_ENV              = "production"
    APP_BASE_URL          = local.public_url
    AWS_REGION            = var.region
    SES_FROM_EMAIL        = var.ses_from_email
    SES_CONFIGURATION_SET = aws_sesv2_configuration_set.main.configuration_set_name
    SES_SNS_TOPIC_ARNS    = aws_sns_topic.ses_events.arn
    MEDIA_S3_BUCKET       = aws_s3_bucket.media.id
    MEDIA_PUBLIC_BASE_URL = "https://${aws_cloudfront_distribution.media.domain_name}"
    EXPORT_S3_BUCKET      = aws_s3_bucket.exports.id
    WORKER_COUNT          = tostring(var.worker_min_count)
    WORKER_HEALTH_PORT    = "8081"
  }, var.extra_environment)
  secrets = concat(
    [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      { name = "TRACKING_SECRET", valueFrom = aws_secretsmanager_secret.tracking_secret.arn },
      { name = "MFA_ENCRYPTION_KEY", valueFrom = aws_secretsmanager_secret.mfa_key.arn },
    ],
    var.enable_fcm_secret ? [{ name = "FCM_SERVICE_ACCOUNT_JSON", valueFrom = aws_secretsmanager_secret.push["FCM_SERVICE_ACCOUNT_JSON"].arn }] : [],
    var.enable_apns_secret ? [{ name = "APNS_PRIVATE_KEY", valueFrom = aws_secretsmanager_secret.push["APNS_PRIVATE_KEY"].arn }] : [],
  )
  env_list = [for k, v in local.environment : { name = k, value = v }]
}

resource "aws_ecs_cluster" "main" {
  name = local.prefix
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.prefix}/web"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${local.prefix}/worker"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------- IAM

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: pull image, write logs, read secrets at task start
resource "aws_iam_role" "execution" {
  name               = "${local.prefix}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = concat(
        [aws_secretsmanager_secret.database_url.arn, aws_secretsmanager_secret.tracking_secret.arn, aws_secretsmanager_secret.mfa_key.arn],
        [for s in aws_secretsmanager_secret.push : s.arn],
      )
    }]
  })
}

# Task role: what the app itself may call (no long-lived AWS keys anywhere)
resource "aws_iam_role" "task" {
  name               = "${local.prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "task" {
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "SesSend"
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail", "ses:GetAccount", "ses:GetEmailIdentity"]
        Resource = "*"
      },
      {
        Sid      = "MediaAndExports"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
        Resource = ["${aws_s3_bucket.media.arn}/*", "${aws_s3_bucket.exports.arn}/*"]
      },
      {
        Sid      = "ListExports"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.exports.arn]
      },
    ]
  })
}

# ---------------------------------------------------------------- Task definitions

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.prefix}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name         = "web"
    image        = local.image
    essential    = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment  = local.env_list
    secrets      = local.secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.web.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "web"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name      = "worker"
    image     = local.image
    essential = true
    command   = ["npm", "run", "worker:start"]
    # Pool must cover WORKER_BATCH_SIZE concurrent jobs (default 25)
    environment = concat(local.env_list, [
      { name = "DB_POOL_SIZE", value = "35" },
      { name = "DB_POOL_TIMEOUT", value = "30" },
    ])
    secrets     = local.secrets
    stopTimeout = 120 # finish the in-flight batch on deploy/scale-in (SIGTERM → drain)
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://localhost:8081/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

# ---------------------------------------------------------------- Load balancer

resource "aws_lb" "main" {
  name                       = local.prefix
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
  idle_timeout               = 120 # long NDJSON exports
}

resource "aws_lb_target_group" "web" {
  name                 = "${local.prefix}-web"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  count             = local.https ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  dynamic "default_action" {
    for_each = local.https ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
  dynamic "default_action" {
    for_each = local.https ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.web.arn
    }
  }
}

# ---------------------------------------------------------------- Services

resource "aws_ecs_service" "web" {
  name                              = "web"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.web.arn
  desired_count                     = var.web_min_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.web.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle {
    ignore_changes = [desired_count] # owned by autoscaling
  }
  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_min_count
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.worker.id]
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  lifecycle {
    ignore_changes = [desired_count]
  }
}

# ---------------------------------------------------------------- Autoscaling

resource "aws_appautoscaling_target" "web" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.web.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.web_min_count
  max_capacity       = var.web_max_count
}

resource "aws_appautoscaling_policy" "web_cpu" {
  name               = "${local.prefix}-web-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.web.service_namespace
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_target" "worker" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.worker_min_count
  max_capacity       = var.worker_max_count
}

resource "aws_appautoscaling_policy" "worker_cpu" {
  name               = "${local.prefix}-worker-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.worker.service_namespace
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 30
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
