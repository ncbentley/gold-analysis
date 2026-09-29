#!/bin/sh
# APP_SECRET encrypts the Telegram session. Generate it only when no value is
# stored yet. Never replace a secret that is already there.
set -eu
SECRET_FILE="${APP_SECRET_FILE:-/data/app-secret}"

if [ -n "${APP_SECRET:-}" ]; then
  echo "APP_SECRET from environment." >&2
else
  mkdir -p "$(dirname "$SECRET_FILE")"
  lock="${SECRET_FILE}.lock"
  while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.05
  done
  trap 'rmdir "$lock" 2>/dev/null || true' EXIT
  if [ -s "$SECRET_FILE" ]; then
    echo "APP_SECRET reused." >&2
  else
    umask 077
    tmp="${SECRET_FILE}.tmp.$$"
    node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > "$tmp"
    mv "$tmp" "$SECRET_FILE"
    echo "APP_SECRET generated." >&2
  fi
  APP_SECRET=$(cat "$SECRET_FILE")
  export APP_SECRET
  rmdir "$lock"
  trap - EXIT
fi

exec "$@"
