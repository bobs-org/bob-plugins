// Snoozed row paint in Live Preview (snoozed-row-paint phase).
// The daily `## Snoozed` section is scanned once per build; each
// distinct link path resolves once and task facts are memoized within
// the build. Only the structural H2's own rows paint: notes beneath
// rows stay, Markdown is never rewritten, and a fenced, indented, or
// duplicate-header uncertainty never invents paint. The existing
// snooze refresh effect drives minute/cache/toggle updates. Contract:
// bob-cli `docs/snooze-marks.md`.

// Classifier state into row-paint presentation. `wokeHhmm` feeds
// history rows; `hhmm` feeds live and historical pills. Never throws.
function snoozeRowPaintPresentation(state, hhmm, wokeHhmm) {
  try {
    const time =
      typeof hhmm === "string" && /^\d{2}:\d{2}$/.test(hhmm)
        ? hhmm
        : null;
    const woke =
      typeof wokeHhmm === "string" && /^\d{2}:\d{2}$/.test(wokeHhmm)
        ? wokeHhmm
        : null;
    if (state === "asleep") {
      return { paint: "asleep", timePill: time, statusText: null, live: true };
    }
    if (state === "due") {
      return {
        paint: "due",
        timePill: time,
        statusText: "due \u00b7 waking",
        live: false,
      };
    }
    if (state === "blocked") {
      return {
        paint: "blocked",
        timePill: time,
        statusText: "waits on prerequisites",
        live: false,
      };
    }
    if (state === "woken") {
      return {
        paint: "history",
        timePill: null,
        statusText: woke ? "woke " + woke : null,
        live: false,
      };
    }
    if (state === "previous_day") {
      return {
        paint: "historical",
        timePill: time,
        statusText: null,
        live: false,
      };
    }
    if (state === "ready") {
      return {
        paint: "ignored",
        timePill: null,
        statusText: "Ready \u2014 won't wake",
        live: false,
      };
    }
    if (state === "missing") {
      return {
        paint: "ignored",
        timePill: null,
        statusText: "Missing \u2014 won't wake",
        live: false,
      };
    }
    if (state === "ambiguous") {
      return {
        paint: "ignored",
        timePill: null,
        statusText: "Ambiguous \u2014 won't wake",
        live: false,
      };
    }
    if (state === "done") {
      return {
        paint: "ignored",
        timePill: null,
        statusText: "Done \u2014 won't wake",
        live: false,
      };
    }
    if (state === "cancelled") {
      return {
        paint: "ignored",
        timePill: null,
        statusText: "Cancelled \u2014 won't wake",
        live: false,
      };
    }
    if (state === "already_linked") {
      return {
        paint: "ignored",
        timePill: null,
        statusText: "Already linked \u2014 won't wake",
        live: false,
      };
    }
    if (state === "event_task") {
      return {
        paint: "ignored",
        timePill: null,
        statusText: "Event \u2014 won't wake",
        live: false,
      };
    }
    if (state === "not_task") {
      return {
        paint: "ignored",
        timePill: null,
        statusText: "Not a task \u2014 won't wake",
        live: false,
      };
    }
    if (state === "duplicate") {
      return {
        paint: "ignored",
        timePill: null,
        statusText: "Duplicate \u2014 earliest wins",
        live: false,
      };
    }
    if (state === "malformed") {
      return {
        paint: "ignored",
        timePill: null,
        statusText: "Unrecognized row",
        live: false,
      };
    }
    return { paint: "none", timePill: null, statusText: null, live: false };
  } catch (error) {
    return { paint: "none", timePill: null, statusText: null, live: false };
  }
}

class BobLedgerToolsSnoozeRowPaintMixin {
  setupSnoozeRowPaint() {
    try {
      if (typeof this.snoozeRowPaintViews === "undefined") {
        this.snoozeRowPaintViews = null;
      }
      const extension = this.createSnoozeRowPaintExtension();
      if (
        extension &&
        typeof this.registerEditorExtension === "function"
      ) {
        this.registerEditorExtension(extension);
      }
      if (typeof this.setupSnoozeRowPaintReading === "function") {
        this.setupSnoozeRowPaintReading();
      }
      if (typeof this.register === "function") {
        this.register(() => {
          this.snoozeRowPaintViews = null;
        });
      }
    } catch (error) {
      // A failed decorative surface never blocks startup.
    }
  }

  snoozeRowPaintAvailable() {
    try {
      return Boolean(
        ViewPlugin &&
          Decoration &&
          WidgetType &&
          RangeSetBuilder &&
          editorInfoField &&
          editorLivePreviewField &&
          ensureSnoozeMarksRefresh(),
      );
    } catch (error) {
      return false;
    }
  }

  createSnoozeRowPaintExtension() {
    try {
      if (
        !this.snoozeRowPaintAvailable() ||
        !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" ||
        !Prec ||
        typeof Prec.highest !== "function"
      ) {
        return null;
      }
      const plugin = this;
      const RowPaintPluginClass = class {
        constructor(view) {
          try {
            if (plugin.snoozeRowPaintViews instanceof Set) {
              plugin.snoozeRowPaintViews.add(view);
            }
          } catch (error) {
            // View tracking is best-effort.
          }
          try {
            this.decorations =
              plugin.buildSnoozeRowPaintDecorations(view);
          } catch (error) {
            this.decorations = Decoration.none;
          }
        }

        update(update) {
          try {
            if (plugin.snoozeRowPaintShouldRebuild(update)) {
              this.decorations =
                plugin.buildSnoozeRowPaintDecorations(update.view);
            }
          } catch (error) {
            // Keep the last valid decoration set.
          }
        }

        destroy() {
          try {
            if (
              plugin.snoozeRowPaintViews instanceof Set &&
              this.view
            ) {
              plugin.snoozeRowPaintViews.delete(this.view);
            }
          } catch (error) {
            // Teardown is best-effort.
          }
          try {
            if (plugin.snoozeRowPaintViews instanceof Set) {
              for (const view of Array.from(
                plugin.snoozeRowPaintViews,
              )) {
                try {
                  if (!view || view === update?.view) {
                    continue;
                  }
                } catch (error) {
                  continue;
                }
              }
            }
          } catch (error) {
            // Best-effort.
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(RowPaintPluginClass, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  snoozeRowPaintShouldRebuild(update) {
    try {
      if (!update || typeof update !== "object") {
        return false;
      }
      if (update.docChanged || update.viewportChanged) {
        return true;
      }
      const refresh = ensureSnoozeMarksRefresh();
      const transactions = update.transactions || [];
      for (const transaction of transactions) {
        const effects =
          transaction && transaction.effects !== undefined
            ? transaction.effects
            : null;
        const list = Array.isArray(effects)
          ? effects
          : effects
            ? [effects]
            : [];
        for (const effect of list) {
          if (
            effect === refresh ||
            (refresh &&
              effect &&
              typeof effect.is === "function" &&
              effect.is(refresh))
          ) {
            return true;
          }
        }
      }
      if (editorLivePreviewField && update.startState && update.state) {
        try {
          if (
            update.startState.field(editorLivePreviewField) !==
            update.state.field(editorLivePreviewField)
          ) {
            return true;
          }
        } catch (error) {
          // Field comparison is best-effort.
        }
      }
      if (editorInfoField && update.startState && update.state) {
        try {
          const before = update.startState.field(editorInfoField);
          const after = update.state.field(editorInfoField);
          const beforePath =
            before && before.file ? before.file.path : null;
          const afterPath =
            after && after.file ? after.file.path : null;
          if (beforePath !== afterPath) {
            return true;
          }
        } catch (error) {
          // Field comparison is best-effort.
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // Classify the current daily-note document for row paint. Returns
  // `{ parsed, classified, noteDate, today, historical }` or null
  // when paint must stay neutral (no section, duplicate headers,
  // toggle off, non-daily path). Never throws.
  snoozeRowPaintClassify(sourcePath, text, clock) {
    try {
      if (
        typeof sourcePath !== "string" ||
        !sourcePath ||
        !PLAN_DAILY_PATH_RE.test(sourcePath)
      ) {
        return null;
      }
      if (!this.snoozeMarksEnabled) {
        return null;
      }
      const content = typeof text === "string" ? text : "";
      if (!content) {
        return null;
      }
      const parsed = snoozeParseSection(content);
      if (!parsed || !Array.isArray(parsed.rows)) {
        return null;
      }
      if (
        Array.isArray(parsed.duplicateHeaders) &&
        parsed.duplicateHeaders.length > 0
      ) {
        return null;
      }
      const moment = clock instanceof Date ? clock : new Date();
      let today = "";
      try {
        today = formatLocalDate(moment);
      } catch (error) {
        today = "";
      }
      let noteDate = "";
      try {
        noteDate = snoozedNoteDateFromDailyPath(sourcePath) || "";
      } catch (error) {
        noteDate = "";
      }
      const historical =
        Boolean(noteDate) &&
        Boolean(today) &&
        /^\d{4}-\d{2}-\d{2}$/.test(noteDate) &&
        /^\d{4}-\d{2}-\d{2}$/.test(today) &&
        noteDate !== today;
      if (historical) {
        return { parsed, classified: null, noteDate, today, historical };
      }
      let tasks = [];
      try {
        const found =
          typeof planBlockTasks === "function"
            ? planBlockTasks(this.app)
            : [];
        tasks = Array.isArray(found) ? found : [];
      } catch (error) {
        tasks = [];
      }
      let todayKeySet = new Set();
      try {
        const rank =
          this.todayCache && this.todayCache.rank instanceof Map
            ? this.todayCache.rank
            : null;
        todayKeySet = new Set(
          rank ? Array.from(rank.keys()) : [],
        );
      } catch (error) {
        todayKeySet = new Set();
      }
      let built = null;
      try {
        built = snoozedBuildClassifyInput({
          content,
          dailyPath: sourcePath,
          tasks,
          resolve: (target, daily) =>
            this.resolveTodayLink(target, daily),
          todayKeySet,
          clock: moment,
          zone: snoozedLocalZoneName(),
          metadataCache: this.app && this.app.metadataCache,
          vault: this.app && this.app.vault,
        });
      } catch (error) {
        built = null;
      }
      if (!built || !built.classifierInput) {
        return null;
      }
      let classified = null;
      try {
        classified = snoozeModel.classifyRows(built.classifierInput);
      } catch (error) {
        classified = null;
      }
      if (!classified || !Array.isArray(classified.rows)) {
        return null;
      }
      return {
        parsed,
        classified,
        meta: built.meta,
        noteDate,
        today,
        historical,
      };
    } catch (error) {
      return null;
    }
  }

  // Heading summary for today's note from classified winner rows:
  // `2 asleep · next 19:00`, distinct due/blocked counts, no `next`
  // for blocked-only, null for history/ignored-only. Never throws.
  snoozeRowPaintHeadingSummary(classified) {
    try {
      if (!classified || !Array.isArray(classified.rows)) {
        return null;
      }
      let asleep = 0;
      let due = 0;
      let blocked = 0;
      let nextMinutes = null;
      for (const row of classified.rows) {
        try {
          if (!row || typeof row !== "object") {
            continue;
          }
          const state =
            typeof row.state === "string" ? row.state : "";
          if (
            state !== "asleep" &&
            state !== "due" &&
            state !== "blocked"
          ) {
            continue;
          }
          if (state === "asleep") {
            asleep += 1;
          } else if (state === "due") {
            due += 1;
          } else {
            blocked += 1;
          }
          if (state === "blocked") {
            continue;
          }
          const minutes = Number.isInteger(row.minutes)
            ? row.minutes
            : null;
          if (minutes === null) {
            continue;
          }
          if (nextMinutes === null || minutes < nextMinutes) {
            nextMinutes = minutes;
          }
        } catch (error) {
          continue;
        }
      }
      if (asleep <= 0 && due <= 0 && blocked <= 0) {
        return null;
      }
      const parts = [];
      if (asleep > 0) {
        parts.push(asleep + " asleep");
      }
      if (due > 0) {
        parts.push(due + " due");
      }
      if (blocked > 0) {
        parts.push(blocked + " blocked");
      }
      if (nextMinutes !== null) {
        const label =
          String(Math.floor(nextMinutes / 60)).padStart(2, "0") +
          ":" +
          String(nextMinutes % 60).padStart(2, "0");
        parts.push("next " + label);
      }
      return parts.join(" \u00b7 ");
    } catch (error) {
      return null;
    }
  }

  buildSnoozeRowPaintDecorations(view) {
    try {
      if (
        !this.snoozeMarksEnabled ||
        !Decoration ||
        !RangeSetBuilder ||
        !view ||
        !view.state
      ) {
        return Decoration.none;
      }
      let livePreview = false;
      try {
        livePreview = Boolean(
          view.state.field(editorLivePreviewField),
        );
      } catch (error) {
        livePreview = false;
      }
      if (!livePreview) {
        return Decoration.none;
      }
      let sourcePath = "";
      try {
        const info = view.state.field(editorInfoField);
        sourcePath =
          info && info.file && typeof info.file.path === "string"
            ? info.file.path
            : "";
      } catch (error) {
        sourcePath = "";
      }
      if (!sourcePath || !PLAN_DAILY_PATH_RE.test(sourcePath)) {
        return Decoration.none;
      }
      const doc = view.state.doc;
      if (!doc || typeof doc.toString !== "function") {
        return Decoration.none;
      }
      const text = doc.toString().replace(/\r\n/g, "\n");
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
      const model = this.snoozeRowPaintClassify(
        sourcePath,
        text,
        clock,
      );
      if (!model || !model.parsed) {
        return Decoration.none;
      }
      const builder = new RangeSetBuilder();
      const ranges = Array.isArray(view.visibleRanges)
        ? view.visibleRanges
        : [];
      const inRange = (pos) => {
        if (!ranges.length) {
          return true;
        }
        for (const range of ranges) {
          try {
            if (
              pos >= range.from &&
              pos <= range.to
            ) {
              return true;
            }
          } catch (error) {
            continue;
          }
        }
        return false;
      };
      // Historical notes: quiet time pills, no countdown, no
      // heading summary. Map parser rows directly.
      if (model.historical) {
        for (const row of model.parsed.rows) {
          try {
            if (!row || row.embedded) {
              continue;
            }
            if (row.kind !== "active" && row.kind !== "history") {
              continue;
            }
            const lineNumber = Number.isInteger(row.line)
              ? row.line
              : null;
            if (!lineNumber || lineNumber < 1) {
              continue;
            }
            let line = null;
            try {
              line = doc.line(lineNumber);
            } catch (error) {
              line = null;
            }
            if (!line) {
              continue;
            }
            if (!inRange(line.from)) {
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
                    row.hhmm,
                    null,
                  );
            if (
              !presentation ||
              presentation.paint === "none"
            ) {
              continue;
            }
            try {
              builder.add(
                line.from,
                line.from,
                Decoration.line({
                  class:
                    "bob-snooze-row bob-snooze-row--" +
                    presentation.paint,
                }),
              );
            } catch (error) {
              // Line paint is best-effort.
            }
            if (
              presentation.timePill ||
              presentation.statusText
            ) {
              try {
                const chip = buildSnoozeRowChipElement(
                  typeof document !== "undefined"
                    ? document
                    : null,
                  {
                    paint: presentation.paint,
                    timePill: presentation.timePill,
                    statusText: presentation.statusText,
                  },
                );
                if (chip && typeof WidgetType === "function") {
                  const widget = new (class extends WidgetType {
                    eq(other) {
                      return Boolean(
                        other &&
                          other.key === this.key,
                      );
                    }
                    toDOM() {
                      return chip;
                    }
                  })();
                  widget.key = [
                    presentation.paint,
                    presentation.timePill,
                    presentation.statusText,
                    lineNumber,
                  ].join("|");
                  builder.add(
                    line.to,
                    line.to,
                    Decoration.widget({
                      widget,
                      side: 1,
                    }),
                  );
                }
              } catch (error) {
                // Chip paint is best-effort.
              }
            }
          } catch (error) {
            continue;
          }
        }
        return builder.finish();
      }
      // Live today note: paint from classifier winner states.
      const byLine = new Map();
      for (const row of model.classified.rows) {
        try {
          if (!row || !Number.isInteger(row.line)) {
            continue;
          }
          byLine.set(row.line, row);
        } catch (error) {
          continue;
        }
      }
      const nowMinutes =
        clock.getHours() * 60 + clock.getMinutes();
      for (const [lineNumber, row] of byLine.entries()) {
        try {
          let line = null;
          try {
            line = doc.line(lineNumber);
          } catch (error) {
            line = null;
          }
          if (!line) {
            continue;
          }
          if (!inRange(line.from)) {
            continue;
          }
          const presentation = snoozeRowPaintPresentation(
            row.state,
            row.hhmm,
            row.wokeAt,
          );
          if (!presentation || presentation.paint === "none") {
            continue;
          }
          // Countdown words for asleep rows tick on the minute.
          if (presentation.paint === "asleep") {
            const gap =
              Number.isInteger(row.minutes) && Number.isInteger(nowMinutes)
                ? Math.max(0, row.minutes - nowMinutes)
                : 0;
            presentation.statusText =
              snoozeRowPaintCountdownText(gap);
            presentation.live = true;
          }
          try {
            builder.add(
              line.from,
              line.from,
              Decoration.line({
                class:
                  "bob-snooze-row bob-snooze-row--" +
                  presentation.paint,
              }),
            );
          } catch (error) {
            // Line paint is best-effort.
          }
          if (presentation.timePill || presentation.statusText) {
            try {
              const chip = buildSnoozeRowChipElement(
                typeof document !== "undefined" ? document : null,
                {
                  paint: presentation.paint,
                  timePill: presentation.timePill,
                  statusText: presentation.statusText,
                },
              );
              if (chip && typeof WidgetType === "function") {
                const key = [
                  presentation.paint,
                  presentation.timePill,
                  presentation.statusText,
                  lineNumber,
                ].join("|");
                const widget = new (class extends WidgetType {
                  constructor() {
                    super();
                    this.key = key;
                  }
                  eq(other) {
                    return Boolean(
                      other && other.key === this.key,
                    );
                  }
                  toDOM() {
                    return chip;
                  }
                })();
                builder.add(
                  line.to,
                  line.to,
                  Decoration.widget({ widget, side: 1 }),
                );
              }
            } catch (error) {
              // Chip paint is best-effort.
            }
          }
        } catch (error) {
          continue;
        }
      }
      // Heading summary chip after the `## Snoozed` header line.
      try {
        const summary = this.snoozeRowPaintHeadingSummary(
          model.classified,
        );
        if (summary) {
          const headerNumber = Number.isInteger(
            model.parsed.headerNumber,
          )
            ? model.parsed.headerNumber
            : null;
          if (headerNumber && headerNumber >= 1) {
            let headerLine = null;
            try {
              headerLine = doc.line(headerNumber);
            } catch (error) {
              headerLine = null;
            }
            if (headerLine && inRange(headerLine.from)) {
              const chip = buildSnoozeHeadingChipElement(
                typeof document !== "undefined" ? document : null,
                summary,
              );
              if (chip && typeof WidgetType === "function") {
                const key = "heading|" + summary;
                const widget = new (class extends WidgetType {
                  constructor() {
                    super();
                    this.key = key;
                  }
                  eq(other) {
                    return Boolean(other && other.key === this.key);
                  }
                  toDOM() {
                    return chip;
                  }
                })();
                builder.add(
                  headerLine.to,
                  headerLine.to,
                  Decoration.widget({ widget, side: 1 }),
                );
              }
            }
          }
        }
      } catch (error) {
        // Heading summary is best-effort.
      }
      return builder.finish();
    } catch (error) {
      try {
        return Decoration.none;
      } catch (inner) {
        return null;
      }
    }
  }

  refreshSnoozeRowPaintEditors() {
    try {
      const refresh = ensureSnoozeMarksRefresh();
      const workspace = this.app && this.app.workspace;
      if (
        !refresh ||
        !workspace ||
        typeof workspace.getLeavesOfType !== "function"
      ) {
        return;
      }
      let leaves = [];
      try {
        leaves = workspace.getLeavesOfType("markdown") || [];
      } catch (error) {
        leaves = [];
      }
      for (const leaf of leaves) {
        try {
          const leafPath =
            leaf && leaf.view && leaf.view.file &&
            typeof leaf.view.file.path === "string"
              ? leaf.view.file.path
              : "";
          if (!leafPath || !PLAN_DAILY_PATH_RE.test(leafPath)) {
            continue;
          }
          const cm =
            leaf && leaf.view && leaf.view.editor
              ? leaf.view.editor.cm
              : null;
          if (cm && typeof cm.dispatch === "function") {
            cm.dispatch({ effects: refresh.of(null) });
          }
        } catch (error) {
          continue;
        }
      }
    } catch (error) {
      // Editor refresh is best-effort.
    }
  }
}
