#!/usr/bin/env bash
#
# scripts/test-auth.sh — End-to-end smoke test for the auth feature.
#
# Tests every endpoint defined in src/routes/auth.routes.js + src/routes/user.routes.js
# in dependency order, asserts status codes and key response shapes, prints a
# pass/fail table, and exits non-zero on any failure.
#
# PREREQUISITES (read README.md or docs/prd-auth.md):
#   1. docker compose up -d   (starts Mongo replica set on 27017)
#   2. .env populated with JWT_SECRET ≥32 chars, OTP_DUMMY=true (default)
#   3. npm run dev            (server on http://localhost:3000)
#
# OPTIONAL — admin tests:
#   To exercise admin-gated endpoints, run:
#     node scripts/create-admin.js
#   then re-run this script with:
#     ADMIN_EMAIL=... ADMIN_PASSWORD=... ./scripts/test-auth.sh
#
# OPTIONAL — reset-password happy path:
#   forgot-password logs the reset token to the server console (stdout).
#   To exercise the full reset flow, copy the token from server logs and run:
#     RESET_TOKEN=<hex token> ./scripts/test-auth.sh
#   The script will skip the reset-password assertion if RESET_TOKEN is unset
#   (everything else still runs).
#
# CONFIG (override via env):
#   BASE_URL   default http://localhost:3000
#   VERBOSE    1 to dump every request/response (default 0)
#
# Required tools: bash, curl, jq.

set -u
set -o pipefail

# ---------- config ----------------------------------------------------------
BASE_URL="${BASE_URL:-http://localhost:3000}"
API="${BASE_URL}/api/v1"
VERBOSE="${VERBOSE:-0}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
RESET_TOKEN="${RESET_TOKEN:-}"

# Unique-per-run identity so the script is rerunnable without colliding with
# previous soft-deleted accounts in the DB.
STAMP="$(date +%s)$$"
TEST_EMAIL="apitest+${STAMP}@example.com"
TEST_USERNAME="apitest_${STAMP}"
TEST_PASSWORD="CorrectHorse123!"
NEW_PASSWORD="Battery_Staple_456!"
RESET_NEW_PASSWORD="Reset_Pass_789!"

# ---------- prerequisite checks --------------------------------------------
for tool in curl jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "FATAL: '$tool' is required but not installed." >&2
    exit 2
  fi
done

# ---------- output helpers --------------------------------------------------
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
  RED=""; GREEN=""; YELLOW=""; DIM=""; BOLD=""; RESET=""
fi

PASS=0
FAIL=0
SKIP=0
declare -a RESULTS=()  # "PASS|status|method|path|note" per row

record() {
  # record OUTCOME STATUS METHOD PATH NOTE
  local outcome="$1" status="$2" method="$3" path="$4" note="${5:-}"
  RESULTS+=("${outcome}|${status}|${method}|${path}|${note}")
  case "$outcome" in
    PASS) PASS=$((PASS+1)) ;;
    FAIL) FAIL=$((FAIL+1)) ;;
    SKIP) SKIP=$((SKIP+1)) ;;
  esac
}

# ---------- request helper --------------------------------------------------
# Sets globals: HTTP_STATUS, HTTP_BODY, HTTP_TIME_MS
#
# Usage: req METHOD PATH [BODY_JSON] [AUTH_TOKEN]
req() {
  local method="$1" path="$2" body="${3:-}" token="${4:-}"
  local url="${API}${path}"
  # /health and other top-level paths can be tested by passing path starting with http
  if [[ "$path" == /health* ]]; then
    url="${BASE_URL}${path}"
  fi

  local tmp_body tmp_meta
  tmp_body="$(mktemp)"
  tmp_meta="$(mktemp)"

  local -a curl_args=(
    -s -o "$tmp_body"
    -w '%{http_code} %{time_total}'
    -X "$method"
    -H 'Accept: application/json'
  )
  if [ -n "$token" ]; then
    curl_args+=(-H "Authorization: Bearer ${token}")
  fi
  if [ -n "$body" ]; then
    curl_args+=(-H 'Content-Type: application/json' --data "$body")
  fi

  # shellcheck disable=SC2086
  curl "${curl_args[@]}" "$url" >"$tmp_meta" 2>/dev/null || true

  read -r HTTP_STATUS HTTP_TIME_SEC <"$tmp_meta"
  HTTP_STATUS="${HTTP_STATUS:-000}"
  # convert seconds to ms
  HTTP_TIME_MS="$(awk -v t="${HTTP_TIME_SEC:-0}" 'BEGIN{ printf "%d", t*1000 }')"
  HTTP_BODY="$(cat "$tmp_body")"
  rm -f "$tmp_body" "$tmp_meta"

  if [ "$VERBOSE" = "1" ]; then
    printf '%s──── %s %s ────%s\n' "$DIM" "$method" "$path" "$RESET"
    [ -n "$body" ] && printf '%s>> %s%s\n' "$DIM" "$body" "$RESET"
    printf '%s<< %s in %sms\n   %s%s\n' "$DIM" "$HTTP_STATUS" "$HTTP_TIME_MS" "$HTTP_BODY" "$RESET"
  fi
}

# Pretty assertion. Returns 0 on pass, 1 on fail. Records the row.
expect() {
  # expect EXPECTED_STATUS METHOD PATH NOTE [JQ_PREDICATE]
  local expected="$1" method="$2" path="$3" note="$4" predicate="${5:-}"
  local outcome="PASS"
  local detail=""

  if [ "$HTTP_STATUS" != "$expected" ]; then
    outcome="FAIL"
    detail="want ${expected}, got ${HTTP_STATUS}"
  elif [ -n "$predicate" ]; then
    # Run the jq predicate; it must print "true" on success.
    local result
    result="$(printf '%s' "$HTTP_BODY" | jq -r "$predicate" 2>/dev/null || true)"
    if [ "$result" != "true" ]; then
      outcome="FAIL"
      detail="body predicate failed: ${predicate}"
    fi
  fi

  if [ "$outcome" = "PASS" ]; then
    printf '  %s✓%s %-6s %-38s %s%s%s  (%sms)  %s\n' \
      "$GREEN" "$RESET" "$method" "$path" "$DIM" "$HTTP_STATUS" "$RESET" "$HTTP_TIME_MS" "$note"
  else
    printf '  %s✗%s %-6s %-38s %s%s%s  (%sms)  %s%s%s\n' \
      "$RED" "$RESET" "$method" "$path" "$RED" "$HTTP_STATUS" "$RESET" "$HTTP_TIME_MS" "$RED" "$detail" "$RESET"
    printf '    %s%s%s\n' "$DIM" "$(printf '%s' "$HTTP_BODY" | head -c 400)" "$RESET"
  fi
  record "$outcome" "$HTTP_STATUS" "$method" "$path" "$note"
}

skip_row() {
  # skip_row METHOD PATH NOTE
  local method="$1" path="$2" note="$3"
  printf '  %s○%s %-6s %-38s %s---%s         %s\n' \
    "$YELLOW" "$RESET" "$method" "$path" "$DIM" "$RESET" "$note"
  record "SKIP" "---" "$method" "$path" "$note"
}

section() {
  printf '\n%s%s%s\n' "$BOLD" "$1" "$RESET"
  printf '%s%s%s\n' "$DIM" "$(printf '%.0s─' {1..70})" "$RESET"
}

# ---------- preflight: server is up? ---------------------------------------
section "Preflight"
req GET /health
if [ "$HTTP_STATUS" != "200" ]; then
  echo "${RED}FATAL${RESET}: server is not responding at ${BASE_URL}/health (got ${HTTP_STATUS})." >&2
  echo "Start it with: docker compose up -d  &&  npm run dev" >&2
  exit 2
fi
expect 200 GET /health "server reachable" '.status == "ok"'

# ===========================================================================
# Public auth flow
# ===========================================================================
section "Public auth flow"

# 1. Register
req POST /auth/register "$(jq -nc \
  --arg e "$TEST_EMAIL" --arg u "$TEST_USERNAME" --arg p "$TEST_PASSWORD" \
  '{email:$e, username:$u, password:$p}')"
expect 201 POST /auth/register "register a new account" \
  '(.authId|test("^[a-f0-9]{24}$")) and (.message|type=="string")'
AUTH_ID="$(printf '%s' "$HTTP_BODY" | jq -r '.authId // empty')"

# 2. Register duplicate → 409
req POST /auth/register "$(jq -nc \
  --arg e "$TEST_EMAIL" --arg u "$TEST_USERNAME" --arg p "$TEST_PASSWORD" \
  '{email:$e, username:$u, password:$p}')"
expect 409 POST /auth/register "duplicate email/username rejected" \
  '.error.message|test("already in use"; "i")'

# 3. Login while UNVERIFIED → 403 with code:UNVERIFIED + authId
req POST /auth/login "$(jq -nc \
  --arg eu "$TEST_EMAIL" --arg p "$TEST_PASSWORD" \
  '{emailOrUsername:$eu, password:$p}')"
expect 403 POST /auth/login "unverified login → 403 UNVERIFIED" \
  '.error.details.code == "UNVERIFIED" and (.error.details.authId|test("^[a-f0-9]{24}$"))'

# 4. verify-otp with WRONG otp → 400
req POST /auth/verify-otp "$(jq -nc --arg id "$AUTH_ID" '{authId:$id, otp:"9999"}')"
expect 400 POST /auth/verify-otp "wrong otp rejected"

# 5. resend-otp → 200
req POST /auth/resend-otp "$(jq -nc --arg id "$AUTH_ID" '{authId:$id}')"
expect 200 POST /auth/resend-otp "resend succeeds" '.message|type=="string"'

# 6. verify-otp with dummy "1234" → 200, returns token+user
req POST /auth/verify-otp "$(jq -nc --arg id "$AUTH_ID" '{authId:$id, otp:"1234"}')"
expect 200 POST /auth/verify-otp "verify with dummy otp 1234" \
  '(.token|type=="string") and (.user.email|type=="string") and (.user.role=="user") and (.user|has("passwordHash")|not) and (.user|has("otpHash")|not)'
TOKEN="$(printf '%s' "$HTTP_BODY" | jq -r '.token // empty')"

# 7. Login (verified) → 200, returns token+user, no sensitive fields
req POST /auth/login "$(jq -nc \
  --arg eu "$TEST_EMAIL" --arg p "$TEST_PASSWORD" \
  '{emailOrUsername:$eu, password:$p}')"
expect 200 POST /auth/login "login after verification" \
  '(.token|type=="string") and (.user.email|type=="string") and (.user|has("passwordHash")|not)'
TOKEN="$(printf '%s' "$HTTP_BODY" | jq -r '.token // empty')"

# 8. Login negative cases — all must look identical (no enumeration)
req POST /auth/login "$(jq -nc '{emailOrUsername:"nobody-here@example.com", password:"whatever"}')"
expect 401 POST /auth/login "unknown email → 401 invalid credentials" \
  '.error.message == "invalid credentials"'

req POST /auth/login "$(jq -nc \
  --arg eu "$TEST_EMAIL" \
  '{emailOrUsername:$eu, password:"wrongpassword"}')"
expect 401 POST /auth/login "wrong password → 401 invalid credentials" \
  '.error.message == "invalid credentials"'

# 9. forgot-password (account exists) → 200, no enumeration
req POST /auth/forgot-password "$(jq -nc --arg e "$TEST_EMAIL" '{email:$e}')"
expect 200 POST /auth/forgot-password "forgot existing email → 200" \
  '.message|test("if the email exists"; "i")'

# 10. forgot-password (non-existent) → still 200, identical body
req POST /auth/forgot-password "$(jq -nc '{email:"nobody-here@example.com"}')"
expect 200 POST /auth/forgot-password "forgot unknown email → 200 (no enumeration)" \
  '.message|test("if the email exists"; "i")'

# 11. reset-password (only if RESET_TOKEN env var was provided)
if [ -n "$RESET_TOKEN" ]; then
  req POST /auth/reset-password "$(jq -nc \
    --arg t "$RESET_TOKEN" --arg p "$RESET_NEW_PASSWORD" \
    '{token:$t, newPassword:$p}')"
  expect 200 POST /auth/reset-password "reset with provided token" \
    '.message|test("password reset"; "i")'
  CURRENT_PASSWORD="$RESET_NEW_PASSWORD"
else
  skip_row POST /auth/reset-password "skipped — set RESET_TOKEN=<token from server logs> to enable"
  CURRENT_PASSWORD="$TEST_PASSWORD"
fi

# Also exercise the negative path — invalid token → 400
req POST /auth/reset-password "$(jq -nc \
  '{token:"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", newPassword:"AnyValid_123!"}')"
expect 400 POST /auth/reset-password "bogus reset token → 400" \
  '.error.message|test("invalid or expired"; "i")'

# ===========================================================================
# Authed endpoints (self-service)
# ===========================================================================
section "Authed self-service"

# 12. GET /users/me — no token → 401
req GET /users/me
expect 401 GET /users/me "missing token → 401"

# 13. GET /users/me — invalid token → 401
req GET /users/me "" "not.a.real.jwt"
expect 401 GET /users/me "garbage token → 401"

# 14. GET /users/me — happy path
req GET /users/me "" "$TOKEN"
expect 200 GET /users/me "fetch own profile" \
  '(.email|type=="string") and (.role=="user") and (.isVerified==true) and (has("passwordHash")|not)'

# 15. PATCH /users/me — happy path (allowlist fields land at top level)
req PATCH /users/me "$(jq -nc \
  '{bio:"hello from test", phone:"+15551234567", picture:"https://example.com/p.png", gender:"prefer_not_to_say"}')" \
  "$TOKEN"
expect 200 PATCH /users/me "update allowed profile fields" \
  '.bio=="hello from test" and .phone=="+15551234567" and .picture=="https://example.com/p.png" and .gender=="prefer_not_to_say"'

# 16. PATCH /users/me — disallowed field (email) → 400 unknown field
req PATCH /users/me "$(jq -nc '{email:"hijack@example.com"}')" "$TOKEN"
expect 400 PATCH /users/me "PATCH email rejected by allowlist" \
  '.error.message|test("not allowed|unknown"; "i")'

# 17. PATCH /users/me — disallowed field (role) → 400
req PATCH /users/me "$(jq -nc '{role:"admin"}')" "$TOKEN"
expect 400 PATCH /users/me "PATCH role rejected by allowlist" \
  '.error.message|test("not allowed|unknown"; "i")'

# 18. change-password — wrong current → 401
req POST /auth/change-password "$(jq -nc \
  --arg n "$NEW_PASSWORD" \
  '{currentPassword:"definitely-not-it", newPassword:$n}')" "$TOKEN"
expect 401 POST /auth/change-password "wrong current password → 401" \
  '.error.message == "invalid credentials"'

# 19. change-password — happy path
req POST /auth/change-password "$(jq -nc \
  --arg c "$CURRENT_PASSWORD" --arg n "$NEW_PASSWORD" \
  '{currentPassword:$c, newPassword:$n}')" "$TOKEN"
expect 200 POST /auth/change-password "rotate password" \
  '.message|test("password changed"; "i")'

# 20. Old password no longer works
req POST /auth/login "$(jq -nc \
  --arg eu "$TEST_EMAIL" --arg p "$CURRENT_PASSWORD" \
  '{emailOrUsername:$eu, password:$p}')"
expect 401 POST /auth/login "old password rejected after change" \
  '.error.message == "invalid credentials"'

# 21. New password works
req POST /auth/login "$(jq -nc \
  --arg eu "$TEST_EMAIL" --arg p "$NEW_PASSWORD" \
  '{emailOrUsername:$eu, password:$p}')"
expect 200 POST /auth/login "new password works"
TOKEN="$(printf '%s' "$HTTP_BODY" | jq -r '.token // empty')"

# 22. logout — 200 (stateless; just an ack)
req POST /auth/logout "" "$TOKEN"
expect 200 POST /auth/logout "logout ack"

# ===========================================================================
# Admin endpoints (only run if ADMIN creds provided)
# ===========================================================================
section "Admin endpoints"

if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  # Login as admin to get a real admin token
  req POST /auth/login "$(jq -nc \
    --arg eu "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" \
    '{emailOrUsername:$eu, password:$p}')"
  if [ "$HTTP_STATUS" != "200" ]; then
    echo "${RED}admin login failed (${HTTP_STATUS}); skipping admin section.${RESET}" >&2
    skip_row GET /users "admin login failed"
    skip_row GET /users/:id "admin login failed"
    skip_row DELETE /users/:id "admin login failed"
  else
    ADMIN_TOKEN="$(printf '%s' "$HTTP_BODY" | jq -r '.token')"

    # Non-admin token must get 403 on admin routes
    req GET /users "" "$TOKEN"
    expect 403 GET /users "non-admin → 403 (not 401, not 200)" \
      '.error.message|test("forbidden"; "i")'

    # No token at all → 401
    req GET /users
    expect 401 GET /users "no token → 401"

    # Admin happy path
    req GET /users "" "$ADMIN_TOKEN"
    expect 200 GET /users "admin lists users" 'type == "array"'
    # Pick a non-admin user id from the list — preferably the one we just made
    TARGET_USER_ID="$(printf '%s' "$HTTP_BODY" \
      | jq -r --arg e "$TEST_EMAIL" '[.[] | select(.email==$e)][0]._id // empty')"

    if [ -n "$TARGET_USER_ID" ]; then
      req GET "/users/${TARGET_USER_ID}" "" "$ADMIN_TOKEN"
      expect 200 GET "/users/:id" "admin fetches by id" \
        ".email == \"${TEST_EMAIL}\""

      # bogus id → 404
      req GET "/users/000000000000000000000000" "" "$ADMIN_TOKEN"
      expect 404 GET "/users/:id" "unknown id → 404" \
        '.error.message|test("not found"; "i")'

      # DELETE — destructive, only on the test user we own.
      req DELETE "/users/${TARGET_USER_ID}" "" "$ADMIN_TOKEN"
      expect 200 DELETE "/users/:id" "admin soft-deletes test user" \
        '.message|test("deleted"; "i")'
    else
      skip_row GET /users/:id "could not find test user in admin list"
      skip_row DELETE /users/:id "could not find test user in admin list"
    fi
  fi
else
  skip_row GET /users    "skipped — set ADMIN_EMAIL/ADMIN_PASSWORD to enable"
  skip_row GET /users/:id "skipped — set ADMIN_EMAIL/ADMIN_PASSWORD to enable"
  skip_row DELETE /users/:id "skipped — set ADMIN_EMAIL/ADMIN_PASSWORD to enable"
fi

# ===========================================================================
# Final destructive: self soft-delete + JWT-after-delete check
# ===========================================================================
section "Self soft-delete (destructive)"

# Re-login in case admin already deleted us. If admin path ran and deleted
# this user, getting a fresh token will fail with 401 — that's actually a
# valid signal of correctness (login on soft-deleted account → 401, not 403).
req POST /auth/login "$(jq -nc \
  --arg eu "$TEST_EMAIL" --arg p "$NEW_PASSWORD" \
  '{emailOrUsername:$eu, password:$p}')"

if [ "$HTTP_STATUS" = "200" ]; then
  TOKEN="$(printf '%s' "$HTTP_BODY" | jq -r '.token')"

  # DELETE /users/me — soft-delete self
  req DELETE /users/me "" "$TOKEN"
  expect 200 DELETE /users/me "self soft-delete" '.message|test("deleted"; "i")'

  # JWT must now be rejected on next authed request
  req GET /users/me "" "$TOKEN"
  expect 401 GET /users/me "JWT rejected after self-delete (fresh DB load)"

  # Login as soft-deleted account → 401, identical to bad-creds (no enumeration)
  req POST /auth/login "$(jq -nc \
    --arg eu "$TEST_EMAIL" --arg p "$NEW_PASSWORD" \
    '{emailOrUsername:$eu, password:$p}')"
  expect 401 POST /auth/login "deleted account login → 401 (no enumeration)" \
    '.error.message == "invalid credentials"'
elif [ "$HTTP_STATUS" = "401" ]; then
  # admin path already deleted this user — verify the no-enumeration property and skip the rest
  expect 401 POST /auth/login "deleted account login → 401 (no enumeration)" \
    '.error.message == "invalid credentials"'
  skip_row DELETE /users/me "user already deleted by admin path above"
  skip_row GET /users/me "user already deleted; nothing to test JWT against"
else
  echo "${RED}unexpected status during pre-delete login: ${HTTP_STATUS}${RESET}" >&2
  skip_row DELETE /users/me "could not log back in for self-delete test"
  skip_row GET /users/me "could not log back in for self-delete test"
fi

# ===========================================================================
# Summary
# ===========================================================================
section "Summary"
TOTAL=$((PASS + FAIL + SKIP))
printf '  %d total · %s%d passed%s · %s%d failed%s · %s%d skipped%s\n' \
  "$TOTAL" "$GREEN" "$PASS" "$RESET" "$RED" "$FAIL" "$RESET" "$YELLOW" "$SKIP" "$RESET"

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "${BOLD}Failures:${RESET}"
  for row in "${RESULTS[@]}"; do
    IFS='|' read -r out code method path note <<<"$row"
    if [ "$out" = "FAIL" ]; then
      printf '  %s✗%s %-6s %-38s %s  %s\n' "$RED" "$RESET" "$method" "$path" "$code" "$note"
    fi
  done
  exit 1
fi

if [ "$SKIP" -gt 0 ]; then
  echo
  echo "${DIM}Skipped (run with the noted env vars to enable):${RESET}"
  for row in "${RESULTS[@]}"; do
    IFS='|' read -r out code method path note <<<"$row"
    if [ "$out" = "SKIP" ]; then
      printf '  %s○%s %-6s %-38s  %s\n' "$YELLOW" "$RESET" "$method" "$path" "$note"
    fi
  done
fi

exit 0
