// Snoozed row paint in Reading view (snoozed-row-paint phase).
// Exact source mapping or neutral; never title-matches, never
// writes. Split from `278a-plugin-snooze-row-paint.js` to keep each
// fragment at or below 1000 lines. Contract: bob-cli
// `docs/snooze-marks.md`.

class BobLedgerToolsSnoozeRowPaintReadingMixin {
  setupSnoozeRowPaintReading() {
    try {
      if (!(this.snoozeRowPaintReadingViews instanceof Map)) {
        try {
          this.snoozeRowPaintReadingViews = new Map();
        } catch (error) {
          this.snoozeRowPaintReadingViews = null;
        }
      }
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor(
          (el, ctx) => this.renderSnoozeRowPaintIn(el, ctx),
          58,
        );
      }
    } catch (error) {
      // Reading-view wiring never blocks plugin startup.
    }
  }

  snoozeRowPaintReadingTag(node) {
    try {
      return String(
        (node && (node.tagName || node.nodeName)) || "",
      ).toUpperCase();
    } catch (error) {
      return "";
    }
  }

  snoozeRowPaintReadingHasClass(node, name) {
    try {
      if (!node || !name) {
        return false;
      }
      if (
        node.classList &&
        typeof node.classList.contains === "function"
      ) {
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

  renderSnoozeRowPaintIn(el, ctx) {
    try {
      if (!el || !ctx) {
        return;
      }
      if (!(this.snoozeRowPaintReadingViews instanceof Map)) {
        try {
          this.snoozeRowPaintReadingViews = new Map();
        } catch (error) {
          return;
        }
      }
      const sourcePath =
        ctx && typeof ctx.sourcePath === "string"
          ? ctx.sourcePath
          : "";
      const record = { el, ctx, sourcePath };
      this.snoozeRowPaintReadingViews.set(el, record);
      this.sweepSnoozeRowPaintReadingView(record);
      try {
        if (typeof this.scheduleSnoozeMarksRefresh === "function") {
          this.scheduleSnoozeMarksRefresh();
        }
      } catch (error) {
        // A follow-up sweep covers late source fills.
      }
      if (typeof ctx.addChild === "function") {
        let child = null;
        try {
          if (typeof MarkdownRenderChild === "function") {
            child = new MarkdownRenderChild(el);
            const views = this.snoozeRowPaintReadingViews;
            child.onunload = () => {
              if (views) {
                views.delete(el);
              }
            };
          }
        } catch (error) {
          child = null;
        }
        if (!child) {
          const views = this.snoozeRowPaintReadingViews;
          child = {
            unload: () => {
              if (views) {
                views.delete(el);
              }
            },
          };
        }
        try {
          ctx.addChild(child);
        } catch (error) {
          // Older hosts may reject processor children.
        }
      }
    } catch (error) {
      // Reading-view marks never throw.
    }
  }

  snoozeRowPaintPreviewRecords() {
    const records = [];
    try {
      const workspace = this.app && this.app.workspace;
      if (
        !workspace ||
        typeof workspace.getLeavesOfType !== "function"
      ) {
        return records;
      }
      const leaves = workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) {
        try {
          const view = leaf && leaf.view ? leaf.view : null;
          const sourcePath =
            view && view.file && typeof view.file.path === "string"
              ? view.file.path
              : "";
          if (!sourcePath) {
            continue;
          }
          const container =
            (view.previewMode && view.previewMode.containerEl) ||
            view.contentEl ||
            view.containerEl ||
            null;
          if (
            !container ||
            typeof container.querySelector !== "function"
          ) {
            continue;
          }
          const root =
            container.querySelector(
              ".markdown-preview-view, .markdown-reading-view",
            ) || container;
          if (root) {
            records.push({
              el: root,
              ctx: { sourcePath },
              sourcePath,
            });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      return records;
    }
    return records;
  }

  refreshSnoozeRowPaintReadingViews() {
    let refreshed = false;
    try {
      if (this.snoozeRowPaintReadingViews instanceof Map) {
        for (const [el, record] of Array.from(
          this.snoozeRowPaintReadingViews.entries(),
        )) {
          try {
            if (!el) {
              this.snoozeRowPaintReadingViews.delete(el);
              continue;
            }
            this.sweepSnoozeRowPaintReadingView(record);
            refreshed = true;
          } catch (error) {
            continue;
          }
        }
      }
      for (const record of this.snoozeRowPaintPreviewRecords()) {
        try {
          this.sweepSnoozeRowPaintReadingView(record);
          refreshed = true;
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Best-effort.
    }
    return refreshed;
  }

  snoozeRowPaintReadingLines(record) {
    try {
      const sourcePath = String(
        (record && record.sourcePath) || "",
      );
      if (!sourcePath) {
        return null;
      }
      const ctx = record && record.ctx;
      try {
        if (
          ctx &&
          typeof ctx.getSectionInfo === "function" &&
          record.el
        ) {
          const info = ctx.getSectionInfo(record.el);
          if (
            info &&
            typeof info.text === "string" &&
            info.text !== ""
          ) {
            const lines = info.text
              .replace(/\r\n/g, "\n")
              .split("\n");
            if (snoozeParseSection(info.text)) {
              return lines;
            }
          }
        }
      } catch (error) {
        // Fall through to the source-text cache.
      }
      try {
        if (typeof this.taskThemeSourceTextFor === "function") {
          const text = this.taskThemeSourceTextFor(sourcePath);
          if (typeof text === "string" && text !== "") {
            if (snoozeParseSection(text)) {
              return text.replace(/\r\n/g, "\n").split("\n");
            }
          }
        }
      } catch (error) {
        // Fall through to the fill request.
      }
      try {
        if (
          typeof this.taskThemeRequestSourceText === "function"
        ) {
          this.taskThemeRequestSourceText(sourcePath);
        }
      } catch (error) {
        // Best-effort.
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  snoozeRowPaintOwnedChips(li) {
    try {
      if (!li || typeof li.querySelectorAll !== "function") {
        return [];
      }
      const found = li.querySelectorAll(
        ".bob-snooze-row-chip, .bob-snooze-heading-chip",
      );
      const out = [];
      for (const node of found || []) {
        try {
          let owner = node;
          let guard = 0;
          while (owner && guard++ < 50) {
            const tag = String(
              (owner && (owner.tagName || owner.nodeName)) || "",
            ).toUpperCase();
            if (tag === "LI" || tag === "H2") {
              break;
            }
            owner = owner.parentNode || null;
          }
          if (owner === li) {
            out.push(node);
          }
        } catch (error) {
          continue;
        }
      }
      return out;
    } catch (error) {
      return [];
    }
  }

  snoozeRowPaintRemoveNode(node) {
    try {
      if (
        node &&
        node.parentNode &&
        typeof node.parentNode.removeChild === "function"
      ) {
        node.parentNode.removeChild(node);
      }
    } catch (error) {
      // Best-effort.
    }
  }

  // Compact `HHMM` into presentation `HH:MM`; defined on the Live
  // Preview twin (278a) and shared here through the plugin scope.
  snoozeRowPaintApplyRowClass(li, paint) {
    try {
      if (!li) {
        return;
      }
      const names = [
        "bob-snooze-row",
        "bob-snooze-row--asleep",
        "bob-snooze-row--due",
        "bob-snooze-row--blocked",
        "bob-snooze-row--history",
        "bob-snooze-row--ignored",
        "bob-snooze-row--historical",
      ];
      if (li.classList && typeof li.classList.remove === "function") {
        for (const name of names) {
          try {
            li.classList.remove(name);
          } catch (error) {
            // Best-effort.
          }
        }
        if (paint && paint !== "none") {
          try {
            li.classList.add("bob-snooze-row");
            li.classList.add("bob-snooze-row--" + paint);
          } catch (error) {
            // Best-effort.
          }
        }
        return;
      }
      const current =
        typeof li.getAttribute === "function"
          ? li.getAttribute("class") || ""
          : typeof li.className === "string"
            ? li.className
            : "";
      const kept = String(current)
        .split(/\s+/)
        .filter((part) => part && names.indexOf(part) === -1);
      if (paint && paint !== "none") {
        kept.push("bob-snooze-row");
        kept.push("bob-snooze-row--" + paint);
      }
      const next = kept.join(" ").trim();
      if (typeof li.setAttribute === "function") {
        li.setAttribute("class", next);
      } else {
        li.className = next;
      }
    } catch (error) {
      // Class paint is best-effort.
    }
  }

  sweepSnoozeRowPaintReadingView(record) {
    try {
      const root = record && record.el;
      const sourcePath = String(
        (record && record.sourcePath) || "",
      );
      if (!root || !sourcePath) {
        return false;
      }
      // The postprocessor may hand us a single block wrapper instead of
      // the whole preview; scope stale cleanup and row discovery to the
      // enclosing preview view.
      let scope = root;
      try {
        const view =
          root && typeof root.closest === "function"
            ? root.closest(
                ".markdown-preview-view, .markdown-reading-view",
              )
            : null;
        if (view) {
          scope = view;
        }
      } catch (error) {
        // Fall back to the postprocessor container.
      }
      const staleChips =
        typeof scope.querySelectorAll === "function"
          ? Array.from(
              scope.querySelectorAll(
                ".bob-snooze-row-chip, .bob-snooze-heading-chip",
              ),
            )
          : [];
      const staleRows =
        typeof scope.querySelectorAll === "function"
          ? Array.from(scope.querySelectorAll("li.bob-snooze-row"))
          : [];
      if (
        !this.snoozeMarksEnabled ||
        !PLAN_DAILY_PATH_RE.test(sourcePath)
      ) {
        for (const node of staleChips) {
          this.snoozeRowPaintRemoveNode(node);
        }
        for (const li of staleRows) {
          this.snoozeRowPaintApplyRowClass(li, "none");
        }
        return true;
      }
      const lines = this.snoozeRowPaintReadingLines(record);
      if (!lines) {
        for (const node of staleChips) {
          this.snoozeRowPaintRemoveNode(node);
        }
        for (const li of staleRows) {
          this.snoozeRowPaintApplyRowClass(li, "none");
        }
        return true;
      }
      const text = lines.join("\n");
      const parsed = snoozeParseSection(text);
      if (!parsed || !Array.isArray(parsed.rows)) {
        for (const node of staleChips) {
          this.snoozeRowPaintRemoveNode(node);
        }
        for (const li of staleRows) {
          this.snoozeRowPaintApplyRowClass(li, "none");
        }
        return true;
      }
      if (
        Array.isArray(parsed.duplicateHeaders) &&
        parsed.duplicateHeaders.length > 0
      ) {
        for (const node of staleChips) {
          this.snoozeRowPaintRemoveNode(node);
        }
        for (const li of staleRows) {
          this.snoozeRowPaintApplyRowClass(li, "none");
        }
        return true;
      }
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
      const model =
        typeof this.snoozeRowPaintClassify === "function"
          ? this.snoozeRowPaintClassify(sourcePath, text, clock)
          : null;
      const doc =
        root.ownerDocument ||
        (typeof document !== "undefined" ? document : null);
      // Find the structural `## Snoozed` heading: the first H2 whose
      // text starts with `Snoozed`. Any second match means the same
      // duplicate-header uncertainty as the parser, so stay neutral.
      let headings = [];
      try {
        headings =
          typeof scope.querySelectorAll === "function"
            ? Array.from(scope.querySelectorAll("h2"))
            : [];
      } catch (error) {
        headings = [];
      }
      const snoozedHeadings = [];
      for (const heading of headings) {
        try {
          const label = String(
            (heading && heading.textContent) || "",
          ).trim();
          if (
            label === "Snoozed" ||
            label.startsWith("Snoozed \u00b7") ||
            label.startsWith("Snoozed ")
          ) {
            const raw = String(
              (heading && heading.textContent) || "",
            );
            void raw;
            snoozedHeadings.push(heading);
          } else {
            // Fall back to the data-heading attribute Obsidian sets.
            const data =
              heading && typeof heading.getAttribute === "function"
                ? heading.getAttribute("data-heading") || ""
                : "";
            if (
              String(data).trim() === "Snoozed" ||
              String(data).trim().startsWith("Snoozed")
            ) {
              snoozedHeadings.push(heading);
            }
          }
        } catch (error) {
          continue;
        }
      }
      if (snoozedHeadings.length !== 1) {
        for (const node of staleChips) {
          this.snoozeRowPaintRemoveNode(node);
        }
        for (const li of staleRows) {
          this.snoozeRowPaintApplyRowClass(li, "none");
        }
        return true;
      }
      const heading = snoozedHeadings[0];
      // Collect top-level list items under the heading until the next
      // H2: those positions mirror `parsed.rows` order, so the nth
      // item maps to the nth parsed row without title heuristics.
      // Reading views wrap blocks in container divs, so walk the scope
      // in document order from the heading; nested lists inside a row
      // stay with their row and never become items themselves.
      const items = [];
      try {
        const takeList = (list) => {
          const children = list.children || list.childNodes || [];
          for (const child of Array.from(children)) {
            try {
              if (
                this.snoozeRowPaintReadingTag(child) === "LI"
              ) {
                items.push(child);
              }
            } catch (error) {
              continue;
            }
          }
        };
        let started = false;
        let guard = 0;
        const walkOrder = (node, depth) => {
          if (!node || depth > 12 || guard++ > 2000) {
            return true;
          }
          const children = node.children || node.childNodes || [];
          for (const child of Array.from(children)) {
            if (!started) {
              if (child === heading) {
                started = true;
                continue;
              }
              if (
                child.contains &&
                typeof child.contains === "function" &&
                child.contains(heading)
              ) {
                if (walkOrder(child, depth + 1) === false) {
                  return false;
                }
                continue;
              }
              continue;
            }
            const tag = this.snoozeRowPaintReadingTag(child);
            if (tag === "H1" || tag === "H2") {
              return false;
            }
            if (tag === "UL" || tag === "OL") {
              takeList(child);
              continue;
            }
            if (tag === "LI") {
              continue;
            }
            if (child.children && child.children.length) {
              if (walkOrder(child, depth + 1) === false) {
                return false;
              }
            }
          }
          return true;
        };
        walkOrder(scope, 0);
      } catch (error) {
        // Item scan is best-effort.
      }
      // Heading summary first: remove the stale chip, then append
      // the current one exactly once (idempotent rerenders).
      try {
        for (const owned of this.snoozeRowPaintOwnedChips(heading)) {
          this.snoozeRowPaintRemoveNode(owned);
        }
        Array.from(
          heading.querySelectorAll
            ? heading.querySelectorAll(".bob-snooze-heading-chip")
            : [],
        ).forEach((node) => this.snoozeRowPaintRemoveNode(node));
      } catch (error) {
        // Best-effort.
      }
      if (model && !model.historical && model.classified && doc) {
        try {
          const summary =
            typeof this.snoozeRowPaintHeadingSummary === "function"
              ? this.snoozeRowPaintHeadingSummary(model.classified)
              : null;
          if (summary) {
            const chip = buildSnoozeHeadingChipElement(doc, summary);
            if (chip && typeof heading.appendChild === "function") {
              heading.appendChild(chip);
            }
          }
        } catch (error) {
          // Heading summary is best-effort.
        }
      }
      // Row paint by position: the nth rendered item carries the nth
      // parsed row's paint. A length mismatch or an uncertain mapping
      // stays neutral instead of guessing.
      const rows = parsed.rows.filter(
        (row) => row && !row.embedded,
      );
      if (model && model.historical) {
        for (let index = 0; index < items.length; index += 1) {
          try {
            const li = items[index];
            const row = rows[index] || null;
            for (const owned of this.snoozeRowPaintOwnedChips(li)) {
              this.snoozeRowPaintRemoveNode(owned);
            }
            if (!row || (row.kind !== "active" && row.kind !== "history")) {
              this.snoozeRowPaintApplyRowClass(li, "none");
              continue;
            }
            const presentation =
              row.kind === "history"
                ? snoozeRowPaintPresentation(
                    "woken",
                    null,
                    row.wokeHhmm,
                  )
                : snoozeRowPaintPresentation(
                    "previous_day",
                    this.snoozeRowPaintColonClock(row.hhmm),
                    null,
                  );
            this.snoozeRowPaintApplyRowClass(li, presentation.paint);
            if (
              doc &&
              (presentation.timePill || presentation.statusText) &&
              presentation.paint !== "none"
            ) {
              const chip = buildSnoozeRowChipElement(doc, {
                paint: presentation.paint,
                timePill: presentation.timePill,
                statusText: presentation.statusText,
              });
              if (chip && typeof li.appendChild === "function") {
                li.appendChild(chip);
              }
            }
          } catch (error) {
            continue;
          }
        }
        return true;
      }
      if (!model || !model.classified) {
        for (const li of items) {
          try {
            for (const owned of this.snoozeRowPaintOwnedChips(li)) {
              this.snoozeRowPaintRemoveNode(owned);
            }
            this.snoozeRowPaintApplyRowClass(li, "none");
          } catch (error) {
            continue;
          }
        }
        return true;
      }
      const byPosition = model.classified.rows || [];
      // `classified.rows` parallels `parsed.rows` for active rows
      // plus trailing history snapshots; align by source line.
      const stateByLine = new Map();
      for (const entry of byPosition) {
        try {
          if (entry && Number.isInteger(entry.line)) {
            stateByLine.set(entry.line, entry);
          }
        } catch (error) {
          continue;
        }
      }
      const nowMinutes = clock.getHours() * 60 + clock.getMinutes();
      for (let index = 0; index < items.length; index += 1) {
        try {
          const li = items[index];
          const row = rows[index] || null;
          for (const owned of this.snoozeRowPaintOwnedChips(li)) {
            this.snoozeRowPaintRemoveNode(owned);
          }
          if (!row || !Number.isInteger(row.line)) {
            this.snoozeRowPaintApplyRowClass(li, "none");
            continue;
          }
          const entry = stateByLine.get(row.line) || null;
          let state =
            entry && typeof entry.state === "string"
              ? entry.state
              : null;
          let hhmm = entry && entry.hhmm;
          // Classified rows omit history (provenance, never membership);
          // the parsed row that shares the line owns the wake label.
          let wokeAt = entry ? entry.wokeAt : null;
          if (
            !state &&
            row &&
            row.kind === "history" &&
            typeof row.wokeHhmm === "string"
          ) {
            state = "woken";
            hhmm = null;
            wokeAt = row.wokeHhmm;
          }
          if (!state) {
            this.snoozeRowPaintApplyRowClass(li, "none");
            continue;
          }
          const presentation = snoozeRowPaintPresentation(
            state,
            this.snoozeRowPaintColonClock(hhmm),
            wokeAt,
          );
          if (!presentation || presentation.paint === "none") {
            this.snoozeRowPaintApplyRowClass(li, "none");
            continue;
          }
          if (presentation.paint === "asleep") {
            const gap =
              Number.isInteger(entry.minutes) &&
              Number.isInteger(nowMinutes)
                ? Math.max(0, entry.minutes - nowMinutes)
                : 0;
            presentation.statusText =
              snoozeRowPaintCountdownText(gap);
          }
          this.snoozeRowPaintApplyRowClass(li, presentation.paint);
          if (
            doc &&
            (presentation.timePill || presentation.statusText)
          ) {
            const chip = buildSnoozeRowChipElement(doc, {
              paint: presentation.paint,
              timePill: presentation.timePill,
              statusText: presentation.statusText,
            });
            if (chip && typeof li.appendChild === "function") {
              li.appendChild(chip);
            }
          }
        } catch (error) {
          continue;
        }
      }
      // Remove chips left on rows that no longer render.
      for (const node of staleChips) {
        try {
          let owner = node.parentNode;
          let guard = 0;
          let inView = false;
          while (owner && guard++ < 50) {
            if (owner === root) {
              inView = true;
              break;
            }
            owner = owner.parentNode;
          }
          if (!inView) {
            this.snoozeRowPaintRemoveNode(node);
          }
        } catch (error) {
          continue;
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }
}
