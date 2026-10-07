// Orchestration for the Pomodoro Task Link lane toggle (plan
// 202610/in_progress_task_link_marks.md §6.4): Next <-> In Progress on the
// Alt+N link pipeline (discover, allowClosed resolve, start-wins batch plan,
// Move to Next prompt, preimage-checked commit, notices, progressMarks
// hint). Exposed as nav `api.taskLinkLane` v1 via `createTaskLinkLaneApi`.
// The bullet is never reformatted.
class BobNavigationHotkeysTaskLinkLaneMixin {

  // Run the D5/D6 toggle for the cursor link (+ N siblings when counted).
  // Uses only the passed count, never re-reads Vim state. Resolves
  // `{ ok: true, mode, changed }` or `{ ok: false, reason }` and never
  // rejects. A second call while one is in flight resolves busy with no
  // write and no Notice. Cancel ends silently with no write and no Notice.
  async toggleTaskLinkLane(request = {}) {
    const editor = (request && request.editor) || null;
    const view = (request && request.view) || null;
    const countExplicit = Boolean(request && request.countExplicit === true);
    const additionalTaskCount = Math.max(
      0,
      Math.floor(numericOrDefault(request && request.additionalTaskCount, 0)),
    );
    const fail = (reason, noticeText) => {
      if (noticeText) {
        new Notice(noticeText);
      }
      return Object.freeze({ ok: false, reason });
    };
    if (this.taskLinkLaneBusy === true) {
      return Object.freeze({ ok: false, reason: "busy" });
    }
    this.taskLinkLaneBusy = true;
    try {
      const cursor =
        editor && typeof editor.getCursor === "function"
          ? getEditorCursor(editor)
          : null;
      if (!cursor) {
        return fail("error", "No active markdown editor");
      }
      const content =
        editor && typeof editor.getValue === "function"
          ? String(editor.getValue() || "")
          : "";
      const discovery = discoverLinkPickerTargets(
        content,
        cursor.line,
        countExplicit ? additionalTaskCount : 0,
      );
      if (!discovery.valid) {
        return fail(
          "refused",
          discovery.notLink ? "Cursor is not on a Task Link" : discovery.error,
        );
      }
      const activeView = view || this.getActiveMarkdownView();
      if (!activeView || !activeView.file) {
        return fail("unavailable", "No active markdown note");
      }
      const sourcePath = activeView.file.path;
      let resolution = null;
      try {
        resolution = await this.resolveLinkPickerTargets(
          sourcePath,
          discovery,
          { allowClosed: true },
        );
      } catch (error) {
        return fail("error", "Task Link targets could not be read");
      }
      if (!resolution || resolution.error) {
        return fail(
          "refused",
          (resolution && resolution.error) ||
            "Task Link targets could not be read",
        );
      }
      if (
        editor &&
        typeof editor.getValue === "function" &&
        String(editor.getValue() || "") !== content
      ) {
        return fail("stale", "A linked note changed; no tasks were updated");
      }
      const groups = groupLinkPickerTargetsByNote(resolution.targets);
      if (groups.length === 0) {
        return fail("refused", "Could not update task; no tasks were updated");
      }
      const statuses = resolution.targets.map((target) =>
        getObsidianTaskCheckboxStatus(target.rawLine || ""),
      );
      const mode = decideTaskLinkLaneMode(statuses);
      if (!mode) {
        const firstStatus = statuses.length > 0 ? statuses[0] : null;
        return fail(
          "refused",
          taskLinkLaneRefusalFor(firstStatus),
        );
      }
      const laneBudgets = readLaneBudgets(this.app);
      const dateText = this.laneReleaseDateText();
      let summary = "";
      if (mode === "pause") {
        const pausable = resolution.targets.filter(
          (target) =>
            getObsidianTaskCheckboxStatus(target.rawLine || "") === "/",
        );
        if (pausable.length > 0) {
          const answer = await this.requestTaskLinkLaneSummary({
            targets: pausable,
            dateText,
          });
          if (answer.cancelled) {
            return Object.freeze({ ok: false, reason: "cancelled" });
          }
          summary = answer.summary;
        }
      }
      const planned = [];
      for (const group of groups) {
        const plan = planTaskLinkLaneBatch(group.content, group.session, {
          mode,
          summary,
          dateText,
          stampLine: this.getFreshnessStampLine(),
          freshDateText: this.getFreshnessDateText(),
        });
        if (!plan.valid) {
          return fail(
            "stale",
            plan.stale
              ? "A linked note changed; no tasks were updated"
              : plan.error,
          );
        }
        planned.push({ group, plan });
      }
      let commit = null;
      try {
        commit = await this.commitLinkPickerNoteWrites(planned, {});
      } catch (error) {
        return fail("error", "Could not update task; no tasks were updated");
      }
      if (!commit || !commit.ok) {
        return fail("stale", "A linked note changed; no tasks were updated");
      }
      let changed = 0;
      let workLogWrittenCount = 0;
      let readySkipped = 0;
      let blockedSkipped = 0;
      let closedSkipped = 0;
      const movedHints = [];
      const labels = [];
      const labelByKey = new Map();
      for (const target of resolution.targets) {
        labelByKey.set(
          `${target.path}::${target.line}`,
          target.displayText || cleanTaskDisplayText(target.rawLine || ""),
        );
      }
      for (const { group, plan } of planned) {
        changed += plan.moved.length;
        workLogWrittenCount += plan.workLogWrittenCount;
        readySkipped += plan.readySkipped;
        blockedSkipped += plan.blockedSkipped;
        closedSkipped += plan.closedSkipped;
        for (const entry of plan.moved) {
          if (entry.blockId) {
            movedHints.push(
              Object.freeze({
                path: group.path,
                blockId: entry.blockId,
                status: entry.toStatus,
              }),
            );
          }
          const label = labelByKey.get(`${group.path}::${entry.line}`);
          if (label) {
            labels.push(label);
          }
        }
      }
      this.hintTaskLinkLaneProgressMarks(movedHints);
      new Notice(
        buildTaskLinkLaneNotice({
          mode,
          tasks: labels,
          changedTaskCount: changed,
          workLogWrittenCount,
          readySkipped,
          blockedSkipped,
          closedSkipped,
          laneBudgets,
        }),
      );
      return Object.freeze({ ok: true, mode, changed });
    } catch (error) {
      return Object.freeze({ ok: false, reason: "error" });
    } finally {
      this.taskLinkLaneBusy = false;
    }
  }

  // Ask once for the optional Move to Next Work Log summary. Resolves
  // `{ cancelled, summary }`; cancel ends the gesture silently. Mirrors
  // `requestLaneReleaseSummary`: a prompt that cannot open proceeds with a
  // blank summary instead of refusing the toggle.
  async requestTaskLinkLaneSummary(options = {}) {
    if (typeof TaskLinkLanePromptModal !== "function") {
      return { cancelled: false, summary: "" };
    }
    const targets = Array.isArray(options.targets) ? options.targets : [];
    const tasks = targets.map((target) =>
      Object.freeze({
        displayText:
          target.displayText || cleanTaskDisplayText(target.rawLine || ""),
        path: target.path || "Current note",
      }),
    );
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        if (this.taskLinkLanePrompt) {
          this.taskLinkLanePrompt = null;
        }
        resolve(result);
      };
      let modal = null;
      try {
        modal = new TaskLinkLanePromptModal(this.app, {
          tasks,
          dateText: options.dateText,
          onDone: (result) => {
            if (result === null) {
              finish({ cancelled: true, summary: "" });
            } else {
              finish({
                cancelled: false,
                summary: String((result && result.summary) || ""),
              });
            }
          },
        });
        this.taskLinkLanePrompt = modal;
        modal.open();
      } catch (error) {
        this.taskLinkLanePrompt = null;
        finish({ cancelled: false, summary: "" });
      }
    });
  }

  // Instant feedback (D9): tell ledger-tools `api.progressMarks` about every
  // just-written status so the mark flips on the same frame instead of
  // waiting up to ~2 s for autosave. Feature-detected (`version >= 1`) and
  // never throwing: a missing or old api is a no-op and the marks fall back
  // to cache-driven refresh.
  hintTaskLinkLaneProgressMarks(entries) {
    try {
      const list = Array.isArray(entries) ? entries : [];
      if (list.length === 0) {
        return;
      }
      const plugins =
        this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins ? plugins["bob-ledger-tools"] : null;
      const api = holder ? holder.api : null;
      const namespace = api ? api.progressMarks : null;
      if (
        !namespace ||
        Number(namespace.version) < 1 ||
        typeof namespace.expect !== "function"
      ) {
        return;
      }
      namespace.expect(
        list
          .filter(
            (entry) =>
              entry &&
              typeof entry.path === "string" &&
              typeof entry.blockId === "string",
          )
          .map((entry) =>
            Object.freeze({
              path: entry.path,
              blockId: entry.blockId,
              status: entry.status,
            }),
          ),
      );
    } catch (error) {
      // A hint must never break the toggle.
    }
  }
}

// nav `api.taskLinkLane` v1 (plan 202610/in_progress_task_link_marks.md §3):
// an additive namespace, frozen. `matches` is synchronous and never throws;
// `toggle` settles to a result object and never rejects. Plugins never
// import each other's `main.js`: task-status-cycler feature-detects
// `api?.taskLinkLane?.version >= 1`.
function createTaskLinkLaneApi(plugin) {
  const matches = (args = {}) => {
    try {
      return isPomodoroTaskLinkLine(
        args ? args.content : "",
        args ? args.line : NaN,
        args ? args.path : "",
      );
    } catch (error) {
      return false;
    }
  };
  const toggle = (args = {}) => {
    try {
      if (!plugin || typeof plugin.toggleTaskLinkLane !== "function") {
        return Promise.resolve(
          Object.freeze({ ok: false, reason: "unavailable" }),
        );
      }
      return Promise.resolve()
        .then(() => plugin.toggleTaskLinkLane(args || {}))
        .then(
          (result) =>
            result && typeof result === "object" && "ok" in result
              ? result
              : Object.freeze({ ok: false, reason: "error" }),
          () => Object.freeze({ ok: false, reason: "error" }),
        );
    } catch (error) {
      return Promise.resolve(Object.freeze({ ok: false, reason: "error" }));
    }
  };
  return Object.freeze({ version: 1, matches, toggle });
}
