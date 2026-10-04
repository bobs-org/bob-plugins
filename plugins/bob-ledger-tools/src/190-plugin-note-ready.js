class BobLedgerToolsNoteReadyMixin {
  // --- Per-note Ready cap (api.noteReady v1) --------------------------
  // One memoized O(tasks) snapshot with live invalidation. The memo key
  // is the Tasks array identity, the Tasks generation, the local date,
  // the eligibility fingerprint generation, the caps key, and the
  // freshness memo identity (for make-up).

  // One typed-note entry for a vault path, or null when the path is
  // excluded, untyped, or unreadable. Frontmatter comes through the
  // shared `noteFrontmatter` reader.
  noteReadyEntryForPath(path, frontmatter) {
    try {
      const text = String(path || "");
      if (!text || noteReadyPathExcluded(text)) {
        return null;
      }
      const front =
        frontmatter === undefined
          ? this.noteFrontmatter(text)
          : frontmatter;
      if (!front || typeof front !== "object") {
        return null;
      }
      const kind = noteReadyKindFromType(front.type);
      if (!kind) {
        return null;
      }
      const status = noteReadyStatusLabel(front.status);
      let readyCapRaw;
      const rawCap = front.ready_cap;
      if (rawCap === undefined || rawCap === null) {
        readyCapRaw = undefined;
      } else if (typeof rawCap === "string") {
        const trimmed = rawCap.trim();
        readyCapRaw = trimmed ? trimmed : undefined;
      } else if (typeof rawCap === "number") {
        readyCapRaw = String(rawCap);
      } else if (typeof rawCap === "boolean") {
        readyCapRaw = rawCap;
      } else {
        readyCapRaw = rawCap;
      }
      const fingerprint = (() => {
        try {
          return JSON.stringify([
            front.type === undefined ? null : front.type,
            front.status === undefined ? null : front.status,
            front.ready_cap === undefined ? null : front.ready_cap,
          ]);
        } catch (error) {
          return JSON.stringify("error");
        }
      })();
      return {
        fingerprint,
        entry: {
          path: text,
          name: noteReadyStemForPath(text),
          kind,
          status,
          isArea: kind === "area",
          isTerminal:
            kind !== "area" && noteReadyStatusIsTerminal(status),
          parent: noteReadyParentStem(front.parent),
          ready_cap_raw: readyCapRaw,
        },
      };
    } catch (error) {
      return null;
    }
  }

  // Rebuild the per-path eligibility fingerprints from
  // `vault.getMarkdownFiles()`. Bumps `noteReadyFrontGen` only when the
  // fingerprint map changes. Returns `{ entries, changed }`.
  noteReadyRefreshEligibility() {
    try {
      const vault = this.app && this.app.vault;
      const files =
        vault && typeof vault.getMarkdownFiles === "function"
          ? vault.getMarkdownFiles()
          : [];
      const next = new Map();
      if (Array.isArray(files)) {
        for (const file of files) {
          const path =
            file && typeof file.path === "string" ? file.path : "";
          if (!path) {
            continue;
          }
          const built = this.noteReadyEntryForPath(
            path,
            this.noteFrontmatter(file),
          );
          if (built) {
            next.set(path, built);
          }
        }
      }
      const previous = this.noteReadyFrontByPath;
      let changed = true;
      if (previous instanceof Map && previous.size === next.size) {
        changed = false;
        for (const [path, built] of next) {
          const old = previous.get(path);
          if (!old || old.fingerprint !== built.fingerprint) {
            changed = true;
            break;
          }
        }
      }
      if (changed) {
        this.noteReadyFrontByPath = next;
        this.noteReadyFrontGen = (this.noteReadyFrontGen || 0) + 1;
      }
      return {
        entries: Array.from(next.values(), (built) => built.entry),
        changed,
      };
    } catch (error) {
      return { entries: [], changed: false };
    }
  }

  // Single-path eligibility update for a changed file. Returns true
  // when the fingerprint changed.
  refreshNoteReadyForChangedFile(file) {
    try {
      const path =
        file && typeof file.path === "string" ? file.path : null;
      if (!path) {
        return false;
      }
      if (!(this.noteReadyFrontByPath instanceof Map)) {
        this.noteReadyFrontByPath = new Map();
      }
      const built = this.noteReadyEntryForPath(
        path,
        this.noteFrontmatter(file),
      );
      const previous = this.noteReadyFrontByPath.get(path);
      const changed =
        (previous && previous.fingerprint) !==
        (built && built.fingerprint);
      if (!changed) {
        return false;
      }
      if (built) {
        this.noteReadyFrontByPath.set(path, built);
      } else {
        this.noteReadyFrontByPath.delete(path);
      }
      this.noteReadyFrontGen = (this.noteReadyFrontGen || 0) + 1;
      try {
        this.noteReadyEnsureSnapshot();
      } catch (error) {
        // The generation still counts; the memo rebuilds on next
        // access (and the query-refresh trigger with it).
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  refreshNoteReadyForDeletedPath(path) {
    try {
      const key = String(path || "");
      if (!key) {
        return false;
      }
      if (
        !(this.noteReadyFrontByPath instanceof Map) ||
        !this.noteReadyFrontByPath.has(key)
      ) {
        return false;
      }
      this.noteReadyFrontByPath.delete(key);
      this.noteReadyFrontGen = (this.noteReadyFrontGen || 0) + 1;
      try {
        this.noteReadyEnsureSnapshot();
      } catch (error) {
        // The generation still counts; the memo rebuilds on next access.
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  refreshNoteReadyForRename(file, oldPath) {
    try {
      let changed = false;
      if (typeof oldPath === "string" && oldPath) {
        changed = this.refreshNoteReadyForDeletedPath(oldPath) || changed;
      }
      changed = this.refreshNoteReadyForChangedFile(file) || changed;
      return changed;
    } catch (error) {
      return false;
    }
  }

  refreshNoteReadyForVaultEvent(event, file, oldPath) {
    try {
      if (event === "delete") {
        return this.refreshNoteReadyForDeletedPath(
          file && file.path,
        );
      }
      if (event === "rename") {
        return this.refreshNoteReadyForRename(file, oldPath);
      }
      return this.refreshNoteReadyForChangedFile(file);
    } catch (error) {
      return false;
    }
  }

  // The memoized snapshot. Rebuilds in one O(tasks) pass when the memo
  // key changes; otherwise returns the cached snapshot object.
  noteReadyEnsureSnapshot(now = new Date()) {
    const tasks = planBlockTasks(this.app);
    let dateText = null;
    try {
      dateText = this.freshnessTodayText(now);
    } catch (error) {
      dateText = null;
    }
    if (!dateText) {
      try {
        dateText = formatLocalDate(new Date());
      } catch (error) {
        dateText = "1970-01-01";
      }
    }
    const todayDay = freshnessDayNumberForDateText(dateText);
    const loaded = loadPlanCaps();
    const effective = effectivePlanCaps(loaded.caps);
    const defaultCap = planPerNoteCapOrDefault(
      effective.maxReadyPerNote,
      NOTE_READY_DEFAULT_CAP,
    );
    const defaultSource =
      loaded.defaultSource === "config" ? "config" : "default";
    const capsKey = JSON.stringify([
      defaultCap,
      defaultSource,
      Boolean(loaded.invalid),
    ]);
    const eligibility = this.noteReadyRefreshEligibility();
    const frontGen = this.noteReadyFrontGen || 0;
    const tasksGen = this.freshnessTasksGen || 0;
    let freshnessMemo = null;
    let freshnessAvailable = false;
    try {
      freshnessMemo = this.freshnessEnsureMemo(now);
      freshnessAvailable = Boolean(
        freshnessMemo && Array.isArray(freshnessMemo.evaluatedByIndex),
      );
    } catch (error) {
      freshnessMemo = null;
      freshnessAvailable = false;
    }
    const previous = this.noteReadyMemo;
    if (
      previous &&
      previous.tasks === tasks &&
      previous.tasksGen === tasksGen &&
      previous.dateText === dateText &&
      previous.frontGen === frontGen &&
      previous.capsKey === capsKey &&
      previous.freshnessMemo === freshnessMemo &&
      previous.snapshot
    ) {
      return previous.snapshot;
    }
    const capBlock = {
      default: defaultCap,
      source: defaultSource,
      invalid: Boolean(loaded.invalid),
    };
    const unavailable = (reason) => ({
      available: false,
      reason,
      date: dateText,
      cap: capBlock,
      totals: noteReadyEmptyTotals(),
      notes: [],
      lints: [],
    });
    const cacheState = this.tasksCacheState();
    if (!Array.isArray(tasks)) {
      const snapshot = unavailable("no-tasks");
      this.noteReadyMemo = {
        tasks,
        tasksGen,
        dateText,
        frontGen,
        capsKey,
        freshnessMemo,
        crowdedKey: noteReadyCrowdedKey([], capsKey),
        snapshot,
        byPath: new Map(),
        crowdedRank: new Map(),
        countedByTask: new Map(),
        countedByKey: new Map(),
        tasksRef: tasks,
      };
      return snapshot;
    }
    if (typeof cacheState === "string" && cacheState !== "Warm") {
      const snapshot = unavailable("tasks-not-warm");
      this.noteReadyMemo = {
        tasks,
        tasksGen,
        dateText,
        frontGen,
        capsKey,
        freshnessMemo,
        crowdedKey: noteReadyCrowdedKey([], capsKey),
        snapshot,
        byPath: new Map(),
        crowdedRank: new Map(),
        countedByTask: new Map(),
        countedByKey: new Map(),
        tasksRef: tasks,
      };
      return snapshot;
    }
    const rows = [];
    const countedByTask = new Map();
    const keyTallies = new Map();
    for (const task of tasks) {
      let path = "";
      try {
        path = planTaskPath(task) || "";
      } catch (error) {
        path = "";
      }
      if (!path) {
        continue;
      }
      let lane = false;
      try {
        lane =
          Boolean(readyTaskVisible(task, todayDay)) &&
          !planTaskIsBlocked(task, tasks);
      } catch (error) {
        lane = false;
      }
      if (!lane) {
        continue;
      }
      let blockId = null;
      try {
        blockId = planTaskBlockId(task);
      } catch (error) {
        blockId = null;
      }
      if (blockId === "prj") {
        continue;
      }
      let recurring = false;
      try {
        recurring = noteReadyRecurringFor(task);
      } catch (error) {
        recurring = false;
      }
      let bucket = null;
      if (freshnessAvailable) {
        try {
          const evaluated = this.freshnessEvaluatedFor(
            task,
            freshnessMemo,
          );
          bucket =
            evaluated && typeof evaluated.bucket === "string"
              ? evaluated.bucket
              : null;
        } catch (error) {
          bucket = null;
        }
      }
      rows.push({ path, recurring, blockId, bucket });
      countedByTask.set(task, !recurring);
      let rankKey = null;
      try {
        rankKey = this.freshnessMemoRankKey(task);
      } catch (error) {
        rankKey = null;
      }
      if (rankKey) {
        const tally = keyTallies.get(rankKey) || { total: 0, counted: 0 };
        tally.total += 1;
        if (!recurring) {
          tally.counted += 1;
        }
        keyTallies.set(rankKey, tally);
      }
    }
    const evaluated = noteReadyEvaluate({
      notes: eligibility.entries,
      rows,
      defaultCap,
      defaultSource,
      freshnessAvailable,
    });
    const byPath = new Map();
    for (const entry of evaluated.notes) {
      byPath.set(entry.path, entry);
    }
    const crowdedRank = new Map();
    let rank = 0;
    for (const entry of evaluated.notes) {
      if (entry.state === "crowded") {
        rank += 1;
        crowdedRank.set(entry.path, rank);
      }
    }
    const countedByKey = new Map();
    for (const [key, tally] of keyTallies) {
      if (tally.total === 1) {
        countedByKey.set(key, tally.counted === 1);
      }
    }
    const snapshot = {
      available: true,
      date: dateText,
      cap: capBlock,
      totals: evaluated.totals,
      notes: evaluated.notes,
      lints: evaluated.lints,
    };
    const crowdedKey = noteReadyCrowdedKey(evaluated.notes, capsKey);
    this.noteReadyMemo = {
      tasks,
      tasksGen,
      dateText,
      frontGen,
      capsKey,
      freshnessMemo,
      crowdedKey,
      snapshot,
      byPath,
      crowdedRank,
      countedByTask,
      countedByKey,
      tasksRef: tasks,
    };
    if (
      previous &&
      previous.snapshot &&
      previous.snapshot.available &&
      previous.tasks === tasks &&
      previous.tasksGen === tasksGen &&
      previous.crowdedKey !== crowdedKey
    ) {
      try {
        const workspace = this.app && this.app.workspace;
        if (workspace && typeof workspace.trigger === "function") {
          workspace.trigger(TODAY_RELOAD_EVENT);
        }
      } catch (error) {
        // The memo is still correct; only the live refresh is skipped.
      }
    }
    return snapshot;
  }

  // Direct lane check for one task (the `counted(task)` miss fallback).
  noteReadyTaskCounted(task, tasks, todayDay) {
    try {
      if (!task || typeof task !== "object") {
        return false;
      }
      const path = planTaskPath(task);
      if (!path) {
        return false;
      }
      if (!readyTaskVisible(task, todayDay)) {
        return false;
      }
      if (planTaskIsBlocked(task, tasks)) {
        return false;
      }
      if (planTaskBlockId(task) === "prj") {
        return false;
      }
      return !noteReadyRecurringFor(task);
    } catch (error) {
      return false;
    }
  }

  // --- api.noteReady members (synchronous, never throw) ---------------

  apiNoteReadySnapshot(now) {
    try {
      return this.noteReadyEnsureSnapshot(
        now === undefined ? new Date() : now,
      );
    } catch (error) {
      return {
        available: false,
        reason: "error",
        date: null,
        cap: {
          default: NOTE_READY_DEFAULT_CAP,
          source: "default",
          invalid: false,
        },
        totals: noteReadyEmptyTotals(),
        notes: [],
        lints: [],
      };
    }
  }

  apiNoteReadyForNote(path) {
    try {
      const key = typeof path === "string" ? path : "";
      if (!key) {
        return null;
      }
      this.noteReadyEnsureSnapshot();
      const memo = this.noteReadyMemo;
      if (!memo || !(memo.byPath instanceof Map)) {
        return null;
      }
      return memo.byPath.get(key) || null;
    } catch (error) {
      return null;
    }
  }

  apiNoteReadyCounted(task) {
    try {
      const snapshot = this.noteReadyEnsureSnapshot();
      if (!snapshot || snapshot.available !== true) {
        return null;
      }
      const memo = this.noteReadyMemo;
      if (
        memo &&
        memo.countedByTask instanceof Map &&
        memo.countedByTask.has(task)
      ) {
        return memo.countedByTask.get(task) === true;
      }
      let rankKey = null;
      try {
        rankKey = this.freshnessMemoRankKey(task);
      } catch (error) {
        rankKey = null;
      }
      if (
        rankKey &&
        memo &&
        memo.countedByKey instanceof Map &&
        memo.countedByKey.has(rankKey)
      ) {
        return memo.countedByKey.get(rankKey) === true;
      }
      const tasks = (memo && memo.tasksRef) || [];
      let todayDay = null;
      try {
        todayDay = freshnessDayNumberForDateText(
          this.freshnessTodayText(),
        );
      } catch (error) {
        todayDay = null;
      }
      return this.noteReadyTaskCounted(task, tasks, todayDay);
    } catch (error) {
      return null;
    }
  }

  apiNoteReadyInCrowdedNote(task) {
    try {
      const counted = this.apiNoteReadyCounted(task);
      if (counted !== true) {
        return false;
      }
      let path = "";
      try {
        path = planTaskPath(task) || "";
      } catch (error) {
        path = "";
      }
      if (!path) {
        return false;
      }
      const entry = this.apiNoteReadyForNote(path);
      return Boolean(entry && entry.state === "crowded");
    } catch (error) {
      return false;
    }
  }

  apiNoteReadyGroupLabel(task) {
    try {
      const snapshot = this.noteReadyEnsureSnapshot();
      if (!snapshot || snapshot.available !== true) {
        return "–";
      }
      let path = "";
      try {
        path = planTaskPath(task) || "";
      } catch (error) {
        path = "";
      }
      const memo = this.noteReadyMemo;
      const entry =
        path && memo && memo.byPath instanceof Map
          ? memo.byPath.get(path)
          : null;
      if (!entry) {
        return "–";
      }
      if (entry.state !== "crowded") {
        return `[[${entry.name}]] · ${entry.count}/${entry.cap}`;
      }
      const rank =
        memo &&
        memo.crowdedRank instanceof Map &&
        memo.crowdedRank.get(entry.path);
      const prefix = String(
        Number.isInteger(rank) && rank > 0 ? rank : 0,
      ).padStart(3, "0");
      return (
        `%%${prefix}%%[[${entry.name}]] · ` +
        `${entry.count}/${entry.cap} · +${entry.over_by}`
      );
    } catch (error) {
      return "–";
    }
  }

  // --- Per-note Ready cap views (ledger-views) ------------------------
  // Live `renderCrowdedChip`, the `bob-ready-notes` ranked-bar block,
  // the `## Tasks` heading chip (Live Preview widget plus Reading
  // view), and one consolidated live-refresh fan-out. All members are
  // synchronous, never throw, and follow the widget-Set pattern with
  // unload cleanup.

  noteReadyHeadingEntryForPath(path) {
    try {
      const key = typeof path === "string" ? path : "";
      if (!key) {
        return null;
      }
      return this.apiNoteReadyForNote(key);
    } catch (error) {
      return null;
    }
  }

  noteReadyHeadingFlags() {
    let invalid = false;
    let mobileDefault = false;
    try {
      const loaded = loadPlanCaps();
      invalid = Boolean(loaded && loaded.invalid);
      const source =
        loaded && loaded.defaultSource ? loaded.defaultSource : "default";
      let isMobile = false;
      try {
        isMobile = Boolean(Platform && Platform.isMobile);
      } catch (error) {
        isMobile = false;
      }
      mobileDefault = Boolean(isMobile && source === "default");
    } catch (error) {
      invalid = false;
      mobileDefault = false;
    }
    return { invalid, mobileDefault };
  }

  paintCrowdedChipElement(host, model, options = {}) {
    try {
      if (!host || typeof host.createEl !== "function") {
        return null;
      }
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const safe =
        model && typeof model === "object"
          ? model
          : noteReadyCrowdedChipModel(null);
      const anchor = host.createEl("a", {
        cls:
          `bob-plan-chip bob-plan-crowded` +
          `${safe.over ? " bob-plan-over" : ""}` +
          `${safe.placeholder ? " bob-plan-unavailable" : ""}` +
          `${safe.calm ? " bob-plan-calm" : ""}`,
        title: safe.tooltip,
        href: "crowded",
      });
      const countModel = {
        count: safe.placeholder ? null : safe.crowded,
        cap: safe.placeholder ? null : safe.crowded,
        over: Boolean(safe.over),
        placeholder: Boolean(safe.placeholder),
        tooltip: safe.tooltip,
        aria: safe.aria,
      };
      setReadyAnchorContent(
        anchor,
        countModel,
        { kind: "crowded", label: NOTE_READY_CROWDED_LABEL },
      );
      // Value span shows the chip value (`4`, `0 ✓`, `–`): rewrite it
      // from the count/cap fraction the shared routine writes.
      try {
        const valueSpan = findReadySpan(anchor, READY_VALUE_CLS);
        if (valueSpan) {
          setReadySpanText(valueSpan, safe.valueText);
        }
      } catch (error) {
        // Value rewrite is best-effort only.
      }
      // `↗` arrow span with aria-hidden, appended once and preserved
      // across in-place refreshes.
      try {
        let arrow = null;
        if (typeof anchor.querySelector === "function") {
          arrow = anchor.querySelector(".bob-plan-crowded-arrow");
        }
        if (!arrow && Array.isArray(anchor.children)) {
          arrow = anchor.children.find(
            (child) =>
              child &&
              child.attrs &&
              child.attrs.class &&
              String(child.attrs.class).indexOf("bob-plan-crowded-arrow") !==
                -1,
          );
        }
        if (!arrow && typeof anchor.createSpan === "function") {
          arrow = anchor.createSpan({
            cls: "bob-plan-crowded-arrow",
            text: NOTE_READY_CROWDED_ARROW,
          });
        } else if (!arrow && typeof anchor.createEl === "function") {
          arrow = anchor.createEl("span", {
            cls: "bob-plan-crowded-arrow",
            text: NOTE_READY_CROWDED_ARROW,
          });
        }
        if (arrow && typeof arrow.setAttribute === "function") {
          arrow.setAttribute("aria-hidden", "true");
        }
      } catch (error) {
        // Arrow is best-effort only.
      }
      if (anchor && typeof anchor.setAttribute === "function") {
        anchor.setAttribute("aria-label", safe.aria);
        anchor.setAttribute("role", "link");
        try {
          if (!anchor.hasAttribute("tabindex")) {
            anchor.setAttribute("tabindex", "0");
          }
        } catch (error) {
          // tabindex is best-effort only.
        }
      }
      const open = (event) => {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        try {
          const workspace = this.app && this.app.workspace;
          if (
            workspace &&
            typeof workspace.openLinkText === "function"
          ) {
            const newLeaf = Boolean(
              event && (event.ctrlKey || event.metaKey),
            );
            workspace.openLinkText("crowded", sourcePath, newLeaf);
          }
        } catch (error) {
          // The chip still shows the count without the navigation.
        }
      };
      if (anchor && typeof anchor.addEventListener === "function") {
        anchor.addEventListener("click", open);
        anchor.addEventListener("keydown", (event) => {
          if (event && (event.key === "Enter" || event.key === " ")) {
            open(event);
          }
        });
        anchor.addEventListener("mouseover", (event) => {
          try {
            const workspace = this.app && this.app.workspace;
            if (workspace && typeof workspace.trigger === "function") {
              workspace.trigger("hover-link", {
                event,
                source: "bob-plan",
                hoverParent: host,
                targetEl: anchor,
                linktext: "crowded",
                sourcePath,
              });
            }
          } catch (error) {
            // Hover preview is best-effort only.
          }
        });
      }
      return anchor;
    } catch (error) {
      return null;
    }
  }

  renderCrowdedChip(host, options = {}) {
    try {
      if (!host || typeof host.createEl !== "function") {
        return null;
      }
      const sourcePath =
        typeof options.sourcePath === "string" ? options.sourcePath : "";
      const component = options.component || null;
      if (!this.crowdedWidgets) {
        this.crowdedWidgets = new Set();
      }
      if (component) {
        for (const widget of Array.from(this.crowdedWidgets)) {
          if (widget.component === component) {
            try {
              if (widget.el && widget.el.parentNode) {
                widget.el.parentNode.removeChild(widget.el);
              } else if (
                widget.el &&
                typeof widget.el.remove === "function"
              ) {
                widget.el.remove();
              }
            } catch (error) {
              // Best-effort removal only.
            }
            this.crowdedWidgets.delete(widget);
          }
        }
      }
      for (const widget of Array.from(this.crowdedWidgets)) {
        try {
          const el = widget.el;
          const detached =
            !el ||
            (typeof el.isConnected === "boolean" &&
              el.isConnected === false &&
              (!el.parentNode || el.parentNode === null));
          if (detached && (!el.parentNode || el.parentNode === null)) {
            if (!host.contains || !host.contains(el)) {
              this.crowdedWidgets.delete(widget);
            }
          }
        } catch (error) {
          // Keep the widget on inspection failure.
        }
      }
      let snapshot = null;
      try {
        snapshot = this.noteReadyEnsureSnapshot(new Date());
      } catch (error) {
        snapshot = null;
      }
      const model = noteReadyCrowdedChipModel(snapshot);
      const anchor = this.paintCrowdedChipElement(host, model, {
        sourcePath,
      });
      if (!anchor) {
        return null;
      }
      const widget = { el: anchor, sourcePath, component };
      this.crowdedWidgets.add(widget);
      if (component && typeof component.register === "function") {
        try {
          component.register(() => {
            this.crowdedWidgets.delete(widget);
          });
        } catch (error) {
          // The widget still refreshes with the batch; only the
          // component-owned unregister is skipped.
        }
      }
      return anchor;
    } catch (error) {
      return null;
    }
  }

  refreshCrowdedChips(now = new Date()) {
    if (!this.crowdedWidgets || this.crowdedWidgets.size === 0) {
      return false;
    }
    let refreshed = false;
    let snapshot = null;
    try {
      snapshot = this.noteReadyEnsureSnapshot(now);
    } catch (error) {
      snapshot = null;
    }
    const model = noteReadyCrowdedChipModel(snapshot);
    for (const widget of Array.from(this.crowdedWidgets)) {
      try {
        const el = widget.el;
        const parent = el && el.parentNode ? el.parentNode : null;
        if (!parent || typeof parent.createEl !== "function") {
          if (!el || !el.isConnected) {
            this.crowdedWidgets.delete(widget);
          }
          continue;
        }
        const countModel = {
          count: model.placeholder ? null : model.crowded,
          cap: model.placeholder ? null : model.crowded,
          over: Boolean(model.over),
          placeholder: Boolean(model.placeholder),
          tooltip: model.tooltip,
          aria: model.aria,
        };
        // In-place refresh: keep the anchor (and its listeners) and
        // rewrite spans, title, aria, and state classes without
        // flicker. Never assigns `.text` on the live element.
        setReadyAnchorContent(el, countModel, {
          kind: "crowded",
          label: NOTE_READY_CROWDED_LABEL,
        });
        try {
          const valueSpan = findReadySpan(el, READY_VALUE_CLS);
          if (valueSpan) {
            setReadySpanText(valueSpan, model.valueText);
          }
        } catch (error) {
          // One stale widget never breaks the others.
        }
        try {
          if (el && typeof el.setAttribute === "function") {
            el.setAttribute("title", model.tooltip);
            el.setAttribute("aria-label", model.aria);
          }
        } catch (error) {
          // Best-effort label refresh only.
        }
        refreshed = true;
      } catch (error) {
        // One stale widget never breaks the others.
      }
    }
    return refreshed;
  }

  scheduleCrowdedRefresh() {
    if (
      this.crowdedRefreshTimer !== null &&
      this.crowdedRefreshTimer !== undefined
    ) {
      return;
    }
    const schedule =
      typeof window !== "undefined" &&
      typeof window.setTimeout === "function"
        ? window.setTimeout
        : setTimeout;
    this.crowdedRefreshTimer = schedule(() => {
      this.crowdedRefreshTimer = null;
      try {
        this.refreshCrowdedChips(new Date());
      } catch (error) {
        // Best-effort refresh only.
      }
    }, 150);
  }

}
