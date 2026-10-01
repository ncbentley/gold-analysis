#!/usr/bin/env bash
# Ships the working tree to the VPS, rebuilds the image there and restarts the stack.
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
docker compose up -d --build --remove-orphans
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
    docker compose up -d app queue
  fi
  echo "Live at $url"
fi
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
REMOTE
