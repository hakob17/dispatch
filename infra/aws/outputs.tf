output "app_url" {
  value = local.public_url
}

output "alb_dns_name" {
  description = "Point domain_name at this (CNAME / Route 53 alias)."
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "media_cdn_domain" {
  value = aws_cloudfront_distribution.media.domain_name
}

output "exports_bucket" {
  value = aws_s3_bucket.exports.id
}

output "push_secret_arns" {
  description = "Put FCM service-account JSON / APNs .p8 contents here, then set enable_*_secret = true."
  value       = { for k, s in aws_secretsmanager_secret.push : k => s.arn }
}

output "ses_dkim_cname_records" {
  description = "Publish these CNAMEs so SES can sign mail for the sending domain."
  value = local.ses_domain == "" ? [] : [
    for t in aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens :
    "${t}._domainkey.${local.ses_domain} CNAME ${t}.dkim.amazonses.com"
  ]
}

output "migrate_command" {
  description = "Run database migrations (one-off task) before rolling out a new image."
  value = join(" ", [
    "aws ecs run-task --region ${var.region} --cluster ${aws_ecs_cluster.main.name}",
    "--launch-type FARGATE --task-definition ${aws_ecs_task_definition.web.family}",
    "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.private[*].id)}],securityGroups=[${aws_security_group.web.id}]}'",
    "--overrides '{\"containerOverrides\":[{\"name\":\"web\",\"command\":[\"npm\",\"run\",\"db:migrate\"]}]}'",
  ])
}

output "region" {
  value = var.region
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}
