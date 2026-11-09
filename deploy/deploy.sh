#!/usr/bin/env bash
# Deploy your own Werewolf Dealer instance to a Docker host (optionally behind Caddy):
# sync sources → docker compose up --build → install the Caddy site → reload → health check.
#
#   cp deploy/deploy.env.example deploy/deploy.env   # then edit it
#   deploy/deploy.sh
#
# DEPLOY_ENV=path/to/other.env deploy/deploy.sh uses another config file.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${DEPLOY_ENV:-deploy/deploy.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE: copy deploy/deploy.env.example and fill in your host and domain." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${DEPLOY_HOST:?set DEPLOY_HOST in $ENV_FILE}"
: "${DOMAIN:?set DOMAIN in $ENV_FILE}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/werewolf-dealer}"
HOST_PORT="${HOST_PORT:-3232}"
CADDY_SITE="${CADDY_SITE-/etc/caddy/sites/werewolf.caddy}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"

echo "→ syncing sources to $DEPLOY_DIR"
ssh "$DEPLOY_HOST" "mkdir -p '$DEPLOY_DIR'"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude data --exclude test-results \
  --exclude playwright-report --exclude scripts/.venv --exclude .git --exclude .DS_Store --exclude docs \
  --exclude deploy/deploy.env --exclude CLAUDE.local.md \
  ./ "$DEPLOY_HOST:$DEPLOY_DIR/"

echo "→ building and starting the container"
ssh "$DEPLOY_HOST" "cd '$DEPLOY_DIR' && HOST_PORT='$HOST_PORT' docker compose up -d --build && docker image prune -f >/dev/null"

if [[ -n "$CADDY_SITE" ]]; then
  echo "→ installing the Caddy site ($CADDY_SITE)"
  sed -e "s|{{DOMAIN}}|$DOMAIN|g" -e "s|{{HOST_PORT}}|$HOST_PORT|g" deploy/werewolf.caddy.template |
    ssh "$DEPLOY_HOST" "set -e
      f='$CADDY_SITE'
      if [ -f \"\$f\" ]; then cp \"\$f\" \"\$f.bak\"; fi
      cat > \"\$f\"
      if caddy validate --config '$CADDYFILE' --adapter caddyfile >/dev/null 2>&1; then
        rm -f \"\$f.bak\"
        systemctl reload caddy
      else
        echo 'Caddy rejected the config; restoring the previous site file' >&2
        if [ -f \"\$f.bak\" ]; then mv \"\$f.bak\" \"\$f\"; else rm -f \"\$f\"; fi
        exit 1
      fi"
fi

echo "→ health check"
for _ in $(seq 1 30); do
  if ssh "$DEPLOY_HOST" "curl -fsS http://127.0.0.1:$HOST_PORT/api/health" >/dev/null 2>&1; then
    echo "✓ container healthy"
    break
  fi
  sleep 2
done
# a first deploy needs a few seconds for the certificate
for _ in $(seq 1 20); do
  if curl -fsS "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    echo "✓ https://$DOMAIN is live"
    exit 0
  fi
  sleep 3
done
echo "✗ https://$DOMAIN did not answer (check DNS, the proxy and: ssh $DEPLOY_HOST docker logs werewolf-dealer)" >&2
exit 1
