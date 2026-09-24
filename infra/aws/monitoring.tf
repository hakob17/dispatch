# ---------------------------------------------------------------- Alerting
# Metrics under namespace "Dispatch" come from the worker's embedded-metric log
# lines (src/lib/metrics.ts); the rest are AWS service metrics.

resource "aws_sns_topic" "alerts" {
  name = "${local.prefix}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  alarm_actions = [aws_sns_topic.alerts.arn]
  dispatch_dims = { Environment = var.environment }
  alb_suffix    = aws_lb.main.arn_suffix
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.prefix}-web-5xx"
  alarm_description   = "Console/API returning server errors (RFP 8.3: availability)"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = local.alb_suffix }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 20
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "alb_latency" {
  alarm_name          = "${local.prefix}-web-latency-p95"
  alarm_description   = "API p95 latency above 2 s"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = { LoadBalancer = local.alb_suffix }
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 10
  datapoints_to_alarm = 5
  threshold           = 2
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_web" {
  alarm_name          = "${local.prefix}-web-unhealthy-targets"
  alarm_description   = "A web task is failing /api/health (database unreachable or crashed)"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = { LoadBalancer = local.alb_suffix, TargetGroup = aws_lb_target_group.web.arn_suffix }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "worker_down" {
  alarm_name          = "${local.prefix}-worker-not-running"
  alarm_description   = "No worker task running: nothing will be sent"
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.worker.name }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "queue_backlog" {
  alarm_name          = "${local.prefix}-queue-backlog"
  alarm_description   = "Send queue is backing up (workers can't keep up or a provider is slow)"
  namespace           = "Dispatch"
  metric_name         = "QueueDepth"
  dimensions          = local.dispatch_dims
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = var.queue_backlog_alarm
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "queue_stale" {
  alarm_name          = "${local.prefix}-queue-oldest-job"
  alarm_description   = "A due job has waited over 5 minutes — breaking news would be late"
  namespace           = "Dispatch"
  metric_name         = "OldestPendingJobAgeSeconds"
  dimensions          = local.dispatch_dims
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 300
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "send_failures" {
  alarm_name          = "${local.prefix}-send-failures"
  alarm_description   = "Many messages failing in 5 minutes (expired credentials, provider outage)"
  namespace           = "Dispatch"
  metric_name         = "MessagesFailed5m"
  dimensions          = local.dispatch_dims
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "webhooks_failing" {
  alarm_name          = "${local.prefix}-integrations-failing"
  alarm_description   = "An event webhook / Segment destination keeps failing (RFP 10.3: interface monitoring)"
  namespace           = "Dispatch"
  metric_name         = "WebhookEndpointsFailing"
  dimensions          = local.dispatch_dims
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "feeds_failing" {
  alarm_name          = "${local.prefix}-feeds-failing"
  alarm_description   = "A content feed can't be fetched — auto-sends from it have stopped"
  namespace           = "Dispatch"
  metric_name         = "FeedsFailing"
  dimensions          = local.dispatch_dims
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 6
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.prefix}-db-cpu"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${local.prefix}-db-free-storage"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 10 * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ---------------------------------------------------------------- Worker scaling on backlog
# CPU target tracking (ecs.tf) handles steady load; this adds workers fast when
# a broadcast floods the queue, and removes them once it has drained.

resource "aws_appautoscaling_policy" "worker_backlog_out" {
  name               = "${local.prefix}-worker-backlog-out"
  policy_type        = "StepScaling"
  service_namespace  = aws_appautoscaling_target.worker.service_namespace
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 60
    metric_aggregation_type = "Maximum"
    step_adjustment {
      metric_interval_lower_bound = 0
      metric_interval_upper_bound = 1500
      scaling_adjustment          = 2
    }
    step_adjustment {
      metric_interval_lower_bound = 1500
      scaling_adjustment          = 6
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_backlog_high" {
  alarm_name          = "${local.prefix}-worker-scale-out"
  namespace           = "Dispatch"
  metric_name         = "QueueDepth"
  dimensions          = local.dispatch_dims
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 500
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_appautoscaling_policy.worker_backlog_out.arn]
}

resource "aws_appautoscaling_policy" "worker_backlog_in" {
  name               = "${local.prefix}-worker-backlog-in"
  policy_type        = "StepScaling"
  service_namespace  = aws_appautoscaling_target.worker.service_namespace
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 300
    metric_aggregation_type = "Maximum"
    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_backlog_low" {
  alarm_name          = "${local.prefix}-worker-scale-in"
  namespace           = "Dispatch"
  metric_name         = "QueueDepth"
  dimensions          = local.dispatch_dims
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 15
  threshold           = 50
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_appautoscaling_policy.worker_backlog_in.arn]
}

# ---------------------------------------------------------------- Dashboard

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.prefix
  dashboard_body = jsonencode({
    widgets = [
      for i, w in [
        { title = "Queue depth / oldest job (s)", metrics = [["Dispatch", "QueueDepth", "Environment", var.environment], [".", "OldestPendingJobAgeSeconds", ".", ".", { yAxis = "right" }]] },
        { title = "Messages sent / failed (5 min)", metrics = [["Dispatch", "MessagesSent5m", "Environment", var.environment], [".", "MessagesFailed5m", ".", "."]] },
        { title = "API 5xx / p95 latency", metrics = [["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", local.alb_suffix, { stat = "Sum" }], [".", "TargetResponseTime", ".", ".", { stat = "p95", yAxis = "right" }]] },
        { title = "Running tasks", metrics = [["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", "web"], ["...", "worker"]] },
        { title = "Database CPU / connections", metrics = [["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.main.identifier], [".", "DatabaseConnections", ".", ".", { yAxis = "right" }]] },
        { title = "Failing integrations / feeds", metrics = [["Dispatch", "WebhookEndpointsFailing", "Environment", var.environment], [".", "FeedsFailing", ".", "."]] },
        ] : {
        type       = "metric"
        x          = (i % 2) * 12
        y          = floor(i / 2) * 6
        width      = 12
        height     = 6
        properties = { title = w.title, metrics = w.metrics, region = var.region, view = "timeSeries", period = 60, stat = "Maximum" }
      }
    ]
  })
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}
