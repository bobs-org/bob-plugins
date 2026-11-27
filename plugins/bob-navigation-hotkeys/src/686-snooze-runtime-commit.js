// Snooze runtime controller: one guarded commit path used by both Alt+Z and
// the Task Card `z` row (the card phase calls these; it adds no second
// writer). Resolution, facts, destination, and report policy are the pure
// helpers in 740; this mixin binds them to live Obsidian state.
//
// Contract for the card phase:
// - `resolveSnoozeAtCursor(cm)` reads authoritative live editor contents
//   first (open editor, then open buffers; ambiguous buffers refuse) and
//   returns a frozen resolution or a refusal. A historical kind
//   (`history-link`, `woken-link`) identifies the task; writes always go to
//   today's daily note.
// - `commitSnoozeResolution(resolution, {action, when, ...})` revalidates the
//   clock, day, preimages, and task facts at confirmation, plans through
//   `snoozeMutationPlanner` (BIP `snoozePlanning` adapter + ledger-tools
//   freshness stamper, so type/property settling composes into the same
//   postimages), then commits. One composed editor transaction per open
//   note (the daily note's whole snooze undoes with one Ctrl+Z; same-path
//   task+daily edits merge into one transaction); closed notes go through
//   `vault.process` with a preimage comparison inside the callback. Across
//   two paths every input is checked before any write; when the second
//   write fails the first rolls back only while it still equals this
//   operation's postimage, and a rollback failure is reported truthfully
//   without touching concurrent user edits. Success is never reported with
//   only the promotion or only the row installed.
// - Add/retime/drop never spawn: no subprocess runs on those paths.
// - `wakeSnoozeNow(resolution)` is the one exception. It flushes live dirty
//   note buffers through the views' own `save()` (refusing with a retry
//   message when that cannot be verified), then runs
//   `bob snooze wake TASK -q -f json` through the ledger-tools bounded
//   spawn/decoder with the vault path, passing argv (never a
//   shell-interpolated title or link). bob stays the sole wake writer; no
//   link-now substitute is implemented here. The 8-second local Notice fires
//   only for a nonempty `woken` list with `notified: none`; other reports
//   are not success.
// - Repeat Enter presses cannot commit twice: an in-flight token per plugin
//   instance refuses reentry until the run settles.
// - After success the controller refreshes the snoozed cache through the
//   ledger-tools plugin instance and calls `onSnoozeRuntimeCommitted` (a
//   no-op hook the card phase may extend for Today/task-index consumers).
//   When the gesture resolves a captured review landing, pass
//   `{advanceReview: {anchor}}` to advance exactly once through
//   `advanceReviewWalkAfterAnswer`; cancellation, failure, and off-landing
//   actions never advance.
class BobNavigationHotkeysSnoozeRuntimeMixin {
  getSnoozePlanningAdapter() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins ? plugins["block-id-prompt"] : null;
      const api = holder ? holder.api : null;
      const adapter = api ? api.snoozePlanning : null;
      if (!adapter || Number(adapter.version) < 1) return null;
      if (typeof adapter.planTargetTaskUpdate !== "function") return null;
      return adapter;
    } catch (_) {
      return null;
    }
  }

  getSnoozeFactsProvider() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins ? plugins["bob-ledger-tools"] : null;
      const api = holder ? holder.api : null;
      const facts = api ? api.snoozeFacts : null;
      if (!facts || Number(facts.version) < 1) return null;
      return facts;
    } catch (_) {
      return null;
    }
  }

  getSnoozeLedgerPlugin() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      return (plugins && plugins["bob-ledger-tools"]) || null;
    } catch (_) {
      return null;
    }
  }

  // Authoritative note read: live open editor, then open buffers, then the
  // vault. Null on ambiguity (differing open buffers) or unreadable notes.
  async readSnoozeRuntimeNote(path, file) {
    try {
      if (typeof this.readLinkPickerNoteContent === "function") {
        return await this.readLinkPickerNoteContent(path, file);
      }
    } catch (_) {}
    return null;
  }

  // Alt+Z entry: resolve the task under the cursor from live editor state.
  // `overrides` supplies Task Card explicit targets and host-assembled task
  // and identity facts; without them the controller resolves links/rows from
  // the note text and refuses prose mentions and ambiguity.
  async resolveSnoozeAtCursor(cm, overrides) {
    const extra = overrides && typeof overrides === "object" ? overrides : {};
    const editor = cm || (typeof this.getActiveMarkdownView === "function" ? (this.getActiveMarkdownView() || {}).editor : null) || null;
    const view = typeof this.getActiveMarkdownView === "function" ? this.getActiveMarkdownView() : null;
    const sourcePath = snoozeRuntimeNormalizePath(
      extra.sourcePath || (view && view.file && view.file.path) || "",
    );
    const sourceContents = editor && typeof editor.getValue === "function"
      ? String(editor.getValue() || "")
      : (typeof extra.sourceContents === "string" ? extra.sourceContents : null);
    if (sourceContents === null) {
      new Notice("No active markdown editor");
      return snoozeRuntimeRefusal("unavailable");
    }
    let cursorLine = Number.isInteger(extra.cursorLine) ? extra.cursorLine : null;
    if (cursorLine === null) {
      try {
        const cursor = typeof getEditorCursor === "function" ? getEditorCursor(editor) : (editor && typeof editor.getCursor === "function" ? editor.getCursor() : null);
        cursorLine = cursor && Number.isInteger(cursor.line) ? cursor.line : null;
      } catch (_) {
        cursorLine = null;
      }
    }
    if (cursorLine === null) {
      new Notice("No active markdown editor");
      return snoozeRuntimeRefusal("unavailable");
    }
    const dailyPath = snoozeRuntimeNormalizePath(extra.dailyPath || (typeof this.currentSnoozeDailyPath === "function" ? this.currentSnoozeDailyPath() : ""));
    return resolveSnoozeCursorTarget({
      sourcePath,
      sourceContents,
      cursorLine,
      dailyPath,
      explicitTargets: Array.isArray(extra.explicitTargets) ? extra.explicitTargets : null,
      tasks: Array.isArray(extra.tasks) ? extra.tasks : [],
      identities: extra.identities || [],
    });
  }

  currentSnoozeDailyPath() {
    try {
      if (typeof this.currentDailyPath === "function") return this.currentDailyPath();
    } catch (_) {}
    try {
      const dateText = typeof this.getFreshnessDateText === "function" ? this.getFreshnessDateText() : null;
      if (typeof dateText === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
        const notes = this.app && this.app.dailyNotes;
        void notes;
      }
    } catch (_) {}
    return "";
  }

  // Guarded two-path commit of planner postimages. `plans` are
  // `{path, preimage, postimage}`; `io` defaults to this plugin's guarded
  // reader/writer. Pure enough to test with fake io.
  async commitSnoozePlans(plans, io) {
    const list = Array.isArray(plans) ? plans : [];
    const reader = (io && typeof io.read === "function")
      ? io.read
      : async (path) => await this.readSnoozeRuntimeNote(path, io && io.fileFor ? io.fileFor(path) : null);
    const writeOpen = (io && typeof io.writeOpen === "function")
      ? io.writeOpen
      : async (path, before, after) => {
        if (typeof this.writeLinkPickerNoteChange === "function") {
          return await this.writeLinkPickerNoteChange(path, io && io.fileFor ? io.fileFor(path) : null, before, after);
        }
        throw new Error("Vault content updates are unavailable");
      };
    const writeClosed = (io && typeof io.writeClosed === "function")
      ? io.writeClosed
      : async (path, before, after) => {
        if (typeof this.writeLinkPickerNoteChange === "function") {
          return await this.writeLinkPickerNoteChange(path, io && io.fileFor ? io.fileFor(path) : null, before, after);
        }
        throw new Error("Vault content updates are unavailable");
      };
    const isOpen = (io && typeof io.isOpen === "function")
      ? io.isOpen
      : (path) => {
        try {
          return Boolean(typeof this.getOpenMarkdownEditorForPath === "function" && this.getOpenMarkdownEditorForPath(path));
        } catch (_) {
          return false;
        }
      };
    const failed = (reason, extra) => Object.freeze({ ok: false, reason, ...(extra || {}) });
    if (list.length === 0) return failed("stale");
    const live = [];
    for (const plan of list) {
      if (!plan || typeof plan.path !== "string") return failed("stale");
      let current = null;
      try {
        current = await reader(plan.path);
      } catch (_) {
        current = null;
      }
      if (current === null || current !== plan.preimage) return failed("stale");
      live.push({ path: plan.path, before: plan.preimage, after: plan.postimage });
    }
    const needed = live.filter((entry) => entry.after !== entry.before);
    if (needed.length === 0) return Object.freeze({ ok: true, wrote: Object.freeze([]) });
    const written = [];
    try {
      for (const entry of needed) {
        if (isOpen(entry.path)) {
          await writeOpen(entry.path, entry.before, entry.after);
        } else {
          await writeClosed(entry.path, entry.before, entry.after);
        }
        written.push(entry);
      }
    } catch (error) {
      const rollbackFailures = [];
      for (const entry of written.slice().reverse()) {
        let current = null;
        try {
          current = await reader(entry.path);
        } catch (_) {
          current = null;
        }
        if (current !== entry.after) {
          rollbackFailures.push(entry.path);
          continue;
        }
        try {
          if (isOpen(entry.path)) {
            await writeOpen(entry.path, entry.after, entry.before);
          } else {
            await writeClosed(entry.path, entry.after, entry.before);
          }
        } catch (_) {
          rollbackFailures.push(entry.path);
        }
      }
      return failed(rollbackFailures.length > 0 ? "partial-write" : "write", {
        message: rollbackFailures.length > 0
          ? "A snooze write failed and rollback did not complete (" + rollbackFailures.join(", ") + "); your notes were left untouched where possible"
          : "A snooze write failed; no tasks were updated",
        rollbackFailures: Object.freeze(rollbackFailures),
      });
    }
    return Object.freeze({ ok: true, wrote: Object.freeze(needed.map((entry) => entry.path)) });
  }

  // Full add/retime/drop pipeline: revalidate, plan, commit, refresh. Never
  // spawns. `run` carries {action: 'add'|'drop', when, newBlockId,
  // extraIdentities, advanceReview, io, now, clock, dayText, dailyPath,
  // dailyContents, taskContents}. Returns a frozen outcome; failures leave
  // every note unchanged.
  async runSnoozeCommit(resolution, run) {
    const options = run && typeof run === "object" ? run : {};
    if (!resolution || resolution.ok !== true) {
      return Object.freeze({ ok: false, refusal: (resolution && resolution.refusal) || "unavailable", message: (resolution && resolution.message) || "Snooze is unavailable here" });
    }
    if (this.snoozeRuntimeInFlight === true) {
      return Object.freeze({ ok: false, refusal: "busy", message: "Snooze is already running; wait for it to finish" });
    }
    this.snoozeRuntimeInFlight = true;
    try {
      const action = options.action === "drop" ? "drop" : "add";
      const now = options.now instanceof Date ? options.now : new Date();
      const open = options.io && typeof options.io.read === "function" ? options.io : null;
      const reader = open
        ? open.read
        : async (path) => await this.readSnoozeRuntimeNote(path, null);
      const task = resolution.task && typeof resolution.task === "object" ? resolution.task : {};
      const taskPath = snoozeRuntimeNormalizePath(task.path || task.route || resolution.sourcePath);
      const dailyPath = snoozeRuntimeNormalizePath(options.dailyPath || (typeof this.currentSnoozeDailyPath === "function" ? this.currentSnoozeDailyPath() : ""));
      if (!dailyPath) return Object.freeze({ ok: false, refusal: "unavailable", message: "Today's daily note is unknown; try again" });
      let day = typeof options.dailyContents === "string" ? options.dailyContents : null;
      let taskContents = typeof options.taskContents === "string" ? options.taskContents : null;
      try {
        if (day === null) day = await reader(dailyPath);
        if (action === "drop") {
          if (taskContents === null) taskContents = "";
        } else if (taskPath && taskPath !== dailyPath && taskContents === null) {
          taskContents = await reader(taskPath);
        } else if (!taskPath || taskPath === dailyPath) {
          taskContents = day;
        }
      } catch (_) {
        return Object.freeze({ ok: false, refusal: "stale", message: SNOOZE_RUNTIME_REFUSAL_MESSAGES.stale });
      }
      if (day === null || (action !== "drop" && taskPath && taskPath !== dailyPath && taskContents === null)) {
        return Object.freeze({ ok: false, refusal: "stale", message: SNOOZE_RUNTIME_REFUSAL_MESSAGES.stale });
      }
      const freshness = typeof this.getFreshnessApi === "function" ? this.getFreshnessApi() : null;
      const stampLine = typeof this.getFreshnessStampLine === "function" ? this.getFreshnessStampLine() : undefined;
      const freshDateText = (() => {
        try {
          if (typeof this.getFreshnessDateText === "function") return this.getFreshnessDateText();
        } catch (_) {}
        return undefined;
      })();
      const dayText = typeof options.dayText === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.dayText)
        ? options.dayText
        : (typeof freshDateText === "string" ? freshDateText : null);
      if (dayText) {
        const todayText = (() => {
          try {
            if (typeof this.getFreshnessDateText === "function") return this.getFreshnessDateText();
          } catch (_) {
            return null;
          }
          return null;
        })();
        if (todayText && todayText !== dayText) {
          return Object.freeze({ ok: false, refusal: "day_changed", message: SNOOZE_RUNTIME_REFUSAL_MESSAGES.day_changed });
        }
      }
      const adapter = typeof options.planTargetTaskUpdate === "function"
        ? { planTargetTaskUpdate: options.planTargetTaskUpdate }
        : this.getSnoozePlanningAdapter();
      if (action === "add" && (taskPath !== dailyPath || String(task.status).slice(0, 1) === " ") && !adapter) {
        return Object.freeze({ ok: false, refusal: "unavailable", message: "Snooze planning needs block-id-prompt; try again after it loads" });
      }
      const clock = options.clock && typeof options.clock === "object" ? options.clock : {
        date: dayText || undefined,
        now: options.nowText,
        zone: options.zone,
        nowInstant: now,
        freshDateText: typeof freshDateText === "string" ? freshDateText : dayText,
      };
      const planInput = {
        action,
        when: options.when,
        day,
        dailyPath,
        task: {
          path: taskPath,
          route: task.route || taskPath,
          block: task.block || task.blockId || "",
          blockId: task.block || task.blockId || "",
          target: task.target == null ? "" : task.target,
          status: task.status,
          is_task: task.is_task,
          is_event: task.is_event,
          blocked: task.blocked,
          contents: taskContents,
          line: task.line,
          link: task.link,
          displayText: task.displayText,
        },
        newBlockId: options.newBlockId || "",
        identities: options.extraIdentities || options.identities || [],
        clock,
        nowInstant: now,
        freshDateText: typeof freshDateText === "string" ? freshDateText : (dayText || undefined),
        stampLine,
        planTargetTaskUpdate: adapter ? adapter.planTargetTaskUpdate.bind(adapter) : undefined,
      };
      let planned = null;
      try {
        planned = snoozeMutationPlanner.plan(planInput);
      } catch (_) {
        planned = null;
      }
      if (!planned || planned.ok !== true) {
        const refusal = (planned && planned.refusal) || "unavailable";
        return Object.freeze({ ok: false, refusal, message: SNOOZE_RUNTIME_REFUSAL_MESSAGES[refusal] || "Snooze cannot be made here" });
      }
      const committed = await this.commitSnoozePlans(planned.plans, open);
      if (!committed.ok) {
        return Object.freeze({ ok: false, refusal: committed.reason || "write", message: committed.message || "A snooze write failed; no tasks were updated" });
      }
      await this.refreshSnoozeRuntimeConsumers({ now });
      if (options.advanceReview) {
        try {
          if (typeof this.advanceReviewWalkAfterAnswer === "function") {
            await this.advanceReviewWalkAfterAnswer({ anchor: options.advanceReview.anchor || null, preamble: options.advanceReview.preamble || "" });
          }
        } catch (_) {}
      }
      return Object.freeze({ ok: true, wrote: committed.wrote, operation: planned.operation || null });
    } finally {
      this.snoozeRuntimeInFlight = false;
    }
  }

  async refreshSnoozeRuntimeConsumers(options) {
    const now = (options && options.now instanceof Date) ? options.now : new Date();
    try {
      const ledger = this.getSnoozeLedgerPlugin();
      if (ledger && typeof ledger.refreshSnoozedCacheFromDaily === "function") {
        await ledger.refreshSnoozedCacheFromDaily(now);
      }
    } catch (_) {}
    try {
      if (typeof this.onSnoozeRuntimeCommitted === "function") {
        await this.onSnoozeRuntimeCommitted({ now });
      }
    } catch (_) {}
  }

  // Explicit Wake now through bob, the sole wake writer. `resolution` is a
  // committed snoozed-row (or live task) resolution; `run` carries
  // {notes, vaultPath, saveNotes(), spawn(argv), notify(text)} overrides for
  // tests. Dirty live buffers are flushed through their views' own save();
  // when that cannot be verified the gesture refuses with a retry message
  // instead of handing half-written notes to an external writer.
  async wakeSnoozeNow(resolution, run) {
    const options = run && typeof run === "object" ? run : {};
    if (!resolution || resolution.ok !== true || !resolution.identity) {
      return Object.freeze({ ok: false, refusal: (resolution && resolution.refusal) || "unavailable", message: (resolution && resolution.message) || "Nothing to wake" });
    }
    if (this.snoozeRuntimeInFlight === true) {
      return Object.freeze({ ok: false, refusal: "busy", message: "Snooze is already running; wait for it to finish" });
    }
    this.snoozeRuntimeInFlight = true;
    try {
      const identity = resolution.identity;
      const locator = "[[" + identity.route + "#^" + identity.block + "]]";
      const argv = ["snooze", "wake", locator, "-q", "-f", "json"];
      const notes = Array.isArray(options.notes) && options.notes.length > 0
        ? options.notes
        : [...new Set([snoozeRuntimeNormalizePath(options.dailyPath || ""), snoozeRuntimeNormalizePath(resolution.sourcePath || "")].filter(Boolean))];
      const saveNotes = typeof options.saveNotes === "function" ? options.saveNotes : async (paths) => {
        const views = [];
        try {
          const leaves = (this.app && this.app.workspace && typeof this.app.workspace.iterateAllLeaves === "function")
            ? await new Promise((resolve) => {
              const found = [];
              try {
                this.app.workspace.iterateAllLeaves((leaf) => {
                  try {
                    const view = leaf && leaf.view;
                    if (view && view.file && paths.includes(snoozeRuntimeNormalizePath(view.file.path))) found.push(view);
                  } catch (_) {}
                });
              } catch (_) {}
              resolve(found);
            })
            : [];
          views.push(...leaves);
        } catch (_) {}
        for (const view of views) {
          if (view && typeof view.save === "function") {
            await view.save();
          } else {
            return { ok: false, unverifiable: true };
          }
        }
        if (typeof this.getOpenMarkdownEditorForPath === "function") {
          for (const path of paths) {
            try {
              if (this.getOpenMarkdownEditorForPath(path)) {
                const covered = views.some((view) => view && view.file && snoozeRuntimeNormalizePath(view.file.path) === path);
                if (!covered) return { ok: false, unverifiable: true };
              }
            } catch (_) {
              return { ok: false, unverifiable: true };
            }
          }
        }
        return { ok: true };
      };
      let flushed = null;
      try {
        flushed = await saveNotes(notes);
      } catch (_) {
        flushed = null;
      }
      if (!flushed || flushed.ok !== true) {
        return Object.freeze({ ok: false, refusal: "dirty", message: "The note changed under the card; close and retry so bob reads what you see" });
      }
      const spawn = typeof options.spawn === "function" ? options.spawn : async (args) => {
        try {
          const ledger = this.getSnoozeLedgerPlugin();
          if (ledger && typeof ledger.snoozeWakeSpawn === "function") {
            return { spawned: true, result: await ledger.snoozeWakeSpawn(args) };
          }
        } catch (error) {
          return { spawned: false, error: String((error && error.message) || error) };
        }
        return { spawned: false, error: "wake spawn is unavailable on this device" };
      };
      let outcome = null;
      try {
        outcome = await spawn(argv);
      } catch (error) {
        outcome = { spawned: false, error: String((error && error.message) || error) };
      }
      if (!outcome || outcome.spawned !== true) {
        const detail = String((outcome && (outcome.error || outcome.message)) || "unavailable");
        if (/mobile|unavailable on this device/i.test(detail)) {
          return Object.freeze({ ok: false, refusal: "unavailable", message: interpretSnoozeWakeReport({ unavailable: true }).message });
        }
        return Object.freeze({ ok: false, refusal: "spawn", message: "bob snooze wake could not start (" + detail + "); the row stays snoozed" });
      }
      const result = outcome.result;
      const unsupported = (() => {
        try {
          const text = [result && result.message, result && result.detail].filter(Boolean).join(" ");
          return /(?:unrecognized|unknown) subcommand\s+['"`]?snooze['"`]?/i.test(text)
            || (/(?:unrecognized|unknown) subcommand\s+['"`]?wake['"`]?/i.test(text) && /snooze/i.test(text));
        } catch (_) {
          return false;
        }
      })();
      if (unsupported) {
        return Object.freeze({ ok: false, refusal: "unsupported", message: interpretSnoozeWakeReport({ unsupported: true }).message });
      }
      if (result && (result.timedOut === true || result.timeout === true || result.code === "timeout")) {
        return Object.freeze({ ok: false, refusal: "timeout", message: interpretSnoozeWakeReport({ timeout: true }).message });
      }
      const policy = interpretSnoozeWakeReport({ decoded: result });
      if (policy.notice && policy.noticeText) {
        const notify = typeof options.notify === "function" ? options.notify : (text) => {
          try {
            new Notice(text, 8000);
          } catch (_) {}
        };
        try {
          notify(policy.noticeText);
        } catch (_) {}
      }
      if (policy.refresh) {
        await this.refreshSnoozeRuntimeConsumers({ now: new Date() });
      }
      if (policy.outcome !== "woke") {
        return Object.freeze({ ok: false, refusal: policy.outcome, message: policy.message });
      }
      return Object.freeze({ ok: true, outcome: policy.outcome, message: policy.message });
    } finally {
      this.snoozeRuntimeInFlight = false;
    }
  }
}

const createDependencyNavApiBeforeSnoozeRuntime = createDependencyNavApi;
createDependencyNavApi = function createDependencyNavApiWithSnoozeRuntime(plugin) {
  const api = createDependencyNavApiBeforeSnoozeRuntime(plugin);
  if (!plugin) return api;
  const guard = (fn) => (...args) => {
    try {
      return fn(...args);
    } catch (_) {
      return null;
    }
  };
  return Object.freeze({
    ...api,
    snoozeRuntime: Object.freeze({
      version: SNOOZE_RUNTIME_VERSION,
      resolve: guard((snapshot) => resolveSnoozeCursorTarget(snapshot)),
      facts: guard((snapshot) => buildSnoozeCardFacts(snapshot)),
      destination: guard((snapshot) => projectSnoozeWakeDestination(snapshot)),
      commit: (resolution, run) => plugin.runSnoozeCommit(resolution, run),
      wakeNow: (resolution, run) => plugin.wakeSnoozeNow(resolution, run),
    }),
  });
};
