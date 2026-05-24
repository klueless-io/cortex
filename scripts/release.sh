#!/usr/bin/env bash
# release.sh — bump, build, test, commit, tag, publish
#
# Usage:
#   ./scripts/release.sh patch          # 2.1.1 → 2.1.2
#   ./scripts/release.sh minor          # 2.1.1 → 2.2.0
#   ./scripts/release.sh major          # 2.1.1 → 3.0.0
#   ./scripts/release.sh 2.3.0          # exact version
#
# The script will pause before publishing and ask for your npm OTP.
# Nothing is published until you enter a valid OTP.

set -euo pipefail

PACKAGES=(
  packages/cortex-contracts
  packages/cortex-core
  packages/cortex-testkit
  packages/cortex-provider-libsql
  packages/cortex-provider-sqlite-vec
  packages/cortex-provider-llm-claude-code
)

# ── Resolve new version ──────────────────────────────────────────────────────

BUMP=${1:-}
if [[ -z "$BUMP" ]]; then
  echo "Usage: $0 <patch|minor|major|x.y.z>"
  exit 1
fi

CURRENT=$(node -p "require('./packages/cortex-contracts/package.json').version")

bump_version() {
  local current=$1 part=$2
  IFS='.' read -r major minor patch <<< "$current"
  case "$part" in
    major) echo "$((major+1)).0.0" ;;
    minor) echo "${major}.$((minor+1)).0" ;;
    patch) echo "${major}.${minor}.$((patch+1))" ;;
    *)     echo "$part" ;;  # treat as literal version
  esac
}

NEW=$(bump_version "$CURRENT" "$BUMP")

echo ""
echo "  Cortex release: $CURRENT → $NEW"
echo ""

# ── Verify working tree is clean ─────────────────────────────────────────────

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree is dirty. Commit or stash changes first."
  git status --short
  exit 1
fi

# ── Bump version in all package.json files ───────────────────────────────────

echo "  [1/5] Bumping versions..."
for pkg in "${PACKAGES[@]}"; do
  node -e "
    const fs = require('fs');
    const p = '$pkg/package.json';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.version = '$NEW';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  "
done
echo "        Done — all packages at $NEW"

# ── Build ─────────────────────────────────────────────────────────────────────

echo "  [2/5] Building..."
pnpm build
echo "        Build OK"

# ── Test ──────────────────────────────────────────────────────────────────────

echo "  [3/5] Running tests..."
pnpm test
echo "        Tests OK"

# ── Commit + tag ──────────────────────────────────────────────────────────────

echo "  [4/5] Committing + tagging..."
git add packages/*/package.json
git commit -m "chore: release v${NEW}"
git tag "v${NEW}"
echo "        Committed + tagged v${NEW}"

# ── Publish ───────────────────────────────────────────────────────────────────

echo ""
echo "  [5/5] Ready to publish v${NEW} to npm."
echo "        Enter your npm OTP (or Ctrl-C to abort):"
read -r OTP

pnpm publish -r --access public --otp "$OTP"

echo ""
echo "  ✓ v${NEW} published. Push with:"
echo "    git push origin main --tags"
