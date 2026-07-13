#!/usr/bin/env bash
# deploy.sh <html-file> <site-name> [--force]
#
# Strips the claude.ai frame-runtime block from an artifact HTML file and
# deploys it to the internal Brisk instance. Tries the VPN URL first; if
# unreachable, falls back to a kubectl port-forward into the staging cluster.
set -euo pipefail

FILE="${1:?usage: deploy.sh <html-file> <site-name> [--force]}"
NAME="${2:?usage: deploy.sh <html-file> <site-name> [--force]}"
FORCE="${3:-}"
SERVER="${BRISK_SERVER:-https://brisk.sm-svc.com}"
USERNAME="${BRISK_USERNAME:-$(whoami)}"
KUBE_CTX="plat-staging:AdministratorAccess-sawmills-plat-ue1-staging-eks-cluster"
PF_PORT=18899

CLEAN="$(mktemp -t artifact2brisk).html"
# Remove the claude.ai iframe glue (postMessage bridge, capability loader,
# RTC lockdown). It's inert on a standalone origin but it's ~6KB of noise.
perl -0pe 's/<!-- frame-runtime -->.*?<!-- \/frame-runtime -->//s' "$FILE" > "$CLEAN"

QS=""
[ "$FORCE" = "--force" ] && QS="?force=1"

deploy() {
  local base="$1"
  curl -sS --max-time 30 -X POST \
    -H "x-brisk-username: $USERNAME" \
    -F "files=@$CLEAN;filename=index.html" \
    "$base/api/deploy/$NAME$QS"
}

if curl -sf --max-time 5 -o /dev/null "$SERVER/auth/login"; then
  OUT=$(deploy "$SERVER")
else
  echo "note: $SERVER unreachable (off VPN?) — falling back to kubectl port-forward" >&2
  kubectl --context "$KUBE_CTX" port-forward -n brisk svc/brisk-brisk "$PF_PORT:80" >/dev/null 2>&1 &
  PF=$!
  trap 'kill $PF 2>/dev/null' EXIT
  sleep 8
  OUT=$(deploy "http://127.0.0.1:$PF_PORT")
fi

echo "$OUT"
echo
if echo "$OUT" | grep -q '"error"'; then
  echo "deploy failed — if it's an ownership 409, rerun with --force" >&2
  exit 1
fi
echo "live: https://$NAME.brisk.sm-svc.com/ (VPN)"
