// Snoozed wake-history pills in Reading view. Source text comes from the
// render section, a live editor, or the established source-text cache; a
// missing or uncertain mapping stays neutral.
class BobLedgerToolsSnoozeWokenPillsReadingMixin {
  setupSnoozeWokenPillsReading() {
    try {
      if (!(this.snoozeWokenReadingViews instanceof Map)) this.snoozeWokenReadingViews = new Map();
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor((el, ctx) => this.renderSnoozeWokenPillsIn(el, ctx), 57);
      }
    } catch (error) {}
  }

  snoozeWokenReadingTag(node) {
    try { return String(node && (node.tagName || node.nodeName) || "").toUpperCase(); }
    catch (error) { return ""; }
  }

  snoozeWokenReadingHasClass(node, name) {
    try {
      if (node && node.classList && typeof node.classList.contains === "function") return node.classList.contains(name);
      const raw = node && typeof node.getAttribute === "function" ? node.getAttribute("class") || "" : node && node.className || "";
      return String(raw).split(/\s+/).includes(name);
    } catch (error) { return false; }
  }

  renderSnoozeWokenPillsIn(el, ctx) {
    try {
      if (!el || !ctx) return;
      if (!(this.snoozeWokenReadingViews instanceof Map)) this.snoozeWokenReadingViews = new Map();
      const record = { el, ctx, sourcePath: typeof ctx.sourcePath === "string" ? ctx.sourcePath : "" };
      this.snoozeWokenReadingViews.set(el, record);
      this.sweepSnoozeWokenPillsReadingView(record);
      try { this.scheduleSnoozeMarksRefresh(); } catch (error) {}
      if (typeof ctx.addChild === "function") {
        const views = this.snoozeWokenReadingViews;
        let child = null;
        try {
          child = typeof MarkdownRenderChild === "function" ? new MarkdownRenderChild(el) : null;
          if (child) child.onunload = () => { if (views) views.delete(el); };
        } catch (error) { child = null; }
        if (!child) child = { unload: () => { if (views) views.delete(el); } };
        try { ctx.addChild(child); } catch (error) {}
      }
    } catch (error) {}
  }

  snoozeWokenPillPreviewRecords() {
    const records = [];
    try {
      const workspace = this.app && this.app.workspace;
      const leaves = workspace && typeof workspace.getLeavesOfType === "function" ? workspace.getLeavesOfType("markdown") || [] : [];
      for (const leaf of leaves) {
        try {
          const view = leaf && leaf.view;
          const sourcePath = view && view.file && typeof view.file.path === "string" ? view.file.path : "";
          const container = view && ((view.previewMode && view.previewMode.containerEl) || view.contentEl || view.containerEl);
          if (!sourcePath || !container || typeof container.querySelector !== "function") continue;
          records.push({
            el: container.querySelector(".markdown-preview-view, .markdown-reading-view") || container,
            ctx: { sourcePath },
            sourcePath,
          });
        } catch (error) { continue; }
      }
    } catch (error) {}
    return records;
  }

  refreshSnoozeWokenPillReadingViews() {
    let refreshed = false;
    try {
      if (this.snoozeWokenReadingViews instanceof Map) {
        for (const [el, record] of Array.from(this.snoozeWokenReadingViews.entries())) {
          try {
            if (!el) { this.snoozeWokenReadingViews.delete(el); continue; }
            this.sweepSnoozeWokenPillsReadingView(record);
            refreshed = true;
          } catch (error) {}
        }
      }
      for (const record of this.snoozeWokenPillPreviewRecords()) {
        try { this.sweepSnoozeWokenPillsReadingView(record); refreshed = true; }
        catch (error) {}
      }
    } catch (error) {}
    return refreshed;
  }

  snoozeWokenReadingLines(record) {
    try {
      const sourcePath = String(record && record.sourcePath || "");
      if (!sourcePath) return null;
      const ctx = record && record.ctx;
      try {
        if (ctx && typeof ctx.getSectionInfo === "function" && record.el) {
          const info = ctx.getSectionInfo(record.el);
          if (info && typeof info.text === "string" && info.text !== "") {
            const lines = info.text.replace(/\r\n/g, "\n").split("\n");
            if (snoozeParseSection(info.text) && planSectionRange(lines)) return lines;
          }
        }
      } catch (error) {}
      try {
        if (ctx && typeof this.calendarEventSourceLines === "function") {
          const lines = this.calendarEventSourceLines(ctx);
          if (Array.isArray(lines) && lines.length && snoozeParseSection(lines.join("\n"))) return lines;
        }
      } catch (error) {}
      try {
        if (typeof this.taskThemeSourceTextFor === "function") {
          const text = this.taskThemeSourceTextFor(sourcePath);
          if (typeof text === "string" && text !== "") {
            const lines = text.replace(/\r\n/g, "\n").split("\n");
            if (snoozeParseSection(text)) return lines;
          }
        }
      } catch (error) {}
      try { if (typeof this.taskThemeRequestSourceText === "function") this.taskThemeRequestSourceText(sourcePath); }
      catch (error) {}
      return null;
    } catch (error) { return null; }
  }

  snoozeWokenPillOwnedHosts(li, root) {
    try {
      const found = li && typeof li.querySelectorAll === "function" ? li.querySelectorAll(".bob-snooze-woke") : [];
      const hosts = [];
      for (const host of found || []) {
        let owner = host && host.parentNode;
        let guard = 0;
        while (owner && owner !== root && guard++ < 100 && this.snoozeWokenReadingTag(owner) !== "LI") owner = owner.parentNode;
        if (owner === li) hosts.push(host);
      }
      return hosts;
    } catch (error) { return []; }
  }

  snoozeWokenPillRemoveHost(host) {
    try { if (host && host.parentNode && typeof host.parentNode.removeChild === "function") host.parentNode.removeChild(host); }
    catch (error) {}
  }

  snoozeWokenPillSetAttribute(host, name, value) {
    try {
      if (value === null || value === undefined) {
        if (host && typeof host.removeAttribute === "function") host.removeAttribute(name);
      } else if (host && typeof host.setAttribute === "function") host.setAttribute(name, String(value));
    } catch (error) {}
  }

  snoozeWokenPillRefreshHost(host, doc, model, targetPath, blockId, sourcePath) {
    try {
      const fresh = buildSnoozeWokenElement(doc, model);
      if (!host || !fresh) return false;
      for (const name of ["class", "role", "aria-label", "data-tooltip-position", "data-bob-snooze-woke-time", "data-bob-snooze-woke-note", "data-bob-snooze-woke-line"]) {
        this.snoozeWokenPillSetAttribute(host, name, fresh.getAttribute(name));
      }
      this.snoozeWokenPillSetAttribute(host, "data-bob-snooze-woke-target", targetPath);
      this.snoozeWokenPillSetAttribute(host, "data-bob-snooze-woke-block", blockId);
      this.snoozeWokenPillSetAttribute(host, "data-bob-snooze-woke-source", sourcePath);
      return true;
    } catch (error) { return false; }
  }

  snoozeWokenPillBindReadingGesture(host) {
    try {
      if (!host || typeof host.addEventListener !== "function") return;
      host.addEventListener("mousedown", (event) => {
        try {
          if (!event || (event.button !== undefined && event.button !== 0)) return;
          const isMac = Boolean(Platform && Platform.isMacOS);
          const modified = typeof todayMarkModifierPressed === "function"
            ? todayMarkModifierPressed(event, isMac)
            : (isMac ? Boolean(event.metaKey) : Boolean(event.ctrlKey));
          if (!modified) return;
          if (typeof event.preventDefault === "function") event.preventDefault();
          if (typeof event.stopPropagation === "function") event.stopPropagation();
          const note = host.getAttribute("data-bob-snooze-woke-note");
          const line = Number(host.getAttribute("data-bob-snooze-woke-line"));
          const target = host.getAttribute("data-bob-snooze-woke-target");
          const block = host.getAttribute("data-bob-snooze-woke-block");
          if (typeof this.jumpToSnoozeWokenHistory === "function") {
            void this.jumpToSnoozeWokenHistory({ note, line }, target, block);
          }
        } catch (error) {}
      });
    } catch (error) {}
  }

  snoozeWokenPillReadingContainer(anchor) {
    try {
      const parent = anchor && anchor.parentNode;
      const tag = this.snoozeWokenReadingTag(parent);
      if (["S", "DEL", "STRIKE"].includes(tag) && parent.childNodes && parent.childNodes.length === 1 && parent.childNodes[0] === anchor) return parent;
      return anchor || null;
    } catch (error) { return anchor || null; }
  }

  snoozeWokenPillReadingPlace(container, host) {
    try {
      const parent = container && container.parentNode;
      if (!parent || typeof parent.insertBefore !== "function") return;
      if (host.parentNode !== parent || host.nextSibling !== container) parent.insertBefore(host, container);
      let node = host.previousSibling;
      let guard = 0;
      while (node && guard++ < 100 && (this.snoozeWokenReadingHasClass(node, "bob-ledger-type-mark") || this.snoozeWokenReadingHasClass(node, "bob-progress-mark"))) {
        const before = node;
        node = node.previousSibling;
        parent.insertBefore(host, before);
      }
    } catch (error) {}
  }

  sweepSnoozeWokenPillsReadingView(record) {
    try {
      const root = record && record.el;
      const sourcePath = String(record && record.sourcePath || "");
      if (!root || !sourcePath) return false;
      const allHosts = typeof root.querySelectorAll === "function" ? Array.from(root.querySelectorAll(".bob-snooze-woke")) : [];
      if (!this.snoozeMarksEnabled || !PLAN_DAILY_PATH_RE.test(sourcePath)) {
        for (const host of allHosts) this.snoozeWokenPillRemoveHost(host);
        return true;
      }
      const lines = this.snoozeWokenReadingLines(record);
      if (!lines) { for (const host of allHosts) this.snoozeWokenPillRemoveHost(host); return true; }
      const parsed = snoozeParseSection(lines.join("\n"));
      if (!parsed || !Array.isArray(parsed.rows)) { for (const host of allHosts) this.snoozeWokenPillRemoveHost(host); return true; }
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
        } catch (error) {}
      }
      const sourceText = lines.join("\n");
      const liveDoc = taskLinkMarkLiveDocModel(sourceText, sourcePath);
      const eventRows = eventRunEventRows(lines);
      const doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc) { for (const host of allHosts) this.snoozeWokenPillRemoveHost(host); return true; }
      const now = new Date();
      const nowLabel = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
      let today = "";
      let noteDate = "";
      try { today = formatLocalDate(now); } catch (error) {}
      try { noteDate = snoozedNoteDateFromDailyPath(sourcePath) || ""; } catch (error) {}
      const items = typeof root.querySelectorAll === "function" ? Array.from(root.querySelectorAll("li")) : [];
      for (const li of items) {
        try {
          const existing = this.snoozeWokenPillOwnedHosts(li, root);
          const context = typeof this.progressMarkReadingContext === "function"
            ? this.progressMarkReadingContext(li, root, { allowLedgerMarks: true }) : null;
          if (!context || !context.anchor || !context.blockId) {
            for (const host of existing) this.snoozeWokenPillRemoveHost(host);
            continue;
          }
          const targetPath = this.snoozeWokenResolvedPath(context.target, sourcePath, resolutionCache);
          const identity = targetPath ? targetPath + "\u0000" + context.blockId : "";
          const facts = targetPath ? this.snoozeWokenTaskFacts(targetPath, context.blockId, sourcePath, lines, liveDoc, eventRows, taskCache) : null;
          const history = identity ? historyByIdentity.get(identity) || [] : [];
          if (!facts || !history.length) { for (const host of existing) this.snoozeWokenPillRemoveHost(host); continue; }
          const model = snoozeWokenPillModel({
            today, now: nowLabel, zone: snoozedLocalZoneName(), note: sourcePath, note_date: noteDate,
            entry: { open: true, name: "" },
            link: { line: "", struck: false, is_event: false, is_prose: false, is_embed: false,
              in_fence: false, aliased: Boolean(context.alias), block: context.blockId, route: targetPath },
            history, active_row_for_identity: activeIdentities.has(identity), resolution: "found",
            target_status: facts.state === "next" ? "*" : facts.state === "in-progress" ? "/" : " ",
            toggles: { snooze_marks: true },
          });
          if (model.pill === "none") { for (const host of existing) this.snoozeWokenPillRemoveHost(host); continue; }
          let host = existing[0] || null;
          if (host) this.snoozeWokenPillRefreshHost(host, doc, model, targetPath, context.blockId, sourcePath);
          else {
            host = buildSnoozeWokenElement(doc, model);
            if (host) {
              this.snoozeWokenPillSetAttribute(host, "data-bob-snooze-woke-target", targetPath);
              this.snoozeWokenPillSetAttribute(host, "data-bob-snooze-woke-block", context.blockId);
              this.snoozeWokenPillSetAttribute(host, "data-bob-snooze-woke-source", sourcePath);
              this.snoozeWokenPillBindReadingGesture(host);
            }
          }
          if (!host) continue;
          const container = this.snoozeWokenPillReadingContainer(context.anchor);
          if (!container || !container.parentNode) { for (const old of existing) this.snoozeWokenPillRemoveHost(old); continue; }
          this.snoozeWokenPillReadingPlace(container, host);
          for (const duplicate of existing.slice(1)) this.snoozeWokenPillRemoveHost(duplicate);
        } catch (error) { continue; }
      }
      for (const host of allHosts) {
        try {
          let node = host.parentNode;
          let inList = false;
          let guard = 0;
          while (node && node !== root && guard++ < 100) {
            if (this.snoozeWokenReadingTag(node) === "LI") { inList = true; break; }
            node = node.parentNode;
          }
          if (!inList) this.snoozeWokenPillRemoveHost(host);
        } catch (error) {}
      }
      return true;
    } catch (error) { return false; }
  }

  snoozeWokenFindHistoryLine(content, notePath, targetPath, blockId) {
    try {
      const parsed = snoozeParseSection(String(content || ""));
      if (!parsed || !Array.isArray(parsed.rows)) return null;
      const cache = new Map();
      const histories = [];
      let active = false;
      for (const row of parsed.rows) {
        try {
          if (!row || !row.blockId || row.embedded) continue;
          const route = this.snoozeWokenResolvedPath(row.target, notePath, cache);
          if (route !== targetPath || row.blockId !== blockId) continue;
          if (row.kind === "active") active = true;
          if (row.kind === "history" && Number.isInteger(row.wokeMinutes) && Number.isInteger(row.line)) histories.push(row);
        } catch (error) {}
      }
      if (active || !histories.length) return null;
      histories.sort((a, b) => a.wokeMinutes - b.wokeMinutes || a.line - b.line);
      return histories[histories.length - 1].line - 1;
    } catch (error) { return null; }
  }

  async snoozeWokenOpenDailyPath(notePath) {
    try {
      let leaf = findOpenMarkdownLeafByPath(this.app, notePath);
      if (leaf) return await activateMarkdownLeaf(this.app, leaf, { path: notePath });
      const file = this.app && this.app.vault && typeof this.app.vault.getAbstractFileByPath === "function"
        ? this.app.vault.getAbstractFileByPath(notePath) : null;
      const workspace = this.app && this.app.workspace;
      if (!file || !workspace || typeof workspace.getLeaf !== "function") return null;
      leaf = workspace.getLeaf("tab");
      if (!leaf || typeof leaf.openFile !== "function") return null;
      await leaf.openFile(file);
      return leaf.view || null;
    } catch (error) { return null; }
  }

  async jumpToSnoozeWokenHistory(navigation, targetPath, blockId) {
    try {
      const notePath = String(navigation && navigation.note || "");
      const hintLine = Number(navigation && navigation.line);
      if (!notePath || !Number.isInteger(hintLine) || hintLine < 1 || !targetPath || !blockId) return false;
      const view = await this.snoozeWokenOpenDailyPath(notePath);
      if (!view || !view.editor) { new Notice("Could not open the daily note"); return false; }
      const read = () => {
        try { if (typeof view.editor.getValue === "function") return view.editor.getValue(); }
        catch (error) {}
        try { const cm = getEditorViewFromEditor(view.editor); if (cm && cm.state && cm.state.doc) return cm.state.doc.toString(); }
        catch (error) {}
        return null;
      };
      const content = read();
      if (typeof content !== "string") { new Notice("This task's wake history is no longer in this note"); return false; }
      const line = this.snoozeWokenFindHistoryLine(content, notePath, String(targetPath), String(blockId));
      if (!Number.isInteger(line)) { new Notice("This task's wake history is no longer in this note"); return false; }
      return await this.jumpToDailyNoteLine(notePath, line, 0, {
        vanished: "This task's wake history is no longer in this note",
        findLine: (current) => this.snoozeWokenFindHistoryLine(current, notePath, String(targetPath), String(blockId)),
      });
    } catch (error) { return false; }
  }
}
