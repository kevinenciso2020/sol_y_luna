#!/usr/bin/env bash
# Deploys the store (apps/web) to Cloudflare Workers from a CLEAN copy of the current commit.
#
# Why a clean copy: Astro inlines PUBLIC_* variables at build time, and local files such as
# apps/web/.dev.vars or apps/web/.env (development values) would override them. Building from a
# temporary git worktree guarantees that only committed code and the variables below are used.
#
# Usage (see docs/DEPLOY.md):
#   PUBLIC_SITE_URL=https://... PUBLIC_TURNSTILE_SITE_KEY=0x... \
#   [PUBLIC_WHATSAPP_NUMBER=57...] [PUBLIC_CLOUDINARY_CLOUD_NAME=...] scripts/deploy-web.sh
#
# Worker secrets (API_INTERNAL_URL, BFF_SHARED_SECRET) are set once with `wrangler secret put`.
set -euo pipefail

: "${PUBLIC_SITE_URL:?Falta PUBLIC_SITE_URL (URL pública de la tienda)}"
: "${PUBLIC_TURNSTILE_SITE_KEY:?Falta PUBLIC_TURNSTILE_SITE_KEY (obligatoria en producción)}"
export PUBLIC_SITE_URL PUBLIC_TURNSTILE_SITE_KEY
export PUBLIC_WHATSAPP_NUMBER="${PUBLIC_WHATSAPP_NUMBER:-}"
export PUBLIC_CLOUDINARY_CLOUD_NAME="${PUBLIC_CLOUDINARY_CLOUD_NAME:-}"

ROOT="$(git rev-parse --show-toplevel)"
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "Aviso: hay cambios sin commit; se despliega el último commit ($(git -C "$ROOT" rev-parse --short HEAD))." >&2
fi

WORKTREE="$(mktemp -d)"
cleanup() { git -C "$ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true; }
trap cleanup EXIT
git -C "$ROOT" worktree add --detach "$WORKTREE" HEAD >/dev/null

cd "$WORKTREE"
pnpm install --frozen-lockfile
pnpm build:shared
cd apps/web
pnpm build
pnpm exec wrangler deploy
