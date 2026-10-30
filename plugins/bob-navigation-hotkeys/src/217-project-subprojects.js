// Sub-project discovery and the pure top-down subtree planner
// (`docs/task-dependencies.md` §13.3, §13.6, §13.19 PDS6/PDS15, PDG8–PDG13).
// parent(K) matches bob projects sync's scalar wikilink (alias and heading
// dropped, path kept) and resolves like NoteIndex::resolve. `_conflicts/`
// copies are skipped so they are never children and never resolve as parents.

const PROJECT_SUBTREE_MAX_DEPTH = 16;

function projectParentTarget(frontmatterParent) {
  if (frontmatterParent == null) {
    return null;
  }
  if (Array.isArray(frontmatterParent)) {
    return null;
  }
  if (typeof frontmatterParent === "object") {
    return null;
  }
  const raw = getYamlScalarText(String(frontmatterParent));
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[[") || !trimmed.endsWith("]]")) {
    return null;
  }
  let inner = trimmed.slice(2, -2).trim();
  const pipe = inner.indexOf("|");
  if (pipe !== -1) {
    inner = inner.slice(0, pipe);
  }
  const hash = inner.indexOf("#");
  if (hash !== -1) {
    inner = inner.slice(0, hash);
  }
  inner = inner.trim();
  return inner || null;
}

function projectParentFieldFromNoteText(content) {
  const { lines } = splitMarkdownContent(content);
  if (!startsWithFrontmatter(lines)) {
    return null;
  }
  let closingLine = -1;
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    if (FRONTMATTER_DELIMITER_RE.test(lines[lineIndex])) {
      closingLine = lineIndex;
      break;
    }
  }
  if (closingLine === -1) {
    return null;
  }
  for (let lineIndex = 1; lineIndex < closingLine; lineIndex += 1) {
    const match = /^parent[ \t]*:(.*)$/.exec(lines[lineIndex]);
    if (!match) {
      continue;
    }
    const scalar = getYamlScalarText(match[1]);
    return scalar || [];
  }
  return null;
}

function resolveProjectParentPath(target, sourcePath, notePaths) {
  const source = normalizeVaultRelativePath(sourcePath);
  const raw = String(target || "").trim();
  if (!raw) {
    return null;
  }
  const paths = (Array.isArray(notePaths) ? notePaths : [])
    .map((entry) => normalizeVaultRelativePath(entry))
    .filter(Boolean);
  const pathSet = new Set(paths);
  const exact = canonicalRecoveryMarkdownPath(raw);
  if (exact && pathSet.has(exact)) {
    return exact === source ? null : exact;
  }
  if (raw.includes("/") || raw.includes("\\")) {
    return null;
  }
  const base = recoveryMarkdownBasename(exact || raw).toLowerCase();
  if (!base) {
    return null;
  }
  let found = null;
  for (const filePath of paths) {
    if (recoveryMarkdownBasename(filePath).toLowerCase() !== base) {
      continue;
    }
    if (found && found !== filePath) {
      return null;
    }
    found = filePath;
  }
  if (!found || found === source) {
    return null;
  }
  return found;
}

function parentFieldFromFrontmatter(frontmatter) {
  if (frontmatter == null) {
    return null;
  }
  if (typeof frontmatter === "string" || Array.isArray(frontmatter)) {
    return frontmatter;
  }
  if (typeof frontmatter === "object") {
    return Object.prototype.hasOwnProperty.call(frontmatter, "parent")
      ? frontmatter.parent
      : null;
  }
  return null;
}

function frontmatterLooksLikeProject(frontmatter, path) {
  if (canonicalRecoveryDailyDate(normalizeVaultRelativePath(path))) {
    return false;
  }
  if (frontmatter == null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(frontmatter, "type")) {
    const typeValue = getYamlScalarText(frontmatter.type);
    if (typeValue && typeValue !== PROJECT_TYPE_WIKILINK) {
      return false;
    }
  }
  if (Object.prototype.hasOwnProperty.call(frontmatter, "status")) {
    const status = normalizeStatus(frontmatter.status);
    if (PROJECT_TERMINAL_STATUSES.has(status)) {
      return false;
    }
  }
  return true;
}

function filePathOf(file) {
  if (!file) {
    return "";
  }
  if (typeof file === "string") {
    return normalizeVaultRelativePath(file);
  }
  return normalizeVaultRelativePath(file.path);
}

function frontmatterForProjectChild(file, frontmatterOf) {
  const text =
    file && typeof file === "object" ? file.text || file.content : null;
  if (typeof text === "string") {
    const recognition = readProjectFrontmatterRecognition(text);
    if (!recognition.isProjectType) {
      return { type: "[[other]]" };
    }
    return {
      parent: projectParentFieldFromNoteText(text),
      type: PROJECT_TYPE_WIKILINK,
      status: recognition.status,
    };
  }
  if (typeof frontmatterOf === "function") {
    const provided = frontmatterOf(file);
    if (provided && typeof provided === "object" && !Array.isArray(provided)) {
      return provided;
    }
    if (provided != null) {
      return { parent: provided };
    }
  }
  return null;
}

function buildProjectChildrenMap(files, frontmatterOf) {
  const list = Array.isArray(files) ? files : [];
  const records = [];
  const notePaths = [];
  for (const file of list) {
    const path = filePathOf(file);
    if (!path || isConflictsNotePath(path)) {
      continue;
    }
    notePaths.push(path);
    records.push({ path, file });
  }
  const children = new Map();
  for (const { path, file } of records) {
    const frontmatter = frontmatterForProjectChild(file, frontmatterOf);
    if (!frontmatterLooksLikeProject(frontmatter, path)) {
      continue;
    }
    const target = projectParentTarget(parentFieldFromFrontmatter(frontmatter));
    if (!target) {
      continue;
    }
    const parentPath = resolveProjectParentPath(target, path, notePaths);
    if (!parentPath) {
      continue;
    }
    if (!children.has(parentPath)) {
      children.set(parentPath, []);
    }
    children.get(parentPath).push(path);
  }
  for (const [parentPath, kids] of children) {
    kids.sort((first, second) => first.localeCompare(second));
    children.set(parentPath, Object.freeze(kids.slice()));
  }
  return children;
}

function collectProjectDescendants(
  rootPath,
  childrenMap,
  maxDepth = PROJECT_SUBTREE_MAX_DEPTH,
) {
  const root = normalizeVaultRelativePath(rootPath);
  if (!root) {
    return Object.freeze([]);
  }
  const descendants = [];
  const visited = new Set([root]);
  const queue = [{ path: root, depth: 0 }];
  const limit = Math.max(0, Math.floor(numericOrDefault(maxDepth, PROJECT_SUBTREE_MAX_DEPTH)));
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth >= limit) {
      continue;
    }
    const kids =
      childrenMap instanceof Map ? childrenMap.get(current.path) || [] : [];
    for (const child of kids) {
      const childPath = normalizeVaultRelativePath(child);
      if (!childPath || visited.has(childPath)) {
        continue;
      }
      visited.add(childPath);
      descendants.push(childPath);
      queue.push({ path: childPath, depth: current.depth + 1 });
    }
  }
  return Object.freeze(descendants);
}

function collectProjectDescendantPathsFromNotes(rootPath, filesMap) {
  const files = [];
  const map = filesMap instanceof Map ? filesMap : new Map();
  for (const [path, text] of map) {
    files.push({ path, text: String(text || "") });
  }
  return collectProjectDescendants(
    rootPath,
    buildProjectChildrenMap(files, (file) =>
      projectParentFieldFromNoteText(file.text),
    ),
  );
}

function ownProjectReasons(state) {
  const reasons = state && Array.isArray(state.reasons) ? state.reasons : [];
  return reasons.filter((reason) => reason && reason.kind !== "project_parent");
}

function rewriteNoteLines(content, replacements) {
  const source = splitMarkdownContent(content);
  let changed = false;
  for (const [line, text] of replacements) {
    const at = Math.floor(numericOrDefault(line, Number.NaN));
    if (!Number.isFinite(at) || at < 0 || at >= source.lines.length) {
      continue;
    }
    if (source.lines[at] !== text) {
      source.lines[at] = text;
      changed = true;
    }
  }
  return Object.freeze({
    before: String(content || ""),
    after: source.lines.join(source.lineEnding),
    changed,
  });
}

function planProjectSubtreePass(args = {}) {
  const rootPath = normalizeVaultRelativePath(args.rootPath || "");
  const rootBlockedAfter = Boolean(args.rootBlockedAfter);
  const descendants = Array.isArray(args.descendants) ? args.descendants : [];
  const lookupOpen =
    typeof args.lookupOpen === "function" ? args.lookupOpen : () => false;
  const today = args.today instanceof Date ? args.today : new Date();
  const markUnblockedLine =
    typeof args.markUnblockedLine === "function" ? args.markUnblockedLine : null;
  const recoveryFor =
    typeof args.recoveryFor === "function"
      ? args.recoveryFor
      : () => Object.freeze({ state: "ready", rank: " ", reason: null });
  const byPath = new Map();
  for (const entry of descendants) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const path = normalizeVaultRelativePath(entry.path);
    if (!path || path === rootPath) {
      continue;
    }
    byPath.set(path, String(entry.text || ""));
  }
  const files = [...byPath.entries()].map(([path, text]) => ({ path, text }));
  if (rootPath) {
    files.push({ path: rootPath, text: String(args.rootText || "") });
  }
  // Full vault paths for NoteIndex-like parent resolution (gesture writers
  // pass the vault list; tests fall back to the pass notes plus the root).
  const resolutionPaths = Array.isArray(args.notePaths) && args.notePaths.length > 0
    ? args.notePaths.map((entry) => normalizeVaultRelativePath(entry)).filter(Boolean)
    : [...byPath.keys(), rootPath].filter(Boolean);
  const childrenMap = buildProjectChildrenMap(files, (file) =>
    projectParentFieldFromNoteText(file.text),
  );
  const ordered = rootPath
    ? collectProjectDescendants(rootPath, childrenMap).filter((path) =>
        byPath.has(path),
      )
    : [...byPath.keys()];
  const blockedAfterByPath = new Map();
  if (rootPath) {
    blockedAfterByPath.set(rootPath, rootBlockedAfter);
  }
  const notes = [];
  const pomodoroTargets = [];
  const laneStatuses = [];
  let blocked = 0;
  let recovered = 0;
  const recoverOptions = (path) =>
    Object.freeze({
      today,
      markUnblockedLine,
      isDailyNote: Boolean(canonicalRecoveryDailyDate(path)),
      isToday: false,
    });
  const recordNewlyBlocked = (path, before, after, blockId) => {
    const beforeStatus = getObsidianTaskCheckboxStatus(before);
    const afterStatus = getObsidianTaskCheckboxStatus(after);
    if (beforeStatus === afterStatus || afterStatus !== "?") {
      return;
    }
    if (OPEN_OBSIDIAN_TASK_STATUSES.has(beforeStatus) && beforeStatus !== "?") {
      laneStatuses.push(beforeStatus);
    }
    if (blockId) {
      pomodoroTargets.push(Object.freeze({ path, blockId }));
    }
  };

  for (const path of ordered) {
    const text = byPath.get(path);
    if (text == null) {
      continue;
    }
    const state = getProjectBlockState(text, path, today, lookupOpen);
    if (!state.isProject) {
      blockedAfterByPath.set(path, false);
      continue;
    }
    const parentTarget = projectParentTarget(projectParentFieldFromNoteText(text));
    const parentPath = parentTarget
      ? resolveProjectParentPath(parentTarget, path, resolutionPaths)
      : null;
    let inheritedAfter = false;
    if (parentPath && blockedAfterByPath.has(parentPath)) {
      inheritedAfter = Boolean(blockedAfterByPath.get(parentPath));
    } else if (parentPath && parentPath === rootPath) {
      inheritedAfter = rootBlockedAfter;
    } else if (!parentPath || !byPath.has(parentPath)) {
      inheritedAfter = rootBlockedAfter;
    }
    const ownBlocked = ownProjectReasons(state).length > 0;
    const blockedAfter = ownBlocked || inheritedAfter;
    blockedAfterByPath.set(path, blockedAfter);
    const prjWasTagged = taskHasProjectBlockedTag(state.prjLine >= 0
      ? String(splitMarkdownContent(text).lines[state.prjLine] || "")
      : "");
    const replacements = [];
    if (state.prjLine >= 0) {
      const current = String(splitMarkdownContent(text).lines[state.prjLine] || "");
      let next = current;
      if (inheritedAfter) {
        next = setProjectBlockedTag(blockObsidianTaskCheckboxStatus(current), true);
      } else {
        next = setProjectBlockedTag(current, false);
        if (
          prjWasTagged &&
          !ownBlocked &&
          getObsidianTaskCheckboxStatus(current) === "?"
        ) {
          next = recoverProjectResidentLine(
            current,
            recoveryFor(path, state.prjLine, current),
            recoverOptions(path),
          ).line;
        }
      }
      if (next !== current) {
        replacements.push([state.prjLine, next]);
        recordNewlyBlocked(
          path,
          current,
          next,
          getTrailingBlockId(current) || "prj",
        );
      }
    }
    for (const resident of state.residents) {
      const current = String(
        splitMarkdownContent(text).lines[resident.line] || resident.text || "",
      );
      let next = current;
      if (blockedAfter) {
        next = blockProjectResidentLine(current);
      } else if (taskHasProjectBlockedTag(current)) {
        next = recoverProjectResidentLine(
          current,
          recoveryFor(path, resident.line, current),
          recoverOptions(path),
        ).line;
      }
      if (next !== current) {
        replacements.push([resident.line, next]);
        recordNewlyBlocked(path, current, next, resident.blockId);
      }
    }
    if (inheritedAfter) {
      blocked += 1;
    } else if (prjWasTagged && !ownBlocked) {
      recovered += 1;
    }
    const rewritten = rewriteNoteLines(text, replacements);
    if (rewritten.changed) {
      notes.push(
        Object.freeze({
          path,
          before: rewritten.before,
          after: rewritten.after,
        }),
      );
    }
  }

  return Object.freeze({
    notes: Object.freeze(notes),
    pomodoroTargets: Object.freeze(pomodoroTargets),
    laneStatuses: Object.freeze(laneStatuses),
    blocked,
    recovered,
  });
}
