#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
mana_registry_user="${1:-}"
if [[ ! "$mana_registry_user" =~ ^[a-z0-9][a-z0-9_-]{2,29}$ ]]; then
  echo 'Usage: bash publish-image.sh YOUR_DOCKER_HUB_USERNAME --development' >&2
  exit 1
fi
if [[ "${2:-}" != '--development' ]]; then
  echo 'Production quality review has not passed. This package can only be published with --development for isolated testing.' >&2
  exit 1
fi
command -v docker >/dev/null || { echo 'Docker must be installed and running to publish this image.' >&2; exit 1; }
docker info >/dev/null
mana_image_tag="${mana_registry_user}/mana-precision-ocr:cpu-preview-v1"
echo 'This publishes program files and public model weights only. No website data or secrets are included.'
docker login
docker buildx build --platform linux/amd64 --file Dockerfile --tag "$mana_image_tag" --push .
printf '\nPublished image address: %s\n' "$mana_image_tag"
