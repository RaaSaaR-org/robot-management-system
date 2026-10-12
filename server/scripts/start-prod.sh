#!/bin/sh
# @file start-prod.sh
# @description Production entrypoint: apply migrations once the database answers, then run the server (TASK-364).
#
# On a fresh install the server pod usually starts before Postgres accepts
# connections. `prisma migrate deploy` then exits with P1001 ("Can't reach
# database server") and the pod restarted — twice, measured on k3d. Here an
# unreachable database is waited out with backoff, up to DB_WAIT_TIMEOUT
# seconds (default 120). Any other migration error fails at once: retrying a
# broken migration only hides it.
set -u

timeout="${DB_WAIT_TIMEOUT:-120}"
delay=1
start=$(date +%s)
out="$(mktemp)"

while :; do
  if npx prisma migrate deploy >"$out" 2>&1; then
    cat "$out"
    break
  fi
  if ! grep -q 'P1001' "$out"; then
    cat "$out" >&2
    echo "[start-prod] prisma migrate deploy failed (not a connection error) — giving up" >&2
    rm -f "$out"
    exit 1
  fi
  elapsed=$(( $(date +%s) - start ))
  if [ "$elapsed" -ge "$timeout" ]; then
    cat "$out" >&2
    echo "[start-prod] database still unreachable after ${elapsed}s (DB_WAIT_TIMEOUT=${timeout})" >&2
    rm -f "$out"
    exit 1
  fi
  echo "[start-prod] database not reachable yet (P1001) — retrying in ${delay}s (${elapsed}s of ${timeout}s)"
  sleep "$delay"
  delay=$(( delay * 2 )); [ "$delay" -gt 10 ] && delay=10
done

rm -f "$out"
exec node dist/index.js
