// Task Card subtree pass for the sub-project cascade
// (`docs/task-dependencies.md` §13.19 PDS, PDG8–PDG12, PDG14).
// After a Depends on or Schedule gesture blocks or unblocks N's `^prj`,
// the pass blocks or recovers N's descendant sub-projects top-down in the
// same gesture (reconcile re-derives them within one interval when any
// other writer moves first). Pure helpers live here for tests; the mixin
// below binds them to the vault (open buffer first, else `cachedRead`) with
// preimage-checked writes modelled on `640 writeTaskMoveChange`.

// Whether `text` is a project note whose cascade root is its single `^prj`.
// Daily notes, terminal projects, and notes without exactly one `^prj`
// never root a pass.
function isProjectPrjEditRoot(path, text) {
  const notePath = normalizeVaultRelativePath(path);
  if (!notePath || canonicalRecoveryDailyDate(notePath)) {
    return false;
  }
  const recognition = readProjectFrontmatterRecognition(String(text || ""));
  if (!recognition.isProjectType) {
    return false;
  }
  if (PROJECT_TERMINAL_STATUSES.has(recognition.status)) {
    return false;
  }
  return collectProjectNoteTaskRows(String(text || "")).prj.length === 1;
}

// Checkbox statuses of the open `^prj` and residents in `text`, for
// commitment transfer: the strongest lane among N's `^prj`, its residents,
// and every descendant line the pass newly blocks rises to the added target
// (Design §5 Lanes; ADJ-11 still never raises a `^prj` target).
function collectSubtreeLaneStatuses(text) {
  const rows = collectProjectNoteTaskRows(String(text || ""));
  const statuses = [];
  for (const row of [...rows.prj, ...rows.residents]) {
    if (row && row.status) {
      statuses.push(row.status);
    }
  }
  return Object.freeze(statuses);
}

// Notice suffix for one subtree result (`{blocked, recovered, skipped}`).
// Returns "" when the pass changed nothing — in particular, a pass that
// wrote and skipped nothing re-asserted tags only (PDG11) and stays quiet.
function subtreePassNoticeSuffix(result) {
  const safe = result && typeof result === "object" ? result : {};
  if (safe.written !== undefined && safe.skipped !== undefined) {
    const wrote = Math.max(0, Math.floor(numericOrDefault(safe.written, 0)));
    const missed = Math.max(0, Math.floor(numericOrDefault(safe.skipped, 0)));
    if (wrote === 0 && missed === 0) {
      return "";
    }
  }
  const blocked = Math.max(0, Math.floor(numericOrDefault(safe.blocked, 0)));
  const recovered = Math.max(
    0,
    Math.floor(numericOrDefault(safe.recovered, 0)),
  );
  const skipped = Math.max(0, Math.floor(numericOrDefault(safe.skipped, 0)));
  const parts = [];
  if (blocked > 0) {
    parts.push(`· ${formatCountLabel(blocked, "sub-project")} Blocked`);
  }
  if (recovered > 0) {
    parts.push(`· ${formatCountLabel(recovered, "sub-project")} Ready again`);
  }
  if (skipped > 0) {
    parts.push(
      `· ${formatCountLabel(skipped, "sub-project")} not updated`,
    );
  }
  return parts.join(" ");
}

// Order roots so ancestors come first: a root that has another root among
// its descendants plans first, so each descendant note is planned once.
function orderSubtreeRootsAncestorFirst(roots, childrenMap) {
  const list = Array.isArray(roots) ? roots.slice() : [];
  if (list.length < 2) {
    return Object.freeze(list);
  }
  const descendantSets = new Map();
  for (const root of list) {
    const path = normalizeVaultRelativePath(root && root.path);
    descendantSets.set(
      path,
      new Set(path ? collectProjectDescendants(path, childrenMap) : []),
    );
  }
  const indexOf = new Map(list.map((root, index) => [
    normalizeVaultRelativePath(root && root.path),
    index,
  ]));
  return Object.freeze(
    list
      .map((root, index) => ({ root, index }))
      .sort((first, second) => {
        const firstPath = normalizeVaultRelativePath(first.root && first.root.path);
        const secondPath = normalizeVaultRelativePath(second.root && second.root.path);
        const firstBeforeSecond =
          firstPath &&
          secondPath &&
          firstPath !== secondPath &&
          descendantSets.get(firstPath) &&
          descendantSets.get(firstPath).has(secondPath);
        const secondBeforeFirst =
          firstPath &&
          secondPath &&
          firstPath !== secondPath &&
          descendantSets.get(secondPath) &&
          descendantSets.get(secondPath).has(firstPath);
        if (firstBeforeSecond && !secondBeforeFirst) {
          return -1;
        }
        if (secondBeforeFirst && !firstBeforeSecond) {
          return 1;
        }
        return first.index - second.index;
      })
      .map((entry) => entry.root),
  );
}

// Openness lookup over a `Map` of vault-relative path → content for
// `getProjectBlockState`. Notes outside the map read as open (the same
// safe direction `planDependencyEdit` uses for kept unloaded links: a
// descendant with an unknown prerequisite stays Blocked until reconcile
// repairs it, and is never wrongly recovered).
function subtreeLookupOpenFor(filesMap) {
  const files = filesMap instanceof Map ? filesMap : new Map();
  return (targetPath, blockId) => {
    const normalized = normalizeVaultRelativePath(targetPath);
    const wanted = normalizeBulletPropertyValue(blockId);
    if (!normalized || !wanted || !files.has(normalized)) {
      return true;
    }
    const lines = String(files.get(normalized) || "").split(/\r?\n/);
    const found = findTaskLineByTrailingBlockId(lines, wanted);
    if (found === null) {
      return true;
    }
    return OPEN_OBSIDIAN_TASK_STATUSES.has(
      getObsidianTaskCheckboxStatus(String(lines[found] || "")),
    );
  };
}

// One `{line, before, after}` root per changed task line between two
// revisions of one note, for counted batches that commit a working copy.
function subtreeRootsFromLineEdits(path, beforeContent, afterContent, lines) {
  const notePath = normalizeVaultRelativePath(path);
  if (!notePath) {
    return Object.freeze([]);
  }
  const before = String(beforeContent || "").split(/\r?\n/);
  const after = String(afterContent || "").split(/\r?\n/);
  const roots = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const at = Math.floor(numericOrDefault(line, Number.NaN));
    if (!Number.isFinite(at) || at < 0) {
      continue;
    }
    const beforeLine = at < before.length ? String(before[at] || "") : "";
    const afterLine = at < after.length ? String(after[at] || "") : "";
    if (!beforeLine && !afterLine) {
      continue;
    }
    roots.push(Object.freeze({ path: notePath, line: at, before: beforeLine, after: afterLine }));
  }
  return Object.freeze(roots);
}

// Strip `#prj_is_blocked` from task lines for recovery-index entries. The
// tag is the pass's own input (a descendant inherits through it); left in
// place, the index's project veto would forbid exactly the recoveries the
// pass just decided. Statuses, links, and line numbers are untouched, so
// ranks and edges resolve as in the vault.
function stripSubtreeIndexTags(content) {
  const text = String(content || "");
  const ending = text.includes("\r\n") ? "\r\n" : "\n";
  return text
    .split(/\r?\n/)
    .map((line) => {
      try {
        return isObsidianTaskLine(line) ? setProjectBlockedTag(line, false) : line;
      } catch (_error) {
        return line;
      }
    })
    .join(ending);
}

// Whether the `^prj` line in `text` carries its own future inline schedule.
function subtreePrjHasFutureSchedule(text, today) {
  const rows = collectProjectNoteTaskRows(String(text || ""));
  if (rows.prj.length !== 1) {
    return false;
  }
  return dependencyParentHasFutureSchedule(
    String(rows.prj[0].text || ""),
    today instanceof Date ? today : new Date(),
  );
}

class BobNavigationHotkeysProjectSubtreeMixin {
  // Children map over the vault's markdown files (metadataCache
  // frontmatter, no content reads), plus the vault path list for
  // NoteIndex-like parent resolution. Never throws.
  buildSubtreeChildrenMap() {
    try {
      const vault = this.app && this.app.vault;
      const cache = this.app && this.app.metadataCache;
      if (!vault || typeof vault.getMarkdownFiles !== "function") {
        return Object.freeze({
          childrenMap: new Map(),
          notePaths: Object.freeze([]),
        });
      }
      const files = vault.getMarkdownFiles() || [];
      const frontmatterOf = (file) => {
        try {
          const fileCache =
            cache && typeof cache.getFileCache === "function"
              ? cache.getFileCache(file)
              : null;
          return fileCache && fileCache.frontmatter;
        } catch (_error) {
          return null;
        }
      };
      const childrenMap = buildProjectChildrenMap(files, frontmatterOf);
      const notePaths = files
        .map((file) => normalizeVaultRelativePath(file && file.path))
        .filter(Boolean);
      return Object.freeze({ childrenMap, notePaths: Object.freeze(notePaths) });
    } catch (_error) {
      return Object.freeze({ childrenMap: new Map(), notePaths: Object.freeze([]) });
    }
  }

  // Contents for `paths`: the open buffer first (unsaved edits count),
  // else `cachedRead`. Unreadable notes are omitted. Never throws.
  async readSubtreeNoteTexts(paths) {
    const texts = new Map();
    let vaultFiles = null;
    try {
      const vault = this.app && this.app.vault;
      if (!vault) {
        return texts;
      }
      if (typeof vault.getMarkdownFiles === "function") {
        vaultFiles = new Map();
        for (const file of vault.getMarkdownFiles() || []) {
          const normalized = normalizeVaultRelativePath(file && file.path);
          if (normalized && !vaultFiles.has(normalized)) {
            vaultFiles.set(normalized, file);
          }
        }
      }
      for (const rawPath of Array.isArray(paths) ? paths : []) {
        const path = normalizeVaultRelativePath(rawPath);
        if (!path || texts.has(path)) {
          continue;
        }
        let buffered = null;
        try {
          buffered =
            typeof this.readOpenBufferContent === "function"
              ? this.readOpenBufferContent(path)
              : null;
        } catch (_error) {
          buffered = null;
        }
        if (buffered !== null) {
          texts.set(path, String(buffered));
          continue;
        }
        const file = vaultFiles ? vaultFiles.get(path) : null;
        if (!file || typeof vault.cachedRead !== "function") {
          continue;
        }
        try {
          texts.set(path, String((await vault.cachedRead(file)) || ""));
        } catch (_error) {
          // Omitted: the next reconcile repairs what this pass cannot see.
        }
      }
    } catch (_error) {
      // Partial map stands.
    }
    return texts;
  }

  // Read-ahead for planning N's edit: descendants, their texts, and the
  // lane statuses commitment transfer needs. Returns null when no pass can
  // apply (not a `^prj` root, or no descendants — a no-children gesture
  // reads no other note). `options.worthReading` skips the descendant reads
  // when the caller already knows neither side can be blocked.
  async prepareSubtreeDescendants(rootPath, rootText, options = {}) {
    try {
      const path = normalizeVaultRelativePath(rootPath);
      if (!path || !isProjectPrjEditRoot(path, rootText)) {
        return null;
      }
      const built =
        options.childrenMap instanceof Map && Array.isArray(options.notePaths)
          ? { childrenMap: options.childrenMap, notePaths: options.notePaths }
          : this.buildSubtreeChildrenMap();
      const descendants = collectProjectDescendants(path, built.childrenMap);
      if (descendants.length === 0) {
        return null;
      }
      let texts = new Map();
      if (options.descendantTexts instanceof Map) {
        texts = options.descendantTexts;
      } else if (options.worthReading !== false) {
        texts = await this.readSubtreeNoteTexts(descendants);
      }
      const lanes = [...collectSubtreeLaneStatuses(rootText)];
      for (const descendant of descendants) {
        if (!texts.has(descendant)) {
          continue;
        }
        for (const status of collectSubtreeLaneStatuses(texts.get(descendant))) {
          lanes.push(status);
        }
      }
      return Object.freeze({
        descendants: Object.freeze(descendants.slice()),
        texts,
        lanes: Object.freeze(lanes),
        childrenMap: built.childrenMap,
        notePaths: built.notePaths,
      });
    } catch (_error) {
      return null;
    }
  }

  // Read-ahead before planning N's Depends on edit: when N is a `^prj`
  // root that is blocked before (over the writer's already-loaded files,
  // so no extra reads) or gains targets, read the descendants and collect
  // the lane statuses commitment transfer needs. Returns null when no pass
  // can apply — then the writer plans exactly as today. Never throws.
  async prepareSubtreeForDependencyPlan(rootPath, rootText, options = {}) {
    try {
      if (options.mirrorTouch === true) {
        return null;
      }
      const path = normalizeVaultRelativePath(rootPath);
      const content = String(rootText || "");
      if (!path || !isProjectPrjEditRoot(path, content)) {
        return null;
      }
      const add = Array.isArray(options.add) ? options.add : [];
      const remove = Array.isArray(options.remove) ? options.remove : [];
      if (add.length === 0 && remove.length === 0) {
        return null;
      }
      const filesMap = new Map();
      if (options.files instanceof Map) {
        for (const [filePath, fileContent] of options.files) {
          const normalized = normalizeVaultRelativePath(filePath);
          if (normalized) {
            filesMap.set(normalized, String(fileContent || ""));
          }
        }
      }
      if (!filesMap.has(path)) {
        filesMap.set(path, content);
      }
      // N may read `[?]` while its targets already closed in the vault (the
      // removal below is what recovers it), so the gate follows the same
      // `[?]`-before heuristic the resident recovery uses: only a gesture
      // that adds nothing to an unblocked `^prj` can never start a pass.
      let prjBlockedBefore = false;
      try {
        const rows = collectProjectNoteTaskRows(content);
        prjBlockedBefore = rows.prj.length === 1 && rows.prj[0].status === "?";
      } catch (_error) {
        prjBlockedBefore = false;
      }
      if (!prjBlockedBefore && add.length === 0) {
        return null;
      }
      return this.prepareSubtreeDescendants(path, content, {
        worthReading: true,
        childrenMap: options.childrenMap,
        notePaths: options.notePaths,
      });
    } catch (_error) {
      return null;
    }
  }

  // Plan the subtree pass for N's `^prj` edit (`beforeText` → `afterText`).
  // Returns null when no pass applies: not a `^prj` root, no descendants,
  // a hand-edit mirror, or N blocked neither before nor after (the common
  // case — zero extra work beyond the file list). Never throws.
  async planSubtreePassForPrjEdit(rootPath, beforeText, afterText, options = {}) {
    try {
      if (options.mirrorTouch === true) {
        return null;
      }
      const path = normalizeVaultRelativePath(rootPath);
      const today = options.today instanceof Date ? options.today : new Date();
      if (!path || !isProjectPrjEditRoot(path, afterText)) {
        return null;
      }
      const built =
        options.childrenMap instanceof Map && Array.isArray(options.notePaths)
          ? { childrenMap: options.childrenMap, notePaths: options.notePaths }
          : this.buildSubtreeChildrenMap();
      const descendants = collectProjectDescendants(path, built.childrenMap);
      if (descendants.length === 0) {
        return null;
      }
      const filesMap = new Map();
      if (options.files instanceof Map) {
        for (const [filePath, fileContent] of options.files) {
          const normalized = normalizeVaultRelativePath(filePath);
          if (normalized) {
            filesMap.set(normalized, String(fileContent || ""));
          }
        }
      } else if (options.files && typeof options.files === "object") {
        for (const filePath of Object.keys(options.files)) {
          const normalized = normalizeVaultRelativePath(filePath);
          if (normalized) {
            filesMap.set(normalized, String(options.files[filePath] || ""));
          }
        }
      }
      const before = String(beforeText || "");
      const after = String(afterText || "");
      filesMap.set(path, after);
      const lookupFor = (revisionText) => {
        const revisionFiles = new Map(filesMap);
        revisionFiles.set(path, revisionText);
        return subtreeLookupOpenFor(revisionFiles);
      };
      const ownBlocked = (revisionText) => {
        try {
          const state = getProjectBlockState(
            revisionText,
            path,
            today,
            lookupFor(revisionText),
          );
          if (!state.isProject) {
            return false;
          }
          return ownProjectReasons(state).length > 0;
        } catch (_error) {
          return false;
        }
      };
      const tagged = (revisionText) => {
        try {
          const rows = collectProjectNoteTaskRows(revisionText);
          return rows.prj.length === 1 &&
            taskHasProjectBlockedTag(String(rows.prj[0].text || ""));
        } catch (_error) {
          return false;
        }
      };
      const textBlocked = (revisionText) => {
        try {
          const rows = collectProjectNoteTaskRows(revisionText);
          return rows.prj.length === 1 && rows.prj[0].status === "?";
        } catch (_error) {
          return false;
        }
      };
      // The run gate widens past own reasons to the text: N may read `[?]`
      // while its targets already closed (the removal below recovers it),
      // and its descendants may still hold stale tags from when it was
      // blocked. The pass itself still blocks only on own reasons or the
      // tag — a hand-set `[?]` never blocks a descendant.
      const rootBlockedBefore = options.rootBlockedBefore !== undefined
        ? Boolean(options.rootBlockedBefore)
        : Boolean(ownBlocked(before) || tagged(before) || textBlocked(before));
      const rootBlockedAfter = options.rootBlockedAfter !== undefined
        ? Boolean(options.rootBlockedAfter)
        : Boolean(ownBlocked(after) || tagged(after));
      if (!rootBlockedBefore && !rootBlockedAfter) {
        return null;
      }
      let texts = options.descendantTexts instanceof Map
        ? options.descendantTexts
        : null;
      if (!texts) {
        texts = await this.readSubtreeNoteTexts(descendants);
      }
      // One level of prerequisite reads keeps own-reason detection exact
      // for N and every descendant; anything deeper stays open (safe).
      // `^prj` items plus every task line's navigation bullets feed the set,
      // so recovery ranks resolve instead of dangling.
      let linkResolver = null;
      try {
        linkResolver = typeof this.dependencyLinkpathResolver === "function"
          ? this.dependencyLinkpathResolver()
          : null;
      } catch (_error) {
        linkResolver = null;
      }
      const depTargets = new Set();
      const collectDepTargets = (revisionText, revisionPath) => {
        try {
          for (
            const item of collectProjectTaskDependencyItems(revisionText, revisionPath)
          ) {
            if (item && !item.internal && !item.archive && item.path && item.blockId) {
              depTargets.add(normalizeVaultRelativePath(item.path));
            }
          }
        } catch (_error) {
          // Best-effort: unknown targets stay open.
        }
        try {
          const lines = String(revisionText || "").split(/\r?\n/);
          for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            let collection = null;
            try {
              collection = collectDependencyNavigationBullets(
                revisionText,
                lineIndex,
              );
            } catch (_bulletError) {
              collection = null;
            }
            if (!collection || collection.reason) {
              continue;
            }
            for (const target of collection.targets || []) {
              let depPath = null;
              try {
                depPath = dependencyPathForLinkNote(
                  target.note,
                  revisionPath,
                  linkResolver,
                );
              } catch (_resolveError) {
                depPath = null;
              }
              if (depPath) {
                depTargets.add(normalizeVaultRelativePath(depPath));
              }
            }
          }
        } catch (_error) {
          // Best-effort: unknown targets stay open.
        }
      };
      collectDepTargets(before, path);
      collectDepTargets(after, path);
      for (const descendant of descendants) {
        if (texts.has(descendant)) {
          collectDepTargets(texts.get(descendant), descendant);
        }
      }
      // Lane recovery reads Pomodoro activity like `080` does: today's and
      // yesterday's daily notes join the recovery entries when present.
      try {
        const dailyPaths = scheduledRecoveryDailyPaths(
          (built.notePaths || []).map((notePath) => ({ path: notePath })),
          today,
        );
        for (const dailyPath of [dailyPaths.current, dailyPaths.previous]) {
          if (dailyPath && !filesMap.has(dailyPath) && !texts.has(dailyPath)) {
            depTargets.add(dailyPath);
          }
        }
      } catch (_error) {
        // Best-effort: ranks fall back to Ready.
      }
      const missing = [...depTargets].filter((target) =>
        target && !filesMap.has(target)
      );
      if (missing.length > 0) {
        const loaded = await this.readSubtreeNoteTexts(missing);
        for (const [loadedPath, loadedText] of loaded) {
          filesMap.set(loadedPath, loadedText);
          if (!texts.has(loadedPath) && descendants.includes(loadedPath)) {
            texts.set(loadedPath, loadedText);
          }
        }
      }
      const recheck = (revisionText) => {
        const revisionFiles = new Map(filesMap);
        revisionFiles.set(path, revisionText);
        try {
          const state = getProjectBlockState(
            revisionText,
            path,
            today,
            subtreeLookupOpenFor(revisionFiles),
          );
          if (!state.isProject) {
            return false;
          }
          return ownProjectReasons(state).length > 0;
        } catch (_error) {
          return false;
        }
      };
      const settledBefore = options.rootBlockedBefore !== undefined
        ? rootBlockedBefore
        : Boolean(recheck(before) || tagged(before) || textBlocked(before));
      const settledAfter = options.rootBlockedAfter !== undefined
        ? rootBlockedAfter
        : Boolean(recheck(after) || tagged(after));
      if (!settledBefore && !settledAfter) {
        return null;
      }
      const entries = [];
      for (const descendant of descendants) {
        if (texts.has(descendant)) {
          entries.push({ path: descendant, text: texts.get(descendant) });
        }
      }
      let markUnblockedLine = null;
      try {
        markUnblockedLine = typeof options.markUnblockedLine === "function"
          ? options.markUnblockedLine
          : navFreshnessMarkUnblockedLine(
            typeof this.getFreshnessApi === "function"
              ? this.getFreshnessApi()
              : null,
          );
      } catch (_error) {
        markUnblockedLine = null;
      }
      // Recovery ranks resolve through the same index `080` uses — but over
      // entries with the inherited tag stripped. The tag is the pass's own
      // input: left in place, the index's project veto would forbid exactly
      // the recoveries the pass just decided. Stripping changes no status,
      // link, or line number, so ranks and edges resolve as in the vault.
      let recoveryFor = null;
      if (typeof options.recoveryFor === "function") {
        recoveryFor = options.recoveryFor;
      } else {
        try {
          const registry = options.registry !== undefined
            ? options.registry
            : typeof readTasksStatusRegistry === "function" && this.app
              ? await readTasksStatusRegistry(this.app)
              : null;
          if (registry) {
            const indexFiles = new Map(filesMap);
            for (const [descendantPath, descendantText] of texts) {
              if (!indexFiles.has(descendantPath)) {
                indexFiles.set(descendantPath, descendantText);
              }
            }
            const recoveryIndex = buildScheduledRecoveryIndex(
              [...indexFiles].map(([recoveryPath, recoveryContent]) => ({
                path: recoveryPath,
                content: stripSubtreeIndexTags(recoveryContent),
              })),
              registry,
              today,
            );
            recoveryFor = (recoveryPath, recoveryLine) =>
              getScheduledRecoveryMetadata(recoveryIndex, recoveryPath, recoveryLine);
          }
        } catch (_error) {
          recoveryFor = null;
        }
      }
      const pass = planProjectSubtreePass({
        rootPath: path,
        rootText: after,
        rootBlockedAfter: settledAfter,
        descendants: entries,
        lookupOpen: subtreeLookupOpenFor(filesMap),
        today,
        markUnblockedLine,
        ...(typeof recoveryFor === "function" ? { recoveryFor } : {}),
        notePaths: built.notePaths,
      });
      return Object.freeze({
        pass,
        descendants: Object.freeze(descendants.slice()),
        rootBlockedBefore: settledBefore,
        rootBlockedAfter: settledAfter,
      });
    } catch (_error) {
      return null;
    }
  }

  // Write one planned pass: one preimage-checked write per descendant note
  // (open editor transaction, else `vault.process`). A stale or failing
  // note is skipped and counted (PDG14); N is never rolled back. Never
  // throws.
  async writeSubtreePass(pass) {
    const written = [];
    const skipped = [];
    try {
      const notes = pass && Array.isArray(pass.notes) ? pass.notes : [];
      if (notes.length === 0) {
        return Object.freeze({ written: 0, skipped: 0 });
      }
      const vault = this.app && this.app.vault;
      let fileByPath = new Map();
      try {
        if (vault && typeof vault.getMarkdownFiles === "function") {
          for (const file of vault.getMarkdownFiles() || []) {
            const normalized = normalizeVaultRelativePath(file && file.path);
            if (normalized && !fileByPath.has(normalized)) {
              fileByPath.set(normalized, file);
            }
          }
        }
      } catch (_error) {
        fileByPath = new Map();
      }
      for (const note of notes) {
        const path = normalizeVaultRelativePath(note && note.path);
        const before = String((note && note.before) || "");
        const after = String((note && note.after) || "");
        if (!path || after === before) {
          continue;
        }
        let done = false;
        try {
          const editor =
            typeof this.getOpenMarkdownEditorForPath === "function"
              ? this.getOpenMarkdownEditorForPath(path)
              : null;
          if (editor && typeof editor.getValue === "function") {
            if (String(editor.getValue() || "") === before) {
              if (
                applyEditorContentTransaction(editor, before, after) &&
                String(editor.getValue() || "") === after
              ) {
                done = true;
              }
            }
          } else if (vault && typeof vault.process === "function") {
            const file = fileByPath.get(path);
            if (file) {
              let transformed = false;
              await vault.process(file, (content) => {
                if (String(content || "") !== before) {
                  throw new Error(`Sub-project preimage changed: ${path}`);
                }
                transformed = true;
                return after;
              });
              done = transformed;
            }
          }
        } catch (_error) {
          done = false;
        }
        if (done) {
          written.push(path);
        } else {
          skipped.push(path);
        }
      }
    } catch (_error) {
      // Partial counts stand.
    }
    return Object.freeze({ written: written.length, skipped: skipped.length });
  }

  // Plan and write the pass for one `^prj` edit. Returns null when no pass
  // applies, else `{blocked, recovered, written, skipped, pomodoroTargets,
  // laneStatuses}`. A write failure is reported in counts, never thrown.
  async applySubtreePassForPrjEdit(rootPath, beforeText, afterText, options = {}) {
    const planned = await this.planSubtreePassForPrjEdit(
      rootPath,
      beforeText,
      afterText,
      options,
    );
    if (!planned) {
      return null;
    }
    const { pass } = planned;
    const outcome = await this.writeSubtreePass(pass);
    return Object.freeze({
      blocked: pass.blocked,
      recovered: pass.recovered,
      written: outcome.written,
      skipped: outcome.skipped,
      pomodoroTargets: pass.pomodoroTargets,
      laneStatuses: pass.laneStatuses,
      rootBlockedBefore: planned.rootBlockedBefore,
      rootBlockedAfter: planned.rootBlockedAfter,
    });
  }

  // Passes for several roots (counted batches): ancestors first, each
  // descendant note planned once. `roots` carries `{path, beforeText,
  // afterText}` plus any `planSubtreePassForPrjEdit` overrides. Returns
  // null when no root yields a pass, else the aggregate result.
  async applySubtreePassesForRoots(roots, options = {}) {
    try {
      const list = Array.isArray(roots) ? roots.filter(Boolean) : [];
      if (list.length === 0) {
        return null;
      }
      const built =
        options.childrenMap instanceof Map && Array.isArray(options.notePaths)
          ? { childrenMap: options.childrenMap, notePaths: options.notePaths }
          : this.buildSubtreeChildrenMap();
      const ordered = orderSubtreeRootsAncestorFirst(list, built.childrenMap);
      const claimed = new Set();
      const seenRoots = new Set();
      let blocked = 0;
      let recovered = 0;
      let written = 0;
      let skipped = 0;
      const pomodoroTargets = [];
      const laneStatuses = [];
      let applied = 0;
      for (const root of ordered) {
        const path = normalizeVaultRelativePath(root.path);
        if (!path) {
          continue;
        }
        // Each note plans once: a root already written as another root's
        // descendant (or seen before) with no change of its own is done.
        // A root with its own edit always re-plans off current texts.
        const ownChange = String(root.beforeText || "") !== String(root.afterText || "");
        if ((claimed.has(path) || seenRoots.has(path)) && !ownChange) {
          continue;
        }
        seenRoots.add(path);
        claimed.add(path);
        const descendants = collectProjectDescendants(path, built.childrenMap)
          .filter((descendant) => !claimed.has(descendant));
        if (descendants.length === 0 && !isProjectPrjEditRoot(path, root.afterText)) {
          continue;
        }
        const planned = await this.planSubtreePassForPrjEdit(
          path,
          root.beforeText,
          root.afterText,
          {
            ...options,
            childrenMap: built.childrenMap,
            notePaths: built.notePaths,
          },
        );
        if (!planned) {
          continue;
        }
        for (const descendant of planned.descendants) {
          claimed.add(descendant);
        }
        const outcome = await this.writeSubtreePass(planned.pass);
        applied += 1;
        blocked += planned.pass.blocked;
        recovered += planned.pass.recovered;
        written += outcome.written;
        skipped += outcome.skipped;
        for (const target of planned.pass.pomodoroTargets || []) {
          pomodoroTargets.push(target);
        }
        for (const status of planned.pass.laneStatuses || []) {
          laneStatuses.push(status);
        }
      }
      if (applied === 0) {
        return null;
      }
      return Object.freeze({
        blocked,
        recovered,
        written,
        skipped,
        pomodoroTargets: Object.freeze(pomodoroTargets),
        laneStatuses: Object.freeze(laneStatuses),
      });
    } catch (_error) {
      return null;
    }
  }

  // Freshness is the last transformation of the parent task line
  // (nav-stamps). Applied inside the one transaction, never as its own edit.
  stampDependencyParentLine(nextContent, parentLine, stamperOverride, dateTextOverride) {
    const stamper =
      typeof stamperOverride === "function"
        ? stamperOverride
        : this.getFreshnessStampLine();
    if (typeof stamper !== "function") {
      return nextContent;
    }
    const dateText =
      dateTextOverride !== undefined
        ? dateTextOverride
        : this.getFreshnessDateText();
    const { lines, lineEnding } = splitMarkdownContent(nextContent);
    if (parentLine < 0 || parentLine >= lines.length) {
      return nextContent;
    }
    lines[parentLine] = applyFreshStampLine(lines[parentLine], stamper, dateText);
    return lines.join(lineEnding);
  }

  // Best-effort vault read for planner target resolution: the open buffer
  // when the note is open (unsaved edits count), else the vault content.
  // Open-buffer content for a note path (unsaved edits count), or null
  // when the note has no open markdown leaf. Synchronous, so the picker
  // never waits on disk while typing.
  readOpenBufferContent(filePath) {
    try {
      const normalized = normalizeVaultRelativePath(filePath || "");
      const workspace = this.app && this.app.workspace;
      if (!normalized || !workspace || typeof workspace.getLeavesOfType !== "function") {
        return null;
      }
      for (const leaf of workspace.getLeavesOfType("markdown") || []) {
        const view = leaf && leaf.view;
        if (
          view &&
          view.file &&
          normalizeVaultRelativePath(view.file.path) === normalized &&
          view.editor &&
          typeof view.editor.getValue === "function"
        ) {
          return String(view.editor.getValue() || "");
        }
      }
      return null;
    } catch (_error) {
      return null;
    }
  }

  // Deferred daily cleanup for a pass's newly-Blocked targets, using the
  // same vault mechanism as the `^prj` writer. Best-effort: failures report
  // `{removed: 0, failed: true}` and never roll anything back.
  async runSubtreePomodoroCleanup(targets, sourcePath, sourceContent, today) {
    try {
      const list = Array.isArray(targets) ? targets : [];
      if (list.length === 0) {
        return Object.freeze({ removed: 0, failed: false });
      }
      if (typeof this.readDeferredPomodoroSnapshot !== "function") {
        return Object.freeze({ removed: 0, failed: true });
      }
      const snapshot = await this.readDeferredPomodoroSnapshot(this.app, {
        sourcePath: normalizeVaultRelativePath(sourcePath),
        sourceContent: String(sourceContent || ""),
        today: today instanceof Date ? today : new Date(),
      });
      if (!snapshot) {
        return Object.freeze({ removed: 0, failed: false });
      }
      const cleanup = planDeferredPomodoroLinkCleanup(
        snapshot.sameFile ? String(sourceContent || "") : snapshot.content,
        list,
        {
          dailyPath: snapshot.dailyPath,
          noteIndex: snapshot.noteIndex,
          removeEmptiedEntries: true,
        },
      );
      if (!cleanup || !cleanup.changed) {
        return Object.freeze({ removed: 0, failed: false });
      }
      if (snapshot.sameFile) {
        return Object.freeze({ removed: 0, failed: true });
      }
      if (typeof this.writeDeferredPomodoroCleanup !== "function") {
        return Object.freeze({ removed: 0, failed: true });
      }
      let written = false;
      try {
        written = await this.writeDeferredPomodoroCleanup(snapshot, cleanup);
      } catch (_error) {
        written = false;
      }
      return written
        ? Object.freeze({ removed: cleanup.removedLinkCount, failed: false })
        : Object.freeze({ removed: 0, failed: true });
    } catch (_error) {
      return Object.freeze({ removed: 0, failed: true });
    }
  }
}
