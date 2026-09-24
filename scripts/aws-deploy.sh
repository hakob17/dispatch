#!/usr/bin/env bash
# Build, push, migrate, roll out.  Usage: scripts/aws-deploy.sh [image-tag]
# Needs: docker, aws CLI (logged in), terraform state for infra/aws applied once.
set -euo pipefail

TAG="${1:-$(git rev-parse --short HEAD)}"
cd "$(dirname "$0")/.."
TF="terraform -chdir=infra/aws"

VARS=(-var "image_tag=$TAG" ${TFVARS:+-var-file=$TFVARS})
REGION=$($TF output -raw region)
REPO=$($TF output -raw ecr_repository_url)
CLUSTER=$($TF output -raw cluster_name)

echo "→ building $REPO:$TAG"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${REPO%%/*}"
docker build --platform linux/amd64 -t "$REPO:$TAG" -t "$REPO:latest" .
docker push "$REPO:$TAG"
docker push "$REPO:latest"

# 1. register new task definition revisions only — services keep running the old image
echo "→ registering task definitions for $TAG"
$TF apply -auto-approve "${VARS[@]}" -target=aws_ecs_task_definition.web -target=aws_ecs_task_definition.worker

# 2. migrate with the new image before any new code serves traffic
echo "→ running migrations"
TASK_ARN=$(eval "$($TF output -raw migrate_command) --query 'tasks[0].taskArn' --output text")
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"
EXIT=$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' --output text)
[ "$EXIT" = "0" ] || { echo "migration failed (exit $EXIT) — see CloudWatch /ecs/*/web"; exit 1; }

# 3. roll the services onto the new revisions (circuit breaker rolls back on failure)
echo "→ rolling out"
$TF apply -auto-approve "${VARS[@]}"
aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services web worker
echo "✓ deployed $TAG"
