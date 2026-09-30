#!/usr/bin/env bash
# test-changelog-section.sh — tests for changelog-section.sh (TASK-303).
#
# Usage: scripts/release/test-changelog-section.sh
#
# Builds a throwaway git repo per case, so it needs nothing but git and bash.
# The last case replays the real v2026.08.27..v2026.09.12 range when those tags
# are present (a full clone), and is reported as SKIPPED when they are not.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SUT="$HERE/changelog-section.sh"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

PASS=0; FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ok   $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
expect() { # <description> <command...>
  local d="$1"; shift
  if "$@"; then pass "$d"; else fail "$d"; fi
}

# A fresh repo whose history is one empty commit per subject, oldest first.
make_repo() { # <dir> <subject...>
  local dir="$1"; shift
  git init -q "$dir"
  git -C "$dir" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "base"
  git -C "$dir" tag base
  local s
  for s in "$@"; do
    git -C "$dir" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "$s"
  done
}

# Section heading a bullet landed under, read off the rendered output.
section_of() { # <file> <bullet text>
  awk -v b="- $2" '/^### /{h=$2} $0 == b {print h}' "$1"
}

echo "changelog-section.sh"

# --- 1. every subject lands exactly once; bare task titles fall back ---------
R="$SCRATCH/mixed"
make_repo "$R" \
  "feat: add a thing (#1)" \
  "fix(app): repair a thing (#2)" \
  "refactor!: reshape a thing" \
  "docs: explain a thing" \
  "Redesign the training pages (#3)" \
  "A voice pack is its own axis (#4)" \
  "TASK-9 is closed" \
  "chore(release): v2026.01.01 (#5)"
git -C "$R" checkout -q -b side
git -C "$R" -c user.name=t -c user.email=t@t commit -q --allow-empty -m "Side work on a branch"
git -C "$R" checkout -q -
git -C "$R" -c user.name=t -c user.email=t@t merge -q --no-ff side -m "Merge branch 'side'"
OUT="$SCRATCH/mixed.md"
( cd "$R" && "$SUT" base..HEAD >"$OUT" 2>/dev/null )
expect "8 commits in, 8 bullets out (release + merge commits excluded)" \
  test "$(grep -c '^- ' "$OUT")" -eq 8
expect "feat goes to Added"           test "$(section_of "$OUT" 'add a thing (#1)')" = Added
expect "scoped fix goes to Fixed"     test "$(section_of "$OUT" 'repair a thing (#2)')" = Fixed
expect "breaking refactor → Changed"  test "$(section_of "$OUT" 'reshape a thing')" = Changed
expect "docs goes to Maintenance"     test "$(section_of "$OUT" 'explain a thing')" = Maintenance
expect "bare task title falls back to Changed, lower-cased" \
  test "$(section_of "$OUT" 'redesign the training pages (#3)')" = Changed
expect "one-letter first word is lower-cased" \
  test "$(section_of "$OUT" 'a voice pack is its own axis (#4)')" = Changed
expect "an acronym keeps its case" \
  test "$(section_of "$OUT" 'TASK-9 is closed')" = Changed
expect "a commit reached through a merge is still listed" \
  test "$(section_of "$OUT" 'side work on a branch')" = Changed
expect "the release commit is not a change" \
  test "$(grep -c 'v2026.01.01' "$OUT" || true)" -eq 0

# --- 2. a PR's branch type places a bare title ------------------------------
R="$SCRATCH/branches"
make_repo "$R" \
  "Repair the widget (#10)" \
  "Retire the old styles (#11)" \
  "Record what the run taught (#12)" \
  "Lookup fails for this one (#13)" \
  "No PR number at all"
STUB="$SCRATCH/branch-of"
cat >"$STUB" <<'STUBEOF'
#!/usr/bin/env bash
case "$1" in
  10) echo fix/task-1-repair-the-widget ;;
  11) echo refactor/task-2-retire-the-old-styles ;;
  12) echo docs/task-3-record-what-the-run-taught ;;
  *)  exit 1 ;;
esac
STUBEOF
chmod +x "$STUB"
OUT="$SCRATCH/branches.md"
( cd "$R" && CHANGELOG_BRANCH_OF="$STUB" "$SUT" base..HEAD >"$OUT" 2>/dev/null )
expect "fix/ branch → Fixed"          test "$(section_of "$OUT" 'repair the widget (#10)')" = Fixed
expect "refactor/ branch → Changed"   test "$(section_of "$OUT" 'retire the old styles (#11)')" = Changed
expect "docs/ branch → Maintenance"   test "$(section_of "$OUT" 'record what the run taught (#12)')" = Maintenance
expect "failed lookup falls back"     test "$(section_of "$OUT" 'lookup fails for this one (#13)')" = Changed
expect "no PR number falls back"      test "$(section_of "$OUT" 'no PR number at all')" = Changed
expect "5 commits in, 5 bullets out"  test "$(grep -c '^- ' "$OUT")" -eq 5

# --- 3. the guard: an unplaceable subject fails the run and is named --------
R="$SCRATCH/strict"
make_repo "$R" "feat: add a thing" "Fix a thing without its prefix" "docs: explain it"
ERR="$SCRATCH/strict.err"
set +e
( cd "$R" && CHANGELOG_STRICT=1 "$SUT" base..HEAD >"$SCRATCH/strict.md" 2>"$ERR" )
RC=$?
set -e
expect "a dropped subject exits non-zero"  test "$RC" -ne 0
expect "the failure names the subject" \
  grep -q 'no section for: Fix a thing without its prefix' "$ERR"
expect "the failure gives the counts"      grep -q 'read 3 subjects .* but wrote 2 bullets' "$ERR"
strict_off() { ( cd "$R" && "$SUT" base..HEAD >/dev/null 2>&1 ); }
expect "without strict mode the same range passes" strict_off
bad_range() { ( cd "$R" && "$SUT" no-such-tag..HEAD >/dev/null 2>&1 ); }
expect "an unknown range fails instead of reading as empty" \
  test "$(bad_range && echo passed || echo failed)" = failed

# --- 4. replay the release that exposed this --------------------------------
if git -C "$REPO_ROOT" rev-parse -q --verify v2026.08.27 >/dev/null \
   && git -C "$REPO_ROOT" rev-parse -q --verify v2026.09.12 >/dev/null; then
  OUT="$SCRATCH/replay.md"
  ( cd "$REPO_ROOT" && "$SUT" v2026.08.27..v2026.09.12 >"$OUT" 2>/dev/null )
  expect "v2026.08.27..v2026.09.12 replays to 92 bullets" \
    test "$(grep -c '^- ' "$OUT")" -eq 92
else
  echo "  SKIPPED replay of v2026.08.27..v2026.09.12 (tags not present — shallow clone?)"
fi

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
