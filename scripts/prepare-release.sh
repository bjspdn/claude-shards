#!/usr/bin/env bash
set -euo pipefail

if [[ "$(git branch --show-current)" != "dev" ]]; then
  echo "Error: must be on the dev branch"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean"
  exit 1
fi

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -z "$LAST_TAG" ]; then
  COMMITS=$(git log --oneline)
else
  COMMITS=$(git log "$LAST_TAG"..HEAD --oneline)
fi

if echo "$COMMITS" | grep -qE '^[a-f0-9]+ feat(\(.+\))?!?:'; then
  BUMP="minor"
else
  BUMP="patch"
fi

npm version "$BUMP" --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")

FRAGMENTS=(.changelog/*.md)
if [ ! -e "${FRAGMENTS[0]}" ]; then
  echo "Error: no changelog fragments found in .changelog/"
  exit 1
fi

SECTION="## $VERSION"$'\n'
for f in "${FRAGMENTS[@]}"; do
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    SECTION+=$'\n'"- $line"
  done < "$f"
done
SECTION+=$'\n'

EXISTING=$(cat CHANGELOG.md)
printf '%s\n\n%s\n' "$SECTION" "$EXISTING" > CHANGELOG.md

git rm .changelog/*.md
git add package.json CHANGELOG.md
git commit -m "chore: bump version to $VERSION"

echo "Bumped to $VERSION ($BUMP)"
