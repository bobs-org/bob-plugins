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
    });
    return Boolean(outcome && outcome.applied === true);
  }
  return applyEditorContentTransaction(editor, expected, contents, cursor || null);
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
