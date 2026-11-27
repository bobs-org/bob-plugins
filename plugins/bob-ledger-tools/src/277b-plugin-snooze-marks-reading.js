// Snooze definition clocks in rendered views (definition-marks phase).
// Exact source mapping or neutral; never title-matches, never writes.
// Split from `277a-plugin-snooze-marks.js` to keep each fragment at or
// below 1000 lines. Shares the plugin scope, so helpers across
// fragments resolve. Contract: bob-cli `docs/snooze-marks.md`.

class BobLedgerToolsSnoozeMarksReadingMixin {
  snoozeMarkHasClass(node, name) {
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

  snoozeMarkRowKey(node) {
    try {
      if (node && node.dataset && typeof node.dataset.bobSnoozeKey === "string") {
        return node.dataset.bobSnoozeKey;
      }
      if (node && typeof node.getAttribute === "function") {
        return node.getAttribute("data-bob-snooze-key") || "";
      }
    } catch (error) {
      // Best-effort.
    }
    return "";
  }

  snoozeMarkStampRow(li, key) {
    try {
      if (!li || !key) {
        return;
      }
      if (li.dataset) {
        li.dataset.bobSnoozeKey = key;
      }
      if (typeof li.setAttribute === "function") {
        li.setAttribute("data-bob-snooze-key", key);
      }
    } catch (error) {
      // Stamping is best-effort.
    }
  }

  snoozeMarkOwnMark(li) {
    try {
      if (!li || typeof li.querySelectorAll !== "function") {
        return null;
      }
      const found = li.querySelectorAll(
        ":scope > span.bob-snooze-mark, :scope span.bob-snooze-mark",
      );
      const list =
        found && typeof found.length === "number"
          ? Array.prototype.slice.call(found)
          : [];
      for (const node of list) {
        try {
          let owner = node;
          let guard = 0;
          while (owner && guard < 50) {
            guard += 1;
            const tag = String(
              (owner && (owner.tagName || owner.nodeName)) || "",
            ).toUpperCase();
            if (tag === "LI") {
              break;
            }
            owner = owner.parentNode || null;
          }
          if (owner === li) {
            return node;
          }
        } catch (error) {
          continue;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  snoozeMarkDesiredForRow(li, key, nowMinutes, clock) {
    try {
      if (!this.snoozeMarksEnabled) {
        return null;
      }
      // The clock shares the Today slot: either toggle off hides it
      // (SM-D15), while the tomato keeps its own Today toggle behavior.
      if (this.todayMarksEnabled === false) {
        return null;
      }
      const moment =
        clock instanceof Date
          ? clock
          : typeof this.snoozeMarksNow === "function"
            ? this.snoozeMarksNow()
            : new Date();
      if (
        typeof this.isSnoozedCacheReady !== "function" ||
        !this.isSnoozedCacheReady(moment)
      ) {
        return null;
      }
      if (typeof this.todayMarkHasDailyAncestor === "function") {
        try {
          if (this.todayMarkHasDailyAncestor(li)) {
            return null;
          }
        } catch (error) {
          // Ancestor scan is best-effort.
        }
      }
      let status = null;
      try {
        status =
          typeof this.todayMarkRenderedStatus === "function"
            ? this.todayMarkRenderedStatus(li)
            : null;
      } catch (error) {
        status = null;
      }
      const open =
        typeof this.todayMarkStatusIsOpen === "function"
          ? this.todayMarkStatusIsOpen(status)
          : status === " " ||
            status === "*" ||
            status === "/" ||
            status === "?";
      if (!open) {
        return null;
      }
      // A live dedicated Task Link wins: the clock leaves and the
      // tomato stays.
      try {
        if (
          this.todayCache &&
          this.todayCache.rank instanceof Map &&
          this.todayCache.rank.has(key)
        ) {
          return null;
        }
      } catch (error) {
        // Precedence check is best-effort.
      }
      if (typeof this.snoozeMarkDesiredSnapshot !== "function") {
        return null;
      }
      const minutes =
        Number.isInteger(nowMinutes)
          ? nowMinutes
          : moment.getHours() * 60 + moment.getMinutes();
      return this.snoozeMarkDesiredSnapshot(key, minutes);
    } catch (error) {
      return null;
    }
  }

  snoozeMarkApplyToRow(li, key, desired) {
    try {
      const existing = this.snoozeMarkOwnMark(li);
      if (!desired) {
        if (existing && existing.parentNode) {
          existing.parentNode.removeChild(existing);
        }
        return;
      }
      if (existing) {
        try {
          existing.setAttribute("aria-label", desired.tooltip);
        } catch (error) {
          // Tooltip update is best-effort.
        }
        try {
          if (existing.dataset) {
            existing.dataset.bobSnoozeKey = key;
            existing.dataset.bobSnoozeTime = desired.time;
          }
        } catch (error) {
          // Dataset update is best-effort.
        }
        try {
          existing.setAttribute("data-bob-snooze-key", key);
          existing.setAttribute("data-bob-snooze-time", desired.time);
        } catch (error) {
          // Attribute update is best-effort.
        }
        try {
          existing.setAttribute(
            "class",
            "bob-snooze-mark bob-snooze-mark--" + desired.tone,
          );
        } catch (error) {
          // Class update is best-effort.
        }
        return;
      }
      const doc =
        (li && li.ownerDocument) ||
        (typeof document !== "undefined" ? document : null);
      const mark = buildSnoozeMarkElement(doc, {
        key,
        time: desired.time,
        tone: desired.tone,
        tooltip: desired.tooltip,
        pulse: false,
      });
      if (!mark) {
        return;
      }
      let anchor = null;
      try {
        anchor =
          typeof this.todayMarkInsertAnchor === "function"
            ? this.todayMarkInsertAnchor(li)
            : null;
      } catch (error) {
        anchor = null;
      }
      if (anchor) {
        try {
          if (typeof this.todayMarkInsertAfter === "function") {
            this.todayMarkInsertAfter(anchor, mark);
            return;
          }
          const parent = anchor.parentNode;
          const next = anchor.nextSibling;
          if (parent && typeof parent.insertBefore === "function") {
            parent.insertBefore(mark, next);
            return;
          }
        } catch (error) {
          // Insertion is best-effort.
        }
      }
      if (li && typeof li.appendChild === "function") {
        li.appendChild(mark);
      }
    } catch (error) {
      // Insertion never throws.
    }
  }

  snoozeMarkRenderRow(li, el, ctx, info, lines, nowMinutes, clock) {
    try {
      const sourceLine =
        typeof this.todayMarkResolveSourceLine === "function"
          ? this.todayMarkResolveSourceLine(li, el, info, lines)
          : null;
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
      let rowStatus = null;
      try {
        rowStatus =
          typeof this.todayMarkRenderedStatus === "function"
            ? this.todayMarkRenderedStatus(li)
            : null;
      } catch (error) {
        rowStatus = null;
      }
      const open =
        typeof this.todayMarkStatusIsOpen === "function"
          ? this.todayMarkStatusIsOpen(candidate.status) &&
            this.todayMarkStatusIsOpen(rowStatus)
          : false;
      if (!open) {
        return;
      }
      const duplicates = todayMarkDuplicateIds(lines, [candidate.blockId]);
      if (duplicates.indexOf(candidate.blockId) !== -1) {
        return;
      }
      const path =
        typeof this.todayMarkHostPath === "function"
          ? this.todayMarkHostPath(ctx && ctx.sourcePath)
          : "";
      if (!path) {
        return;
      }
      // A stamped tomato owns the slot: the clock never renders
      // beside it.
      try {
        if (
          typeof this.todayMarkOwnMark === "function" &&
          this.todayMarkOwnMark(li)
        ) {
          return;
        }
      } catch (error) {
        // Ownership check is best-effort.
      }
      const key = path + "#" + candidate.blockId;
      this.snoozeMarkStampRow(li, key);
      const desired = this.snoozeMarkDesiredForRow(li, key, nowMinutes, clock);
      this.snoozeMarkApplyToRow(li, key, desired);
    } catch (error) {
      // One bad row never breaks the processor.
    }
  }

  renderSnoozeMarksIn(el, ctx) {
    try {
      if (!el || !ctx) {
        return;
      }
      if (typeof this.snoozeMarksEnabled !== "boolean") {
        this.snoozeMarksEnabled = true;
      }
      const sourcePath = typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!sourcePath || PLAN_DAILY_PATH_RE.test(sourcePath)) {
        return;
      }
      const info =
        typeof this.todayMarkSectionInfo === "function"
          ? this.todayMarkSectionInfo(el, ctx)
          : null;
      if (!info) {
        return;
      }
      const text =
        typeof this.todayMarkSourceText === "function"
          ? this.todayMarkSourceText(info, sourcePath)
          : null;
      if (typeof text === "string") {
        this.renderSnoozeMarksInWithText(el, ctx, info, text);
        return;
      }
      if (text && typeof text.then === "function") {
        const self = this;
        Promise.resolve(text)
          .then((source) => {
            try {
              if (typeof source === "string") {
                self.renderSnoozeMarksInWithText(el, ctx, info, source);
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

  renderSnoozeMarksInWithText(el, ctx, info, text) {
    try {
      let clock = null;
      try {
        clock =
          typeof this.snoozeMarksNow === "function"
            ? this.snoozeMarksNow()
            : new Date();
      } catch (error) {
        clock = new Date();
      }
      if (!(clock instanceof Date)) {
        clock = new Date();
      }
      const nowMinutes = clock.getHours() * 60 + clock.getMinutes();
      const lines =
        typeof this.todayMarkSplitLines === "function"
          ? this.todayMarkSplitLines(text)
          : String(text || "").split(/\r?\n/);
      const rows =
        typeof this.todayMarkCandidateRows === "function"
          ? this.todayMarkCandidateRows(el)
          : [];
      for (const li of rows || []) {
        try {
          this.snoozeMarkRenderRow(li, el, ctx, info, lines, nowMinutes, clock);
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Rendered-view marks never throw.
    }
  }

  snoozeMarksReadingDocuments() {
    try {
      if (typeof this.todayMarksReadingDocuments === "function") {
        return this.todayMarksReadingDocuments();
      }
    } catch (error) {
      // Fall through to the local enumeration.
    }
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
    return docs;
  }

  snoozeMarkStampedRows(doc) {
    try {
      if (doc && typeof doc.querySelectorAll === "function") {
        const found = doc.querySelectorAll("li[data-bob-snooze-key]");
        if (found && typeof found.length === "number") {
          return Array.prototype.slice.call(found);
        }
      }
      const rows = [];
      const walk =
        typeof this.todayMarkWalkElements === "function"
          ? (root, visit) => this.todayMarkWalkElements(root, visit)
          : null;
      if (!walk) {
        return rows;
      }
      walk(doc && (doc.body || doc), (node) => {
        try {
          const tag = String(
            (node && (node.tagName || node.nodeName)) || "",
          ).toUpperCase();
          if (tag === "LI" && this.snoozeMarkRowKey(node)) {
            rows.push(node);
          }
        } catch (error) {
          // Row scan is best-effort.
        }
      });
      return rows;
    } catch (error) {
      return [];
    }
  }

  sweepSnoozeMarksReading() {
    try {
      let clock = null;
      try {
        clock =
          typeof this.snoozeMarksNow === "function"
            ? this.snoozeMarksNow()
            : new Date();
      } catch (error) {
        clock = new Date();
      }
      if (!(clock instanceof Date)) {
        clock = new Date();
      }
      const nowMinutes = clock.getHours() * 60 + clock.getMinutes();
      for (const doc of this.snoozeMarksReadingDocuments()) {
        for (const li of this.snoozeMarkStampedRows(doc)) {
          try {
            const key = this.snoozeMarkRowKey(li);
            if (!key) {
              continue;
            }
            this.snoozeMarkApplyToRow(
              li,
              key,
              this.snoozeMarkDesiredForRow(li, key, nowMinutes, clock),
            );
          } catch (error) {
            continue;
          }
        }
      }
    } catch (error) {
      // Sweep is best-effort.
    }
  }

  snoozeMarksBindReadingClicks(doc) {
    try {
      if (!doc) {
        return;
      }
      if (!this.snoozeMarksClickDocs) {
        this.snoozeMarksClickDocs =
          typeof WeakSet === "function" ? new WeakSet() : new Set();
      }
      if (this.snoozeMarksClickDocs.has(doc)) {
        return;
      }
      this.snoozeMarksClickDocs.add(doc);
      const handler = (event) => this.handleSnoozeMarkReadingClick(event);
      if (typeof this.registerDomEvent === "function") {
        this.registerDomEvent(doc, "click", handler, { capture: true });
        return;
      }
      if (typeof doc.addEventListener === "function") {
        doc.addEventListener("click", handler, true);
      }
    } catch (error) {
      // Click binding is best-effort.
    }
  }

  setupSnoozeMarksReading() {
    try {
      if (
        typeof this.registerMarkdownPostProcessor === "function" &&
        typeof this.renderSnoozeMarksIn === "function"
      ) {
        this.registerMarkdownPostProcessor(
          (el, ctx) => this.renderSnoozeMarksIn(el, ctx),
          61,
        );
      }
    } catch (error) {
      // Rendered-view marks are best-effort.
    }
    try {
      if (typeof document !== "undefined") {
        this.snoozeMarksBindReadingClicks(document);
      }
      for (const doc of this.snoozeMarksReadingDocuments()) {
        this.snoozeMarksBindReadingClicks(doc);
      }
      const workspace = this.app && this.app.workspace;
      if (
        workspace &&
        typeof workspace.on === "function" &&
        typeof this.registerEvent === "function"
      ) {
        this.registerEvent(
          workspace.on("window-open", (win, openedWindow) => {
            try {
              let doc = null;
              const candidates = [
                openedWindow && openedWindow.document,
                win && win.document,
                win && win.doc,
              ];
              for (const candidate of candidates) {
                if (candidate) {
                  doc = candidate;
                  break;
                }
              }
              this.snoozeMarksBindReadingClicks(doc);
            } catch (error) {
              // Popout click binding is best-effort.
            }
          }),
        );
      }
    } catch (error) {
      // Click setup never throws.
    }
  }

  handleSnoozeMarkReadingClick(event) {
    try {
      if (!event) {
        return;
      }
      let node = event.target || event.srcElement || null;
      let mark = null;
      let guard = 0;
      while (node && guard < 40) {
        guard += 1;
        if (this.snoozeMarkHasClass(node, "bob-snooze-mark")) {
          mark = node;
          break;
        }
        node = node.parentNode || node.parentElement || null;
      }
      if (!mark) {
        return;
      }
      try {
        let ancestor = mark.parentNode || mark.parentElement || null;
        let depth = 0;
        while (ancestor && depth < 40) {
          depth += 1;
          if (this.snoozeMarkHasClass(ancestor, "cm-editor")) {
            return;
          }
          ancestor = ancestor.parentNode || ancestor.parentElement || null;
        }
      } catch (error) {
        // Ancestor scan is best-effort.
      }
      let isMac = false;
      try {
        isMac = Boolean(Platform && Platform.isMacOS);
      } catch (error) {
        isMac = false;
      }
      if (!snoozeMarkModifierPressed(event, isMac)) {
        return;
      }
      try {
        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        if (typeof event.stopPropagation === "function") {
          event.stopPropagation();
        }
      } catch (error) {
        // Event cancellation is best-effort.
      }
      const key = this.snoozeMarkRowKey(mark);
      if (key && typeof this.goToSnoozedRow === "function") {
        void this.goToSnoozedRow(key);
      }
    } catch (error) {
      // Delegated clicks never throw.
    }
  }
}
