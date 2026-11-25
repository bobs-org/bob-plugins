// Navigation settle mixin: guarded editor/file application, command-entry
// flush, and exact restore. Later phases call these instead of copying
// grouping into nav. `applyEditorContentTransaction` stays a low-level
// helper and is never an unconditional settle hook.

function navTaskSettleReadCursor(editor) {
  if (!editor) return null;
  if (typeof getEditorCursor === "function") {
    try {
      const cursor = getEditorCursor(editor);
      if (cursor) return cursor;
    } catch (_error) {
      // Fall through to editor.getCursor.
    }
  }
  if (typeof editor.getCursor === "function") {
    try {
      return editor.getCursor();
    } catch (_error) {
      return null;
    }
  }
  return null;
}

function navTaskSettleReadLive(editor) {
  if (!editor || typeof editor.getValue !== "function") return "";
  try {
    return String(editor.getValue());
  } catch (_error) {
    return "";
  }
}

function navTaskSettleViewportWouldHide(editor, cursor, scroll) {
  if (!scroll || typeof scroll.top !== "number" || !cursor) return false;
  const lineHeight =
    typeof editor.getLineHeight === "function"
      ? Number(editor.getLineHeight()) || 20
      : 20;
  const height = typeof scroll.clientHeight === "number" ? scroll.clientHeight : 400;
  const first = Math.floor(scroll.top / lineHeight);
  const last = first + Math.max(1, Math.floor(height / lineHeight));
  return cursor.line < first || cursor.line > last;
}

function navTaskSettleRestoreViewport(editor, cursor) {
  if (!editor || typeof editor.scrollTo !== "function") return;
  const scroll =
    typeof editor.getScrollInfo === "function" ? editor.getScrollInfo() : null;
  if (!scroll) return;
  if (navTaskSettleViewportWouldHide(editor, cursor, scroll)) return;
  try {
    editor.scrollTo(scroll.left, scroll.top);
  } catch (_error) {
    // Viewport restoration is best-effort.
  }
}

function navTaskSettleCursorForStaged(cursor, liveText, stagedText) {
  const from = navTaskSettleNormalizePos(cursor) || { line: 0, ch: 0 };
  if (liveText === stagedText) return from;
  const liveLines = splitMarkdownContent(liveText).lines;
  const stagedLines = splitMarkdownContent(stagedText).lines;
  const pairs = alignEditorLines(liveLines, stagedLines);
  return mapEditorPositionThroughLineAlignment(from, liveLines, stagedLines, pairs);
}

function navTaskSettleIdentityForStaged(identity, liveText, stagedText) {
  if (!identity || typeof identity !== "object") return identity || null;
  if (liveText === stagedText || !Number.isInteger(identity.line)) return identity;
  const mapped = navTaskSettleCursorForStaged(
    { line: identity.line, ch: 0 },
    liveText,
    stagedText,
  );
  return { ...identity, line: mapped.line };
}

function navTaskSettleApplyExact(editor, expected, contents, cursor, annotation) {
  const live = navTaskSettleReadLive(editor);
  if (live !== expected) return false;
  if (live === contents) return true;
  return applyEditorContentTransaction(
    editor,
    expected,
    contents,
    cursor || null,
    annotation || null,
  );
}

class BobNavigationHotkeysTaskSettleMixin {
  lookupNavTaskSettle() {
    return lookupNavTaskSettleApi(this.app);
  }

  navTaskSettlePreferredView(editor) {
    try {
      const view = typeof this.getActiveMarkdownView === "function"
        ? this.getActiveMarkdownView()
        : null;
      return navEditorMatchesView(editor, view) ? view : null;
    } catch (_error) {
      return null;
    }
  }

  navTaskSettleToday(options = {}) {
    if (typeof options.today === "string" && options.today) return options.today;
    if (options.today instanceof Date) {
      return formatBulletPropertyDate(getLocalDateStart(options.today));
    }
    return formatProjectTaskCreatedDate(new Date());
  }

  consumeNavSettleOutcome(path, outcome) {
    consumeNavSettleFlushResults(this, [{ path, result: outcome }]);
    return outcome;
  }

  prepareNavSettledFilePostimage(path, contents, options = {}) {
    return prepareNavSettledPostimage(this.app, path, contents, {
      today: this.navTaskSettleToday(options),
      dailyPath: options.dailyPath,
      tasksSettings: options.tasksSettings,
    });
  }

  flushPendingNavSettles() {
    if (this._navTaskSettleFlushing === true) return Object.freeze([]);
    this._navTaskSettleFlushing = true;
    try {
      const settle = this.lookupNavTaskSettle();
      if (!settle) return Object.freeze([]);
      let results;
      try {
        results = settle.flushPending();
      } catch (_error) {
        return Object.freeze([]);
      }
      return consumeNavSettleFlushResults(this, results);
    } finally {
      this._navTaskSettleFlushing = false;
    }
  }

  installNavTaskSettleCommandFlush() {
    const registry = this.app && this.app.commands && this.app.commands.commands;
    if (!registry) return 0;
    if (!(this._navTaskSettleCommandsWrapped instanceof WeakSet)) {
      this._navTaskSettleCommandsWrapped = new WeakSet();
    }
    const entries = registry instanceof Map
      ? [...registry.entries()]
      : Object.entries(registry);
    const pluginId =
      this.manifest && this.manifest.id ? this.manifest.id : "bob-navigation-hotkeys";
    const prefix = `${pluginId}:`;
    let wrappedCount = 0;
    for (const [key, command] of entries) {
      if (!command || typeof command !== "object") continue;
      if (this._navTaskSettleCommandsWrapped.has(command)) continue;
      const id = typeof command.id === "string" ? command.id : String(key);
      if (!String(key).startsWith(prefix) && !id.startsWith(prefix)) continue;
      try {
        const wrapped = wrapNavCommandForSettleFlush(this, command);
        for (const name of [
          "callback",
          "editorCallback",
          "checkCallback",
          "editorCheckCallback",
        ]) {
          if (typeof wrapped[name] === "function") command[name] = wrapped[name];
        }
        this._navTaskSettleCommandsWrapped.add(command);
        wrappedCount += 1;
      } catch (_error) {
        // A read-only registry row keeps its original behavior.
      }
    }
    return wrappedCount;
  }

  applyNavSettledRestoreWrite(editor, path, options = {}) {
    const live = navTaskSettleReadLive(editor);
    const expected = options.expected != null ? String(options.expected) : live;
    const contents = options.contents != null ? String(options.contents) : live;
    const guard = navGuardEditorPath(
      this.app, editor, path, this.navTaskSettlePreferredView(editor),
    );
    if (!guard.ok) {
      return navTaskSettleRefusedOutcome({
        contents: live,
        cursor: navTaskSettleReadCursor(editor),
        reason: guard.reason,
        provider: "none",
      });
    }
    if (live !== expected) {
      return navTaskSettleRefusedOutcome({
        contents: live,
        cursor: navTaskSettleReadCursor(editor),
        reason: "preimage",
        provider: "none",
      });
    }
    const cursor = navTaskSettleNormalizePos(options.cursor) || navTaskSettleReadCursor(editor);
    const scroll =
      typeof editor.getScrollInfo === "function" ? editor.getScrollInfo() : null;
    const wrote = navTaskSettleApplyExact(
      editor,
      expected,
      contents,
      cursor,
      options.annotation || null,
    );
    if (!wrote) {
      return navTaskSettleRefusedOutcome({
        contents: live,
        cursor: navTaskSettleReadCursor(editor),
        reason: "editor",
        provider: "none",
      });
    }
    const after = navTaskSettleReadLive(editor);
    const afterLines = splitMarkdownContent(after).lines;
    const finalCursor = navTaskSettleClampPos(
      cursor || { line: 0, ch: 0 },
      afterLines,
    );
    if (scroll) navTaskSettleRestoreViewport(editor, finalCursor);
    return navTaskSettleRestoreOutcome({
      contents: after,
      changed: after !== expected,
      cursor: finalCursor,
      provider: "none",
    });
  }

  applyNavSettledAnnotatedWrite(editor, path, options = {}) {
    if (options.restore === true) {
      return this.applyNavSettledRestoreWrite(editor, path, options);
    }
    const live = navTaskSettleReadLive(editor);
    const expected = options.expected != null ? String(options.expected) : live;
    const staged = options.contents != null ? String(options.contents) : live;
    const guard = navGuardEditorPath(
      this.app, editor, path, this.navTaskSettlePreferredView(editor),
    );
    if (!guard.ok) {
      return navTaskSettleRefusedOutcome({
        contents: live,
        cursor: navTaskSettleReadCursor(editor),
        reason: guard.reason,
        provider: "none",
      });
    }
    if (live !== expected) {
      return navTaskSettleRefusedOutcome({
        contents: live,
        cursor: navTaskSettleReadCursor(editor),
        reason: "preimage",
        provider: "none",
      });
    }
    const prepared = this.prepareNavSettledFilePostimage(path, staged, options);
    const next = prepared.contents;
    const liveCursor = navTaskSettleNormalizePos(options.cursor) || navTaskSettleReadCursor(editor);
    const stagedCursor = navTaskSettleCursorForStaged(liveCursor, live, staged);
    const stagedIdentity = navTaskSettleIdentityForStaged(
      options.identity,
      live,
      staged,
    );
    const inputLines = splitMarkdownContent(staged).lines;
    const outputLines = splitMarkdownContent(next).lines;
    const composed = composeNavLineMaps(options.lineMap, prepared.lineMap);
    const planned = navTaskSettlePlanCursor({
      cursor: stagedCursor,
      identity: stagedIdentity,
      lineMap: composed,
      inputLines,
      outputLines,
      path,
    });
    const scroll =
      typeof editor.getScrollInfo === "function" ? editor.getScrollInfo() : null;
    const wrote = navTaskSettleApplyExact(
      editor,
      expected,
      next,
      planned.cursor,
      options.annotation || null,
    );
    if (!wrote) {
      return navTaskSettleRefusedOutcome({
        contents: navTaskSettleReadLive(editor),
        cursor: navTaskSettleReadCursor(editor),
        reason: "editor",
        provider: prepared.provider,
      });
    }
    const after = navTaskSettleReadLive(editor);
    if (scroll) navTaskSettleRestoreViewport(editor, planned.cursor);
    const outcome = freezeNavSettleOutcome({
      kind: prepared.provider === "v1" ? (prepared.changed ? "applied" : "idle") : "fallback",
      applied: after !== expected,
      changed: after !== expected,
      contents: after,
      lineMap: composed,
      jumpTarget: planned.jumpTarget,
      cursor: planned.cursor,
      reason: prepared.reason,
      warnings: prepared.warnings,
      provider: prepared.provider,
    });
    return this.consumeNavSettleOutcome(path, outcome);
  }

  applyNavSettledEditorWrite(editor, path, options = {}) {
    if (options.restore === true) {
      return this.applyNavSettledRestoreWrite(editor, path, options);
    }
    if (options.annotation) {
      return this.applyNavSettledAnnotatedWrite(editor, path, options);
    }
    const live = navTaskSettleReadLive(editor);
    const expected = options.expected != null ? String(options.expected) : live;
    const contents = options.contents != null ? String(options.contents) : live;
    const guard = navGuardEditorPath(
      this.app, editor, path, this.navTaskSettlePreferredView(editor),
    );
    if (!guard.ok) {
      return navTaskSettleRefusedOutcome({
        contents: live,
        cursor: navTaskSettleReadCursor(editor),
        reason: guard.reason,
        provider: "none",
      });
    }
    if (live !== expected) {
      return navTaskSettleRefusedOutcome({
        contents: live,
        cursor: navTaskSettleReadCursor(editor),
        reason: "preimage",
        provider: "none",
      });
    }
    const settle = this.lookupNavTaskSettle();
    const liveCursor = navTaskSettleNormalizePos(options.cursor) || navTaskSettleReadCursor(editor);
    if (!settle) {
      return this._applyNavSettledFallbackWrite(editor, path, {
        expected,
        contents,
        cursor: liveCursor,
        identity: options.identity,
        lineMap: options.lineMap,
        reason: "provider",
      });
    }
    let result;
    try {
      result = settle.applyToEditor(editor, path, {
        expected,
        contents,
        identity: options.identity,
        cursor: liveCursor,
        selection: options.selection,
        joinHistory: options.joinHistory === true,
        today: this.navTaskSettleToday(options),
        dailyPath: options.dailyPath,
        tasksSettings: options.tasksSettings,
        app: this.app,
      });
    } catch (_error) {
      const afterThrow = navTaskSettleReadLive(editor);
      if (afterThrow !== expected) {
        return freezeNavSettleOutcome({
          kind: "applied",
          applied: true,
          changed: true,
          contents: afterThrow,
          cursor: navTaskSettleReadCursor(editor),
          reason: "error",
          provider: "error",
        });
      }
      return this._applyNavSettledFallbackWrite(editor, path, {
        expected,
        contents,
        cursor: liveCursor,
        identity: options.identity,
        lineMap: options.lineMap,
        reason: "error",
      });
    }
    const after = navTaskSettleReadLive(editor);
    if (result && result.applied === true) {
      const composed = composeNavLineMaps(options.lineMap, result.lineMap);
      const outcome = navTaskSettleAppliedOutcome({
        contents: after,
        changed: result.changed === true || after !== expected,
        lineMap: composed,
        jumpTarget: result.jumpTarget,
        cursor: result.cursor,
        warnings: result.warnings,
        historyJoined: result.historyJoined,
        provider: "v1",
      });
      return this.consumeNavSettleOutcome(path, outcome);
    }
    const reason = result && result.reason ? String(result.reason) : "idle";
    if (reason === "noop") {
      return navTaskSettleIdleOutcome({
        contents: after,
        cursor: result && result.cursor ? result.cursor : liveCursor,
        lineMap: result && result.lineMap ? result.lineMap : {},
        reason: "noop",
        warnings: result && result.warnings,
        provider: "v1",
      });
    }
    if (after !== expected) {
      return freezeNavSettleOutcome({
        kind: "applied",
        applied: true,
        changed: true,
        contents: after,
        cursor: navTaskSettleReadCursor(editor),
        reason,
        provider: "v1",
      });
    }
    return navTaskSettleRefusedOutcome({
      contents: after,
      cursor: result && result.cursor ? result.cursor : liveCursor,
      reason,
      provider: "v1",
    });
  }

  _applyNavSettledFallbackWrite(editor, path, options) {
    const expected = String(options.expected || "");
    const contents = String(options.contents || "");
    const liveCursor = options.cursor || { line: 0, ch: 0 };
    const inputLines = splitMarkdownContent(contents).lines;
    const identityMap = options.lineMap && typeof options.lineMap === "object"
      ? options.lineMap
      : {};
    const planned = navTaskSettlePlanCursor({
      cursor: liveCursor,
      identity: options.identity,
      lineMap: identityMap,
      inputLines,
      outputLines: inputLines,
      path,
    });
    const scroll =
      typeof editor.getScrollInfo === "function" ? editor.getScrollInfo() : null;
    const wrote = navTaskSettleApplyExact(
      editor,
      expected,
      contents,
      planned.cursor,
      null,
    );
    if (!wrote) {
      return navTaskSettleRefusedOutcome({
        contents: navTaskSettleReadLive(editor),
        cursor: navTaskSettleReadCursor(editor),
        reason: "editor",
        provider: "none",
      });
    }
    const after = navTaskSettleReadLive(editor);
    if (scroll) navTaskSettleRestoreViewport(editor, planned.cursor);
    return navTaskSettleFallbackOutcome({
      applied: after !== expected,
      changed: after !== expected,
      contents: after,
      cursor: planned.cursor,
      reason: options.reason || "provider",
      provider: options.reason === "error" ? "error" : "none",
    });
  }
}
