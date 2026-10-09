#!/bin/sh
# One-shot deploy to Cloudflare (free tier): D1 database, R2 bucket, schema,
# web build, Worker. Safe to re-run; existing resources are reused.
#
#   pnpm --filter server deploy:all            # deploy
#   pnpm --filter server create-user <name> <password> --admin --remote
set -e
cd "$(dirname "$0")/.."
W="pnpm exec wrangler"

$W whoami >/dev/null 2>&1 || { echo "Not logged in. Run: pnpm --filter server exec wrangler login"; exit 1; }

# D1: create once, then write its id into wrangler.toml.
if grep -q '00000000-0000-0000-0000-000000000000' wrangler.toml; then
  ID=$($W d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).find(x=>x.name==="doggynote");process.stdout.write(d?d.uuid:"")})')
  if [ -z "$ID" ]; then
    $W d1 create doggynote >/dev/null
    ID=$($W d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(JSON.parse(s).find(x=>x.name==="doggynote").uuid)})')
  fi
  sed -i.bak "s/00000000-0000-0000-0000-000000000000/$ID/" wrangler.toml && rm wrangler.toml.bak
  echo "✓ D1 database $ID"
fi

# R2: needs R2 enabled once in the Cloudflare dashboard (free tier, 10 GB).
$W r2 bucket list 2>/dev/null | grep -q "doggynote-assets" || $W r2 bucket create doggynote-assets
echo "✓ R2 bucket doggynote-assets"

$W d1 migrations apply doggynote --remote
pnpm --filter web build
$W deploy
echo "✓ Deployed. Create your account with:"
echo "  pnpm --filter server create-user <name> <password> --admin --remote"
