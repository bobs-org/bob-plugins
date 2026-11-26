// Snoozed wake-history pills in Live Preview. The source doc is scanned
// once per build; link paths and task identities are memoized within that
// build. The existing snooze refresh effect drives minute/cache updates.
function snoozeWokenEntryIsOpen(lines, index) {
  try {
    const memo = taskLinkMarkMemoizedSection(lines);
    const section = memo && memo.section;
    if (!section || index <= section.start || index > section.end) return false;
    for (let at = index - 1; at >= section.start; at -= 1) {
      const line = String(lines[at] || "");
      if (line.trim() === "") return false;
      if (/^[ \t]/.test(line)) {
        if (!todayIsSubBulletLine(line)) return false;
        continue;
      }
      const entry = planParseEntry(line);
      return Boolean(entry && entry.state === "open");
    }
    return false;
  } catch (error) {
    return false;
  }
}

// Exact, unstruck, one-link rows under open entries. The established
// ledger parser owns fences, comments, nesting, and prose exclusions.
function snoozeWokenLedgerLinks(lines, path) {
  try {
    const sourcePath = String(path || "");
    if (!Array.isArray(lines) || !sourcePath || !PLAN_DAILY_PATH_RE.test(sourcePath)) return [];
    const ctx = taskLinkMarkDocContext(lines, sourcePath);
    const links = [];
    for (let index = 0; index < lines.length; index += 1) {
      try {
        if (ctx.inert(index) || !taskLinkMarkIsLedgerTaskLinkLine(lines, index, sourcePath)) continue;
        if (!snoozeWokenEntryIsOpen(lines, index)) continue;
        const spans = taskLinkMarkSpans(String(lines[index] || ""), ctx.excluded(index));
        if (!Array.isArray(spans) || spans.length !== 1) continue;
        const span = spans[0];
        if (!span || span.kind !== "wiki" || !span.blockId) continue;
        if (String(lines[index] || "").slice(span.at, span.at + 2) === "~~") continue;
        links.push(Object.freeze({
          line: index,
          ch: span.at,
          linkpath: String(span.linkpath || ""),
          blockId: String(span.blockId),
          aliased: span.alias !== null,
        }));
      } catch (error) {
        continue;
      }
    }
    return Object.freeze(links);
  } catch (error) {
    return Object.freeze([]);
  }
}

class BobLedgerToolsSnoozeWokenPillsMixin {
  setupSnoozeWokenPills() {
    try {
      if (!(this.snoozeWokenViews instanceof Set)) this.snoozeWokenViews = new Set();
      const extension = this.createSnoozeWokenPillExtension();
      if (extension && typeof this.registerEditorExtension === "function") this.registerEditorExtension(extension);
      if (typeof this.setupSnoozeWokenPillsReading === "function") this.setupSnoozeWokenPillsReading();
      if (typeof this.register === "function") this.register(() => { this.snoozeWokenViews = null; });
    } catch (error) {
      // A failed decorative surface never blocks startup.
    }
  }

  createSnoozeWokenPillExtension() {
    try {
      if (!ViewPlugin || !Decoration || !RangeSetBuilder || !SnoozeWokenWidget ||
          !editorInfoField || !editorLivePreviewField || !Prec || typeof Prec.highest !== "function") return null;
      const plugin = this;
      const WokenPluginClass = class {
        constructor(view) {
          this.view = view;
          try { plugin.snoozeWokenViews.add(view); } catch (error) {}
          try { this.decorations = plugin.buildSnoozeWokenPillDecorations(view); }
          catch (error) { this.decorations = Decoration.none; }
        }

        update(update) {
          try {
            if (plugin.snoozeWokenPillRebuildReason(update)) {
              this.decorations = plugin.buildSnoozeWokenPillDecorations(update.view);
            }
          } catch (error) {
            // Keep the last valid decoration set.
          }
        }

        destroy() {
          try { plugin.snoozeWokenViews.delete(this.view); } catch (error) {}
        }
      };
      return Prec.highest(ViewPlugin.fromClass(WokenPluginClass, { decorations: (value) => value.decorations }));
    } catch (error) {
      return null;
    }
  }

  snoozeWokenPillRebuildReason(update) {
    try {
      if (!update || typeof update !== "object") return null;
      const refresh = ensureSnoozeMarksRefresh();
      for (const transaction of update.transactions || []) {
        const effects = transaction && transaction.effects !== undefined ? transaction.effects : null;
        for (const effect of Array.isArray(effects) ? effects : effects ? [effects] : []) {
          if (effect && (effect === refresh || (refresh && typeof effect.is === "function" && effect.is(refresh)))) return "refresh";
        }
      }
      if (update.docChanged) return "doc";
      if (editorLivePreviewField && update.startState && update.state) {
        try { if (update.startState.field(editorLivePreviewField) !== update.state.field(editorLivePreviewField)) return "mode"; }
        catch (error) {}
      }
      if (editorInfoField && update.startState && update.state) {
        try {
          const before = update.startState.field(editorInfoField);
          const after = update.state.field(editorInfoField);
          if ((before && before.file && before.file.path) !== (after && after.file && after.file.path)) return "mode";
        } catch (error) {}
      }
      return update.viewportChanged ? "viewport" : null;
    } catch (error) {
      return null;
    }
  }

  snoozeWokenResolvedPath(linkpath, sourcePath, cache) {
    try {
      const raw = String(linkpath || "").trim();
      if (cache && cache.has(raw)) return cache.get(raw);
      let resolved = null;
      if (raw === "") resolved = String(sourcePath || "");
      else if (typeof this.taskLinkMarkResolvePath === "function") resolved = this.taskLinkMarkResolvePath(raw, sourcePath);
      if (resolved && !/\.md$/i.test(resolved)) resolved += ".md";
      if (cache) cache.set(raw, resolved || null);
      return resolved || null;
    } catch (error) {
      return null;
    }
  }

  snoozeWokenTaskFacts(targetPath, blockId, sourcePath, lines, liveDoc, eventRows, memo) {
    try {
      const key = String(targetPath || "") + "\u0000" + String(blockId || "");
      if (memo.has(key)) return memo.get(key);
      const index = typeof this.dependencyTasksIndex === "function" ? this.dependencyTasksIndex() : null;
      const duplicates = typeof this.dependencyTasksDuplicateKeys === "function" ? this.dependencyTasksDuplicateKeys() : null;
      if (duplicates instanceof Set && duplicates.has(key)) { memo.set(key, null); return null; }
      let state = null;
      let fact = index instanceof Map ? index.get(key) || null : null;
      if (targetPath === sourcePath && liveDoc) {
        const live = taskLinkMarkLiveLookup(liveDoc, blockId, (symbol) => this.taskLinkMarkStatusTypeFor(symbol));
        state = live ? live.state : null;
        const hits = liveDoc.blocks instanceof Map ? liveDoc.blocks.get(String(blockId)) : null;
        if (!fact && Array.isArray(hits) && hits.length === 1) {
          fact = { path: targetPath, lineNumber: hits[0], originalMarkdown: liveDoc.lines[hits[0]] };
        }
      } else {
        let hit = typeof this.taskLinkMarkFromMemo === "function" ? this.taskLinkMarkFromMemo(key) : undefined;
        if (hit === undefined && typeof this.taskLinkMarkFromCache === "function") hit = this.taskLinkMarkFromCache(targetPath, blockId);
        state = hit && typeof hit.state === "string" ? hit.state : null;
      }
      if (!fact || !["next", "in-progress"].includes(state)) { memo.set(key, null); return null; }
      let isEvent = false;
      if (targetPath === sourcePath) {
        isEvent = Boolean(eventRunById(eventRows, blockId));
      } else if (snoozedCanonicalDailyPath(targetPath)) {
        const lineNumber = snoozedTaskLineNumber(fact);
        const metadata = this.app && this.app.metadataCache;
        const vault = this.app && this.app.vault;
        let headingsKnown = false;
        try {
          const file = vault && typeof vault.getAbstractFileByPath === "function" ? vault.getAbstractFileByPath(targetPath) : { path: targetPath };
          const cache = metadata && typeof metadata.getFileCache === "function" ? metadata.getFileCache(file) : null;
          headingsKnown = Boolean(cache && Array.isArray(cache.headings));
        } catch (error) { headingsKnown = false; }
        if (lineNumber === null || !headingsKnown) { memo.set(key, null); return null; }
        isEvent = snoozedIsEventTask(fact, { dailyPath: sourcePath, content: lines.join("\n"), metadataCache: metadata, vault });
      }
      const result = isEvent ? null : { fact, state };
      memo.set(key, result);
      return result;
    } catch (error) {
      return null;
    }
  }

  buildSnoozeWokenPillDecorations(view) {
    try {
      if (!this.snoozeMarksEnabled || !Decoration || !RangeSetBuilder || !SnoozeWokenWidget || !editorInfoField || !editorLivePreviewField) return Decoration.none;
      if (!view || !view.state || !view.state.field(editorLivePreviewField)) return Decoration.none;
      const info = view.state.field(editorInfoField);
      const sourcePath = info && info.file && typeof info.file.path === "string" ? info.file.path : "";
      if (!sourcePath || !PLAN_DAILY_PATH_RE.test(sourcePath)) return Decoration.none;
      const doc = view.state.doc;
      if (!doc || typeof doc.toString !== "function") return Decoration.none;
      const lines = doc.toString().replace(/\r\n/g, "\n").split("\n");
      const text = lines.join("\n");
      const parsed = snoozeParseSection(text);
      if (!parsed || !Array.isArray(parsed.rows)) return Decoration.none;
      const liveDoc = taskLinkMarkLiveDocModel(text, sourcePath);
      const eventRows = eventRunEventRows(lines);
      const resolutionCache = new Map();
      const taskCache = new Map();
      const historyByIdentity = new Map();
      const activeIdentities = new Set();
      for (const row of parsed.rows) {
        try {
          if (!row || !row.blockId || row.embedded) continue;
          const targetPath = this.snoozeWokenResolvedPath(row.target, sourcePath, resolutionCache);
          if (!targetPath) continue;
          const identity = targetPath + "\u0000" + row.blockId;
          if (row.kind === "active") activeIdentities.add(identity);
          if (row.kind !== "history" || !row.wokeHhmm || !Number.isInteger(row.wokeMinutes)) continue;
          const rows = historyByIdentity.get(identity) || [];
          rows.push({ route: targetPath, block: row.blockId, line: row.line, woke_at: row.wokeHhmm, target: row.hhmm });
          historyByIdentity.set(identity, rows);
        } catch (error) { continue; }
      }
      const links = snoozeWokenLedgerLinks(lines, sourcePath);
      if (!links.length) return Decoration.none;
      const now = new Date();
      const nowLabel = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
      let today = "";
      try { today = formatLocalDate(now); } catch (error) { today = ""; }
      let noteDate = "";
      try { noteDate = typeof snoozedNoteDateFromDailyPath === "function" ? snoozedNoteDateFromDailyPath(sourcePath) || "" : ""; } catch (error) {}
      const ranges = Array.isArray(view.visibleRanges) ? view.visibleRanges : [];
      const builder = new RangeSetBuilder();
      for (const link of links) {
        try {
          const targetPath = this.snoozeWokenResolvedPath(link.linkpath, sourcePath, resolutionCache);
          if (!targetPath) continue;
          const identity = targetPath + "\u0000" + link.blockId;
          const facts = this.snoozeWokenTaskFacts(targetPath, link.blockId, sourcePath, lines, liveDoc, eventRows, taskCache);
          if (!facts) continue;
          const history = historyByIdentity.get(identity) || [];
          if (!history.length) continue;
          const model = snoozeWokenPillModel({
            today,
            now: nowLabel,
            zone: snoozedLocalZoneName(),
            note: sourcePath,
            note_date: noteDate,
            entry: { open: true, name: "" },
            link: { line: lines[link.line], struck: false, is_event: false, is_prose: false,
              is_embed: false, in_fence: false, aliased: link.aliased, block: link.blockId, route: targetPath },
            history,
            active_row_for_identity: activeIdentities.has(identity),
            resolution: "found",
            target_status: facts.state === "next" ? "*" : facts.state === "in-progress" ? "/" : " ",
            toggles: { snooze_marks: true },
          });
          if (model.pill === "none") continue;
          const line = doc.line(link.line + 1);
          if (!line || typeof line.from !== "number") continue;
          const position = line.from + link.ch;
          if (!ranges.some((range) => range && position >= range.from && position <= range.to)) continue;
          builder.add(position, position, Decoration.widget({
            widget: new SnoozeWokenWidget(model, sourcePath, targetPath, link.blockId,
              (navigation, path, block) => { void this.jumpToSnoozeWokenHistory(navigation, path, block); }),
            side: SNOOZE_WOKEN_SIDE,
          }));
        } catch (error) { continue; }
      }
      return builder.finish();
    } catch (error) {
      try { return Decoration.none; } catch (inner) { return null; }
    }
  }

  snoozeWokenPillEditorViews() {
    const views = new Set();
    try { if (this.snoozeWokenViews instanceof Set) this.snoozeWokenViews.forEach((view) => views.add(view)); } catch (error) {}
    try {
      const leaves = this.app && this.app.workspace && typeof this.app.workspace.getLeavesOfType === "function"
        ? this.app.workspace.getLeavesOfType("markdown") || [] : [];
      for (const leaf of leaves) {
        const cm = leaf && leaf.view && leaf.view.editor && leaf.view.editor.cm;
        if (cm) views.add(cm);
      }
    } catch (error) {}
    return views;
  }

  refreshSnoozeWokenPillEditors() {
    try {
      const refresh = ensureSnoozeMarksRefresh();
      if (!refresh) return;
      for (const view of this.snoozeWokenPillEditorViews()) {
        try { if (view && typeof view.dispatch === "function") view.dispatch({ effects: refresh.of(null) }); }
        catch (error) {}
      }
    } catch (error) {}
  }
}
