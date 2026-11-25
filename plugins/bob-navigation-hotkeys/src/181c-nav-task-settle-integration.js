// Resolve a staged task line to its settled text by identity: a surviving
// block ID wins, otherwise an unambiguous exact-text match. Falls back to
// the staged text when the identity is gone or ambiguous, so cards that
// stay open keep a usable line. Regrouping moves lines; it never rewrites
// identity, so the resolved text is the final contents' own line.
function navResolveWrittenTaskLineText(settledContents, stagedLineText) {
  const staged = String(stagedLineText || "");
  const lines = splitMarkdownContent(String(settledContents || "")).lines;
  if (!staged) return staged;
  const blockId = navTaskSettleLineBlockId(staged);
  if (blockId) {
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (navTaskSettleLineBlockId(lines[index]) === blockId) matches.push(index);
    }
    if (matches.length === 1) return String(lines[matches[0]]);
    return staged;
  }
  const exact = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === staged) exact.push(index);
  }
  if (exact.length === 1) return String(lines[exact[0]]);
  return staged;
}

function navTaskSettleIdentityAtLine(contents, line) {
  const index = Math.floor(Number(line));
  if (!Number.isInteger(index) || index < 0) return null;
  const lines = splitMarkdownContent(String(contents || "")).lines;
  if (index >= lines.length) return null;
  const text = String(lines[index] || "");
  if (!isObsidianTaskLine(text)) return null;
  const blockId = navTaskSettleLineBlockId(text);
  return Object.freeze({ line: index, text, ...(blockId ? { blockId } : {}) });
}

function applyNavGesturePostimage(plugin, editor, path, expected, contents, cursor, options = {}) {
  if (options.settleNav === true &&
      plugin && typeof plugin.applyNavSettledEditorWrite === "function") {
    const identity = options.settleNavIdentity === false
      ? null
      : navTaskSettleIdentityAtLine(contents, cursor && cursor.line);
    const outcome = plugin.applyNavSettledEditorWrite(editor, path, {
      expected,
      contents,
      cursor,
      identity,
      today: typeof options.settleToday === "string" ? options.settleToday : options.today,
      annotation: options.annotation,
    });
    return Boolean(outcome && outcome.applied === true);
  }
  return applyEditorContentTransaction(editor, expected, contents, cursor || null, options.annotation);
}

// Card line refresh: resolve a staged task line to the settled bytes by
// identity, so a card that stays open reads final contents. Falls back to the
// staged text whenever settling is off or the identity is gone or ambiguous.
function navSettledLineText(cm, staged, options = {}) {
  if (!options || options.settleNav !== true || !cm || typeof cm.getValue !== "function") return staged;
  return navResolveWrittenTaskLineText(String(cm.getValue() || ""), staged);
}

// Prepare every changed note from its complete post-gesture bytes. Closed
// notes use these exact bytes in their guarded vault.process write; editor
// notes still pass the staged bytes to applyToEditor at persistence time.
function prepareNavSettledChangeMap(plugin, changes, options = {}) {
  const prepared = new Map();
  const entries = changes instanceof Map ? changes.entries() : Object.entries(changes || {});
  for (const [path, change] of entries) {
    if (!change || typeof change.before !== "string" || typeof change.after !== "string") {
      continue;
    }
    let outcome = null;
    try {
      if (plugin && typeof plugin.prepareNavSettledFilePostimage === "function") {
        outcome = plugin.prepareNavSettledFilePostimage(path, change.after, options);
      }
    } catch (_error) {
      outcome = null;
    }
    const staged = String(change.after);
    prepared.set(path, Object.freeze({
      before: String(change.before),
      after: outcome && outcome.contents != null ? String(outcome.contents) : staged,
      settleInput: staged,
      lineMap: outcome && outcome.lineMap ? outcome.lineMap : Object.freeze({}),
      provider: outcome && outcome.provider ? outcome.provider : "none",
    }));
  }
  return prepared;
}

// Resolve a task anchor against final bytes. A supplied block ID remains
// authoritative; only ID-less anchors can use an exact-text fallback.
function navResolveSettledTaskAnchor(contents, anchor) {
  if (!anchor || typeof anchor !== "object") return null;
  const lines = splitMarkdownContent(String(contents || "")).lines;
  const hinted = Math.floor(Number(anchor.line || 0)) - 1;
  const identity = {
    line: Number.isInteger(hinted) && hinted >= 0 ? hinted : 0,
    ...(typeof anchor.blockId === "string" && anchor.blockId.trim()
      ? { blockId: anchor.blockId.trim() }
      : {}),
    ...(typeof anchor.text === "string" && anchor.text.length > 0
      ? { text: anchor.text }
      : {}),
  };
  const resolved = resolveNavTaskIdentity(lines, identity);
  if (!resolved || !Number.isInteger(resolved.line) || resolved.line < 0) return null;
  const text = String(lines[resolved.line] || "");
  const blockId = navTaskSettleLineBlockId(text);
  return Object.freeze({
    path: String(anchor.path || ""),
    line: resolved.line + 1,
    blockId,
    text,
  });
}

// Settle line maps are zero-based; move and split receipts expose 1-based
// lines. Removed lines have no mapping and remain unchanged for callers to
// resolve by task identity where possible.
function navMapSettledOneBasedLine(lineMap, line) {
  const original = Math.floor(Number(line));
  if (!Number.isInteger(original) || original < 1) return line;
  const mapped = mapNavLineThroughSettle(lineMap, original - 1);
  return Number.isInteger(mapped) ? mapped + 1 : original;
}

class BobNavigationHotkeysTaskSettleIntegrationMixin {
  applyNavTaskSettleToCurrentEditor(editor, path, options = {}) {
    if (!editor || typeof editor.getValue !== "function" ||
        typeof this.applyNavSettledEditorWrite !== "function") {
      return navTaskSettleRefusedOutcome({
        contents: "",
        reason: "editor",
        provider: "none",
      });
    }
    const contents = String(editor.getValue() || "");
    const cursor = navTaskSettleNormalizePos(
      options.cursor || navTaskSettleReadCursor(editor),
    );
    const identity = options.identity || (cursor
      ? navTaskSettleIdentityAtLine(contents, cursor.line)
      : null);
    return this.applyNavSettledEditorWrite(editor, path, {
      expected: contents,
      contents,
      cursor,
      identity,
      joinHistory: options.joinHistory === true,
      today: options.today,
      dailyPath: options.dailyPath,
      tasksSettings: options.tasksSettings,
    });
  }
}
