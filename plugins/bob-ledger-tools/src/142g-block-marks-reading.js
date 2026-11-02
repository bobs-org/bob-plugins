// --- Blocked-reason marks: Reading view, embeds, hover, Dataview ----------
// Source-note and Dataview TASK rows share the Live Preview classifier.
// Canonical section text is retained before other processors replace
// fields; missing mapping falls back to conservative own-text. Never
// reads the vault. Synchronous throughout; never throws.

const BLOCK_MARK_READING_PROCESSOR_ORDER = 40;
const BLOCK_MARK_READING_DETACHED_RETRIES = 3;
const BLOCK_MARK_READING_PENDING_RETRIES = 60;
const BLOCK_MARK_READING_TRANSFORMED_CLASSES = Object.freeze([
  "bob-date-mark",
  "bob-priority-mark",
  "bob-recurrence-mark",
  "bob-task-tag-mark",
  "bob-pomo-theme",
  "bob-progress-mark",
  "bob-today-mark",
  "bob-ledger-type-mark",
]);

class BobLedgerToolsBlockMarksReadingMixin {
  setupBlockMarksReading() {
    try {
      if (this.blockMarkReadingSetupDone) return;
      this.blockMarkReadingSetupDone = true;
      this.blockMarkReadingEnsureState();
      try {
        if (typeof this.registerMarkdownPostProcessor === "function") {
          this.registerMarkdownPostProcessor(
            (el, ctx) => this.renderBlockMarksIn(el, ctx),
            BLOCK_MARK_READING_PROCESSOR_ORDER,
          );
        }
      } catch (error) {
        // Rendered-view marks are best-effort.
      }
      try {
        if (typeof this.register === "function") {
          this.register(() => this.teardownBlockMarksReading());
        }
      } catch (error) {
        // Unload cleanup is best-effort.
      }
    } catch (error) {
      // Reading-view wiring never breaks plugin startup.
    }
  }

  blockMarkReadingEnsureState() {
    try {
      if (!(this.blockMarkReadingHosts instanceof Set)) {
        this.blockMarkReadingHosts = new Set();
      }
      if (!(this.blockMarkReadingSource instanceof WeakMap)) {
        this.blockMarkReadingSource = new WeakMap();
      }
      if (!(this.blockMarkReadingRows instanceof WeakMap)) {
        this.blockMarkReadingRows = new WeakMap();
      }
      if (!Array.isArray(this.blockMarkReadingQueue)) {
        this.blockMarkReadingQueue = [];
      }
      if (typeof this.blockMarkReadingPending !== "boolean") {
        this.blockMarkReadingPending = false;
      }
    } catch (error) {
      // State setup is best-effort.
    }
  }

  teardownBlockMarksReading() {
    try {
      this.cancelBlockMarkReadingQueryRows();
      const hosts = this.blockMarkReadingHosts instanceof Set
        ? Array.from(this.blockMarkReadingHosts)
        : [];
      for (const rec of hosts) {
        try {
          this.blockMarkReadingDisposeHost(rec, true);
        } catch (error) {
          continue;
        }
      }
      if (this.blockMarkReadingHosts instanceof Set) {
        this.blockMarkReadingHosts.clear();
      }
    } catch (error) {
      // Teardown never throws.
    }
  }

  // Query hosts only (Dataview result lists/tables, Tasks query-result
  // containers, language-tasks/dataview blocks). A source-note li that
  // Tasks also stamps `plugin-tasks-list-item` is not a query.
  blockMarkReadingIsQuery(row, el) {
    try {
      let current = row || el;
      let guard = 0;
      while (current && guard < 200) {
        guard += 1;
        const classes =
          typeof current.className === "string"
            ? current.className
            : this.blockMarkReadingAttr(current, "class") || "";
        if (
          typeof TASK_THEME_QUERY_HOST_RE !== "undefined" &&
          TASK_THEME_QUERY_HOST_RE &&
          TASK_THEME_QUERY_HOST_RE.test(String(classes || ""))
        ) {
          return true;
        }
        current = current.parentNode || current.parentElement || null;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  blockMarkReadingQueryLinkPath(li, queryNote) {
    try {
      const own = this.blockMarkReadingOwnElements(li);
      for (const node of own) {
        if (this.blockMarkReadingTag(node) !== "A") continue;
        if (
          !this.blockMarkReadingHasClass(node, "internal-link") &&
          !this.blockMarkReadingHasClass(node, "task-link") &&
          !this.blockMarkReadingHasClass(node, "file-link")
        ) {
          continue;
        }
        const href = this.blockMarkReadingAttr(node, "data-href") ||
          this.blockMarkReadingAttr(node, "href") ||
          "";
        if (!href || String(href).indexOf("://") !== -1) continue;
        let path = String(href).split("#")[0];
        if (!path) continue;
        try {
          if (typeof taskThemeNormalizeOriginPath === "function") {
            path = taskThemeNormalizeOriginPath(
              path,
              queryNote || "",
              this.app && this.app.metadataCache,
            ) || path;
          }
        } catch (error) {
          // Keep the raw href stem.
        }
        if (path && path !== queryNote) return path;
      }
      return "";
    } catch (error) {
      return "";
    }
  }

  blockMarkReadingOrigin(li, el, ctx) {
    try {
      const query = this.blockMarkReadingIsQuery(li, el);
      if (query) {
        let origin = null;
        try {
          const cache = this.app && this.app.metadataCache;
          origin = typeof taskThemeOriginFromContext === "function"
            ? taskThemeOriginFromContext(li, el, ctx, cache)
            : null;
        } catch (error) {
          origin = null;
        }
        const queryNote = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
        let path = origin && typeof origin.path === "string" ? origin.path : "";
        if (!path || path === queryNote) {
          path = this.blockMarkReadingQueryLinkPath(li, queryNote) || "";
        }
        // Query-note stem is never a proven origin and never a project reason.
        const proven = Boolean(path) && path !== queryNote;
        return { path: proven ? path : "", query: true, proven };
      }
      const path = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      return { path, query: false, proven: Boolean(path) };
    } catch (error) {
      return { path: "", query: false, proven: false };
    }
  }

  blockMarkReadingSectionInfo(el, ctx) {
    try {
      if (!ctx || typeof ctx.getSectionInfo !== "function") return null;
      return ctx.getSectionInfo(el) || null;
    } catch (error) {
      return null;
    }
  }

  blockMarkReadingSourceText(info) {
    try {
      if (info && typeof info.text === "string") return info.text;
      return null;
    } catch (error) {
      return null;
    }
  }

  blockMarkReadingSplitLines(text) {
    try {
      return String(text || "").split(/\r?\n/);
    } catch (error) {
      return [];
    }
  }

  blockMarkReadingLineAt(lines, info, fileLine) {
    try {
      if (!Array.isArray(lines) || !Number.isInteger(fileLine) || fileLine < 0) {
        return null;
      }
      const lineStart = info && Number.isInteger(info.lineStart) ? info.lineStart : 0;
      const lineEnd = info && Number.isInteger(info.lineEnd)
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

  blockMarkReadingResolveSectionLine(li, el, info, lines) {
    try {
      const rowStatus = this.blockMarkReadingAttr(li, "data-task");
      if (rowStatus === null) return null;
      let dataLine = NaN;
      try {
        const raw = this.blockMarkReadingAttr(li, "data-line");
        if (raw !== null && raw !== undefined && raw !== "") {
          dataLine = Number(raw);
        }
      } catch (error) {
        dataLine = NaN;
      }
      if (!Number.isFinite(dataLine) || dataLine < 0 || !Number.isInteger(dataLine)) {
        return null;
      }
      const lineStart = info && Number.isInteger(info.lineStart) ? info.lineStart : 0;
      const fileLine = lineStart + dataLine;
      const sourceLine = this.blockMarkReadingLineAt(lines, info, fileLine);
      if (typeof sourceLine !== "string") return null;
      let parsed = null;
      try {
        parsed = typeof freshnessTaskStatus === "function"
          ? freshnessTaskStatus(sourceLine)
          : null;
      } catch (error) {
        parsed = null;
      }
      if (parsed === null || String(parsed) !== String(rowStatus)) return null;
      return sourceLine;
    } catch (error) {
      return null;
    }
  }

  blockMarkReadingTransformed(li) {
    try {
      const own = this.blockMarkReadingOwnElements(li);
      for (const node of own) {
        const tag = this.blockMarkReadingTag(node);
        if (tag === "CODE" || tag === "PRE") return true;
        for (const name of BLOCK_MARK_READING_TRANSFORMED_CLASSES) {
          if (this.blockMarkReadingHasClass(node, name)) return true;
        }
        if (
          this.blockMarkReadingHasClass(node, "dataview") &&
          this.blockMarkReadingHasClass(node, "inline-field")
        ) {
          return true;
        }
      }
      return false;
    } catch (error) {
      return true;
    }
  }

  blockMarkReadingQueryCanonicalLine(li, origin) {
    try {
      if (!origin || origin.query !== true || origin.proven !== true || !origin.path) {
        return null;
      }
      const status = this.blockMarkReadingAttr(li, "data-task");
      if (status !== "?") return null;
      let own = "";
      try {
        own = typeof dependencyReadingOwnText === "function"
          ? dependencyReadingOwnText(li)
          : String(li && li.textContent || "");
      } catch (error) {
        own = String(li && li.textContent || "");
      }
      if (!own || !String(own).trim()) return null;
      const hasCanonical = /\[[^\]\n]+::/.test(own) ||
        /(?:^|\s)#prj_is_blocked(?![A-Za-z0-9_/-])/.test(own);
      if (hasCanonical) {
        let line = String(own);
        let parsed = null;
        try {
          parsed = typeof freshnessTaskStatus === "function"
            ? freshnessTaskStatus(line)
            : null;
        } catch (error) {
          parsed = null;
        }
        if (parsed === null) {
          line = "- [?] " + String(own).replace(/^\s+/, "");
        }
        try {
          parsed = typeof freshnessTaskStatus === "function"
            ? freshnessTaskStatus(line)
            : "?";
        } catch (error) {
          parsed = "?";
        }
        if (parsed === "?" && (typeof blockMarkEligible !== "function" || blockMarkEligible(line))) {
          return line;
        }
      }
      const memo = typeof this.freshnessEnsureMemo === "function"
        ? this.freshnessEnsureMemo()
        : null;
      const tasks = Array.isArray(memo && memo.tasks) ? memo.tasks : [];
      const originPath = origin.path;
      for (const task of tasks) {
        let path = "";
        try {
          path = typeof planTaskPath === "function" ? planTaskPath(task) : (task && task.path) || "";
        } catch (error) {
          path = task && task.path || "";
        }
        if (!path || path !== originPath) continue;
        let desc = "";
        try {
          desc = typeof planTaskDescription === "function"
            ? planTaskDescription(task)
            : (task && (task.description || task.text)) || "";
        } catch (error) {
          desc = task && (task.description || task.text) || "";
        }
        if (!desc) continue;
        let clean = desc;
        try {
          if (typeof dependencyCleanTaskText === "function") {
            clean = dependencyCleanTaskText(desc) || desc;
          }
        } catch (error) {
          clean = desc;
        }
        const title = String(clean)
          .replace(/\[[^\]]*\]/g, " ")
          .replace(/#[^\s]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .split(" ")
          .slice(0, 4)
          .join(" ");
        if (title.length < 4 || String(own).indexOf(title) === -1) continue;
        let line = String(desc);
        try {
          if (typeof freshnessTaskStatus === "function" && freshnessTaskStatus(line) === null) {
            line = "- [?] " + String(desc).replace(/^\s+/, "");
          }
        } catch (error) {
          line = "- [?] " + String(desc).replace(/^\s+/, "");
        }
        return line;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  blockMarkReadingFallbackLine(li) {
    try {
      if (this.blockMarkReadingTransformed(li)) return null;
      const status = this.blockMarkReadingAttr(li, "data-task");
      if (status !== "?") return null;
      let own = "";
      try {
        own = typeof dependencyReadingOwnText === "function"
          ? dependencyReadingOwnText(li)
          : String(li && li.textContent || "");
      } catch (error) {
        own = "";
      }
      if (!own || !String(own).trim()) return null;
      let line = String(own);
      let parsed = null;
      try {
        parsed = typeof freshnessTaskStatus === "function"
          ? freshnessTaskStatus(line)
          : null;
      } catch (error) {
        parsed = null;
      }
      if (parsed === null) {
        line = "- [?] " + String(own).replace(/^\s+/, "");
        try {
          parsed = typeof freshnessTaskStatus === "function"
            ? freshnessTaskStatus(line)
            : null;
        } catch (error) {
          parsed = null;
        }
      }
      if (parsed !== "?") return null;
      if (typeof blockMarkEligible === "function" && !blockMarkEligible(line)) {
        return null;
      }
      return line;
    } catch (error) {
      return null;
    }
  }

  blockMarkReadingRetain(li, record) {
    try {
      this.blockMarkReadingEnsureState();
      if (li && this.blockMarkReadingSource) {
        this.blockMarkReadingSource.set(li, record);
      }
    } catch (error) {
      // Retention is best-effort.
    }
  }

  blockMarkReadingInvalidate(li) {
    try {
      if (li && this.blockMarkReadingSource && typeof this.blockMarkReadingSource.delete === "function") {
        this.blockMarkReadingSource.delete(li);
      }
    } catch (error) {
      // Invalidation is best-effort.
    }
  }

  blockMarkReadingSourceFor(li) {
    try {
      return li && this.blockMarkReadingSource instanceof WeakMap
        ? this.blockMarkReadingSource.get(li) || null
        : null;
    } catch (error) {
      return null;
    }
  }

  blockMarkReadingRestoreOwned(node, appliedName, originalName, appliedValue, originalValue) {
    try {
      if (!node) return;
      if (appliedValue === null || appliedValue === undefined) return;
      const current = this.blockMarkReadingAttr(node, appliedName);
      if (current !== appliedValue) return;
      if (originalValue === null || originalValue === undefined) {
        this.blockMarkReadingRemoveAttr(node, appliedName);
      } else {
        this.blockMarkReadingSetAttr(node, appliedName, originalValue);
      }
    } catch (error) {
      // Restoration is best-effort.
    }
  }

  blockMarkReadingReleaseRow(li) {
    try {
      if (li && this.blockMarkReadingRows && typeof this.blockMarkReadingRows.delete === "function") {
        this.blockMarkReadingRows.delete(li);
      }
    } catch (error) {
      // Ownership release is best-effort.
    }
  }

  blockMarkReadingClearRow(li) {
    try {
      this.blockMarkReadingEnsureState();
      const record = this.blockMarkReadingRows instanceof WeakMap
        ? this.blockMarkReadingRows.get(li)
        : null;
      if (!record) {
        this.blockMarkReadingRemoveAttr(li, "data-bob-block");
        this.blockMarkReadingRemoveAttr(li, "data-bob-block-family");
        this.blockMarkReadingRemoveAttr(li, "data-bob-block-more");
        return;
      }
      this.blockMarkReadingRestoreOwned(
        li,
        "data-bob-block",
        "data-bob-block",
        record.appliedBlock,
        record.originalBlock,
      );
      this.blockMarkReadingRestoreOwned(
        li,
        "data-bob-block-family",
        "data-bob-block-family",
        record.appliedFamily,
        record.originalFamily,
      );
      this.blockMarkReadingRestoreOwned(
        li,
        "data-bob-block-more",
        "data-bob-block-more",
        record.appliedMore,
        record.originalMore,
      );
      const currentCheckbox = this.blockMarkReadingOwnCheckbox(li);
      const checkbox = record.checkbox && record.checkbox === currentCheckbox
        ? currentCheckbox
        : null;
      this.blockMarkReadingRestoreOwned(
        checkbox,
        "aria-label",
        "aria-label",
        record.appliedAria,
        record.originalAria,
      );
      this.blockMarkReadingRestoreOwned(
        checkbox,
        "data-tooltip-position",
        "data-tooltip-position",
        record.appliedPosition,
        record.originalPosition,
      );
      this.blockMarkReadingReleaseRow(li);
    } catch (error) {
      // Clearing a row never throws.
    }
  }

  blockMarkReadingApplyRow(li, model) {
    try {
      this.blockMarkReadingEnsureState();
      if (!model || typeof model !== "object" || !model.key) {
        this.blockMarkReadingClearRow(li);
        return;
      }
      const checkbox = this.blockMarkReadingOwnCheckbox(li);
      let record = this.blockMarkReadingRows instanceof WeakMap
        ? this.blockMarkReadingRows.get(li)
        : null;
      if (record && record.checkbox && checkbox && record.checkbox !== checkbox) {
        this.blockMarkReadingReleaseRow(li);
        record = null;
      }
      if (!record) {
        record = {
          originalBlock: this.blockMarkReadingAttr(li, "data-bob-block"),
          originalFamily: this.blockMarkReadingAttr(li, "data-bob-block-family"),
          originalMore: this.blockMarkReadingAttr(li, "data-bob-block-more"),
          checkbox,
          originalAria: checkbox ? this.blockMarkReadingAttr(checkbox, "aria-label") : null,
          originalPosition: checkbox
            ? this.blockMarkReadingAttr(checkbox, "data-tooltip-position")
            : null,
          appliedBlock: null,
          appliedFamily: null,
          appliedMore: null,
          appliedAria: null,
          appliedPosition: null,
        };
        this.blockMarkReadingRows.set(li, record);
      } else if (checkbox) {
        record.checkbox = checkbox;
      }
      this.blockMarkReadingSetAttr(li, "data-bob-block", model.key);
      this.blockMarkReadingSetAttr(li, "data-bob-block-family", model.family);
      record.appliedBlock = String(model.key);
      record.appliedFamily = String(model.family);
      if (model.more) {
        this.blockMarkReadingSetAttr(li, "data-bob-block-more", model.more);
        record.appliedMore = String(model.more);
      } else {
        this.blockMarkReadingRestoreOwned(
          li,
          "data-bob-block-more",
          "data-bob-block-more",
          record.appliedMore,
          record.originalMore,
        );
        record.appliedMore = null;
      }
      const tooltip = model && typeof model.tooltip === "string" ? model.tooltip : "";
      if (checkbox && tooltip) {
        this.blockMarkReadingSetAttr(checkbox, "aria-label", tooltip);
        this.blockMarkReadingSetAttr(checkbox, "data-tooltip-position", "top");
        record.appliedAria = tooltip;
        record.appliedPosition = "top";
      } else if (checkbox) {
        this.blockMarkReadingRestoreOwned(
          checkbox,
          "aria-label",
          "aria-label",
          record.appliedAria,
          record.originalAria,
        );
        this.blockMarkReadingRestoreOwned(
          checkbox,
          "data-tooltip-position",
          "data-tooltip-position",
          record.appliedPosition,
          record.originalPosition,
        );
        record.appliedAria = null;
        record.appliedPosition = null;
      }
    } catch (error) {
      // Applying a mark never throws.
    }
  }

  blockMarkReadingSourceIdentityOk(li, retained, origin, status) {
    try {
      if (!retained || retained.status !== status) return false;
      if ((retained.path || "") !== (origin && origin.path || "")) return false;
      if (origin && origin.query && !origin.proven) return false;
      const retainedLine = retained.dataLine === undefined ? null : retained.dataLine;
      if (retainedLine !== null) {
        const currentLine = this.blockMarkReadingAttr(li, "data-line");
        if (String(retainedLine) !== String(currentLine)) return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  blockMarkReadingClassifyRow(li, el, ctx) {
    try {
      if (!li) return;
      if (this.blockMarkReadingRowSkipped(li, el)) {
        this.blockMarkReadingInvalidate(li);
        this.blockMarkReadingClearRow(li);
        return;
      }
      const status = this.blockMarkReadingAttr(li, "data-task");
      if (status !== "?") {
        this.blockMarkReadingInvalidate(li);
        this.blockMarkReadingClearRow(li);
        return;
      }
      const origin = this.blockMarkReadingOrigin(li, el, ctx);
      if (origin.query && !origin.proven) {
        this.blockMarkReadingInvalidate(li);
        this.blockMarkReadingClearRow(li);
        return;
      }
      const retained = this.blockMarkReadingSourceFor(li);
      if (retained && !this.blockMarkReadingSourceIdentityOk(li, retained, origin, status)) {
        this.blockMarkReadingInvalidate(li);
      }
      let lineText = null;
      let kind = null;
      let mappedFailed = false;
      if (!origin.query) {
        const info = this.blockMarkReadingSectionInfo(el, ctx);
        const text = this.blockMarkReadingSourceText(info);
        if (typeof text === "string") {
          const mapped = this.blockMarkReadingResolveSectionLine(
            li,
            el,
            info,
            this.blockMarkReadingSplitLines(text),
          );
          if (typeof mapped === "string") {
            lineText = mapped;
            kind = "section";
          } else {
            mappedFailed = true;
          }
        }
      }
      if (!lineText && !mappedFailed) {
        const fallback = this.blockMarkReadingFallbackLine(li);
        if (typeof fallback === "string") {
          lineText = fallback;
          kind = "fallback";
        }
      }
      if (!lineText && origin.query && origin.proven) {
        const queryLine = this.blockMarkReadingQueryCanonicalLine(li, origin);
        if (typeof queryLine === "string" && queryLine) {
          lineText = queryLine;
          kind = "query";
        }
      }
      if (!lineText && !mappedFailed) {
        const kept = this.blockMarkReadingSourceFor(li);
        if (
          kept &&
          this.blockMarkReadingSourceIdentityOk(li, kept, origin, status) &&
          typeof kept.lineText === "string" &&
          kept.lineText &&
          this.blockMarkReadingTransformed(li)
        ) {
          lineText = kept.lineText;
          kind = kept.kind || "retained";
        }
      }
      if (typeof lineText === "string" && lineText) {
        this.blockMarkReadingRetain(li, {
          path: origin.path || "",
          lineText,
          status,
          kind,
          dataLine: this.blockMarkReadingAttr(li, "data-line"),
        });
      } else {
        this.blockMarkReadingInvalidate(li);
      }
      if (this.blockMarksEnabled === false) {
        this.blockMarkReadingClearRow(li);
        return;
      }
      if (!lineText) {
        this.blockMarkReadingClearRow(li);
        return;
      }
      let model = null;
      try {
        model = this.blockMarkModelForLine(origin.path || "", lineText);
      } catch (error) {
        model = null;
      }
      if (model && model.key === "stale" && kind === "fallback") {
        model = null;
      }
      this.blockMarkReadingApplyRow(li, model);
    } catch (error) {
      // One bad row never breaks the processor.
    }
  }

  blockMarkReadingHostKey(el) {
    try {
      return el || null;
    } catch (error) {
      return null;
    }
  }

  blockMarkReadingFindHost(el) {
    try {
      if (!(this.blockMarkReadingHosts instanceof Set)) return null;
      for (const rec of this.blockMarkReadingHosts) {
        if (rec && rec.el === el) return rec;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  blockMarkReadingObserveHost(rec) {
    try {
      if (!rec || !rec.el || rec.observer) return;
      let Observer = null;
      try {
        Observer = this.blockMarksMutationObserver ||
          (typeof MutationObserver !== "undefined" ? MutationObserver : null);
      } catch (error) {
        Observer = null;
      }
      if (!Observer) return;
      const plugin = this;
      rec.observer = new Observer(() => {
        try {
          if (rec.mutating) return;
          if (typeof plugin.scheduleBlockMarksRefresh === "function") {
            plugin.scheduleBlockMarksRefresh();
          }
        } catch (error) {
          // Observer callbacks never throw.
        }
      });
      rec.observer.observe(rec.el, { childList: true, subtree: true });
    } catch (error) {
      rec.observer = null;
    }
  }

  blockMarkReadingDisposeHost(rec, clearRows) {
    try {
      if (!rec) return;
      try {
        if (rec.observer && typeof rec.observer.disconnect === "function") {
          rec.observer.disconnect();
        }
      } catch (error) {
        // Observer teardown is best-effort.
      }
      rec.observer = null;
      if (clearRows && rec.el) {
        const rows = this.blockMarkReadingCandidateRows(rec.el);
        for (const li of rows) {
          try {
            this.blockMarkReadingClearRow(li);
            this.blockMarkReadingInvalidate(li);
          } catch (error) {
            continue;
          }
        }
      }
      if (this.blockMarkReadingHosts instanceof Set) {
        this.blockMarkReadingHosts.delete(rec);
      }
    } catch (error) {
      // Host disposal never throws.
    }
  }

  blockMarkReadingTrackHost(el, ctx) {
    try {
      this.blockMarkReadingEnsureState();
      if (!el) return null;
      let rec = this.blockMarkReadingFindHost(el);
      if (rec) {
        rec.ctx = ctx || rec.ctx;
        this.blockMarkReadingObserveHost(rec);
        return rec;
      }
      rec = { el, ctx: ctx || null, observer: null, mutating: false };
      this.blockMarkReadingHosts.add(rec);
      this.blockMarkReadingObserveHost(rec);
      return rec;
    } catch (error) {
      return null;
    }
  }

  renderBlockMarksIn(el, ctx, skipQuerySchedule) {
    try {
      if (!el) return;
      const rec = this.blockMarkReadingTrackHost(el, ctx);
      const mutating = rec ? rec.mutating : false;
      if (rec) rec.mutating = true;
      try {
        const rows = this.blockMarkReadingCandidateRows(el);
        for (const li of rows) {
          this.blockMarkReadingClassifyRow(li, el, ctx);
        }
      } finally {
        if (rec) rec.mutating = mutating;
      }
      if (!skipQuerySchedule) this.scheduleBlockMarkReadingQueryRows(el, ctx);
    } catch (error) {
      // The post-processor is synchronous and never throws.
    }
  }

  blockMarkReadingRequestFrame(callback) {
    try {
      if (typeof callback !== "function") return;
      if (typeof this.blockMarkReadingFrame === "function") {
        this.blockMarkReadingFrame(callback);
        return;
      }
      const scope = typeof window !== "undefined" && window
        ? window
        : typeof globalThis !== "undefined" ? globalThis : null;
      if (scope && typeof scope.requestAnimationFrame === "function") {
        scope.requestAnimationFrame(callback);
      } else {
        setTimeout(callback, 16);
      }
    } catch (error) {
      // A missed query-row frame leaves the host unmarked.
    }
  }

  scheduleBlockMarkReadingQueryRows(el, ctx) {
    try {
      if (!el || typeof el !== "object") return;
      const query = this.blockMarkReadingIsQuery(null, el) ||
        this.blockMarkReadingIsQuery(el, el);
      let detached = false;
      try {
        detached = el.isConnected === false;
      } catch (error) {
        detached = false;
      }
      if (!query && !detached) return;
      if (!Array.isArray(this.blockMarkReadingQueue)) this.blockMarkReadingQueue = [];
      this.blockMarkReadingQueue.push({ el, ctx: ctx || null, frames: 0, waits: 0 });
      if (this.blockMarkReadingPending) return;
      this.blockMarkReadingPending = true;
      this.blockMarkReadingRequestFrame(() => this.runBlockMarkReadingQueryRows());
    } catch (error) {
      // Query-row retries are best-effort.
    }
  }

  cancelBlockMarkReadingQueryRows() {
    try {
      this.blockMarkReadingQueue = [];
      this.blockMarkReadingPending = false;
    } catch (error) {
      // Queue cleanup is best-effort.
    }
  }

  runBlockMarkReadingQueryRows() {
    try {
      this.blockMarkReadingPending = false;
      if (this.blockMarksEnabled === false) {
        this.cancelBlockMarkReadingQueryRows();
        return;
      }
      const queued = Array.isArray(this.blockMarkReadingQueue)
        ? this.blockMarkReadingQueue
        : [];
      this.blockMarkReadingQueue = [];
      let again = false;
      const done = new Set();
      for (const entry of queued) {
        try {
          if (!entry || !entry.el) continue;
          const rows = this.blockMarkReadingCandidateRows(entry.el);
          if (!rows.length) {
            const frames = (entry.frames || 0) + 1;
            if (frames <= BLOCK_MARK_READING_DETACHED_RETRIES) {
              this.blockMarkReadingQueue.push({ ...entry, frames });
              again = true;
            }
            continue;
          }
          for (const row of rows) {
            if (done.has(row)) continue;
            const marker = this.blockMarkReadingAttr(row, "data-task");
            if (marker === null || marker === undefined) {
              const waits = (entry.waits || 0) + 1;
              if (waits <= BLOCK_MARK_READING_PENDING_RETRIES) {
                this.blockMarkReadingQueue.push({ ...entry, waits });
                again = true;
              }
              continue;
            }
            done.add(row);
          }
          this.renderBlockMarksIn(entry.el, entry.ctx, true);
        } catch (error) {
          continue;
        }
      }
      if (again && this.blockMarkReadingQueue.length) {
        this.blockMarkReadingPending = true;
        this.blockMarkReadingRequestFrame(() => this.runBlockMarkReadingQueryRows());
      }
    } catch (error) {
      // A failed query frame never affects ordinary Reading rows.
    }
  }

  sweepBlockMarksReading() {
    try {
      this.blockMarkReadingEnsureState();
      const hosts = this.blockMarkReadingHosts instanceof Set
        ? Array.from(this.blockMarkReadingHosts)
        : [];
      for (const rec of hosts) {
        try {
          if (!rec || !rec.el) {
            this.blockMarkReadingDisposeHost(rec, false);
            continue;
          }
          if (this.blockMarkReadingIsConnected(rec.el) === false) {
            this.blockMarkReadingDisposeHost(rec, true);
            continue;
          }
          this.renderBlockMarksIn(rec.el, rec.ctx, true);
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // The rendered-host sweep is best-effort.
    }
  }
}
