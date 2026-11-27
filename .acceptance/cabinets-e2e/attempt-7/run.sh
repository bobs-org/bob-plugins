#!/usr/bin/env bash
set -euo pipefail

attempt_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin_root="$(cd "$attempt_dir/../../.." && pwd)"
remote_root=/var/tmp/bob-cabinets-qq8-20261127

cd "$plugin_root"
npm run build
npm run build:check

source_head="$(git rev-parse HEAD)"
rsync -az \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=.acceptance \
  "$plugin_root/" "athena:$remote_root/source/"

ssh athena "set -e; \
  mkdir -p $remote_root/attempt-7/shots; \
  cd $remote_root/source; \
  unshare --user --map-root-user --mount --propagation private \
    sh -eu -c 'mount -t tmpfs -o size=2g,mode=1777 tmpfs /tmp; \
      cd $remote_root/source; \
      TMPDIR=/var/tmp TMP=/var/tmp TEMP=/var/tmp \
      BOB_CABINETS_SOURCE_HEAD=$source_head \
      BOB_CABINETS_DIRTY_PATHS= \
      xvfb-run -a node scripts/obsidian-cabinets-e2e.cjs \
        -e /snap/obsidian/current/app/obsidian \
        -r $remote_root/attempt-7/report.json \
        -o $remote_root/attempt-7/shots'"
