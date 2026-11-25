// Navigation consumer of bob-ledger-tools.api.taskSettle v1.
//
// Pure helpers: feature detection, typed outcomes, identity, line-map
// composition, cursor stay/jump planning, command wrapping, and
// postimage preparation. The mixin in `181b-plugin-task-settle.js`
// owns editor/file writes and flush. Later phases call these instead
// of copying grouping into nav. Rollback/restore never settles.

const NAV_TASK_SETTLE_PLUGIN_ID = "bob-ledger-tools";
const NAV_TASK_SETTLE_API_VERSION = 1;

const NAV_TASK_SETTLE_FLUSH_ROUTES = Object.freeze({
  commands:
    "Obsidian addCommand callback/editorCallback; checkCallback and editorCheckCallback only when checking !== true",
  vim: "registerVimMappings defineAction wrappers",
  physical: Object.freeze([
    "handleOpenTaskJumpPhysicalKeydown",
    "handleCountedBulletPropertyPhysicalKeydown",
    "handleCountedLaneTogglePhysicalKeydown",
    "handleCountedTransclusionTogglePhysicalKeydown",
    "handleCountedTaskMovePhysicalKeydown",
    "handleReviewRefreshPhysicalKeydown",
    "handleTaskSplitPhysicalKeydown",
    "handlePomodoroSplitPhysicalKeydown",
  ]),
  publicApi: Object.freeze([
    "reviewWalk.capture",
    "claimReviewWalkCompletion",
    "openDependencyStage",
    "removeDependency",
    "openFileInActiveLeaf",
  ]),
  skipped: Object.freeze([
    "checkCallback when checking === true",
    "arbitrary typing / every keydown",
    "recordJump",
  ]),
});

function lookupNavTaskSettleApi(app) {
  try {
    const plugins = app && app.plugins && app.plugins.plugins;
    const holder = plugins ? plugins[NAV_TASK_SETTLE_PLUGIN_ID] : null;
    const settle = holder && holder.api ? holder.api.taskSettle : null;
    if (!settle || settle.version !== NAV_TASK_SETTLE_API_VERSION) {
      return null;
    }
    if (typeof settle.settleNote !== "function") return null;
    if (typeof settle.applyToEditor !== "function") return null;
    if (typeof settle.flushPending !== "function") return null;
    return settle;
  } catch (_error) {
    return null;
  }
}

function freezeNavSettleOutcome(fields) {
  const jump = fields && fields.jumpTarget && typeof fields.jumpTarget === "object"
    ? Object.freeze({ ...fields.jumpTarget })
    : null;
  const cursor = fields && fields.cursor && typeof fields.cursor === "object"
    ? Object.freeze({
        line: Number(fields.cursor.line) || 0,
        ch: Number(fields.cursor.ch) || 0,
      })
    : null;
  const lineMap = {};
  if (fields && fields.lineMap && typeof fields.lineMap === "object") {
    for (const [key, value] of Object.entries(fields.lineMap)) {
      if (Number.isInteger(value)) lineMap[key] = value;
    }
  }
  return Object.freeze({
    kind: String(fields && fields.kind || "idle"),
    applied: fields && fields.applied === true,
    changed: fields && fields.changed === true,
    contents: String(fields && fields.contents != null ? fields.contents : ""),
    lineMap: Object.freeze(lineMap),
    jumpTarget: jump,
    cursor,
    reason: fields && fields.reason != null ? String(fields.reason) : null,
    warnings: Object.freeze(
      Array.isArray(fields && fields.warnings) ? fields.warnings.map(String) : [],
    ),
    historyJoined:
      fields && fields.historyJoined == null ? null : fields.historyJoined,
    provider: String(fields && fields.provider || "none"),
  });
}

function navTaskSettleIdleOutcome(fields) {
  return freezeNavSettleOutcome({ kind: "idle", applied: false, ...fields });
}

function navTaskSettleRefusedOutcome(fields) {
  return freezeNavSettleOutcome({ kind: "refused", applied: false, ...fields });
}

function navTaskSettleFallbackOutcome(fields) {
  return freezeNavSettleOutcome({ kind: "fallback", ...fields });
}

function navTaskSettleAppliedOutcome(fields) {
  return freezeNavSettleOutcome({ kind: "applied", applied: true, ...fields });
}

function navTaskSettleRestoreOutcome(fields) {
  return freezeNavSettleOutcome({ kind: "restore", applied: true, ...fields });
}

function navTaskSettleLineBlockId(line) {
  const id = getTrailingBlockId(String(line || ""));
  return id ? String(id) : "";
}

function navTaskSettleLineIndent(line) {
  const text = String(line || "");
  let index = 0;
  while (text[index] === " " || text[index] === "\t") index += 1;
  return index;
}

function navTaskSettleTaskBlockRange(lines, headlineIndex) {
  if (!Array.isArray(lines) || headlineIndex < 0 || headlineIndex >= lines.length) {
    return null;
  }
  const indent = navTaskSettleLineIndent(lines[headlineIndex]);
  let end = headlineIndex + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (String(line).trim() === "") {
      let look = end + 1;
      while (look < lines.length && String(lines[look]).trim() === "") look += 1;
      if (look < lines.length && navTaskSettleLineIndent(lines[look]) > indent) {
        end = look;
        continue;
      }
      break;
    }
    if (navTaskSettleLineIndent(line) > indent) {
      end += 1;
      continue;
    }
    break;
  }
  return { start: headlineIndex, end };
}

// Zero-based identity against settle-input lines. A supplied block ID is
// authoritative: unique match wins, absent or duplicate is unresolved even
// when fallback text matches. A line number alone is never identity.
function resolveNavTaskIdentity(lines, identity) {
  if (!identity || typeof identity !== "object" || !Array.isArray(lines)) {
    return Object.freeze({ line: null, reason: "identity" });
  }
  const blockId =
    typeof identity.blockId === "string" ? identity.blockId.trim() : "";
  const text = identity.text == null ? null : String(identity.text);
  if (blockId) {
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (navTaskSettleLineBlockId(lines[index]) === blockId) matches.push(index);
    }
    if (matches.length === 1) {
      return Object.freeze({ line: matches[0], reason: null, source: "blockId" });
    }
    return Object.freeze({
      line: null,
      reason: matches.length === 0 ? "missing" : "ambiguous",
      source: "blockId",
    });
  }
  const hinted = Number.isInteger(identity.line)
    ? identity.line
    : Math.floor(Number(identity.line));
  if (
    text != null &&
    Number.isInteger(hinted) &&
    hinted >= 0 &&
    hinted < lines.length &&
    lines[hinted] === text
  ) {
    return Object.freeze({ line: hinted, reason: null, source: "hint" });
  }
  if (text == null) {
    return Object.freeze({ line: null, reason: "identity" });
  }
  const textMatches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === text) textMatches.push(index);
  }
  if (textMatches.length === 1) {
    return Object.freeze({ line: textMatches[0], reason: null, source: "text" });
  }
  return Object.freeze({
    line: null,
    reason: textMatches.length === 0 ? "missing" : "ambiguous",
    source: "text",
  });
}

function navTaskSettleLookupLineMap(lineMap, oldLine) {
  if (!lineMap || typeof lineMap !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(lineMap, oldLine)) {
    const mapped = lineMap[oldLine];
    return Number.isInteger(mapped) ? mapped : null;
  }
  const asString = String(oldLine);
  if (Object.prototype.hasOwnProperty.call(lineMap, asString)) {
    const mapped = lineMap[asString];
    return Number.isInteger(mapped) ? mapped : null;
  }
  return null;
}

function mapNavLineThroughSettle(lineMap, oldLine) {
  return navTaskSettleLookupLineMap(lineMap, oldLine);
}

function navTaskSettleFallbackMappedLine(lineMap, oldLine, newLineCount) {
  const last = Math.max(newLineCount - 1, 0);
  let bestOld = -1;
  let bestNew = null;
  for (const [rawOld, rawNew] of Object.entries(lineMap || {})) {
    const from = Number(rawOld);
    const to = Number(rawNew);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > oldLine) continue;
    if (from > bestOld) {
      bestOld = from;
      bestNew = to;
    }
  }
  if (bestNew == null) return 0;
  return Math.max(0, Math.min(bestNew, last));
}

// `first` maps original/gesture lines onto staged settle input; `second`
// maps that staged input onto settled output. Missing mappings drop.
function composeNavLineMaps(first, second) {
  const out = {};
  const left = first && typeof first === "object" ? first : {};
  const keys = Object.keys(left);
  if (keys.length === 0) {
    const right = second && typeof second === "object" ? second : {};
    for (const [key, value] of Object.entries(right)) {
      if (Number.isInteger(value)) out[key] = value;
    }
    return Object.freeze(out);
  }
  for (const [from, mid] of Object.entries(left)) {
    if (!Number.isInteger(mid)) continue;
    const mapped = navTaskSettleLookupLineMap(second, mid);
    if (mapped != null) out[from] = mapped;
  }
  return Object.freeze(out);
}

function navTaskSettleClampPos(position, lines) {
  const last = Math.max((lines && lines.length ? lines.length : 1) - 1, 0);
  const line = Math.max(0, Math.min(position.line, last));
  const ch = Math.max(0, Math.min(position.ch, String(lines[line] || "").length));
  return { line, ch };
}

function navTaskSettleNormalizePos(position) {
  if (!position || typeof position !== "object") return null;
  const line = Math.floor(Number(position.line));
  const ch = Math.floor(Number(position.ch));
  if (!Number.isInteger(line) || !Number.isInteger(ch)) return null;
  return { line: Math.max(0, line), ch: Math.max(0, ch) };
}

function navTaskSettlePlanCursor(options) {
  const {
    cursor,
    identity,
    lineMap,
    inputLines,
    outputLines,
    path,
  } = options || {};
  const lastOut = Math.max((outputLines && outputLines.length ? outputLines.length : 1) - 1, 0);
  const resolved = resolveNavTaskIdentity(inputLines, identity);
  const identityLine = resolved.line;
  const block =
    identityLine != null ? navTaskSettleTaskBlockRange(inputLines, identityLine) : null;
  const mappedIdentityLine =
    identityLine != null ? navTaskSettleLookupLineMap(lineMap, identityLine) : null;
  const blockMoved =
    identityLine != null &&
    mappedIdentityLine != null &&
    mappedIdentityLine !== identityLine;
  const from = navTaskSettleNormalizePos(cursor) || { line: 0, ch: 0 };
  const stay =
    blockMoved &&
    block &&
    from.line >= block.start &&
    from.line < block.end;
  const mapped = stay
    ? navTaskSettleClampPos(from, outputLines)
    : (() => {
        const hit = navTaskSettleLookupLineMap(lineMap, from.line);
        if (hit != null) {
          return navTaskSettleClampPos({ line: hit, ch: from.ch }, outputLines);
        }
        if (lineMap && Object.keys(lineMap).length > 0) {
          return navTaskSettleClampPos(
            {
              line: navTaskSettleFallbackMappedLine(
                lineMap,
                from.line,
                outputLines.length,
              ),
              ch: 0,
            },
            outputLines,
          );
        }
        return navTaskSettleClampPos(from, outputLines);
      })();
  let jumpTarget = null;
  if (stay && mappedIdentityLine != null) {
    const jumpLine = Math.max(0, Math.min(mappedIdentityLine, lastOut));
    const jumpText = String(outputLines[jumpLine] || "");
    jumpTarget = {
      path: String(path || ""),
      line: jumpLine,
      ch: Math.min(from.ch, jumpText.length),
      blockId:
        identity && typeof identity.blockId === "string" && identity.blockId.trim()
          ? identity.blockId.trim()
          : navTaskSettleLineBlockId(jumpText),
      text: jumpText,
    };
  }
  return Object.freeze({
    cursor: Object.freeze(mapped),
    jumpTarget: jumpTarget ? Object.freeze(jumpTarget) : null,
    stay: stay === true,
  });
}

function prepareNavSettledPostimage(app, path, contents, options = {}) {
  const text = String(contents == null ? "" : contents);
  const settle = lookupNavTaskSettleApi(app);
  if (!settle) {
    return navTaskSettleFallbackOutcome({
      contents: text,
      reason: "provider",
      provider: "none",
    });
  }
  try {
    const request = {
      path: String(path || ""),
      contents: text,
    };
    if (typeof options.today === "string" && options.today) {
      request.today = options.today;
    }
    if (typeof options.dailyPath === "string" && options.dailyPath) {
      request.dailyPath = options.dailyPath;
    }
    if (options.tasksSettings) request.tasksSettings = options.tasksSettings;
    const result = settle.settleNote(request);
    const next = result && result.contents != null ? String(result.contents) : text;
    return freezeNavSettleOutcome({
      kind: result && result.changed ? "applied" : "idle",
      applied: false,
      changed: Boolean(result && result.changed),
      contents: next,
      lineMap: result && result.lineMap ? result.lineMap : {},
      reason: result && result.changed ? null : "noop",
      warnings: result && result.warnings,
      provider: "v1",
    });
  } catch (_error) {
    return navTaskSettleFallbackOutcome({
      contents: text,
      reason: "error",
      provider: "error",
    });
  }
}

function navEditorMatchesView(editor, view) {
  if (!editor || !view) return false;
  if (view.editor === editor) return true;
  const viewEditor = view.editor;
  if (!viewEditor) return false;
  if (viewEditor.cm === editor) return true;
  if (editor.cm && (editor.cm === viewEditor || editor.cm === viewEditor.cm)) {
    return true;
  }
  return false;
}

function navFindMarkdownViewForEditor(app, editor, preferredView = null) {
  if (!app || !editor) return null;
  if (navEditorMatchesView(editor, preferredView)) return preferredView;
  const workspace = app.workspace;
  if (!workspace) return null;
  let match = null;
  const visit = (leaf) => {
    if (match || !leaf) return;
    const view = leaf.view;
    if (!view) return;
    const isMarkdown =
      (typeof view.getViewType === "function" && view.getViewType() === "markdown") ||
      Boolean(view.editor && view.file);
    if (!isMarkdown || !view.editor) return;
    if (navEditorMatchesView(editor, view)) match = view;
  };
  if (typeof workspace.iterateAllLeaves === "function") {
    try {
      workspace.iterateAllLeaves(visit);
    } catch (_error) {
      match = null;
    }
  }
  if (!match && typeof workspace.getLeavesOfType === "function") {
    const leaves = workspace.getLeavesOfType("markdown") || [];
    for (const leaf of leaves) visit(leaf);
  }
  if (!match && typeof workspace.getActiveViewOfType === "function") {
    try {
      visit({ view: workspace.getActiveViewOfType(MarkdownView) });
    } catch (_error) {
      match = null;
    }
  }
  if (!match && workspace.activeLeaf) visit(workspace.activeLeaf);
  return match;
}

function navGuardEditorPath(app, editor, path, preferredView = null) {
  const expected = normalizeVaultRelativePath(path);
  if (!expected) {
    return { ok: false, reason: "path", path: "" };
  }
  const view = navFindMarkdownViewForEditor(app, editor, preferredView);
  if (!view) {
    return { ok: false, reason: "view", path: expected };
  }
  const viewPath = view.file && typeof view.file.path === "string"
    ? normalizeVaultRelativePath(view.file.path)
    : "";
  if (!viewPath || viewPath !== expected) {
    return { ok: false, reason: "path", path: viewPath };
  }
  return { ok: true, reason: null, path: viewPath, view };
}

function wrapNavCommandForSettleFlush(plugin, command) {
  if (!command || typeof command !== "object") return command;
  const wrapped = { ...command };
  const flush = () => {
    if (plugin && typeof plugin.flushPendingNavSettles === "function") {
      plugin.flushPendingNavSettles();
    }
  };
  for (const name of ["callback", "editorCallback"]) {
    const callback = wrapped[name];
    if (typeof callback !== "function") continue;
    wrapped[name] = function navSettleFlushCommand(...args) {
      flush();
      return callback.apply(this, args);
    };
  }
  for (const name of ["checkCallback", "editorCheckCallback"]) {
    const callback = wrapped[name];
    if (typeof callback !== "function") continue;
    wrapped[name] = function navSettleFlushCheckCommand(checking, ...args) {
      if (checking !== true) flush();
      return callback.call(this, checking, ...args);
    };
  }
  return wrapped;
}

function flushNavTaskSettlePlugin(plugin) {
  if (plugin && typeof plugin.flushPendingNavSettles === "function") {
    plugin.flushPendingNavSettles();
  }
}

function wrapNavFunctionForSettleFlush(plugin, fn) {
  if (typeof fn !== "function") return fn;
  return function navSettleFlushWrapped(...args) {
    if (plugin && typeof plugin.flushPendingNavSettles === "function") {
      plugin.flushPendingNavSettles();
    }
    return fn.apply(this, args);
  };
}

function navSettleJumpLocations(path, outcome) {
  if (!outcome || !outcome.jumpTarget) return null;
  const target = outcome.jumpTarget;
  const destPath =
    typeof target.path === "string" && target.path
      ? target.path
      : String(path || "");
  if (!destPath) return null;
  const origin = outcome.cursor && Number.isInteger(outcome.cursor.line)
    ? {
        path: destPath,
        line: outcome.cursor.line,
        ch: Number.isInteger(outcome.cursor.ch) ? outcome.cursor.ch : 0,
      }
    : null;
  const destination = {
    path: destPath,
    line: Number.isInteger(target.line) ? target.line : 0,
    ch: Number.isInteger(target.ch) ? target.ch : 0,
  };
  if (!origin) return { origin: null, destination };
  return { origin, destination };
}

function consumeNavSettleFlushResults(plugin, results) {
  const list = Array.isArray(results) ? results : [];
  const consumed = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const result = entry.result && typeof entry.result === "object" ? entry.result : entry;
    const path = typeof entry.path === "string" ? entry.path : "";
    const jump = navSettleJumpLocations(path, result);
    if (
      jump &&
      jump.origin &&
      jump.destination &&
      plugin &&
      typeof plugin.recordJump === "function"
    ) {
      try {
        plugin.recordJump(jump.origin, jump.destination);
      } catch (_error) {
        // Jump recording is best-effort; the write already landed.
      }
    }
    consumed.push(
      Object.freeze({
        path,
        generation: Number.isInteger(entry.generation) ? entry.generation : null,
        result,
        jump,
      }),
    );
  }
  return Object.freeze(consumed);
}
