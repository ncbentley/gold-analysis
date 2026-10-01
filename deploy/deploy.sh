#!/usr/bin/env bash
# Ships the working tree to the VPS and rebuilds the image there.
# The queue keeps its Telegram session unless the worker code changed.
# Usage: deploy/deploy.sh            (DEPLOY_HOST and DEPLOY_DIR override the defaults)
set -euo pipefail

HOST="${DEPLOY_HOST:-inbound-prod}"
DIR="${DEPLOY_DIR:-/srv/gold}"
cd "$(dirname "$0")/.."

rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .data --exclude .git \
  --exclude '/.env' --exclude '/.env.*' --exclude tsconfig.tsbuildinfo --exclude mockups \
  --exclude deploy/.env --exclude 'deploy/*.dump' \
  ./ "$HOST:$DIR/"

ssh "$HOST" DIR="$DIR" bash -s <<'REMOTE'
set -euo pipefail
cd "$DIR/deploy"
test -f .env || { echo "Missing $DIR/deploy/.env (see deploy/env.example)" >&2; exit 1; }
# Queue is omitted here. It shares the app image, so a normal up would recreate
# it on every website change and drop the Telegram session.
docker compose up -d --build --remove-orphans postgres app caddy tunnel

# Hash of the files the queue process loads. Same command runs on the host and
# inside the container, so a website-only change does not recreate it.
worker_hash() {
  (
    cd "$1"
    find Dockerfile package.json pnpm-lock.yaml pnpm-workspace.yaml \
      docker/entrypoint.sh scripts/queue-worker.ts scripts/seed.ts \
      src/server drizzle \
      -type f ! -name '*.test.ts' ! -name '*.test.tsx' -print \
      | LC_ALL=C sort \
      | while IFS= read -r file; do
          printf '%s ' "$file"
          sha256sum "$file" | awk '{print $1}'
        done \
      | sha256sum \
      | awk '{print $1}'
  )
}

if [ -z "$(docker compose ps -q queue)" ]; then
  echo "Queue is not running. Starting it."
  docker compose up -d --no-deps queue
else
  current=$(worker_hash "$DIR")
  running=$(docker compose exec -T queue sh -c "$(declare -f worker_hash); worker_hash /app")
  if [ "$current" != "$running" ]; then
    echo "Worker code changed. Recreating the queue."
    docker compose up -d --no-deps --force-recreate queue
  else
    echo "Worker code unchanged. Leaving the queue running."
  fi
fi
docker image prune -f >/dev/null

# A quick tunnel gets a new address each time it starts; keep APP_URL on it.
if ! grep -q '^TUNNEL_TOKEN=.' .env; then
  url=""
  for _ in $(seq 1 30); do
    url=$(docker compose logs tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)
    [ -n "$url" ] && break
    sleep 2
  done
  if [ -z "$url" ]; then
    echo "Tunnel address not found; check: docker compose logs tunnel" >&2
    exit 1
  fi
  if ! grep -qx "APP_URL=$url" .env; then
    sed -i "s#^APP_URL=.*#APP_URL=$url#" .env
    docker compose up -d --no-deps app
  fi
  echo "Live at $url"
fi
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
REMOTE
