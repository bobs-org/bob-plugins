// Snooze definition clocks in Live Preview (definition-marks phase).
// The snoozed cache is the sole membership source: this mixin only
// decorates exact task lines in Live Preview and opens today's daily
// note for an explicit click or command. It shares the Today slot,
// so a live ledger link always wins and the clock never renders
// beside a tomato. Contract: bob-cli `docs/snooze-marks.md`.
//
// Guards mirror the Today surface (`143`, `275`): non-daily hosts
// only, exact `#task` token plus trailing unique id, no inline
// code or fences, open status, ready cache. A snoozed-only task
// works when the Today cache holds no ids for that note: Today
// membership is consulted only for precedence, never for
// eligibility.

// Duplicate-id memo, keyed on the immutable CodeMirror doc. The
// stored value is `{ signature, duplicates }`, where `signature` is
// the sorted snoozed id list for the host note joined with `\n`.
const SNOOZE_MARK_DUPLICATE_MEMO =
  typeof WeakMap === "function" ? new WeakMap() : new Map();

class BobLedgerToolsSnoozeMarksMixin {
  snoozeMarksNow() {
    try {
      return new Date();
    } catch (error) {
      return new Date();
    }
  }

  setupSnoozeMarks() {
    try {
      if (typeof this.snoozeMarksEnabled !== "boolean") {
        this.snoozeMarksEnabled = true;
      }
      if (typeof this.snoozeJumpInFlight !== "boolean") {
        this.snoozeJumpInFlight = false;
      }
      if (!(this.snoozeDueSeen instanceof Map)) {
        try {
          this.snoozeDueSeen = new Map();
        } catch (error) {
          this.snoozeDueSeen = null;
        }
      }
      this.applyMarkGateClass(
        "bob-snooze-marks-off",
        !this.snoozeMarksEnabled,
      );
      this.registerMarkGatePopoutSync(
        "bob-snooze-marks-off",
        () => !this.snoozeMarksEnabled,
      );
      try {
        if (typeof this.addCommand === "function") {
          this.addCommand({
            id: "toggle-snooze-marks",
            name: "Toggle snooze marks",
            callback: () => this.toggleSnoozeMarks(),
          });
          this.addCommand({
            id: "go-to-snoozed-row",
            name: "Go to the Snoozed row",
            editorCallback: (editor, view) =>
              this.goToSnoozedRow(editor, view),
          });
        }
      } catch (error) {
        // Commands are best-effort on limited test hosts.
      }
      try {
        const extension = this.createSnoozeMarkExtension();
        if (
          extension &&
          typeof this.registerEditorExtension === "function"
        ) {
          this.registerEditorExtension(extension);
        }
      } catch (error) {
        // Live Preview marks are best-effort.
      }
      try {
        if (typeof this.setupSnoozeMarksReading === "function") {
          this.setupSnoozeMarksReading();
        }
      } catch (error) {
        // Reading-view wiring is best-effort.
      }
      try {
        if (typeof this.setupSnoozeWokenPills === "function") this.setupSnoozeWokenPills();
      } catch (error) {
        // Woken-link paint is best-effort.
      }
      try {
        if (typeof this.setupSnoozeRowPaint === "function") this.setupSnoozeRowPaint();
      } catch (error) {
        // Row paint is best-effort.
      }
      this.scheduleSnoozeMarksRefresh();
    } catch (error) {
      // Setup never breaks plugin startup.
    }
  }

  snoozeMarksAvailable() {
    try {
      return Boolean(
        ViewPlugin &&
          Decoration &&
          WidgetType &&
          RangeSetBuilder &&
          editorInfoField &&
          editorLivePreviewField &&
          SnoozeMarkWidget &&
          ensureSnoozeMarksRefresh(),
      );
    } catch (error) {
      return false;
    }
  }

  createSnoozeMarkExtension() {
    try {
      if (
        !this.snoozeMarksAvailable() ||
        !ViewPlugin ||
        typeof ViewPlugin.fromClass !== "function" ||
        !Prec ||
        typeof Prec.highest !== "function"
      ) {
        return null;
      }
      const plugin = this;
      const MarkPluginClass = class {
        constructor(view) {
          try {
            this.decorations = plugin.buildSnoozeMarkDecorations(view);
          } catch (error) {
            this.decorations = Decoration.none;
          }
        }

        update(update) {
          try {
            if (plugin.snoozeMarkShouldRebuild(update)) {
              this.decorations =
                plugin.buildSnoozeMarkDecorations(update.view);
            }
          } catch (error) {
            // A failed rebuild leaves the last valid decorations in place.
          }
        }
      };
      return Prec.highest(
        ViewPlugin.fromClass(MarkPluginClass, {
          decorations: (value) => value.decorations,
        }),
      );
    } catch (error) {
      return null;
    }
  }

  snoozeMarkShouldRebuild(update) {
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
        const list = Array.isArray(effects) ? effects : effects ? [effects] : [];
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
      // selectionSet is deliberately ignored: the mark stays visible
      // under the caret and never changes Vim motion positions.
      return false;
    } catch (error) {
      return false;
    }
  }

  snoozeIdsForHostPath(hostPath) {
    try {
      const cache = this.snoozedCache;
      if (
        !cache ||
        !(cache.byKey instanceof Map) ||
        typeof hostPath !== "string" ||
        !hostPath
      ) {
        return new Set();
      }
      const prefix = hostPath + "#";
      const out = new Set();
      for (const key of cache.byKey.keys()) {
        try {
          if (typeof key === "string" && key.startsWith(prefix)) {
            out.add(key.slice(prefix.length));
          }
        } catch (error) {
          continue;
        }
      }
      return out;
    } catch (error) {
      return new Set();
    }
  }

  snoozeSnapshotForKey(key) {
    try {
      const cache = this.snoozedCache;
      if (!cache || !(cache.byKey instanceof Map)) {
        return null;
      }
      return cache.byKey.get(key) || null;
    } catch (error) {
      return null;
    }
  }

  snoozeDuePulse(key, state) {
    try {
      if (!(this.snoozeDueSeen instanceof Map)) {
        return false;
      }
      const previous = this.snoozeDueSeen.get(key);
      // First sighting never pulses: the pulse must not replay on
      // startup, on scroll, or on rerender, only on the live
      // Asleep-to-Due transition frame.
      if (previous === undefined) {
        this.snoozeDueSeen.set(key, state);
        return false;
      }
      this.snoozeDueSeen.set(key, state);
      return previous !== "due" && state === "due";
    } catch (error) {
      return false;
    }
  }

  snoozeMarkDesiredSnapshot(key, nowMinutes) {
    try {
      const snapshot = this.snoozeSnapshotForKey(key);
      if (!snapshot || typeof snapshot !== "object") {
        return null;
      }
      const state = snapshot.state;
      if (
        state !== "asleep" &&
        state !== "due" &&
        state !== "blocked"
      ) {
        return null;
      }
      const time =
        typeof snapshot.hhmm === "string" &&
        /^\d{2}:\d{2}$/.test(snapshot.hhmm)
          ? snapshot.hhmm
          : snoozeDefinitionColonTime(
              typeof snapshot.minutes === "number"
                ? String(Math.floor(snapshot.minutes / 60)).padStart(2, "0") +
                  String(snapshot.minutes % 60).padStart(2, "0")
                : null,
            );
      if (!time) {
        return null;
      }
      const tone =
        state === "due" ? "amber" : state === "blocked" ? "muted" : "indigo";
      let tooltip = null;
      try {
        const gap =
          state === "asleep" &&
          Number.isInteger(snapshot.minutes) &&
          Number.isInteger(nowMinutes)
            ? Math.max(0, snapshot.minutes - nowMinutes)
            : 0;
        tooltip = snoozeDefinitionTooltip(
          state,
          time,
          state === "asleep"
            ? snoozeDefinitionCountdownText(gap)
            : null,
          this.snoozeMarkPlatform(),
        );
      } catch (error) {
        tooltip = snoozeDefinitionTooltip(state, time, null, "other");
      }
      return { state, time, tone, tooltip };
    } catch (error) {
      return null;
    }
  }

  snoozeMarkPlatform() {
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

  buildSnoozeMarkDecorations(view, now) {
    try {
      if (!this.snoozeMarksEnabled) {
        return Decoration.none;
      }
      // The clock shares the Today slot: either toggle off hides it
      // (SM-D15), while the tomato keeps its own Today toggle behavior.
      if (this.todayMarksEnabled === false) {
        return Decoration.none;
      }
      if (!view || !view.state) {
        return Decoration.none;
      }
      if (
        !Decoration ||
        !RangeSetBuilder ||
        !SnoozeMarkWidget ||
        !editorInfoField ||
        !editorLivePreviewField
      ) {
        return Decoration.none;
      }
      let live = false;
      let info = null;
      try {
        live = view.state.field(editorLivePreviewField) === true;
        info = view.state.field(editorInfoField);
      } catch (error) {
        return Decoration.none;
      }
      if (!live) {
        return Decoration.none;
      }
      const filePath =
        info && info.file && typeof info.file.path === "string"
          ? info.file.path
          : "";
      if (!filePath || PLAN_DAILY_PATH_RE.test(filePath)) {
        return Decoration.none;
      }
      let clock = null;
      try {
        clock = now instanceof Date ? now : this.snoozeMarksNow();
      } catch (error) {
        clock = new Date();
      }
      if (!(clock instanceof Date)) {
        clock = new Date();
      }
      if (
        typeof this.isSnoozedCacheReady !== "function" ||
        !this.isSnoozedCacheReady(clock)
      ) {
        return Decoration.none;
      }
      const path = /\.md$/i.test(filePath) ? filePath : filePath + ".md";
      let ids = null;
      try {
        ids = this.snoozeIdsForHostPath(path);
      } catch (error) {
        ids = new Set();
      }
      if (!(ids instanceof Set) || ids.size === 0) {
        return Decoration.none;
      }

      let tree = null;
      try {
        if (typeof syntaxTree === "function") {
          tree = syntaxTree(view.state);
        } else if (
          syntaxTree &&
          typeof syntaxTree.resolveInner === "function"
        ) {
          tree = syntaxTree;
        }
      } catch (error) {
        tree = null;
      }
      // Without a syntax tree we cannot distinguish inline/fenced code,
      // so stay neutral until the Live Preview parser is ready.
      if (!tree || typeof tree.resolveInner !== "function") {
        return Decoration.none;
      }

      const doc = view.state.doc;
      if (
        !doc ||
        typeof doc.lineAt !== "function" ||
        !Number.isInteger(doc.lines) ||
        doc.lines < 1
      ) {
        return Decoration.none;
      }
      const nowMinutes =
        clock.getHours() * 60 + clock.getMinutes();
      const visible = (view.visibleRanges || []).slice();
      const candidates = [];
      const seenLines = new Set();
      for (const range of visible) {
        if (!range || typeof range.from !== "number") {
          continue;
        }
        let position = Math.max(0, range.from);
        const end =
          typeof range.to === "number"
            ? Math.min(range.to, doc.length)
            : doc.length;
        let guard = 0;
        while (position <= end && guard < 10000) {
          guard += 1;
          let line = null;
          try {
            line = doc.lineAt(position);
          } catch (error) {
            break;
          }
          if (!line || typeof line.text !== "string") {
            break;
          }
          if (!seenLines.has(line.from)) {
            seenLines.add(line.from);
            if (line.text.indexOf("#task") !== -1) {
              let trailing = null;
              try {
                trailing = todayMarkTrailingBlockId(line.text);
              } catch (error) {
                trailing = null;
              }
              if (!trailing || !ids.has(trailing)) {
                // Not in this note's snoozed id set: skip before the
                // candidate parse.
              } else {
                const candidate = todayMarkLineCandidate(line.text);
                if (candidate) {
                  candidates.push({ line, candidate });
                }
              }
            }
          }
          if (
            typeof line.to !== "number" ||
            line.to >= end ||
            line.to < position
          ) {
            break;
          }
          position = line.to + 1;
        }
      }
      if (candidates.length === 0) {
        return Decoration.none;
      }

      const builder = new RangeSetBuilder();
      const idsArray = Array.from(ids);
      let duplicateIds = null;
      const ensureDuplicates = () => {
        if (duplicateIds) {
          return duplicateIds;
        }
        const signature = idsArray.slice().sort().join("\n");
        try {
          const cached = SNOOZE_MARK_DUPLICATE_MEMO.get(doc);
          if (
            cached &&
            cached.signature === signature &&
            cached.duplicates instanceof Set
          ) {
            duplicateIds = cached.duplicates;
            return duplicateIds;
          }
        } catch (error) {
          // A failed memo read recomputes below.
        }
        const allLines = todayMarkAllDocLines(doc);
        let list = [];
        try {
          list = todayMarkDuplicateIds(allLines, idsArray);
        } catch (error) {
          list = [];
        }
        duplicateIds = new Set(Array.isArray(list) ? list : []);
        try {
          SNOOZE_MARK_DUPLICATE_MEMO.set(doc, {
            signature,
            duplicates: duplicateIds,
          });
        } catch (error) {
          // Memo storage is best-effort.
        }
        return duplicateIds;
      };
      let todayRank = null;
      try {
        todayRank =
          this.todayCache && this.todayCache.rank instanceof Map
            ? this.todayCache.rank
            : null;
      } catch (error) {
        todayRank = null;
      }
      for (const item of candidates) {
        try {
          const line = item.line;
          const candidate = item.candidate;
          if (
            freshnessMarkPosInCode(
              tree,
              line.from + candidate.tagFrom + 1,
            )
          ) {
            continue;
          }
          const key = path + "#" + candidate.blockId;
          // A live dedicated Task Link wins: the clock leaves and the
          // tomato stays, including during cache transitions.
          if (todayRank && todayRank.has(key)) {
            continue;
          }
          const desired = this.snoozeMarkDesiredSnapshot(key, nowMinutes);
          if (!desired) {
            continue;
          }
          const dups = ensureDuplicates();
          if (dups.has(candidate.blockId)) {
            continue;
          }
          const widget = new SnoozeMarkWidget(
            key,
            desired.time,
            desired.tone,
            desired.tooltip,
            this.snoozeDuePulse(key, desired.state),
            (clickedKey) => {
              void this.jumpSnoozedRow(clickedKey);
            },
          );
          builder.add(
            line.from + candidate.insertCh,
            line.from + candidate.insertCh,
            Decoration.widget({ widget, side: -1 }),
          );
        } catch (error) {
          continue;
        }
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

  refreshSnoozeMarkEditors() {
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
          if (leafPath && PLAN_DAILY_PATH_RE.test(leafPath)) {
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

  scheduleSnoozeMarksRefresh() {
    try {
      if (
        this.snoozeMarksTimer !== null &&
        this.snoozeMarksTimer !== undefined
      ) {
        return;
      }
      const schedule =
        typeof window !== "undefined" &&
        window &&
        typeof window.setTimeout === "function"
          ? window.setTimeout
          : typeof setTimeout === "function"
            ? setTimeout
            : null;
      if (!schedule) {
        this.applySnoozeMarksRefresh();
        return;
      }
      this.snoozeMarksTimer = schedule(() => {
        this.snoozeMarksTimer = null;
        this.applySnoozeMarksRefresh();
      }, 16);
    } catch (error) {
      this.applySnoozeMarksRefresh();
    }
  }

  applySnoozeMarksRefresh() {
    try {
      this.refreshSnoozeMarkEditors();
    } catch (error) {
      // Editor refresh is best-effort.
    }
    try {
      if (typeof this.sweepSnoozeMarksReading === "function") {
        this.sweepSnoozeMarksReading();
      }
    } catch (error) {
      // Reading sweep is best-effort.
    }
    try {
      if (typeof this.refreshSnoozeWokenPillEditors === "function") this.refreshSnoozeWokenPillEditors();
      if (typeof this.refreshSnoozeWokenPillReadingViews === "function") this.refreshSnoozeWokenPillReadingViews();
    } catch (error) {
      // Woken-link refresh shares the snooze display lifecycle.
    }
    try {
      if (typeof this.refreshSnoozeRowPaintEditors === "function") this.refreshSnoozeRowPaintEditors();
      if (typeof this.refreshSnoozeRowPaintReadingViews === "function") this.refreshSnoozeRowPaintReadingViews();
    } catch (error) {
      // Row paint shares the snooze display lifecycle.
    }
  }

  toggleSnoozeMarks() {
    try {
      this.snoozeMarksEnabled = !this.snoozeMarksEnabled;
      const enabled = this.snoozeMarksEnabled;
      this.applyMarkGateClass("bob-snooze-marks-off", !enabled);
      this.applySnoozeMarksRefresh();
      try {
        new Notice(enabled ? "Snooze marks on" : "Snooze marks off");
      } catch (error) {
        // Notice is best-effort.
      }
      return enabled;
    } catch (error) {
      return this.snoozeMarksEnabled;
    }
  }

}
