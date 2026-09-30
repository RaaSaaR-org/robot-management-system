#!/usr/bin/env bash
# changelog-section.sh — sort every commit in a range into a CHANGELOG section.
#
# Usage:
#   scripts/release/changelog-section.sh <git-range>      # e.g. v2026.09.12..HEAD
#
# Prints the "### Added / Fixed / Changed / Maintenance" body for the range on
# stdout (no "## [vX]" heading — the caller owns that) and a one-line tally on
# stderr. Used by .github/workflows/prepare-release-pr.yml; runnable locally.
#
# Why this exists (TASK-303): the generator used to place only subjects that
# carried a conventional-commit prefix and silently dropped the rest. Since
# .claude/rules/tasks.md makes a PR title the task title verbatim, and a squash
# merge's subject IS the PR title, every rule-abiding PR vanished — 33 of 92
# commits in v2026.09.12. A subject is now placed by, in order:
#
#   1. its conventional prefix          feat/fix/perf|refactor|revert/chore|docs|...
#   2. its PR's branch type             "(#NNN)" suffix -> head branch "<type>/task-..."
#                                       (only when CHANGELOG_BRANCH_OF is set)
#   3. the fallback                     ### Changed
#
# and the script exits non-zero, naming each subject, when the bullets it wrote
# do not match the subjects it read one for one. A dropped line is therefore a
# failed workflow run, never a silently shorter release note.
#
# Environment:
#   CHANGELOG_BRANCH_OF   command that prints the head branch of a PR number,
#                         called as `$CHANGELOG_BRANCH_OF <number>`; the workflow
#                         uses `gh pr view --json headRefName -q .headRefName`.
#                         A failed or empty lookup falls through to step 3.
#   CHANGELOG_STRICT=1    disable step 3: an unplaceable subject fails the run.
#                         Exists so the guard itself can be exercised.

set -euo pipefail

RANGE="${1:?usage: changelog-section.sh <git-range>}"
BRANCH_OF="${CHANGELOG_BRANCH_OF:-}"
STRICT="${CHANGELOG_STRICT:-0}"

CONVENTIONAL='^(feat|fix|perf|refactor|revert|chore|docs|build|ci|test|style)(\([^)]*\))?!?: (.+)$'
PR_SUFFIX='\(#([0-9]+)\)$'

# Section of a conventional-commit type, or of a branch type (rules/tasks.md
# lists feat · fix · chore · refactor · docs). Empty for anything else.
section_of_type() {
  case "$1" in
    feat)                                 echo added ;;
    fix)                                  echo fixed ;;
    perf|refactor|revert)                 echo changed ;;
    chore|docs|build|ci|test|style)       echo maintenance ;;
    *)                                    echo "" ;;
  esac
}

# A task title is sentence case ("Redesign the training pages"); a changelog
# line is not. Lower the first letter unless the word is an acronym or a name
# with an inner capital ("TASK-…", "NeoDEM" keep theirs).
bulletize() {
  local s="$1"
  if [[ "${s:0:1}" =~ [A-Z] && ! "${s:1:1}" =~ [A-Z0-9] ]]; then
    s="$(printf '%s' "${s:0:1}" | tr '[:upper:]' '[:lower:]')${s:1}"
  fi
  printf -- '- %s' "$s"
}

# Read up front, not through a process substitution: a bad range must fail the
# run here, not read as zero commits and "pass" with an empty section.
LOG="$(git log --no-merges --pretty=tformat:'%s' "$RANGE" --)"

ADDED=""; FIXED=""; CHANGED=""; OTHER=""
READ=0; BY_PREFIX=0; BY_BRANCH=0; BY_FALLBACK=0
UNPLACED=()

append() { # <section> <bullet>
  case "$1" in
    added)       ADDED+="$2"$'\n' ;;
    fixed)       FIXED+="$2"$'\n' ;;
    changed)     CHANGED+="$2"$'\n' ;;
    maintenance) OTHER+="$2"$'\n' ;;
  esac
}

while IFS= read -r subject; do
  [ -n "$subject" ] || continue
  # The release commit describes the previous release; it is not a change.
  [[ "$subject" =~ ^chore\(release\): ]] && continue
  READ=$((READ + 1))

  if [[ "$subject" =~ $CONVENTIONAL ]]; then
    append "$(section_of_type "${BASH_REMATCH[1]}")" "- ${BASH_REMATCH[3]}"
    BY_PREFIX=$((BY_PREFIX + 1))
    continue
  fi

  section=""
  if [ -n "$BRANCH_OF" ] && [[ "$subject" =~ $PR_SUFFIX ]]; then
    # Word splitting of $BRANCH_OF is intended: it is a command with arguments.
    # shellcheck disable=SC2086
    branch="$($BRANCH_OF "${BASH_REMATCH[1]}" 2>/dev/null || true)"
    section="$(section_of_type "${branch%%/*}")"
    if [ -n "$section" ]; then BY_BRANCH=$((BY_BRANCH + 1)); fi
  fi
  if [ -z "$section" ] && [ "$STRICT" != 1 ]; then
    section=changed
    BY_FALLBACK=$((BY_FALLBACK + 1))
  fi

  if [ -n "$section" ]; then
    append "$section" "$(bulletize "$subject")"
  else
    UNPLACED+=("$subject")
  fi
done <<<"$LOG"

render() {
  if [ -n "$ADDED" ];   then printf '### Added\n\n%s\n'       "$ADDED";   fi
  if [ -n "$FIXED" ];   then printf '### Fixed\n\n%s\n'       "$FIXED";   fi
  if [ -n "$CHANGED" ]; then printf '### Changed\n\n%s\n'     "$CHANGED"; fi
  if [ -n "$OTHER" ];   then printf '### Maintenance\n\n%s\n' "$OTHER";   fi
  return 0
}
SECTION="$(render)"

# --- The guard: every subject read is one bullet written --------------------
# Counted off the rendered text, not the tallies above, so a bug anywhere
# between reading and printing shows up here rather than in a published release.
WRITTEN="$(printf '%s\n' "$SECTION" | grep -c '^- ' || true)"
if [ "${#UNPLACED[@]}" -gt 0 ] || [ "$WRITTEN" -ne "$READ" ]; then
  {
    echo "changelog-section: read $READ subjects in $RANGE but wrote $WRITTEN bullets."
    for s in ${UNPLACED[@]+"${UNPLACED[@]}"}; do
      echo "  no section for: $s"
    done
    echo "Every commit must reach the changelog; fix the classifier or the subject."
  } >&2
  exit 1
fi

printf '%s\n' "$SECTION"
echo "changelog-section: $READ subjects -> $WRITTEN bullets ($BY_PREFIX by prefix, $BY_BRANCH by PR branch, $BY_FALLBACK by fallback)" >&2
