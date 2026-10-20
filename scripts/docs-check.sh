#!/usr/bin/env bash
# Preview this repository's docs through bob-cli's documentation gate.
# npm test does not run this script, and this script never calls npm.
set -euo pipefail

CLI_REMOTE='https://github.com/bobs-org/bob-cli'
CLI_BRANCH='master'

usage() {
  cat <<'EOF'
Run bob-cli's documentation gate with this repository as the plugin source.

Usage: scripts/docs-check.sh

bob-cli resolution order:
  1. $BOB_CLI_DIR (never falls through when set)
  2. ../bob-cli relative to this repository
  3. a managed cache clone of https://github.com/bobs-org/bob-cli (master)

User-owned checkouts ($BOB_CLI_DIR and the sibling) are never fetched or reset.
just docs-check runs with BOB_DOCS_BOB_PLUGINS_DIR set to this repository.
EOF
}

if [[ "${1:-}" == '-h' || "${1:-}" == '--help' ]]; then
  usage
  exit 0
fi
if [[ "$#" -ne 0 ]]; then
  printf 'docs-check: unexpected argument %s\n\n' "$1" >&2
  usage >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/bob-plugins-docs"
cache_cli="$cache_root/bob-cli"

fail() {
  printf 'docs-check: %s\n' "$*" >&2
  exit 2
}

is_bob_cli() {
  local candidate=$1
  [[ -d "$candidate" ]] || return 1
  [[ -f "$candidate/justfile" || -f "$candidate/Justfile" ]] || return 1
  return 0
}

describe_invalid() {
  local candidate=$1
  if [[ ! -e "$candidate" ]]; then
    printf 'does not exist'
  elif [[ ! -d "$candidate" ]]; then
    printf 'is not a directory'
  elif [[ ! -f "$candidate/justfile" && ! -f "$candidate/Justfile" ]]; then
    printf 'has no justfile'
  else
    printf 'is not a usable bob-cli checkout'
  fi
}

validate_user_owned() {
  local candidate=$1
  local source=$2
  if ! is_bob_cli "$candidate"; then
    fail "$source $candidate $(describe_invalid "$candidate"); an explicit choice never falls through to other locations"
  fi
}

clone_cache() {
  local dest=$1
  mkdir -p "$(dirname -- "$dest")"
  GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "$CLI_BRANCH" "$CLI_REMOTE" "$dest" ||
    fail "could not clone $CLI_REMOTE branch $CLI_BRANCH into $dest"
}

refresh_cache() {
  local dest=$1
  GIT_TERMINAL_PROMPT=0 git -C "$dest" fetch --depth 1 origin "+refs/heads/${CLI_BRANCH}:refs/remotes/origin/${CLI_BRANCH}" ||
    fail "could not refresh cached bob-cli clone at $dest"
  local fetched
  fetched=$(GIT_TERMINAL_PROMPT=0 git -C "$dest" rev-parse --verify FETCH_HEAD) ||
    fail "cached bob-cli clone at $dest has no FETCH_HEAD after refresh"
  GIT_TERMINAL_PROMPT=0 git -C "$dest" reset --hard "$fetched" ||
    fail "could not reset cached bob-cli clone at $dest"
}

resolve_cli() {
  if [[ -n "${BOB_CLI_DIR+x}" ]]; then
    if [[ -z "${BOB_CLI_DIR}" ]]; then
      fail 'BOB_CLI_DIR is set but empty; an explicit override never falls through'
    fi
    validate_user_owned "$BOB_CLI_DIR" '$BOB_CLI_DIR'
    printf '%s\n' "$BOB_CLI_DIR"
    return
  fi

  local sibling
  sibling=$(CDPATH= cd -- "$plugin_root/.." && pwd)/bob-cli
  if [[ -e "$sibling" ]]; then
    validate_user_owned "$sibling" 'sibling'
    printf '%s\n' "$sibling"
    return
  fi

  if [[ -e "$cache_cli" ]]; then
    if ! is_bob_cli "$cache_cli"; then
      fail "cached clone $cache_cli $(describe_invalid "$cache_cli")"
    fi
    refresh_cache "$cache_cli"
    printf '%s\n' "$cache_cli"
    return
  fi

  clone_cache "$cache_cli"
  if ! is_bob_cli "$cache_cli"; then
    fail "cloned $CLI_REMOTE into $cache_cli but $(describe_invalid "$cache_cli")"
  fi
  printf '%s\n' "$cache_cli"
}

cli_root=$(resolve_cli)

if ! command -v just >/dev/null 2>&1; then
  fail "just is not on PATH; install just to run docs-check in $cli_root"
fi

printf 'docs-check: using bob-cli %s with BOB_DOCS_BOB_PLUGINS_DIR=%s\n' "$cli_root" "$plugin_root"

(
  CDPATH= cd -- "$cli_root"
  export BOB_DOCS_BOB_PLUGINS_DIR="$plugin_root"
  just docs-check
)
