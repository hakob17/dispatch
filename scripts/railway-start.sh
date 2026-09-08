#!/usr/bin/env bash
# Railway start: run migrations, then web + worker in one service.
# If either process dies, exit so Railway restarts the service.
set -e

npx prisma migrate deploy

npx next start -p "${PORT:-3000}" &
npx tsx worker/index.ts &

wait -n
exit 1
