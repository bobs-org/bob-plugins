// Project-parent parsing and resolution (docs/task-dependencies.md §13).
// Keep this pure so the cycler can mirror reconcile without metadataCache.

const PROJECT_PARENT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".obsidian",
  "_conflicts",
  "_generated",
  "_templates",
  "done",
]);

function projectParentPathIsIndexed(path) {
  const value = String(path || "").replace(/\\/g, "/");
  if (!value || value === "dash.md" || isCanonicalDailyNotePath(value)) {
    return false;
  }
  return !value.split("/").some((part) =>
    PROJECT_PARENT_EXCLUDED_DIRECTORIES.has(part)
  );
}

function projectParentTarget(sourceText) {
  const lines = String(sourceText || "").split(/\r?\n/);
  if (lines.length === 0 || !/^\s*---\s*$/.test(lines[0])) {
    return null;
  }
  let count = 0;
  for (let line = 1; line < lines.length; line += 1) {
    if (/^\s*---\s*$/.test(lines[line])) {
      break;
    }
    if (/^parent\s*:/.test(lines[line])) {
      count += 1;
    }
  }
  if (count !== 1) {
    return null;
  }
  const value = parseFrontmatterScalar(sourceText, "parent");
  const match = value && value.match(/^\[\[([^\]\n]+)\]\]$/);
  if (!match) {
    return null;
  }
  const target = String(match[1] || "")
    .split("|")[0]
    .split("#")[0]
    .trim();
  return target || null;
}

function resolveProjectParentPath(target, sourcePath = "", notePaths = []) {
  let value = String(target || "").trim();
  const wrapped = value.match(/^\[\[([^\]\n]+)\]\]$/);
  if (wrapped) {
    value = String(wrapped[1] || "").split("|")[0].split("#")[0].trim();
  } else {
    value = value.split("|")[0].split("#")[0].trim();
  }
  if (!value) {
    return null;
  }
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return null;
  }
  const paths = [...new Set(Array.from(notePaths || [], (path) =>
    String(path || "").replace(/\\/g, "/")
  ).filter(projectParentPathIsIndexed))];
  const targetPath = value.replace(/\\/g, "/");
  const candidate = /\.md$/i.test(targetPath) ? targetPath : `${targetPath}.md`;
  let resolved = paths.includes(candidate) ? candidate : null;
  if (!resolved && !targetPath.includes("/") && !targetPath.includes("\\")) {
    const basename = targetPath.replace(/\.md$/i, "").toLocaleLowerCase();
    const matches = paths.filter((path) =>
      path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "").toLocaleLowerCase() === basename
    );
    if (matches.length === 1) {
      resolved = matches[0];
    }
  }
  return resolved && resolved !== String(sourcePath || "") ? resolved : null;
}

function prjInheritsBlock(prjLineText) {
  return getTrailingBlockId(prjLineText) === "prj" &&
    hasProjectBlockedResidentTag(prjLineText);
}

function projectPullInParentPathMap(closed, noteTexts, notePaths) {
  const paths = Array.isArray(notePaths) ? notePaths : Object.keys(noteTexts || {});
  const parents = new Map();
  for (const identity of Array.isArray(closed) ? closed : []) {
    if (!identity || !identity.path || !projectIdentityIsPrj(identity)) {
      continue;
    }
    const childPath = String(identity.path);
    const target = projectParentTarget(projectNoteTextFor(noteTexts, childPath));
    const parentPath = resolveProjectParentPath(target, childPath, paths);
    if (!parentPath) {
      continue;
    }
    if (!parents.has(parentPath)) {
      parents.set(parentPath, new Set());
    }
    parents.get(parentPath).add(childPath);
  }
  return parents;
}

function projectPullInParentPaths(closed, noteTexts, notePaths) {
  return [...projectPullInParentPathMap(closed, noteTexts, notePaths).keys()];
}

function projectPullInParentCandidatePaths(closed, noteTexts, today, notePaths) {
  const paths = Array.isArray(notePaths) ? notePaths : Object.keys(noteTexts || {});
  const skipKeys = projectClosedSkipKeys(closed);
  const candidates = [];
  const parentPaths = projectPullInParentPathMap(closed, noteTexts, paths);
  for (const [path, closedChildPaths] of parentPaths) {
    const surface = projectSurfaceState(
      projectNoteTextFor(noteTexts, path),
      path,
      today,
      { skipKeys, notePaths: paths, closedChildPaths },
    );
    if (surface && surface.empty) {
      candidates.push(path);
    }
  }
  return candidates;
}

function projectPullInNeedsDependents(closed, noteTexts, today, notePaths) {
  if (projectClosedTaskIds(closed).size > 0) {
    return true;
  }
  const skipKeys = projectClosedSkipKeys(closed);
  const candidates = new Map();
  for (const path of projectPullInCandidatePaths(closed, noteTexts, today)) {
    candidates.set(path, new Set());
  }
  const parentPaths = projectPullInParentPathMap(closed, noteTexts, notePaths);
  for (const [path, childPaths] of parentPaths) {
    const surface = projectSurfaceState(
      projectNoteTextFor(noteTexts, path),
      path,
      today,
      { skipKeys, notePaths, closedChildPaths: childPaths },
    );
    if (surface && surface.empty) {
      candidates.set(path, childPaths);
    }
  }
  for (const [path, closedChildPaths] of candidates) {
    const surface = projectSurfaceState(
      projectNoteTextFor(noteTexts, path),
      path,
      today,
      { skipKeys, notePaths, closedChildPaths },
    );
    if (!surface || !surface.task) {
      continue;
    }
    if ((surface.task.dependsOn || []).length > 0) {
      return true;
    }
    if (surface.task.status === "?") {
      const text = projectNoteTextFor(noteTexts, path);
      const tasks = parseTaskDependencyDocument(text, path).filter(
        (task) => task && task.status && DEPENDENCY_OPEN_TASK_SYMBOLS.has(task.status),
      );
      if (tasks.some((task) => task.blockId !== "prj" && Array.isArray(task.dependsOn) && task.dependsOn.length > 0)) {
        return true;
      }
    }
  }
  return false;
}
