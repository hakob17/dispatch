# SES configuration set → SNS → /api/webhooks/ses (bounces, complaints, deliveries).
# The endpoint verifies SNS signatures and only accepts this topic (SES_SNS_TOPIC_ARNS).

resource "aws_sesv2_configuration_set" "main" {
  configuration_set_name = local.prefix
  reputation_options {
    reputation_metrics_enabled = true
  }
  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}

resource "aws_sns_topic" "ses_events" {
  name = "${local.prefix}-ses-events"
}

data "aws_caller_identity" "current" {}

resource "aws_sns_topic_policy" "ses_events" {
  arn = aws_sns_topic.ses_events.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSesPublish"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.ses_events.arn
      Condition = { StringEquals = { "AWS:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_sesv2_configuration_set_event_destination" "sns" {
  configuration_set_name = aws_sesv2_configuration_set.main.configuration_set_name
  event_destination_name = "sns"
  event_destination {
    enabled              = true
    matching_event_types = ["BOUNCE", "COMPLAINT", "DELIVERY"]
    sns_destination {
      topic_arn = aws_sns_topic.ses_events.arn
    }
  }
}

# Subscribes once the app is reachable over HTTPS; the app auto-confirms.
resource "aws_sns_topic_subscription" "ses_webhook" {
  count                  = local.https ? 1 : 0
  topic_arn              = aws_sns_topic.ses_events.arn
  protocol               = "https"
  endpoint               = "${local.public_url}/api/webhooks/ses"
  endpoint_auto_confirms = true
}

# Sending domain identity (DKIM records are in the outputs — add them to DNS)
resource "aws_sesv2_email_identity" "domain" {
  count                  = local.ses_domain != "" ? 1 : 0
  email_identity         = local.ses_domain
  configuration_set_name = aws_sesv2_configuration_set.main.configuration_set_name
}
