// Keep inbox tree (keep-indicator-view): membership and per-note open
// counts for the footer inbox tray. A member is `inbox.md` or an area
// note whose parent chain reaches it. Intermediate notes of any type are
// walked through. Never throws.

const KEEP_INBOX_TREE_ROOT = "inbox.md";

function keepInboxTreeNormalizePath(path) {
  try {
    return String(path || "")
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .trim();
  } catch (error) {
    return "";
  }
}

function keepInboxTreeStore(memo, path, answer) {
  try {
    if (memo && typeof memo.set === "function" && path) {
      memo.set(path, answer);
    }
  } catch (error) {
    // Memo is best-effort.
  }
  return answer;
}

function keepInboxTreeMember(path, metadataCache, vault, memo) {
  try {
    const normalized = keepInboxTreeNormalizePath(path);
    if (!normalized) {
      return false;
    }
    try {
      if (memo && typeof memo.get === "function" && memo.has(normalized)) {
        return Boolean(memo.get(normalized));
      }
    } catch (error) {
      // A broken memo never blocks membership.
    }
    if (keepInboxSamePath(normalized, KEEP_INBOX_TREE_ROOT)) {
      return keepInboxTreeStore(memo, normalized, true);
    }
    let file = null;
    try {
      if (vault && typeof vault.getAbstractFileByPath === "function") {
        file = vault.getAbstractFileByPath(normalized);
      }
    } catch (error) {
      file = null;
    }
    if (!file || typeof file.path !== "string") {
      return keepInboxTreeStore(memo, normalized, false);
    }
    let startFrontmatter = {};
    try {
      const read = pomodoroHomeReadFrontmatter(file, metadataCache, vault);
      startFrontmatter = read && read.frontmatter ? read.frontmatter : {};
    } catch (error) {
      startFrontmatter = {};
    }
    let startType = "other";
    try {
      startType = pomodoroHomeType(startFrontmatter);
    } catch (error) {
      startType = "other";
    }
    if (startType !== "area") {
      return keepInboxTreeStore(memo, normalized, false);
    }
    const visited = new Set();
    let current = file;
    for (let depth = 0; current && depth < POMODORO_HOME_MAX_DEPTH; depth += 1) {
      const currentPath = keepInboxTreeNormalizePath(current.path);
      if (!currentPath) {
        return keepInboxTreeStore(memo, normalized, false);
      }
      const key = currentPath.toLowerCase();
      if (visited.has(key)) {
        return keepInboxTreeStore(memo, normalized, false);
      }
      visited.add(key);
      let frontmatter = {};
      try {
        const read = pomodoroHomeReadFrontmatter(current, metadataCache, vault);
        frontmatter = read && read.frontmatter ? read.frontmatter : {};
      } catch (error) {
        frontmatter = {};
      }
      let parentTarget = "";
      try {
        parentTarget = pomodoroHomeParentTarget(frontmatter.parent);
      } catch (error) {
        parentTarget = "";
      }
      if (!parentTarget) {
        return keepInboxTreeStore(memo, normalized, false);
      }
      let parentFile = null;
      try {
        parentFile = pomodoroHomeResolveFile(
          parentTarget,
          current.path,
          current.path,
          metadataCache,
          vault,
        );
      } catch (error) {
        parentFile = null;
      }
      if (!parentFile || typeof parentFile.path !== "string") {
        return keepInboxTreeStore(memo, normalized, false);
      }
      const parentPath = keepInboxTreeNormalizePath(parentFile.path);
      if (keepInboxSamePath(parentPath, KEEP_INBOX_TREE_ROOT)) {
        return keepInboxTreeStore(memo, normalized, true);
      }
      current = parentFile;
    }
    return keepInboxTreeStore(memo, normalized, false);
  } catch (error) {
    return false;
  }
}

function keepInboxTreeNoteOrder(left, right) {
  const leftOpen = Number(left && left.open);
  const rightOpen = Number(right && right.open);
  const leftCount = Number.isFinite(leftOpen) ? leftOpen : 0;
  const rightCount = Number.isFinite(rightOpen) ? rightOpen : 0;
  if (rightCount !== leftCount) {
    return rightCount - leftCount;
  }
  const leftPath = keepInboxAsString(left && left.path);
  const rightPath = keepInboxAsString(right && right.path);
  if (leftPath < rightPath) {
    return -1;
  }
  if (leftPath > rightPath) {
    return 1;
  }
  return 0;
}

function keepInboxTreeCounts(tasks, isMember) {
  try {
    if (!Array.isArray(tasks)) {
      return { total: 0, notes: [] };
    }
    const membership = new Map();
    const counts = new Map();
    const memberOf = (path) => {
      if (membership.has(path)) {
        return membership.get(path);
      }
      let answer = false;
      try {
        answer = typeof isMember === "function" ? Boolean(isMember(path)) : false;
      } catch (error) {
        answer = false;
      }
      membership.set(path, answer);
      return answer;
    };
    for (const task of tasks) {
      try {
        if (!keepInboxIsTopLevelTask(task)) {
          continue;
        }
        const symbol = keepInboxTaskSymbol(task);
        if (!symbol || symbol === "x" || symbol === "X" || symbol === "-") {
          continue;
        }
        const path = keepInboxTreeNormalizePath(keepInboxTaskPath(task));
        if (!path) {
          continue;
        }
        if (!memberOf(path)) {
          continue;
        }
        const prior = counts.get(path) || 0;
        counts.set(path, prior + 1);
      } catch (error) {
        // One bad row never breaks the tree count.
      }
    }
    const notes = [];
    let total = 0;
    for (const [path, open] of counts) {
      if (!(open > 0)) {
        continue;
      }
      let label = "";
      try {
        label = pomodoroHomeStem(path);
      } catch (error) {
        label = "";
      }
      notes.push({ path, label, open });
      total += open;
    }
    notes.sort(keepInboxTreeNoteOrder);
    return { total, notes };
  } catch (error) {
    return { total: 0, notes: [] };
  }
}
