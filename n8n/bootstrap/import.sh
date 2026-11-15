#!/bin/sh
# One-shot n8n bootstrap, run by the `n8n-import` service in docker-compose.yml:
#   1. turns the signing secrets (env vars from .env.automation) into n8n
#      credentials, which n8n encrypts with its instance key;
#   2. imports the workflows from n8n/workflows (they hold no secrets, only
#      credential references);
#   3. publishes them so their webhooks and schedules are live.
# The plain-text credentials file only ever exists on this container's tmpfs.
set -eu

for name in CONVEX_TO_N8N_SIGNING_SECRET N8N_TO_CONVEX_SIGNING_SECRET; do
  eval "value=\${$name:-}"
  if [ "${#value}" -lt 32 ]; then
    echo "n8n-import: $name must be set in .env.automation (at least 32 characters)" >&2
    exit 1
  fi
done

umask 077
credentials=/tmp/lendloop-credentials.json
trap 'rm -f "$credentials"' EXIT

node /bootstrap/credentials.mjs > "$credentials"
n8n import:credentials --input="$credentials"
rm -f "$credentials"

n8n import:workflow --separate --input=/workflows

for file in /workflows/*.json; do
  id=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).id)' "$file")
  n8n publish:workflow --id="$id"
done

echo "n8n-import: credentials and workflows are in place"
