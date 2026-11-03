#!/usr/bin/env bash
set -euo pipefail
if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy\ ([a-f0-9]{40})$ ]]; then
  if [[ "$EUID" -eq 0 ]]; then exec /srv/sugar/deploy.sh "${BASH_REMATCH[1]}"; fi
  exec /usr/bin/sudo --non-interactive -- /srv/sugar/deploy.sh "${BASH_REMATCH[1]}"
fi
echo 'This key can only deploy a Sugar commit.' >&2
exit 2
