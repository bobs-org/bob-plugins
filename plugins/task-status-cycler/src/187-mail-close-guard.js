// Mail Close Card guard for Task Status Cycler close writes.
// Sync pre-check keeps non-email closes on today's synchronous path; possible
// Gmail Tasks go through nav api.mailCloseGuard v1. Missing nav classifies
// through the twin (cache, then vault YAML) and fails closed only when the
// twin says the target is a Gmail Task.
const CYCLER_MAIL_CLOSE_FAIL_NOTICE =
  "✉ Not closed — confirming an email task needs Bob Navigation Hotkeys";
const CYCLER_MAIL_CLOSE_QUERY_SELECTORS = [
  "ul.plugin-tasks-query-result",
  ".block-language-tasks",
  ".block-language-dataview",
  ".block-language-dataviewjs",
];

function cyclerMailCloseIsClose(before, after) {
  return [" ", "*", "/", "?"].includes(String(before || "")) &&
    ["x", "X", "-"].includes(String(after || ""));
}

function cyclerMailCloseChildrenAt(lines, taskIndex) {
  const rows = Array.isArray(lines) ? lines : [];
  const task = String(rows[taskIndex] || "");
  const taskIndent = (/^\s*/.exec(task) || [""])[0].replace(/\t/g, "    ").length;
  const children = [];
  for (let index = taskIndex + 1; index < rows.length; index += 1) {
    const line = String(rows[index] || "");
    if (!line.trim()) continue;
    const indent = (/^\s*/.exec(line) || [""])[0].replace(/\t/g, "    ").length;
    if (indent <= taskIndent) break;
    children.push(line);
  }
  return children;
}

function cyclerMailClosePossibleLinks(lineText, children) {
  const links = [];
  try {
    for (const target of mailCloseLineLinks(lineText)) {
      if (target && !links.includes(target)) links.push(target);
    }
  } catch (_error) {}
  for (const child of Array.isArray(children) ? children : []) {
    let target = null;
    try { target = mailCloseLinkOnlyBullet(child); } catch (_error) { target = null; }
    if (target && !links.includes(target)) links.push(target);
  }
  return links;
}

function cyclerMailCloseWarmIsMail(app, sourcePath, link) {
  try {
    const metadata = app && app.metadataCache;
    if (!metadata || typeof metadata.getFirstLinkpathDest !== "function") return null;
    const dest = metadata.getFirstLinkpathDest(link, sourcePath || "");
    if (!dest) return null;
    if (typeof metadata.getFileCache !== "function") return null;
    const cache = metadata.getFileCache(dest);
    if (!cache || !cache.frontmatter || typeof cache.frontmatter !== "object") return null;
    return mailCloseFrontmatterIsMail(cache.frontmatter) === true;
  } catch (_error) {
    return null;
  }
}

function cyclerMailCloseLineIsPossible(app, path, lineText, children) {
  const links = cyclerMailClosePossibleLinks(lineText, children);
  if (links.length === 0) return false;
  for (const link of links) {
    const isMail = cyclerMailCloseWarmIsMail(app, path, link);
    if (isMail !== false) return true;
  }
  return false;
}

function cyclerMailCloseNormalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function cyclerMailCloseCoerceFrontmatter(frontmatter) {
  if (!frontmatter || typeof frontmatter !== "object") return frontmatter;
  if (mailCloseFrontmatterIsMail(frontmatter)) return frontmatter;
  const type = frontmatter.type;
  if (!Array.isArray(type)) return frontmatter;
  const tokens = type.flat(Infinity).map((item) => String(item || "").trim()).filter(Boolean);
  if (tokens.length === 1 && tokens[0] === "mail") {
    return Object.assign({}, frontmatter, { type: "[[mail]]" });
  }
  return frontmatter;
}

function cyclerMailCloseParsedFrontmatter(text) {
  try {
    const match = /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(String(text || ""));
    if (!match || typeof parseYaml !== "function") return null;
    const value = parseYaml(match[1]);
    return value && typeof value === "object" ? cyclerMailCloseCoerceFrontmatter(value) : null;
  } catch (_error) {
    return null;
  }
}

function cyclerMailCloseVaultFile(app, path) {
  try {
    const vault = app && app.vault;
    const normalized = cyclerMailCloseNormalizePath(path);
    const exact = vault && typeof vault.getAbstractFileByPath === "function"
      ? vault.getAbstractFileByPath(normalized) ||
        (!/\.md$/i.test(normalized) ? vault.getAbstractFileByPath(`${normalized}.md`) : null)
      : null;
    if (exact) return exact;
    const files = vault && typeof vault.getMarkdownFiles === "function" ? vault.getMarkdownFiles() : [];
    const basename = normalized.split("/").pop().replace(/\.md$/i, "").toLowerCase();
    const matches = files.filter((file) => String(file && file.basename || "").toLowerCase() === basename);
    if (matches.length !== 1) return null;
    const metadata = app && app.metadataCache;
    if (metadata && typeof metadata.getFirstLinkpathDest === "function") {
      const resolved = metadata.getFirstLinkpathDest(normalized, "");
      if (resolved && matches.some((file) => file.path === resolved.path)) return resolved;
    }
    return matches[0];
  } catch (_error) {
    return null;
  }
}

function cyclerMailCloseResolvedLinkFile(app, linkpath, sourcePath) {
  try {
    const link = String(linkpath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    const basename = link.split("/").pop().replace(/\.md$/i, "").toLowerCase();
    const files = app && app.vault && typeof app.vault.getMarkdownFiles === "function"
      ? app.vault.getMarkdownFiles()
      : [];
    if (!link.includes("/") && files.filter((file) => String(file.basename || "").toLowerCase() === basename).length > 1) {
      return null;
    }
    const metadata = app && app.metadataCache;
    const resolved = metadata && typeof metadata.getFirstLinkpathDest === "function"
      ? metadata.getFirstLinkpathDest(linkpath, sourcePath)
      : null;
    return resolved || cyclerMailCloseVaultFile(app, linkpath);
  } catch (_error) {
    return null;
  }
}

async function cyclerMailCloseReadFile(app, file) {
  try {
    const vault = app && app.vault;
    if (!vault || !file) return "";
    if (typeof vault.cachedRead === "function") return String((await vault.cachedRead(file)) || "");
    if (typeof vault.read === "function") return String((await vault.read(file)) || "");
  } catch (_error) {}
  return "";
}

async function cyclerMailCloseFrontmatterForFile(app, file) {
  try {
    const metadata = app && app.metadataCache;
    const cache = metadata && typeof metadata.getFileCache === "function" ? metadata.getFileCache(file) : null;
    if (cache && cache.frontmatter && typeof cache.frontmatter === "object") {
      return cyclerMailCloseCoerceFrontmatter(cache.frontmatter);
    }
  } catch (_error) {}
  return cyclerMailCloseParsedFrontmatter(await cyclerMailCloseReadFile(app, file));
}

function cyclerMailCloseTargetText(target) {
  if (!target || typeof target !== "object") {
    return { lineText: "", children: [], path: "" };
  }
  const lineText = typeof target.lineText === "string"
    ? target.lineText
    : (typeof target.line_text === "string" ? target.line_text : "");
  const children = Array.isArray(target.children) ? target.children : [];
  return { lineText, children, path: String(target.path || "") };
}

function cyclerMailCloseTwinSyncHint(plugin, target) {
  const { lineText, children, path } = cyclerMailCloseTargetText(target);
  if (
    !/^\s*(?:[-+*]|\d+[.)])\s+\[[ /?*]\]/.test(lineText) ||
    !/(?:^|\s)#task(?:\s|$)/.test(lineText)
  ) {
    return "no";
  }
  const app = plugin && plugin.app;
  const links = cyclerMailClosePossibleLinks(lineText, children);
  const resolvedLinks = new Map();
  let unknown = false;
  for (const link of links) {
    const isMail = cyclerMailCloseWarmIsMail(app, path, link);
    if (isMail === null) {
      unknown = true;
      continue;
    }
    let dest = null;
    try {
      const metadata = app && app.metadataCache;
      dest = metadata && typeof metadata.getFirstLinkpathDest === "function"
        ? metadata.getFirstLinkpathDest(link, path)
        : null;
    } catch (_error) {
      dest = null;
    }
    if (!dest || !dest.path) {
      unknown = true;
      continue;
    }
    let frontmatter = null;
    try {
      const cache = app.metadataCache.getFileCache(dest);
      frontmatter = cache && cache.frontmatter && typeof cache.frontmatter === "object"
        ? cache.frontmatter
        : null;
    } catch (_error) {
      frontmatter = null;
    }
    resolvedLinks.set(link, { path: cyclerMailCloseNormalizePath(dest.path), frontmatter });
  }
  const predicate = mailClosePredicate({
    line: lineText,
    children,
    resolve: (link) => resolvedLinks.get(link) || null,
    isMail: (_notePath, resolved) => mailCloseFrontmatterIsMail(resolved && resolved.frontmatter),
  });
  if (predicate.gmail_task) return "yes";
  if (unknown) return "unknown";
  return "no";
}

async function cyclerMailCloseTwinHasGmail(plugin, targets) {
  const app = plugin && plugin.app;
  for (const target of Array.isArray(targets) ? targets : []) {
    const { lineText, children, path } = cyclerMailCloseTargetText(target);
    const links = cyclerMailClosePossibleLinks(lineText, children);
    const resolvedLinks = new Map();
    const frontmatterByPath = {};
    for (const link of links) {
      const file = cyclerMailCloseResolvedLinkFile(app, link, path);
      if (!file) continue;
      const linkedPath = cyclerMailCloseNormalizePath(file.path);
      const frontmatter = await cyclerMailCloseFrontmatterForFile(app, file);
      resolvedLinks.set(link, { path: linkedPath, frontmatter });
      if (frontmatter) frontmatterByPath[linkedPath] = frontmatter;
    }
    const predicate = mailClosePredicate({
      line: lineText,
      children,
      resolve: (link) => resolvedLinks.get(link) || null,
      notes: frontmatterByPath,
      isMail: (_notePath, resolved) => mailCloseFrontmatterIsMail(resolved && resolved.frontmatter),
    });
    if (predicate.gmail_task) return true;
  }
  return false;
}

function cyclerMailCloseNavApi(plugin) {
  try {
    const plugins = plugin && plugin.app && plugin.app.plugins && plugin.app.plugins.plugins;
    const api = plugins && plugins["bob-navigation-hotkeys"] && plugins["bob-navigation-hotkeys"].api;
    const guard = api && api.mailCloseGuard;
    if (!guard || !(Number(guard.version) >= 1) || typeof guard.confirm !== "function") {
      return null;
    }
    return guard;
  } catch (_error) {
    return null;
  }
}

function cyclerMailCloseSyncDecision(plugin, targets) {
  const closes = [];
  for (const source of Array.isArray(targets) ? targets : []) {
    if (!source || typeof source !== "object") continue;
    if (!cyclerMailCloseIsClose(source.before, source.after)) continue;
    closes.push(source);
  }
  if (closes.length === 0) return { kind: "allow", targets: [] };
  const possible = [];
  for (const target of closes) {
    const lineText = typeof target.lineText === "string"
      ? target.lineText
      : (typeof target.line_text === "string" ? target.line_text : "");
    const children = Array.isArray(target.children) ? target.children : [];
    if (cyclerMailCloseLineIsPossible(plugin && plugin.app, target.path, lineText, children)) {
      possible.push(target);
    }
  }
  if (possible.length === 0) return { kind: "allow", targets: [] };
  const remaining = [];
  let knownGmail = 0;
  for (const target of possible) {
    const hint = cyclerMailCloseTwinSyncHint(plugin, target);
    if (hint === "no") continue;
    remaining.push(target);
    if (hint === "yes") knownGmail += 1;
  }
  if (remaining.length === 0) return { kind: "allow", targets: [] };
  if (cyclerMailCloseNavApi(plugin)) return { kind: "ask", targets: remaining };
  if (knownGmail === remaining.length) return { kind: "block", targets: remaining };
  return { kind: "classify", targets: remaining };
}

function cyclerMailCloseNoticeFail() {
  try { new Notice(CYCLER_MAIL_CLOSE_FAIL_NOTICE); } catch (_error) {}
}

function cyclerMailCloseReleaseWalk(plugin) {
  try {
    const plugins = plugin && plugin.app && plugin.app.plugins && plugin.app.plugins.plugins;
    const nav = plugins && plugins["bob-navigation-hotkeys"];
    if (!nav || typeof nav.settleReviewWalkLock !== "function") return;
    nav.settleReviewWalkLock(false);
  } catch (_error) {}
}

function cyclerMailClosePublicTarget(target) {
  if (!target || typeof target !== "object") return null;
  const path = String(target.path || "");
  const line = Math.floor(Number(target.line));
  const before = String(target.before || " ").slice(0, 1);
  const after = String(target.after || " ").slice(0, 1);
  if (!path || !Number.isInteger(line) || line < 1) return null;
  const row = { path, line, before, after };
  if (typeof target.lineText === "string") row.lineText = target.lineText;
  else if (typeof target.line_text === "string") row.lineText = target.line_text;
  return row;
}

async function confirmCyclerMailClose(plugin, targets, options = {}) {
  const decision = cyclerMailCloseSyncDecision(plugin, targets);
  if (decision.kind === "allow") return { confirmed: true, guarded: false, token: null };
  if (decision.kind === "block") {
    cyclerMailCloseNoticeFail();
    cyclerMailCloseReleaseWalk(plugin);
    return { confirmed: false, guarded: true, token: null };
  }
  if (decision.kind === "classify") {
    if (await cyclerMailCloseTwinHasGmail(plugin, decision.targets)) {
      cyclerMailCloseNoticeFail();
      cyclerMailCloseReleaseWalk(plugin);
      return { confirmed: false, guarded: true, token: null };
    }
    return { confirmed: true, guarded: false, token: null };
  }
  const passed = options && options.context && typeof options.context.mailCloseConfirmed === "string"
    ? options.context.mailCloseConfirmed
    : null;
  const api = cyclerMailCloseNavApi(plugin);
  if (!api) {
    if (await cyclerMailCloseTwinHasGmail(plugin, decision.targets)) {
      cyclerMailCloseNoticeFail();
      cyclerMailCloseReleaseWalk(plugin);
      return { confirmed: false, guarded: true, token: null };
    }
    return { confirmed: true, guarded: false, token: null };
  }
  try {
    const payload = decision.targets.map(cyclerMailClosePublicTarget).filter(Boolean);
    const result = await api.confirm(payload, {
      context: passed ? { mailCloseConfirmed: passed } : options.context,
      openingKeys: options.openingKeys,
    });
    if (!result || result.confirmed !== true) {
      cyclerMailCloseReleaseWalk(plugin);
      return result && typeof result === "object"
        ? result
        : { confirmed: false, guarded: true, token: null };
    }
    return result;
  } catch (_error) {
    cyclerMailCloseNoticeFail();
    cyclerMailCloseReleaseWalk(plugin);
    return { confirmed: false, guarded: true, token: null };
  }
}

class TaskStatusCyclerMailCloseMixin {
  cyclerMailCloseTargetFromEditor(editor, path, taskStatus, after) {
    if (!taskStatus || !path) return null;
    let children = [];
    try {
      const lines = this.getEditorLineTexts(editor);
      children = cyclerMailCloseChildrenAt(lines, taskStatus.line);
    } catch (_error) {
      children = [];
    }
    return {
      path,
      line: taskStatus.line + 1,
      lineText: String(taskStatus.lineText || ""),
      before: String(taskStatus.symbol || " "),
      after,
      children,
    };
  }

  cyclerMailCloseTargetFromResolved(resolvedTarget, after) {
    if (!resolvedTarget || !resolvedTarget.file || !resolvedTarget.file.path) return null;
    const lineText = resolvedTarget.taskStatus && resolvedTarget.taskStatus.lineText
      ? resolvedTarget.taskStatus.lineText
      : getLineTextFromSourceText(resolvedTarget.sourceText, resolvedTarget.line);
    let children = [];
    try {
      const lines = String(resolvedTarget.sourceText || "").split(/\r?\n/);
      children = cyclerMailCloseChildrenAt(lines, resolvedTarget.line);
    } catch (_error) {
      children = [];
    }
    const before = resolvedTarget.taskStatus && resolvedTarget.taskStatus.symbol
      ? resolvedTarget.taskStatus.symbol
      : " ";
    return {
      path: resolvedTarget.file.path,
      line: resolvedTarget.line + 1,
      lineText: String(lineText || ""),
      before,
      after,
      children,
    };
  }

  async confirmCyclerMailClose(targets, options = {}) {
    return confirmCyclerMailClose(this, targets, options);
  }

  async collectCyclerMailCloseTargetsFromResolvedTree(
    resolvedTarget,
    context,
    seen = new Set(),
    depth = 0,
  ) {
    const targets = [];
    if (!resolvedTarget || !resolvedTarget.file || depth > MAX_TRANSCLUDED_RECURSION_DEPTH) {
      return targets;
    }
    const seenKey = `${resolvedTarget.file.path}#^${resolvedTarget.blockId}`;
    if (seen.has(seenKey) || seen.size >= MAX_TRANSCLUDED_RECURSION_TARGETS) return targets;
    seen.add(seenKey);
    const childContext = {
      editor: context && context.editor,
      activePath: context && context.activePath,
      originPath: resolvedTarget.file.path,
      ...(context && typeof context.mailCloseConfirmed === "string"
        ? { mailCloseConfirmed: context.mailCloseConfirmed }
        : {}),
    };
    let childTargets = [];
    try {
      childTargets = collectEmbeddedTranscludedTaskTargetsInListItemBlock(
        resolvedTarget.sourceText,
        resolvedTarget.line,
      );
    } catch (_error) {
      childTargets = [];
    }
    for (const childTarget of childTargets) {
      try {
        const childResolved = await this.resolveTranscludedBlockTarget(
          childTarget,
          childContext,
          { taskStatusPredicate: isTranscludedCompletionTraversableStatus },
        );
        if (childResolved && childResolved.file) {
          const nested = await this.collectCyclerMailCloseTargetsFromResolvedTree(
            childResolved, childContext, seen, depth + 1,
          );
          targets.push(...nested);
        }
      } catch (_error) {}
    }
    const lineText = resolvedTarget.taskStatus && resolvedTarget.taskStatus.lineText
      ? resolvedTarget.taskStatus.lineText
      : getLineTextFromSourceText(resolvedTarget.sourceText, resolvedTarget.line);
    if (
      isTranscludedCompletionClosableStatus(resolvedTarget.taskStatus) &&
      taskReqCarriesGlobalFilter(lineText, TASKS_GLOBAL_FILTER)
    ) {
      const own = this.cyclerMailCloseTargetFromResolved(resolvedTarget, "x");
      if (own) targets.push(own);
    }
    return targets;
  }

  async confirmCyclerMailCloseIfNeeded(targets, context, options = {}) {
    const token = context && typeof context.mailCloseConfirmed === "string"
      ? context.mailCloseConfirmed
      : (options && options.context && options.context.mailCloseConfirmed);
    const result = await confirmCyclerMailClose(this, targets, {
      ...options,
      context: token ? { ...(options.context || {}), mailCloseConfirmed: token } : options.context,
    });
    if (result && result.confirmed === true && result.token && context && typeof context === "object") {
      context.mailCloseConfirmed = result.token;
    }
    return result;
  }

  maybeDeferCyclerMailCloseLocalCycle(editor, view, taskStatus, nextSymbol, direction) {
    const cycleFile = (view && view.file) ||
      (this.app.workspace && typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);
    const cyclePath = cycleFile && cycleFile.path;
    if (!cyclerMailCloseIsClose(taskStatus && taskStatus.symbol, nextSymbol) || !cyclePath) {
      return false;
    }
    const mailTarget = this.cyclerMailCloseTargetFromEditor(
      editor, cyclePath, taskStatus, nextSymbol,
    );
    const mailDecision = cyclerMailCloseSyncDecision(this, mailTarget ? [mailTarget] : []);
    if (mailDecision.kind === "block") {
      cyclerMailCloseNoticeFail();
      return true;
    }
    if (mailDecision.kind !== "ask" && mailDecision.kind !== "classify") return false;
    const snapshot = {
      line: taskStatus.line,
      lineText: taskStatus.lineText,
      nextSymbol,
    };
    void this.confirmCyclerMailClose(mailTarget ? [mailTarget] : []).then((result) => {
      if (!result || result.confirmed !== true) return;
      const live = this.getActiveTaskStatus(editor);
      if (!live || live.line !== snapshot.line || live.lineText !== snapshot.lineText) return;
      if (this.getAdjacentSymbol(live.symbol, direction) !== snapshot.nextSymbol) return;
      this.writeCycledLocalTask(editor, view, live, snapshot.nextSymbol);
    }).catch(() => false);
    return true;
  }

  async collectCyclerMailCloseRangeTargets(
    editor, activePath, lines, startLine, endLine, direction, context, editorLineFor, cursor, isLaneSkippedRangeLine,
  ) {
    const targets = [];
    for (let line = startLine; line <= endLine; line += 1) {
      if (typeof isLaneSkippedRangeLine === "function" && isLaneSkippedRangeLine(line)) continue;
      const lineText = String(lines[line] || "");
      if (cyclerBankLineKind(activePath, lineText) !== null) continue;
      const taskStatus = getTaskStatusForLine(lineText, line);
      if (taskStatus) {
        if (!isCyclableTaskStatus(taskStatus)) continue;
        if (
          taskStatus.symbol === BLOCKED_TASK_STATUS_SYMBOL &&
          isProjectBlockedResidentTaskInDocument(lines.join("\n"), activePath, line)
        ) continue;
        const nextSymbol = this.getAdjacentSymbol(taskStatus.symbol, direction);
        if (!cyclerMailCloseIsClose(taskStatus.symbol, nextSymbol)) continue;
        const target = this.cyclerMailCloseTargetFromEditor(editor, activePath, taskStatus, nextSymbol);
        if (target) targets.push(target);
        continue;
      }
      if (!context) continue;
      const target = isTaskLinkGestureLine(lineText)
        ? getTaskBlockLinkTargetFromLine(
            lineText, activePath, editorLineFor(line),
            cursor && line === startLine ? cursor.ch : null,
          )
        : getTranscludedTaskTargetFromLine(
            lineText, activePath, editorLineFor(line),
            cursor && line === startLine ? cursor.ch : null,
          );
      if (!target) continue;
      let resolvedTarget = null;
      try {
        resolvedTarget = await this.resolveTranscludedBlockTarget(
          target, context, { taskStatusPredicate: isCyclableTaskStatus },
        );
      } catch (_error) {
        resolvedTarget = null;
      }
      if (!resolvedTarget || !resolvedTarget.file) continue;
      const targetNext = this.getAdjacentSymbol(resolvedTarget.taskStatus.symbol, direction);
      if (!cyclerMailCloseIsClose(resolvedTarget.taskStatus.symbol, targetNext)) continue;
      const mailTarget = this.cyclerMailCloseTargetFromResolved(resolvedTarget, targetNext);
      if (mailTarget) targets.push(mailTarget);
    }
    return targets;
  }

  async confirmCyclerMailCloseRange(
    editor, activePath, lines, startLine, endLine, direction, context, editorLineFor, cursor, isLaneSkippedRangeLine,
  ) {
    const targets = await this.collectCyclerMailCloseRangeTargets(
      editor, activePath, lines, startLine, endLine, direction, context, editorLineFor, cursor, isLaneSkippedRangeLine,
    );
    return this.confirmCyclerMailCloseIfNeeded(targets, context);
  }

  async confirmCyclerMailCloseForEditorClose(editor, activePath, taskStatus, after, options = {}) {
    const target = this.cyclerMailCloseTargetFromEditor(editor, activePath, taskStatus, after);
    return confirmCyclerMailClose(this, target ? [target] : [], {
      context: options && options.context,
    });
  }

  async confirmCyclerMailCloseForCheckbox(editor, activePath, taskStatus, transclusionCandidate, options = {}) {
    const targets = [];
    const localTarget = this.cyclerMailCloseTargetFromEditor(
      editor, activePath, taskStatus, getNextOpenDoneSymbol(taskStatus),
    );
    if (localTarget) targets.push(localTarget);
    if (transclusionCandidate) {
      try {
        const resolvedEmbed = await this.resolveTranscludedBlockTarget(
          transclusionCandidate,
          { editor, activePath, originPath: activePath },
        );
        if (resolvedEmbed && isTranscludedCompletionClosableStatus(resolvedEmbed.taskStatus)) {
          const embedTarget = this.cyclerMailCloseTargetFromResolved(resolvedEmbed, "x");
          if (embedTarget) targets.push(embedTarget);
        }
      } catch (_error) {}
    }
    const result = await confirmCyclerMailClose(this, targets, {
      context: options && options.mailCloseConfirmed
        ? { mailCloseConfirmed: options.mailCloseConfirmed }
        : options && options.context,
    });
    if (result && result.confirmed === true && result.token && options && typeof options === "object") {
      options.mailCloseConfirmed = result.token;
    }
    return result;
  }

  async confirmCyclerMailCloseForResolvedClose(resolvedTarget, context, after = "x") {
    const target = this.cyclerMailCloseTargetFromResolved(resolvedTarget, after);
    return this.confirmCyclerMailCloseIfNeeded(target ? [target] : [], context);
  }

  async confirmCyclerMailCloseForResolvedTree(resolvedTarget, context) {
    const targets = await this.collectCyclerMailCloseTargetsFromResolvedTree(resolvedTarget, context);
    return this.confirmCyclerMailCloseIfNeeded(targets, context);
  }

  async confirmCyclerMailCloseForResolvedWrite(resolvedTarget, context, forcedNextSymbol = null) {
    let after = forcedNextSymbol;
    if (!after) {
      try { after = getNextOpenDoneSymbol(resolvedTarget && resolvedTarget.taskStatus); } catch (_error) { after = null; }
    }
    const before = resolvedTarget && resolvedTarget.taskStatus
      ? resolvedTarget.taskStatus.symbol
      : "";
    if (!cyclerMailCloseIsClose(before, after)) {
      return { confirmed: true, guarded: false, token: null };
    }
    return this.confirmCyclerMailCloseForResolvedClose(resolvedTarget, context, after);
  }

  async confirmCyclerMailCloseForPomodoroCascade(editor, sourcePath, pomodoroLine, subBullets, context) {
    const targets = [];
    let lineText = "";
    try {
      lineText = editor && typeof editor.getLine === "function"
        ? String(editor.getLine(pomodoroLine) || "")
        : "";
    } catch (_error) {
      lineText = "";
    }
    const taskStatus = getTaskStatusForLine(lineText, pomodoroLine);
    if (taskStatus && cyclerMailCloseIsClose(taskStatus.symbol, "x")) {
      const own = this.cyclerMailCloseTargetFromEditor(editor, sourcePath, taskStatus, "x");
      if (own) targets.push(own);
    }
    const writeContext = { editor, activePath: sourcePath, originPath: sourcePath };
    for (const bullet of Array.isArray(subBullets && subBullets.transcludedTaskLinkBullets)
      ? subBullets.transcludedTaskLinkBullets : []) {
      for (const candidate of Array.isArray(bullet.targets) ? bullet.targets : []) {
        try {
          const resolved = await this.resolveTranscludedBlockTarget(
            candidate,
            writeContext,
            { taskStatusPredicate: isTranscludedCompletionTraversableStatus },
          );
          if (resolved && resolved.file) {
            targets.push(...await this.collectCyclerMailCloseTargetsFromResolvedTree(resolved, writeContext));
          }
        } catch (_error) {}
      }
    }
    return this.confirmCyclerMailCloseIfNeeded(targets, context);
  }

  async confirmCyclerMailCloseForOfferCloses(finalPlanned, liveNotes, providedNotes, context) {
    const targets = [];
    for (const row of Array.isArray(finalPlanned) ? finalPlanned : []) {
      const path = String(row && row.path || "");
      const line = Number.isInteger(row && row.line) ? row.line : -1;
      if (!path || line < 0) continue;
      const lineText = typeof row.beforeLine === "string"
        ? row.beforeLine
        : (typeof row.expected === "string" ? row.expected : "");
      const after = row.outcome === "cancelled" ? "-" : "x";
      const before = String(row.status || " ").slice(0, 1);
      let children = [];
      try {
        const live = liveNotes && liveNotes.has && liveNotes.has(path)
          ? liveNotes.get(path)
          : (providedNotes && providedNotes.get && providedNotes.get(path));
        if (typeof live === "string") {
          children = cyclerMailCloseChildrenAt(String(live).split(/\r?\n/), line);
        }
      } catch (_error) {
        children = [];
      }
      targets.push({ path, line: line + 1, lineText, before, after, children });
    }
    return this.confirmCyclerMailCloseIfNeeded(targets, context);
  }

  cyclerMailCloseEmptyOfferResult() {
    return {
      offer_closes: [],
      offer_close_refused: null,
      undo: null,
      resolved: [],
      failures: null,
    };
  }

  registerCyclerMailCloseClickGuard() {
    let doc = null;
    try {
      const workspace = this.app && this.app.workspace;
      const el = workspace && workspace.containerEl;
      doc = el && el.ownerDocument ? el.ownerDocument : (typeof document !== "undefined" ? document : null);
    } catch (_error) {
      doc = typeof document !== "undefined" ? document : null;
    }
    if (!doc || typeof this.registerDomEvent !== "function") return;
    const handler = (event) => this.cyclerMailCloseGuardClick(event);
    for (const type of ["pointerdown", "mousedown", "touchstart", "click"]) {
      try {
        this.registerDomEvent(doc, type, handler, { capture: true, passive: false });
      } catch (_error) {}
    }
  }

  cyclerMailCloseClickIsForeign(input) {
    if (!input || typeof input.closest !== "function") return true;
    for (const selector of CYCLER_MAIL_CLOSE_QUERY_SELECTORS) {
      try {
        if (input.closest(selector)) return true;
      } catch (_error) {}
    }
    return false;
  }

  cyclerMailCloseLineFromCheckbox(input, view) {
    if (!input || typeof input.closest !== "function") return null;
    if (this.cyclerMailCloseClickIsForeign(input)) return null;
    try {
      const reading = input.closest("li.task-list-item");
      if (reading && typeof reading.getAttribute === "function") {
        const raw = reading.getAttribute("data-line");
        const line = Number(raw);
        if (Number.isInteger(line) && line >= 0) return line;
      }
    } catch (_error) {}
    try {
      const editor = view && view.editor;
      const cm = editor && (editor.cm || editor);
      if (cm && typeof cm.posAtDOM === "function") {
        const pos = cm.posAtDOM(input);
        if (pos && Number.isInteger(pos.line) && pos.line >= 0) return pos.line;
      }
    } catch (_error) {}
    try {
      const host = input.closest(".HyperMD-task-line, .cm-task-list-item, .cm-line");
      if (host && typeof host.getAttribute === "function") {
        const raw = host.getAttribute("data-line");
        const line = Number(raw);
        if (Number.isInteger(line) && line >= 0) return line;
      }
    } catch (_error) {}
    return null;
  }

  cyclerMailCloseActiveMarkdownView() {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getActiveViewOfType !== "function") return null;
      const view = workspace.getActiveViewOfType(MarkdownView);
      return view instanceof MarkdownView ? view : null;
    } catch (_error) {
      return null;
    }
  }

  cyclerMailCloseGuardClick(event) {
    if (!event) return false;
    let input = null;
    try {
      const target = event.target;
      input = target && typeof target.closest === "function"
        ? target.closest("input.task-list-item-checkbox")
        : null;
    } catch (_error) {
      input = null;
    }
    if (!input) return false;
    const view = this.cyclerMailCloseActiveMarkdownView();
    if (!view || !view.editor) return false;
    const file = view.file ||
      (this.app.workspace && typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);
    const path = file && file.path;
    if (!path) return false;
    const line = this.cyclerMailCloseLineFromCheckbox(input, view);
    if (!Number.isInteger(line) || line < 0) return false;
    let lineText = "";
    try { lineText = String(view.editor.getLine(line) || ""); } catch (_error) { return false; }
    const taskStatus = getTaskStatusForLine(lineText, line);
    if (!taskStatus || !this.lineMatchesTasksGlobalFilter(lineText)) return false;
    const after = getNextOpenDoneSymbol(taskStatus);
    if (!cyclerMailCloseIsClose(taskStatus.symbol, after)) return false;
    const target = this.cyclerMailCloseTargetFromEditor(view.editor, path, taskStatus, after);
    const decision = cyclerMailCloseSyncDecision(this, target ? [target] : []);
    if (decision.kind === "allow") return false;
    try {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    } catch (_error) {}
    const previous = this.cyclerMailCloseLastClick;
    const now = Date.now();
    const sameGesture = previous && previous.input === input && now - previous.time < 1000;
    this.cyclerMailCloseLastClick = event.type === "click" ? null : { input, time: now };
    if (sameGesture && event.type !== "click") return true;
    if (decision.kind === "block") {
      cyclerMailCloseNoticeFail();
      return true;
    }
    if (this.cyclerMailCloseClickPending === true) return true;
    this.cyclerMailCloseClickPending = true;
    void this.confirmCyclerMailClose(target ? [target] : []).then((result) => {
      this.cyclerMailCloseClickPending = false;
      if (!result || result.confirmed !== true) return;
      try {
        if (typeof view.editor.setCursor === "function") {
          view.editor.setCursor({ line, ch: Math.min(3, lineText.length) });
        }
      } catch (_error) {}
      const live = this.getActiveTaskStatus(view.editor);
      if (!live || live.line !== line || live.lineText !== lineText) return;
      return this.toggleActiveCheckboxOpenDoneAndPropagate(view.editor, file, live, {
        mailCloseConfirmed: result.token,
      });
    }).catch(() => {
      this.cyclerMailCloseClickPending = false;
    });
    return true;
  }
}
