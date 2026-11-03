#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
[[ "$EUID" -eq 0 ]] || { echo 'Deployment requires the restricted root runner.' >&2; exit 2; }
[[ "$#" -eq 1 && "$1" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected one full commit SHA' >&2; exit 2; }
cd /srv/sugar
sha=${1:-}
# Validate the checker and its parent directories before running it as root.
for protected in /srv /srv/sugar /srv/sugar/security /srv/sugar/security/check-files.py; do
  [[ -e "$protected" && ! -L "$protected" ]] || { echo 'Unsafe deployment permissions.' >&2; exit 2; }
  if [[ "$protected" == *.py ]]; then [[ -f "$protected" ]] || exit 2; else [[ -d "$protected" ]] || exit 2; fi
  owner=$(stat -c %u "$protected" 2>/dev/null) || exit 2
  mode=$(stat -c %a "$protected" 2>/dev/null) || exit 2
  [[ "$owner" -eq 0 ]] && (( (8#$mode & 0022) == 0 )) || { echo 'Unsafe deployment permissions.' >&2; exit 2; }
done
python3 /srv/sugar/security/check-files.py --root /srv/sugar --owner-uid 0
exec 9>>/srv/sugar/.deploy.lock
flock -w 600 9
read -r registry_token
[[ -n "$registry_token" ]] || exit 2
registry_config=$(mktemp -d)
trap 'rm -rf "$registry_config"' EXIT
export DOCKER_CONFIG="$registry_config"
printf '%s' "$registry_token" | docker login ghcr.io -u picli3 --password-stdin >/dev/null
unset registry_token
previous=''
if [[ -f release.env ]]; then previous=$(sed -n 's/^IMAGE_TAG=//p' release.env); fi
previous_access=''
if [[ -f release.env ]]; then previous_access=$(sed -n 's/^DATABASE_ACCESS=//p' release.env); fi
rollback_file=/srv/sugar/legacy-rollback.yaml
if [[ "$previous" =~ ^[a-f0-9]{40}$ && "$previous_access" != runtime-v1 ]]; then
  [[ -f "$rollback_file" && ! -L "$rollback_file" ]] || exit 2
  [[ "$(stat -c %u "$rollback_file")" -eq 0 ]] || exit 2
  rollback_mode=$(stat -c %a "$rollback_file")
  (( (8#$rollback_mode & 0022) == 0 )) || exit 2
fi
export IMAGE_TAG="$sha"
compose() { docker compose --env-file .env -f compose.yaml "$@"; }
compose config --quiet
compose pull api web
mkdir -p backups
if compose ps --status running --services | grep -qx db; then
  compose exec -T db pg_dump -U designer -d hardware_designer -Fc > "backups/$(date -u +%Y%m%dT%H%M%SZ)-before-${sha:0:12}.dump"
fi
if ! compose up -d --wait --wait-timeout 180 db || ! compose --profile maintenance run --rm --no-deps migrate || ! compose up -d --wait --wait-timeout 180 || ! curl --fail --silent --retry 6 --retry-delay 2 http://127.0.0.1:18088/api/health; then
  if [[ "$previous" =~ ^[a-f0-9]{40}$ ]]; then
    export IMAGE_TAG="$previous"
    if [[ "$previous_access" == runtime-v1 ]]; then
      compose up -d --wait --wait-timeout 180
    else
      # The trusted override restores legacy credentials only for the prior image.
      docker compose --env-file .env -f compose.yaml -f "$rollback_file" up -d --wait --wait-timeout 180
    fi
    echo "Restored previous application images: $previous" >&2
  fi
  echo 'Deployment failed. Database backup retained; no automatic database restore.' >&2
  exit 1
fi
printf 'IMAGE_TAG=%s\nDATABASE_ACCESS=runtime-v1\n' "$sha" > release.env
printf '\nDeployed %s\n' "$sha"
