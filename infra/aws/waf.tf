# AWS WAF on the load balancer: AWS managed rule groups + a per-IP rate limit.
# The SDK/tracking endpoints see real user traffic, so the rate limit is generous;
# tighten it (or add an IP allowlist for the console) to taste.

variable "waf_rate_limit_per_5min" {
  type        = number
  description = "Requests per 5 minutes per client IP before WAF blocks it."
  default     = 20000
}

resource "aws_wafv2_web_acl" "main" {
  name  = local.prefix
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  dynamic "rule" {
    for_each = {
      AWSManagedRulesAmazonIpReputationList = 1
      AWSManagedRulesCommonRuleSet          = 2
      AWSManagedRulesKnownBadInputsRuleSet  = 3
      AWSManagedRulesSQLiRuleSet            = 4
    }
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.key
          # Template/HTML bodies legitimately exceed 8 KB and contain markup
          dynamic "rule_action_override" {
            for_each = rule.key == "AWSManagedRulesCommonRuleSet" ? ["SizeRestrictions_BODY", "CrossSiteScripting_BODY"] : []
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 10
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5min
        aggregate_key_type = "IP" # clients connect to the ALB directly
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-per-ip"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = local.prefix
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}
