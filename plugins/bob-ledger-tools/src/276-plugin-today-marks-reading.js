// Today marks in rendered views (today-mark-v1 reading).
// Exact source mapping or neutral; never title-matches, never writes.
// Contract: bob-cli `docs/today-marks.md`.

class BobLedgerToolsTodayMarksReadingMixin {
  setupTodayMarksReading() {
    try {
      this.setupTodayMarksReadingClicks();
      this.refreshDailyNoteViewClasses();
      const workspace = this.app && this.app.workspace;
      if (
        workspace &&
        typeof workspace.on === "function" &&
        typeof this.registerEvent === "function"
      ) {
        this.registerEvent(
          workspace.on("layout-change", () => this.refreshDailyNoteViewClasses()),
        );
        this.registerEvent(
          workspace.on("window-open", (win) => {
            try {
              this.todayMarksBindReadingClicks(win && (win.document || win.doc));
            } catch (error) {
              // Popout click binding is best-effort.
            }
          }),
        );
      }
    } catch (error) {
      // Reading-view wiring never breaks setup.
    }
  }

  todayMarkHasClass(node, name) {
    try {
      if (!node || !name) {
        return false;
      }
      if (node.classList && typeof node.classList.contains === "function") {
        return node.classList.contains(name);
      }
      const raw =
        typeof node.getAttribute === "function"
          ? node.getAttribute("class") || ""
          : typeof node.className === "string"
            ? node.className
            : "";
      return String(raw).split(/\s+/).indexOf(name) !== -1;
    } catch (error) {
      return false;
    }
  }

  todayMarkTag(node) {
    try {
      return String((node && (node.tagName || node.nodeName)) || "").toUpperCase();
    } catch (error) {
      return "";
    }
  }

  todayMarkNormalizeStatus(status) {
    return status === "" || status == null ? " " : String(status);
  }

  todayMarkStatusEqual(left, right) {
    return this.todayMarkNormalizeStatus(left) === this.todayMarkNormalizeStatus(right);
  }

  todayMarkStatusIsOpen(status) {
    try {
      return TODAY_MARK_OPEN_STATUSES.indexOf(this.todayMarkNormalizeStatus(status)) !== -1;
    } catch (error) {
      return false;
    }
  }

  todayMarkHostPath(sourcePath) {
    try {
      const raw = typeof sourcePath === "string" ? sourcePath : "";
      return raw && !/\.md$/i.test(raw) ? raw + ".md" : raw;
    } catch (error) {
      return "";
    }
  }

  todayMarkPlatform() {
    try {
      if (Platform && Platform.isMobile) {
        return "mobile";
      }
      if (Platform && Platform.isMacOS) {
        return "mac";
      }
    } catch (error) {
      // Non-Mac default.
    }
    return "other";
  }

  todayMarkRenderedStatus(li) {
    try {
      if (!li || typeof li.getAttribute !== "function") {
        return null;
      }
      const raw = li.getAttribute("data-task");
      return raw === null ? null : this.todayMarkNormalizeStatus(raw);
    } catch (error) {
      return null;
    }
  }

  todayMarkRowSkipped(li, root) {
    try {
      let current = li;
      let guard = 0;
      while (current && current !== root && guard < 200) {
        guard += 1;
        const tag = this.todayMarkTag(current);
        if (tag === "CODE" || tag === "PRE") {
          return true;
        }
        if (
          this.todayMarkHasClass(current, "plugin-tasks-list-item") ||
          this.todayMarkHasClass(current, "tasks-list-text") ||
          this.todayMarkHasClass(current, "task-description")
        ) {
          return true;
        }
        current = current.parentNode || null;
      }
      return false;
    } catch (error) {
      return true;
    }
  }

  todayMarkWalkElements(root, visit) {
    try {
      if (!root) {
        return;
      }
      const stack = [root];
      let guard = 0;
      while (stack.length > 0 && guard < 20000) {
        guard += 1;
        const node = stack.pop();
        if (!node || node.nodeType !== 1) {
          continue;
        }
        try {
          visit(node);
        } catch (error) {
          // Keep walking on per-node failure.
        }
        const children = node.childNodes || [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          const child = children[index];
          if (child && child.nodeType === 1) {
            stack.push(child);
          }
        }
      }
    } catch (error) {
      // Walk is best-effort.
    }
  }

  todayMarkCandidateRows(el) {
    try {
      const rows = [];
      this.todayMarkWalkElements(el, (node) => {
        if (this.todayMarkTag(node) !== "LI") {
          return;
        }
        if (!this.todayMarkHasClass(node, "task-list-item")) {
          return;
        }
        if (typeof node.getAttribute !== "function") {
          return;
        }
        if (node.getAttribute("data-task") === null) {
          return;
        }
        if (this.todayMarkRowSkipped(node, el)) {
          return;
        }
        rows.push(node);
      });
      return rows;
    } catch (error) {
      return [];
    }
  }

  todayMarkOwnElements(li) {
    try {
      const found = [];
      const walk = (node) => {
        const children = (node && node.childNodes) || [];
        for (const child of children) {
          if (!child || child.nodeType !== 1) {
            continue;
          }
          const tag = this.todayMarkTag(child);
          if (tag === "UL" || tag === "OL" || tag === "CODE" || tag === "PRE") {
            continue;
          }
          found.push(child);
          walk(child);
        }
      };
      walk(li);
      return found;
    } catch (error) {
      return [];
    }
  }

  todayMarkTaskTagAnchor(li) {
    try {
      const own = this.todayMarkOwnElements(li);
      for (const node of own) {
        if (this.todayMarkTag(node) !== "A") {
          continue;
        }
        if (!this.todayMarkHasClass(node, "tag")) {
          continue;
        }
        const text = String(node.textContent || "").trim();
        if (text === "#task") {
          return node;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  todayMarkCheckbox(li) {
    try {
      const own = this.todayMarkOwnElements(li);
      for (const node of own) {
        if (this.todayMarkTag(node) !== "INPUT") {
          continue;
        }
        if (this.todayMarkHasClass(node, "task-list-item-checkbox")) {
          return node;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  todayMarkNextElementSkippingWhitespace(node) {
    try {
      let sibling = node ? node.nextSibling : null;
      let guard = 0;
      while (sibling && guard < 50) {
        guard += 1;
        if (sibling.nodeType === 3) {
          const value =
            typeof sibling.nodeValue === "string"
              ? sibling.nodeValue
              : String(sibling.textContent || "");
          if (value.trim() === "") {
            sibling = sibling.nextSibling || null;
            continue;
          }
          return null;
        }
        if (sibling.nodeType === 1) {
          return sibling;
        }
        sibling = sibling.nextSibling || null;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  todayMarkIsRefAnchor(node) {
    try {
      if (!node || this.todayMarkTag(node) !== "A") {
        return false;
      }
      const text = String(node.textContent || "").trim().toLowerCase();
      if (text === "#ref") {
        return true;
      }
      return this.todayMarkHasClass(node, "bob-ref-task-hidden");
    } catch (error) {
      return false;
    }
  }

  todayMarkInsertAfter(anchor, mark) {
    try {
      if (!anchor || !mark) {
        return false;
      }
      const parent = anchor.parentNode;
      if (!parent || typeof parent.insertBefore !== "function") {
        return false;
      }
      const next = anchor.nextSibling || null;
      if (next && next.nodeType === 3) {
        const value =
          typeof next.nodeValue === "string"
            ? next.nodeValue
            : String(next.textContent || "");
        const match = /^[ \t]+/.exec(value);
        if (match) {
          if (match[0].length < value.length) {
            const doc =
              (next.ownerDocument && next.ownerDocument) ||
              (parent.ownerDocument && parent.ownerDocument) ||
              (typeof document !== "undefined" ? document : null);
            if (doc && typeof doc.createTextNode === "function") {
              const rest = doc.createTextNode(value.slice(match[0].length));
              try {
                next.nodeValue = match[0];
              } catch (error) {
                // Keep the original node when it cannot be split.
              }
              parent.insertBefore(rest, next.nextSibling || null);
              parent.insertBefore(mark, rest);
              return true;
            }
          } else {
            parent.insertBefore(mark, next.nextSibling || null);
            return true;
          }
        }
      }
      parent.insertBefore(mark, next);
      return true;
    } catch (error) {
      return false;
    }
  }

  todayMarkOwnMark(li) {
    try {
      const own = this.todayMarkOwnElements(li);
      for (const node of own) {
        if (!this.todayMarkHasClass(node, "bob-today-mark")) {
          continue;
        }
        let owner = node;
        let guard = 0;
        while (owner && guard < 50) {
          guard += 1;
          if (this.todayMarkTag(owner) === "LI") {
            break;
          }
          owner = owner.parentNode || null;
        }
        if (owner === li) {
          return node;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  todayMarkHasDailyAncestor(node) {
    try {
      let current = node;
      let guard = 0;
      while (current && guard < 200) {
        guard += 1;
        if (this.todayMarkHasClass(current, "bob-daily-note-view")) {
          return true;
        }
        current = current.parentNode || null;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  todayMarkSplitLines(text) {
    try {
      return String(text || "").split(/\r?\n/);
    } catch (error) {
      return [];
    }
  }

  todayMarkLineAt(lines, info, fileLine) {
    try {
      if (!Array.isArray(lines) || !Number.isInteger(fileLine) || fileLine < 0) {
        return null;
      }
      const lineStart = info && Number.isInteger(info.lineStart) ? info.lineStart : 0;
      const lineEnd =
        info && Number.isInteger(info.lineEnd)
          ? info.lineEnd
          : lineStart + lines.length - 1;
      if (lines.length === lineEnd - lineStart + 1) {
        const index = fileLine - lineStart;
        return index >= 0 && index < lines.length ? lines[index] : null;
      }
      return fileLine < lines.length ? lines[fileLine] : null;
    } catch (error) {
      return null;
    }
  }

  todayMarkIsSourceListItem(line) {
    try {
      const stripped = freshnessStripBlockquotePrefix(String(line || ""));
      let index = 0;
      while (stripped[index] === " " || stripped[index] === "\t") {
        index += 1;
      }
      return freshnessAfterListMarker(stripped, index) !== null;
    } catch (error) {
      return /^\s*(?:[-*+]|\d+[.)])\s+/.test(String(line || ""));
    }
  }

  todayMarkSectionItemLines(lines, info) {
    try {
      const lineStart = info && Number.isInteger(info.lineStart) ? info.lineStart : 0;
      const lineEnd =
        info && Number.isInteger(info.lineEnd)
          ? info.lineEnd
          : lineStart + Math.max(0, lines.length - 1);
      const low = Math.max(0, lineStart);
      const high = Math.max(low, lineEnd);
      let fenced = new Set();
      try {
        if (typeof planFencedLines === "function") {
          fenced = planFencedLines(lines, low, Math.min(high, lines.length - 1));
        }
      } catch (error) {
        fenced = new Set();
      }
      const items = [];
      const sectionLen = lineEnd - lineStart + 1;
      const sectionOnly = lines.length === sectionLen;
      const last = sectionOnly
        ? lines.length - 1
        : Math.min(high, lines.length - 1);
      const first = sectionOnly ? 0 : low;
      for (let index = first; index <= last; index += 1) {
        if (fenced.has(sectionOnly ? index + lineStart : index)) {
          continue;
        }
        if (this.todayMarkIsSourceListItem(lines[index])) {
          items.push(sectionOnly ? index + lineStart : index);
        }
      }
      return items;
    } catch (error) {
      return [];
    }
  }

  todayMarkResolveSourceLine(li, el, info, lines) {
    try {
      const rowStatus = this.todayMarkRenderedStatus(li);
      if (rowStatus === null) {
        return null;
      }
      let dataLine = NaN;
      try {
        if (typeof li.getAttribute === "function") {
          const raw = li.getAttribute("data-line");
          if (raw !== null && raw !== undefined && raw !== "") {
            dataLine = Number(raw);
          }
        }
      } catch (error) {
        dataLine = NaN;
      }
      if (Number.isFinite(dataLine)) {
        const lineStart =
          info && Number.isInteger(info.lineStart) ? info.lineStart : 0;
        const fileLine = lineStart + dataLine;
        const sourceLine = this.todayMarkLineAt(lines, info, fileLine);
        if (typeof sourceLine === "string") {
          let parsed = null;
          try {
            parsed = freshnessTaskStatus(sourceLine);
          } catch (error) {
            parsed = null;
          }
          if (
            parsed !== null &&
            this.todayMarkStatusEqual(parsed, rowStatus)
          ) {
            return sourceLine;
          }
          return null;
        }
      }
      let rendered = null;
      try {
        if (el && typeof el.querySelectorAll === "function") {
          rendered = Array.from(el.querySelectorAll("li"));
        } else {
          rendered = this.todayMarkCandidateRows(el);
        }
      } catch (error) {
        rendered = this.todayMarkCandidateRows(el);
      }
      if (!Array.isArray(rendered)) {
        rendered = this.todayMarkCandidateRows(el);
      }
      const itemLines = this.todayMarkSectionItemLines(lines, info);
      if (rendered.length !== itemLines.length) {
        return null;
      }
      const index = rendered.indexOf(li);
      if (index < 0 || index >= itemLines.length) {
        return null;
      }
      const mapped = this.todayMarkLineAt(lines, info, itemLines[index]);
      if (typeof mapped !== "string") {
        return null;
      }
      let parsed = null;
      try {
        parsed = freshnessTaskStatus(mapped);
      } catch (error) {
        parsed = null;
      }
      if (parsed === null || !this.todayMarkStatusEqual(parsed, rowStatus)) {
        return null;
      }
      return mapped;
    } catch (error) {
      return null;
    }
  }

  todayMarkSectionInfo(el, ctx) {
    try {
      if (!ctx || typeof ctx.getSectionInfo !== "function") {
        return null;
      }
      return ctx.getSectionInfo(el) || null;
    } catch (error) {
      return null;
    }
  }

  todayMarkSourceText(info, sourcePath) {
    try {
      if (info && typeof info.text === "string") {
        return info.text;
      }
    } catch (error) {
      // Fall through to the vault read.
    }
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.cachedRead !== "function") {
        return null;
      }
      const file =
        typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(sourcePath)
          : sourcePath;
      return vault.cachedRead(file);
    } catch (error) {
      return null;
    }
  }

  todayMarkStampRow(li, key) {
    try {
      if (!li || !key) {
        return;
      }
      if (li.dataset) {
        li.dataset.bobTodayKey = key;
      }
      if (typeof li.setAttribute === "function") {
        li.setAttribute("data-bob-today-key", key);
      }
    } catch (error) {
      // Stamping is best-effort.
    }
  }

  todayMarkDesiredForRow(li, key) {
    try {
      if (!this.todayMarksEnabled) {
        return null;
      }
      let clock = null;
      try {
        clock =
          typeof this.todayMarksNow === "function"
            ? this.todayMarksNow()
            : new Date();
      } catch (error) {
        clock = new Date();
      }
      if (!(clock instanceof Date)) {
        clock = new Date();
      }
      if (
        typeof this.isTodayCacheReady !== "function" ||
        !this.isTodayCacheReady(clock)
      ) {
        return null;
      }
      if (this.todayMarkHasDailyAncestor(li)) {
        return null;
      }
      const status = this.todayMarkRenderedStatus(li);
      if (!this.todayMarkStatusIsOpen(status)) {
        return null;
      }
      const details =
        typeof this.todayDetailsForKey === "function"
          ? this.todayDetailsForKey(key)
          : [];
      if (!Array.isArray(details) || details.length === 0) {
        return null;
      }
      return todayMarkTooltip(details, { platform: this.todayMarkPlatform() });
    } catch (error) {
      return null;
    }
  }

  todayMarkApplyToRow(li, key, tooltip) {
    try {
      const existing = this.todayMarkOwnMark(li);
      if (!tooltip) {
        if (existing && existing.parentNode) {
          existing.parentNode.removeChild(existing);
        }
        return;
      }
      if (existing) {
        try {
          existing.setAttribute("aria-label", tooltip);
        } catch (error) {
          // Tooltip update is best-effort.
        }
        try {
          if (existing.dataset) {
            existing.dataset.bobTodayKey = key;
          }
        } catch (error) {
          // Dataset update is best-effort.
        }
        try {
          existing.setAttribute("data-bob-today-key", key);
        } catch (error) {
          // Attribute update is best-effort.
        }
        return;
      }
      const doc =
        (li && li.ownerDocument) ||
        (typeof document !== "undefined" ? document : null);
      const mark = buildTodayMarkElement(doc, { key, tooltip, entering: false });
      if (!mark) {
        return;
      }
      const anchor = this.todayMarkInsertAnchor(li);
      if (anchor) {
        this.todayMarkInsertAfter(anchor, mark);
        return;
      }
      if (li && typeof li.appendChild === "function") {
        li.appendChild(mark);
      }
    } catch (error) {
      // Insertion is best-effort.
    }
  }

  todayMarkRenderRow(li, el, ctx, info, lines) {
    try {
      const sourceLine = this.todayMarkResolveSourceLine(li, el, info, lines);
      if (typeof sourceLine !== "string") {
        return;
      }
      const candidate = todayMarkLineCandidate(sourceLine);
      if (!candidate) {
        return;
      }
      let inCode = false;
      try {
        inCode = todayMarkPosInInlineCode(sourceLine, candidate.tagFrom);
      } catch (error) {
        inCode = false;
      }
      if (inCode) {
        return;
      }
      let atBody = false;
      try {
        atBody = candidate.tagFrom !== todayMarkBodyStart(sourceLine);
      } catch (error) {
        atBody = false;
      }
      this.todayMarkSetRowPlace(li, atBody);
      const rowStatus = this.todayMarkRenderedStatus(li);
      if (
        !this.todayMarkStatusIsOpen(candidate.status) ||
        !this.todayMarkStatusIsOpen(rowStatus)
      ) {
        return;
      }
      const duplicates = todayMarkDuplicateIds(lines, [candidate.blockId]);
      if (duplicates.indexOf(candidate.blockId) !== -1) {
        return;
      }
      const path = this.todayMarkHostPath(ctx && ctx.sourcePath);
      if (!path) {
        return;
      }
      const key = path + "#" + candidate.blockId;
      this.todayMarkStampRow(li, key);
      const tooltip = this.todayMarkDesiredForRow(li, key);
      this.todayMarkApplyToRow(li, key, tooltip);
    } catch (error) {
      // One bad row never breaks the processor.
    }
  }

  renderTodayMarksIn(el, ctx) {
    try {
      if (!el || !ctx) {
        return;
      }
      const sourcePath = typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!sourcePath || PLAN_DAILY_PATH_RE.test(sourcePath)) {
        return;
      }
      const info = this.todayMarkSectionInfo(el, ctx);
      if (!info) {
        return;
      }
      const text = this.todayMarkSourceText(info, sourcePath);
      if (typeof text === "string") {
        this.renderTodayMarksInWithText(el, ctx, info, text);
        return;
      }
      if (text && typeof text.then === "function") {
        const self = this;
        Promise.resolve(text)
          .then((source) => {
            try {
              if (typeof source === "string") {
                self.renderTodayMarksInWithText(el, ctx, info, source);
              }
            } catch (error) {
              // Async completion is best-effort.
            }
          })
          .catch(() => {});
      }
    } catch (error) {
      // Rendered-view marks never throw.
    }
  }

  todayMarkDuplicateSet(lines, ids) {
    try {
      const dups = todayMarkDuplicateIds(lines, ids);
      return new Set(Array.isArray(dups) ? dups : []);
    } catch (error) {
      return new Set();
    }
  }

  renderTodayMarksInWithText(el, ctx, info, text) {
    try {
      const lines = this.todayMarkSplitLines(text);
      const rows = this.todayMarkCandidateRows(el);
      const resolved = [];
      const allIds = [];
      for (const li of rows) {
        try {
          const sourceLine = this.todayMarkResolveSourceLine(li, el, info, lines);
          if (typeof sourceLine !== "string") {
            continue;
          }
          const candidate = todayMarkLineCandidate(sourceLine);
          if (!candidate) {
            continue;
          }
          let inCode = false;
          try {
            inCode = todayMarkPosInInlineCode(sourceLine, candidate.tagFrom);
          } catch (error) {
            inCode = false;
          }
          if (inCode) {
            continue;
          }
          let atBody = false;
          try {
            atBody = candidate.tagFrom !== todayMarkBodyStart(sourceLine);
          } catch (error) {
            atBody = false;
          }
          this.todayMarkSetRowPlace(li, atBody);
          const rowStatus = this.todayMarkRenderedStatus(li);
          if (
            !this.todayMarkStatusIsOpen(candidate.status) ||
            !this.todayMarkStatusIsOpen(rowStatus)
          ) {
            continue;
          }
          resolved.push({ li, candidate });
          if (allIds.indexOf(candidate.blockId) === -1) {
            allIds.push(candidate.blockId);
          }
        } catch (error) {
          continue;
        }
      }
      let duplicateSet = new Set();
      try {
        if (typeof this.todayMarkDuplicateSet === "function") {
          const computed = this.todayMarkDuplicateSet(lines, allIds);
          duplicateSet = computed instanceof Set ? computed : new Set();
        } else {
          const dups = todayMarkDuplicateIds(lines, allIds);
          duplicateSet = new Set(Array.isArray(dups) ? dups : []);
        }
      } catch (error) {
        duplicateSet = new Set();
      }
      for (const item of resolved) {
        try {
          if (duplicateSet.has(item.candidate.blockId)) {
            continue;
          }
          const path = this.todayMarkHostPath(ctx && ctx.sourcePath);
          if (!path) {
            continue;
          }
          const key = path + "#" + item.candidate.blockId;
          this.todayMarkStampRow(item.li, key);
          const tooltip = this.todayMarkDesiredForRow(item.li, key);
          this.todayMarkApplyToRow(item.li, key, tooltip);
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Rendered-view marks never throw.
    }
  }

  todayMarkRowKey(node) {
    try {
      if (node && node.dataset && typeof node.dataset.bobTodayKey === "string") {
        return node.dataset.bobTodayKey;
      }
      if (node && typeof node.getAttribute === "function") {
        return node.getAttribute("data-bob-today-key") || "";
      }
    } catch (error) {
      // Best-effort.
    }
    return "";
  }

  todayMarkLeafContainer(leaf) {
    return (
      (leaf && leaf.containerEl) ||
      (leaf && leaf.view && leaf.view.containerEl) ||
      null
    );
  }

  todayMarksReadingDocuments() {
    const docs = [];
    const seen = new Set();
    const add = (doc) => {
      if (doc && !seen.has(doc)) {
        seen.add(doc);
        docs.push(doc);
      }
    };
    try {
      if (typeof document !== "undefined") {
        add(document);
      }
    } catch (error) {
      // The main document is optional on test hosts.
    }
    try {
      const workspace = this.app && this.app.workspace;
      const leaves =
        workspace && typeof workspace.getLeavesOfType === "function"
          ? workspace.getLeavesOfType("markdown") || []
          : [];
      for (const leaf of leaves) {
        const container = this.todayMarkLeafContainer(leaf);
        if (container && container.ownerDocument) {
          add(container.ownerDocument);
        }
      }
    } catch (error) {
      // Popout documents are best-effort.
    }
    return docs;
  }

  todayMarkStampedRows(doc) {
    try {
      if (doc && typeof doc.querySelectorAll === "function") {
        const found = doc.querySelectorAll("li[data-bob-today-key]");
        if (found && typeof found.length === "number") {
          return Array.prototype.slice.call(found);
        }
      }
      const rows = [];
      this.todayMarkWalkElements(doc && (doc.body || doc), (node) => {
        if (this.todayMarkTag(node) === "LI" && this.todayMarkRowKey(node)) {
          rows.push(node);
        }
      });
      return rows;
    } catch (error) {
      return [];
    }
  }

  sweepTodayMarksReading() {
    try {
      for (const doc of this.todayMarksReadingDocuments()) {
        for (const li of this.todayMarkStampedRows(doc)) {
          try {
            const key = this.todayMarkRowKey(li);
            if (!key) {
              continue;
            }
            this.todayMarkApplyToRow(li, key, this.todayMarkDesiredForRow(li, key));
          } catch (error) {
            continue;
          }
        }
      }
    } catch (error) {
      // Sweep is best-effort.
    }
  }

  refreshDailyNoteViewClasses() {
    try {
      const workspace = this.app && this.app.workspace;
      if (!workspace || typeof workspace.getLeavesOfType !== "function") {
        return;
      }
      const leaves = workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) {
        try {
          const container = this.todayMarkLeafContainer(leaf);
          if (!container || !container.classList) {
            continue;
          }
          const path =
            leaf && leaf.view && leaf.view.file && typeof leaf.view.file.path === "string"
              ? leaf.view.file.path
              : "";
          const daily = Boolean(path && PLAN_DAILY_PATH_RE.test(path));
          if (daily && typeof container.classList.add === "function") {
            container.classList.add("bob-daily-note-view");
          } else if (!daily && typeof container.classList.remove === "function") {
            container.classList.remove("bob-daily-note-view");
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Daily-view classes are best-effort.
    }
  }

}
