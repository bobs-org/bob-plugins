// Post-write `#^prj` rewrite application for project reversal (§13.10).
// Rewrites are planned in memory and the parent is written first; each
// rewrite that throws or finds changed content then counts its planned
// links as failed, so the caller keeps the project note and reports it
// instead of counting the links as updated.
function countPlannedRewriteLinksByPath(blockRewrites, parentPath) {
  const counts = new Map();
  for (const rewrite of Array.isArray(blockRewrites) ? blockRewrites : []) {
    const rewritePath = normalizeVaultRelativePath(rewrite && rewrite.path);
    if (!rewritePath || rewritePath === parentPath) {
      continue;
    }
    const originals = Array.isArray(rewrite && rewrite.originals)
      ? rewrite.originals
      : [];
    counts.set(
      rewritePath,
      (counts.get(rewritePath) || 0) + (originals.length || 1),
    );
  }
  return counts;
}

async function applyPlannedBlockIdLinkRewrites(args = {}) {
  const vault = args.vault;
  const isMarkdownFile =
    typeof args.isMarkdownFile === "function" ? args.isMarkdownFile : null;
  const changes = Array.isArray(args.changes) ? args.changes : [];
  const parentPath = args.parentPath;
  const plannedLinksByPath =
    args.plannedLinksByPath instanceof Map
      ? args.plannedLinksByPath
      : new Map();
  let failedLinkCount = 0;
  const failedPaths = new Set();
  const recordFailure = (path) => {
    failedLinkCount += plannedLinksByPath.get(path) || 1;
    failedPaths.add(path);
  };
  for (const change of changes) {
    if (!change || change.path === parentPath) {
      continue;
    }
    const file =
      vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(change.path)
        : null;
    if (!isMarkdownFile || !isMarkdownFile(file)) {
      recordFailure(change.path);
      continue;
    }
    let applied = false;
    try {
      await vault.process(file, (current) => {
        if (current !== change.before) {
          return current;
        }
        applied = true;
        return change.after;
      });
    } catch (_error) {
      applied = false;
    }
    if (!applied) {
      recordFailure(change.path);
    }
  }
  return Object.freeze({ failedLinkCount, failedPaths });
}
