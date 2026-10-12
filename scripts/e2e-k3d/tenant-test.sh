#!/usr/bin/env bash
# @file tenant-test.sh
# @description k3d E2E with auth and multi-tenancy ON: bootstrap admin, onboarding, tenant isolation (TASK-367).
#
# The production chart has no value for MULTI_TENANCY_ENABLED or the bootstrap
# admin, and values-k3d.yaml runs AUTH_DISABLED=true for the import test. So
# this stage switches the installed server over with `kubectl set env`, runs
# its checks, and switches it back on exit — test.sh and a later install.sh see
# the server exactly as the chart left it.
#
# Each step is a hard assertion:
#   1. an anonymous API call answers 401
#   2. the bootstrap super-admin signs in; its tenant list answers
#   3. onboarding two tenants puts each owner in ITS tenant, with
#      mustChangePassword, and re-onboarding a slug answers 409
#   4. the forced password change clears the flag
#   5. tenant A registers the demo robot; tenant B gets 404 on it for GET,
#      telemetry, command and delete, and A still reads it
#   6. an anonymous WebSocket receives no event while the robot streams
#      (needs node 22+; skipped without it)
#
# Knobs: E2E_PORT (default 18081). Slugs carry a timestamp, so it re-runs on
# the same cluster; the robot is unregistered again at the end.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

need kubectl
need curl
need jq

PORT="${E2E_PORT:-18081}"
API="http://127.0.0.1:$PORT/api"
WORK="$(mktemp -d)"
PF_PID=""
ADMIN_EMAIL="e2e-admin@neodem.test"
ADMIN_PASSWORD="E2eAdmin2026"
RUN="$(date +%s)"
ENV_SET=0

SERVER_DEPLOY="$(kc get deploy -l app.kubernetes.io/component=server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
SERVER_SVC="$(kc get svc -l app.kubernetes.io/component=server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
ROBOT_SVC="$(kc get svc -o name 2>/dev/null | sed -n 's|^service/\(.*robot-agent-g1-01\)$|\1|p' | head -1)"
[ -n "$SERVER_DEPLOY" ] || fail "no server Deployment in $NAMESPACE — run install.sh first"

stop_forward() {
  [ -n "$PF_PID" ] || return 0
  kill "$PF_PID" 2>/dev/null || true
  ( sleep 5; kill -9 "$PF_PID" 2>/dev/null ) &
  local watchdog=$!
  wait "$PF_PID" 2>/dev/null || true
  kill "$watchdog" 2>/dev/null || true
  PF_PID=""
}

cleanup() {
  local rc=$?
  stop_forward
  if [ "$ENV_SET" = 1 ]; then
    log "restoring the server's chart environment"
    kc set env "deploy/$SERVER_DEPLOY" AUTH_DISABLED- MULTI_TENANCY_ENABLED- \
      BOOTSTRAP_ADMIN_EMAIL- BOOTSTRAP_ADMIN_PASSWORD- >/dev/null 2>&1 || true
    kc rollout status "deploy/$SERVER_DEPLOY" --timeout=180s >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

dump_server_logs() {
  log "last server log lines:"
  kc logs "deploy/$SERVER_DEPLOY" --tail=60 2>/dev/null || true
}

# --- switch auth + multi-tenancy on ------------------------------------------
log "switching $SERVER_DEPLOY to AUTH_DISABLED=false, MULTI_TENANCY_ENABLED=true"
ENV_SET=1
kc set env "deploy/$SERVER_DEPLOY" AUTH_DISABLED=false MULTI_TENANCY_ENABLED=true \
  BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL" BOOTSTRAP_ADMIN_PASSWORD="$ADMIN_PASSWORD" >/dev/null
kc rollout status "deploy/$SERVER_DEPLOY" --timeout=300s >/dev/null \
  || { dump_server_logs; fail "server did not roll out with auth on"; }

# After the rollout: a forward started earlier would be bound to the old pod.
if command -v lsof >/dev/null 2>&1; then
  holder="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  [ -z "$holder" ] || fail "port $PORT is already in use by PID $holder — stop it or set E2E_PORT"
fi
kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" port-forward "svc/$SERVER_SVC" "$PORT:3001" >"$WORK/pf.log" 2>&1 &
PF_PID=$!
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/health" 2>/dev/null && break
  kill -0 "$PF_PID" 2>/dev/null || fail "port-forward died: $(cat "$WORK/pf.log")"
  sleep 1
done

# --- helpers -------------------------------------------------------------------
# call METHOD PATH [TOKEN] [JSON] → body in $WORK/body, prints the status code
call() {
  local method="$1" path="$2" token="${3:-}" body="${4:-}"
  local args=(-sS -o "$WORK/body" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}" "$API$path"
}
expect() { # expect CODE METHOD PATH [TOKEN] [JSON]
  local want="$1"; shift
  local got; got="$(call "$@")"
  [ "$got" = "$want" ] || { dump_server_logs; fail "$1 $2 answered $got, expected $want: $(head -c 300 "$WORK/body")"; }
}
login() { # login EMAIL PASSWORD → access token (the auth limiter allows 5 a minute)
  expect 200 POST /auth/login "" "$(jq -nc --arg e "$1" --arg p "$2" '{email:$e,password:$p}')"
  jq -r .accessToken "$WORK/body"
}

# --- 1. anonymous is refused ---------------------------------------------------
expect 401 GET /robots
ok "anonymous API call refused (401)"

# --- 2. bootstrap super-admin ----------------------------------------------------
ROOT="$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
expect 200 GET /auth/me "$ROOT"
[ "$(jq -r '.user.role // .role' "$WORK/body")" = super-admin ] || fail "bootstrap admin is not a super-admin: $(cat "$WORK/body")"
expect 200 GET /tenants "$ROOT"
ok "bootstrap super-admin signs in and lists tenants"

# --- 3. onboarding puts each owner in its own tenant -----------------------------
onboard() { # onboard SLUG EMAIL → new tenant id
  expect 201 POST /tenants/onboard "$ROOT" "$(jq -nc --arg s "$1" --arg e "$2" \
    '{tenant:{name:$s,slug:$s},adminUser:{email:$e,name:"E2E Owner",password:"E2eTemp2026"}}')"
  jq -r .tenant.id "$WORK/body"
}
TENANT_A="$(onboard "e2e-a-$RUN" "owner-a-$RUN@neodem.test")"
TENANT_B="$(onboard "e2e-b-$RUN" "owner-b-$RUN@neodem.test")"
expect 409 POST /tenants/onboard "$ROOT" "$(jq -nc --arg s "e2e-a-$RUN" \
  '{tenant:{name:$s,slug:$s},adminUser:{email:"other@neodem.test",name:"x",password:"E2eTemp2026"}}')"

TOKEN_A="$(login "owner-a-$RUN@neodem.test" E2eTemp2026)"
TOKEN_B="$(login "owner-b-$RUN@neodem.test" E2eTemp2026)"
for pair in "A $TOKEN_A $TENANT_A" "B $TOKEN_B $TENANT_B"; do
  set -- $pair
  expect 200 GET /auth/me "$2"
  [ "$(jq -r '.user.tenantId // .tenantId' "$WORK/body")" = "$3" ] \
    || fail "owner $1 is not in its tenant $3: $(cat "$WORK/body")"
  [ "$(jq -r '.user.forcePasswordChange // .forcePasswordChange' "$WORK/body")" = true ] \
    || fail "owner $1 is not asked to change the temporary password"
done
ok "onboarded owners belong to their own tenants, re-onboarding a slug is 409"

# --- 4. forced password change ---------------------------------------------------
expect 200 POST /auth/change-password "$TOKEN_A" '{"currentPassword":"E2eTemp2026","newPassword":"E2eOwnerA2027"}'
expect 200 GET /auth/me "$TOKEN_A"
[ "$(jq -r '.user.forcePasswordChange // .forcePasswordChange' "$WORK/body")" = false ] \
  || fail "the password change did not clear forcePasswordChange"
ok "forced password change clears the flag"

# --- 5. robot isolation ----------------------------------------------------------
if [ -z "$ROBOT_SVC" ]; then
  log "no demo robot Service (robot-agent-g1-01) — skipping robot isolation"
else
  expect 200 POST /robots/register "$TOKEN_A" "$(jq -nc --arg u "http://$ROBOT_SVC:41243" '{robotUrl:$u}')"
  ROBOT_ID="$(jq -r '.robot.id // .id' "$WORK/body")"
  expect 200 GET "/robots/$ROBOT_ID" "$TOKEN_A"
  expect 404 GET "/robots/$ROBOT_ID" "$TOKEN_B"
  expect 404 GET "/robots/$ROBOT_ID/telemetry" "$TOKEN_B"
  expect 404 POST "/robots/$ROBOT_ID/command" "$TOKEN_B" '{"type":"stop"}'
  expect 404 DELETE "/robots/$ROBOT_ID" "$TOKEN_B"
  expect 200 GET "/robots/$ROBOT_ID" "$TOKEN_A"
  [ "$(jq -r '.robots | length' <<<"$(call GET /robots "$TOKEN_B" >/dev/null; cat "$WORK/body")")" = 0 ] \
    || fail "tenant B lists robots it does not own"
  ok "tenant B cannot read, command or delete tenant A's robot"

  # --- 6. anonymous WebSocket ----------------------------------------------------
  if command -v node >/dev/null 2>&1 && node -e 'process.exit(typeof WebSocket === "function" ? 0 : 1)'; then
    frames="$(node -e '
      const ws = new WebSocket(process.argv[1]); let n = 0;
      ws.onmessage = (m) => { if (JSON.parse(m.data).type !== "connected") n++; };
      setTimeout(() => { console.log(n); process.exit(0); }, 6000);
    ' "ws://127.0.0.1:$PORT/api/a2a/ws")"
    [ "$frames" = 0 ] || fail "an anonymous WebSocket received $frames events"
    ok "anonymous WebSocket receives no events"
  else
    log "node 22+ not found — skipping the WebSocket check"
  fi

  expect 200 DELETE "/robots/$ROBOT_ID" "$TOKEN_A"
fi

ok "tenant-test.sh"
