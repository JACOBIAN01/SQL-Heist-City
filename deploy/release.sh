#!/usr/bin/env bash
# Release and rollback (Phase 20.7).
#   ./release.sh <tag>      deploy that image tag; if the stack is not healthy, go back to the last good tag
#   ./release.sh rollback   go back to the last good tag
#   ./release.sh status     what is running
# Run in the folder holding compose.yaml and .env. State is kept in .release/ (current, previous).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .release
COMPOSE=(docker compose -f "${COMPOSE_FILE:-compose.yaml}" ${COMPOSE_EXTRA:+$COMPOSE_EXTRA})
current() { cat .release/current 2>/dev/null || true; }
# Every container running and, where it has a health check, healthy. "Still starting" when time
# is up counts as failed, and one that reports unhealthy fails at once.
wait_healthy() {
  local tag="$1" deadline=$((SECONDS + ${WAIT_SECONDS:-120})) report bad
  while [ "$SECONDS" -lt "$deadline" ]; do
    report="$(TAG="$tag" "${COMPOSE[@]}" ps --all --format '{{.Service}} {{.State}} {{.Health}}')"
    if grep -qE ' (unhealthy|exited|dead)( |$)' <<<"$report"; then
      echo "$report"; return 1
    fi
    bad="$(grep -vE ' running (healthy)?$' <<<"$report" || true)"
    [ -z "$bad" ] && return 0
    sleep 2
  done
  echo "not healthy in ${WAIT_SECONDS:-120}s:"; echo "$bad"; return 1
}
set_tag() {
  # .env wins over the environment for compose, so TAG is passed explicitly.
  TAG="$1" "${COMPOSE[@]}" up -d --remove-orphans
  wait_healthy "$1"
}

case "${1:-}" in
  status)
    echo "current: $(current)  previous: $(cat .release/previous 2>/dev/null || echo none)"
    TAG="$(current)" "${COMPOSE[@]}" ps --format '{{.Service}}: {{.Image}} {{.Status}}'
    exit 0
    ;;
  rollback)
    target="$(cat .release/previous 2>/dev/null || true)"
    [ -n "$target" ] || { echo "no previous release recorded"; exit 1; }
    bad="$(current)"
    set_tag "$target"
    echo "$target" > .release/current
    echo "$bad" > .release/previous
    echo "rolled back $bad -> $target"
    exit 0
    ;;
  '') echo "usage: release.sh <tag>|rollback|status"; exit 2 ;;
esac

new="$1"
old="$(current)"
# Optional hook: take a backup before changing anything (e.g. BACKUP_CMD="./backup.sh").
if [ -n "${BACKUP_CMD:-}" ]; then echo "backup: $BACKUP_CMD"; bash -c "$BACKUP_CMD"; fi
echo "release $new (was ${old:-nothing})"
# Pulling first means a missing image stops the release before anything has changed.
if [ "${SKIP_PULL:-}" != 1 ]; then TAG="$new" "${COMPOSE[@]}" pull --quiet; fi
if set_tag "$new"; then
  echo "${old:-}" > .release/previous
  echo "$new" > .release/current
  echo "released $new"
else
  echo "release $new is not healthy"
  if [ -n "$old" ]; then
    set_tag "$old" && echo "back on $old" || echo "ROLLBACK FAILED: fix by hand"
  fi
  exit 1
fi
