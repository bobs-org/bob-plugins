// Successor-link wiring (plan:202610/successor_links.md `cycler_wiring`).
// Runs the gated recover-and-link pass inside `finalizeClosedTasks`: with at
// least one `[id::]` in the closed set, dependents are recovered and linked
// in one planned pass (pure helpers from 085/086/087), then embeds retire as
// today. Writes go through open editors or preimage-checked `vault.process`.
// Exactly one notice per gesture: the nav Unblocked card, the walk toast, or
// a plain-text fallback. Linking is best-effort: a close is never rolled
// back for a linking failure.

class TaskStatusCyclerSuccessorsMixin {
  // Nav `api.notice` v1 for the Unblocked card (plan 202610/successor_links.md
  // §12.6): the frozen `{ version, showUnblocked }` pair, or null when nav is
  // missing, old, or malformed. Never throws. Follows `getReviewWalkApi`.
  getNavNoticeApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins && plugins["bob-navigation-hotkeys"];
      const api = holder && holder.api;
      if (!api) {
        return null;
      }
      const notice = api.notice;
      if (!notice || !(Number(notice.version) >= 1)) {
        return null;
      }
      if (typeof notice.showUnblocked !== "function") {
        return null;
      }
      return notice;
    } catch (error) {
      return null;
    }
  }

  // Defensive read of the Obsidian Tasks plugin cache, ported from nav's
  // `readStageTasksCache` (`590-plugin-dependency-stage.js`) but normalized
  // with the cycler's own `normalizeTasksCacheTask`. Returns
  // `{ ready, tasks }`; anything unusable reads not-ready so callers fall
  // back to the vault scan. Never throws.
  readSuccessorTasksCache() {
    try {
      const plugins =
        (this.app && this.app.plugins && this.app.plugins.plugins) || {};
      const tasksPlugin = plugins["obsidian-tasks-plugin"];
      if (!tasksPlugin) {
        return { ready: false, tasks: [] };
      }
      const apis = [tasksPlugin.apiV1, tasksPlugin.api, tasksPlugin].filter(
        Boolean,
      );
      for (const api of apis) {
        if (!api || typeof api.getTasks !== "function") {
          continue;
        }
        const state =
          typeof api.getState === "function" ? api.getState() : "Warm";
        if (state !== "Warm") {
          return { ready: false, tasks: [] };
        }
        const raw = api.getTasks();
        if (!Array.isArray(raw)) {
          continue;
        }
        const tasks = raw
          .map((entry) => normalizeTasksCacheTask(entry))
          .filter(Boolean);
        return { ready: true, tasks };
      }
    } catch (_error) {
      // Fall through to the vault scan.
    }
    return { ready: false, tasks: [] };
  }

  // Read one note's text for the successor pass: the open editor buffer
  // first, else `cachedRead`/`read`. Results are memoized in `cache`
  // (a Map) so the gate, pool, and mint lookups share one read per note.
  // Resolves to the text or null. Never throws.
  async readSuccessorNoteText(path, context, cache) {
    try {
      if (!path) {
        return null;
      }
      if (cache && cache.has(path)) {
        return cache.get(path);
      }
      const editors = this.getOpenMarkdownEditors(context || {});
      const editor = editors.get(path);
      if (editor && typeof editor.getValue === "function") {
        const text = editor.getValue();
        if (cache) {
          cache.set(path, typeof text === "string" ? text : null);
        }
        return typeof text === "string" ? text : null;
      }
      const vault = this.app && this.app.vault;
      const file = vault && typeof vault.getAbstractFileByPath === "function"
        ? vault.getAbstractFileByPath(path)
        : null;
      const target = file ||
        (vault && typeof vault.getMarkdownFiles === "function"
          ? vault.getMarkdownFiles().find((candidate) =>
            candidate && candidate.path === path
          ) || null
          : null);
      if (!target) {
        if (cache) {
          cache.set(path, null);
        }
        return null;
      }
      const text = typeof vault.cachedRead === "function"
        ? await vault.cachedRead(target)
        : typeof vault.read === "function"
          ? await vault.read(target)
          : null;
      if (cache) {
        cache.set(path, typeof text === "string" ? text : null);
      }
      return typeof text === "string" ? text : null;
    } catch (error) {
      return null;
    }
  }

  // Gate + enrichment for the successor pass. Identities that already carry
  // a `taskId` pass through; identities with only a `blockId` get one look
  // at their own note's closed line (editor buffer first) via the same
  // `closedTaskIdentity` rule the toggles use. Returns `{ identities }` with
  // `text` filled when the line was found, or `{ identities, gated: true }`
  // when no `[id::]` survived: callers skip the rest with no vault-wide
  // read. Never throws.
  async resolveSuccessorClosedIdentities(closed, context, cache) {
    const identities = [];
    try {
      for (const identity of Array.isArray(closed) ? closed : []) {
        if (!identity || !identity.path) {
          continue;
        }
        const next = {
          path: String(identity.path),
          ...(identity.blockId ? { blockId: String(identity.blockId) } : {}),
          ...(identity.taskId ? { taskId: String(identity.taskId) } : {}),
          ...(identity.rootKey ? { rootKey: identity.rootKey } : {}),
          ...(identity.text ? { text: String(identity.text) } : {}),
        };
        // Identities without a `taskId` need the closed line to pass the
        // gate; identities with one still want its display text for the
        // notice predecessors. Either way the closed note is read at most
        // once (editor buffer first).
        if ((!next.taskId || !next.text) && next.blockId) {
          const noteText = await this.readSuccessorNoteText(
            next.path,
            context || {},
            cache,
          );
          if (typeof noteText === "string") {
            const lines = noteText.split(/\r?\n/);
            const lineText = lines.find((line) =>
              getTrailingBlockId(line) === next.blockId
            ) || null;
            if (lineText != null) {
              const resolved = closedTaskIdentity(next.path, lineText);
              if (resolved && resolved.taskId) {
                next.taskId = resolved.taskId;
              }
              if (!next.text) {
                try {
                  next.text = cleanDescription(
                    successorBodyAfterStatusBox(lineText),
                    "#task",
                    next.blockId || null,
                  );
                } catch (error) {
                  next.text = "";
                }
              }
            }
          }
        }
        identities.push(next);
      }
    } catch (error) {
      return { identities: [], gated: true };
    }
    const gated = !identities.some((identity) => identity.taskId);
    return gated ? { identities, gated: true } : { identities };
  }

  // Build the successor task pool. When Tasks reports Warm, the reverse
  // index comes from `getTasks()` with open editor buffers overriding their
  // notes; otherwise callers pass the cold full-scan documents. Returns
  // `{ tasks, noteTexts }` where `noteTexts` maps the candidate-note paths
  // (plus every open buffer) to text for block-ID minting. Never throws.
  async buildSuccessorPool(closedTaskIds, context, cache) {
    const noteTexts = new Map();
    try {
      const editors = this.getOpenMarkdownEditors(context || {});
      for (const [path, editor] of editors) {
        try {
          const text = editor.getValue();
          if (typeof text === "string") {
            noteTexts.set(path, text);
          }
        } catch (error) {
          // Best effort: the vault read below still covers the note.
        }
      }
      const cacheRead = this.readSuccessorTasksCache();
      if (cacheRead.ready) {
        const buffered = new Set(noteTexts.keys());
        const tasks = [];
        for (const task of cacheRead.tasks) {
          if (!buffered.has(task.path)) {
            tasks.push(task);
          }
        }
        for (const [path, text] of noteTexts) {
          for (const task of tasksFromDocuments([{ path, text }])) {
            tasks.push(task);
          }
        }
        const candidatePaths = new Set();
        for (const task of tasks) {
          if (
            task &&
            Array.isArray(task.dependsOn) &&
            task.dependsOn.some((id) => closedTaskIds.has(String(id)))
          ) {
            candidatePaths.add(task.path);
          }
        }
        for (const path of candidatePaths) {
          if (!noteTexts.has(path)) {
            const text = await this.readSuccessorNoteText(
              path,
              context || {},
              cache,
            );
            if (typeof text === "string") {
              noteTexts.set(path, text);
            }
          }
        }
        return { tasks, noteTexts, warm: true };
      }
    } catch (error) {
      // Fall through to the cold scan.
    }
    return { tasks: null, noteTexts, warm: false };
  }

  // Cold fallback: read every Markdown note (editor buffers first), exactly
  // like `recoverBlockedDependentsNow`, so a cold Tasks cache still
  // recovers. Returns `{ documents }`. Never throws.
  async readSuccessorColdDocuments(context, cache) {
    const documents = [];
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getMarkdownFiles !== "function") {
        return { documents };
      }
      const openEditors = this.getOpenMarkdownEditors(context || {});
      const files = vault.getMarkdownFiles().filter(
        (file) => file && file.path && MARKDOWN_EXTENSION_RE.test(file.path),
      );
      for (const file of files) {
        try {
          const editor = openEditors.get(file.path);
          const text = editor
            ? editor.getValue()
            : typeof vault.cachedRead === "function"
              ? await vault.cachedRead(file)
              : typeof vault.read === "function"
                ? await vault.read(file)
                : null;
          if (typeof text !== "string") {
            continue;
          }
          documents.push({ path: file.path, text });
          if (cache && !cache.has(file.path)) {
            cache.set(file.path, text);
          }
        } catch (error) {
          // Best effort: one unreadable note must not block the pass.
        }
      }
    } catch (error) {
      // Best effort.
    }
    return { documents };
  }

  // Re-locate a Pomodoro-line close's entry by pre-edit headline (Work Log
  // writes can shift it). Returns the 0-based line or null (callers report
  // `failed` rather than guess). Never throws.
  relocateSuccessorClosingEntry(currentLines, hint) {
    try {
      const lines = Array.isArray(currentLines) ? currentLines : [];
      const lineText = hint && typeof hint.lineText === "string"
        ? hint.lineText
        : null;
      if (lineText == null) {
        return null;
      }
      let expected = null;
      try {
        expected = replaceTaskStatusSymbol(lineText, "x");
      } catch (error) {
        expected = null;
      }
      if (expected != null) {
        for (let line = 0; line < lines.length; line += 1) {
          if (String(lines[line] || "") === expected) {
            return line;
          }
        }
      }
      const name = hint && typeof hint.name === "string" ? hint.name : "";
      let best = null;
      for (let line = 0; line < lines.length; line += 1) {
        const text = String(lines[line] || "");
        let parts = null;
        try {
          parts = parsePomodoroEntryLineParts(text);
        } catch (error) {
          parts = null;
        }
        if (!parts) {
          continue;
        }
        let status = null;
        try {
          status = getTaskStatusForLine(text, line);
        } catch (error) {
          status = null;
        }
        if (!status || status.symbol !== "x") {
          continue;
        }
        if (String(parts.name || "") !== name) {
          continue;
        }
        if (best == null) {
          best = line;
        }
      }
      return best;
    } catch (error) {
      return null;
    }
  }

  // Apply successor note edits through the open editor (line re-check) or
  // `vault.process` (preimage check); mismatches mark rows `failed`. Never throws.
  async applySuccessorNoteEdits(plan, context) {
    let failed = 0;
    let failureReason = null;
    const failRow = (rowIndex, reason) => {
      failed += 1;
      if (!failureReason) {
        failureReason = reason;
      }
      const row = plan.unblocked[rowIndex];
      if (row && typeof row === "object") {
        row.link = null;
        row.not_linked = "failed";
      }
    };
    try {
      const edits = Array.isArray(plan.edits) ? plan.edits : [];
      const editsByPath = new Map();
      edits.forEach((edit, editIndex) => {
        if (!edit || !edit.path || !Number.isInteger(edit.line)) {
          return;
        }
        if (!editsByPath.has(edit.path)) {
          editsByPath.set(edit.path, []);
        }
        editsByPath.get(edit.path).push({ edit, editIndex });
      });
      const vault = this.app && this.app.vault;
      const openEditors = this.getOpenMarkdownEditors(context || {});
      const rowForEdit = (edit) => {
        for (let index = 0; index < plan.unblocked.length; index += 1) {
          const row = plan.unblocked[index];
          if (
            row &&
            row.note_path === edit.path &&
            Number(row.line) === Number(edit.line) &&
            row.not_linked !== "failed"
          ) {
            return index;
          }
        }
        return -1;
      };
      for (const [path, pathEdits] of editsByPath) {
        const editor = openEditors.get(path);
        if (editor && typeof editor.getLine === "function") {
          for (const { edit } of pathEdits) {
            let current = null;
            try {
              current = editor.getLine(edit.line);
            } catch (error) {
              current = null;
            }
            if (current !== edit.before) {
              failRow(rowForEdit(edit), "note changed before write");
              continue;
            }
            try {
              if (typeof editor.replaceRange !== "function") {
                failRow(rowForEdit(edit), "note cannot be updated safely");
                continue;
              }
              editor.replaceRange(
                edit.after,
                { line: edit.line, ch: 0 },
                { line: edit.line, ch: current.length },
              );
            } catch (error) {
              failRow(rowForEdit(edit), error.message || String(error));
            }
          }
          continue;
        }
        const file = vault && typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(path)
          : null;
        const target = file ||
          (vault && typeof vault.getMarkdownFiles === "function"
            ? vault.getMarkdownFiles().find((candidate) =>
              candidate && candidate.path === path
            ) || null
            : null);
        if (!target) {
          for (const { edit } of pathEdits) {
            failRow(rowForEdit(edit), "note disappeared before write");
          }
          continue;
        }
        const canProcess = vault && typeof vault.process === "function";
        const canReadModify = vault &&
          typeof vault.read === "function" &&
          typeof vault.modify === "function";
        if (!canProcess && !canReadModify) {
          for (const { edit } of pathEdits) {
            failRow(rowForEdit(edit), "note cannot be updated safely");
          }
          continue;
        }
        const stale = [];
        const transform = (liveText) => {
          const text = String(liveText || "");
          const ending = text.includes("\r\n") ? "\r\n" : "\n";
          const lines = text.split(/\r?\n/);
          for (const { edit } of pathEdits) {
            if (String(lines[edit.line] || "") !== edit.before) {
              stale.push(edit);
              continue;
            }
            lines[edit.line] = edit.after;
          }
          return lines.join(ending);
        };
        try {
          if (canProcess) {
            await vault.process(target, transform);
          } else {
            const live = await vault.read(target);
            const next = transform(live);
            if (next !== live) {
              await vault.modify(target, next);
            }
          }
        } catch (error) {
          for (const { edit } of pathEdits) {
            failRow(rowForEdit(edit), error.message || String(error));
          }
          continue;
        }
        for (const edit of stale) {
          failRow(rowForEdit(edit), "note changed before write");
        }
      }
    } catch (error) {
      // Best effort: rows keep their planned values and the model reports
      // what landed via the failure count below.
    }
    return { failed, failureReason };
  }

  // Apply daily insertions as one editor transaction or through
  // `vault.process`; skipped placements mark their rows `failed`. Never throws.
  async applySuccessorDailyInsertions(plan, insertion, context, dailyPath) {
    let failed = 0;
    let failureReason = null;
    const failPlacement = (placement, reason) => {
      failed += 1;
      if (!failureReason) {
        failureReason = reason;
      }
      const row = plan.unblocked[placement && placement.rowIndex];
      if (row && typeof row === "object") {
        row.link = null;
        row.not_linked = "failed";
      }
    };
    try {
      const placements = Array.isArray(plan.placements) ? plan.placements : [];
      if (placements.length === 0) {
        return { failed, failureReason };
      }
      if (!insertion || !Array.isArray(insertion.splices)) {
        for (const placement of placements) {
          failPlacement(placement, "daily note changed");
        }
        return { failed, failureReason };
      }
      const skipped = new Set(
        (insertion.skipped || []).map((entry) => entry && entry.order),
      );
      const editors = this.getOpenMarkdownEditors(context || {});
      const editor = dailyPath ? editors.get(dailyPath) : null;
      if (editor && typeof editor.getValue === "function") {
        const cursor = typeof editor.getCursor === "function"
          ? editor.getCursor()
          : null;
        try {
          const lineCount = typeof editor.lineCount === "function"
            ? editor.lineCount()
            : typeof editor.lastLine === "function"
              ? editor.lastLine() + 1
              : null;
          const splices = insertion.splices.slice().sort(
            (left, right) => right.at - left.at,
          );
          for (const splice of splices) {
            const from = { line: splice.at, ch: 0 };
            const to = splice.deleteCount > 0
              ? { line: splice.at + splice.deleteCount, ch: 0 }
              : from;
            // An append at end-of-file has no newline to anchor to: lead
            // with one instead of trailing one, or the new lines would
            // join onto the last line.
            const atEof = lineCount != null && splice.deleteCount <= 0 &&
              splice.at >= lineCount;
            const replacement = splice.lines.length > 0
              ? atEof
                ? `\n${splice.lines.join("\n")}`
                : `${splice.lines.join("\n")}\n`
              : "";
            editor.replaceRange(replacement, from, to);
          }
        } catch (error) {
          for (const placement of placements) {
            failPlacement(placement, error.message || String(error));
          }
          return { failed, failureReason };
        }
        if (cursor && typeof editor.setCursor === "function") {
          try {
            const lineText = typeof editor.getLine === "function"
              ? editor.getLine(cursor.line) || ""
              : "";
            editor.setCursor({
              line: cursor.line,
              ch: Math.min(cursor.ch, lineText.length),
            });
          } catch (error) {
            // Best effort: the insertions already landed.
          }
        }
      } else {
        const vault = this.app && this.app.vault;
        const file = vault &&
            typeof vault.getAbstractFileByPath === "function"
          ? vault.getAbstractFileByPath(dailyPath)
          : null;
        const target = file ||
          (vault && typeof vault.getMarkdownFiles === "function"
            ? vault.getMarkdownFiles().find((candidate) =>
              candidate && candidate.path === dailyPath
            ) || null
            : null);
        if (!target || typeof vault.process !== "function") {
          for (const placement of placements) {
            failPlacement(placement, "daily note cannot be updated safely");
          }
          return { failed, failureReason };
        }
        const snapshot = insertion.snapshot;
        try {
          await vault.process(target, (liveText) => {
            if (String(liveText || "") !== snapshot) {
              throw new Error("daily note changed before write");
            }
            return insertion.text;
          });
        } catch (error) {
          for (const placement of placements) {
            failPlacement(placement, error.message || String(error));
          }
          return { failed, failureReason };
        }
      }
      const linkByRow = new Map();
      for (const link of insertion.links || []) {
        if (link && Number.isInteger(link.rowIndex)) {
          linkByRow.set(link.rowIndex, link);
        }
      }
      placements.forEach((placement, order) => {
        const row = plan.unblocked[placement && placement.rowIndex];
        if (!row || typeof row !== "object") {
          return;
        }
        if (skipped.has(order)) {
          failPlacement(placement, "daily note changed");
          return;
        }
        const link = linkByRow.get(placement.rowIndex);
        if (!link) {
          failPlacement(placement, "daily note changed");
          return;
        }
        row.link = {
          day_file: dailyPath,
          entry_name: link.entry_name || "",
          entry_line: link.entry_line,
          entry_created: link.entry_created === true,
          next_up: link.next_up === true,
          line: link.line,
          block_link: link.block_link,
          block_id_created: row.link ? row.link.block_id_created === true : false,
        };
      });
    } catch (error) {
      // Best effort: see `applySuccessorNoteEdits`.
    }
    return { failed, failureReason };
  }

  // The gated recover-and-link pass inside `finalizeClosedTasks`: gate on
  // `[id::]`, plan with `planSuccessors`, apply, and return the §12.5 model
  // (or null). The close never depends on this result. Never throws.
  async planAndApplySuccessorsNow(closed, context) {
    try {
      const active = context && typeof context === "object" ? context : {};
      const vault = this.app && this.app.vault;
      const cache = new Map();
      const gate = await this.resolveSuccessorClosedIdentities(
        closed,
        active,
        cache,
      );
      // Gated (no `[id::]` in C): nothing can be blocked on this close.
      // Return a quiet marker, not a failure: callers stay silent and the
      // read budget proves no vault-wide scan ran.
      const quietGate = {
        version: 1,
        gated: true,
        predecessors: [],
        unblocked: [],
        still_blocked: [],
        daily_path: "",
        daily_content: null,
        failure: null,
      };
      if (gate.gated) {
        return quietGate;
      }
      const identities = gate.identities;
      const closedTaskIds = new Set(
        identities.filter((identity) => identity.taskId).map((identity) =>
          String(identity.taskId)
        ),
      );
      if (closedTaskIds.size === 0) {
        return quietGate;
      }
      let linkUnblocked = true;
      try {
        linkUnblocked = loadLinkUnblocked() !== false;
      } catch (error) {
        linkUnblocked = true;
      }
      // `cycler_polish`: a cancel close (`closeKind: "cancelled"`) recovers
      // only — no links, no mints, rows report `cancelled`.
      const cancelledClose = active.closeKind === "cancelled";
      if (cancelledClose) {
        linkUnblocked = false;
      }
      let today = null;
      try {
        today = typeof active.today === "string" && active.today
          ? active.today
          : typeof this.getScheduleLogDateString === "function"
            ? this.getScheduleLogDateString()
            : formatLocalDate();
      } catch (error) {
        today = formatLocalDate();
      }
      let dailyPath = typeof active.dailyPath === "string" && active.dailyPath
        ? active.dailyPath
        : null;
      if (!dailyPath) {
        try {
          dailyPath = todayDailyPath(this.app);
        } catch (error) {
          dailyPath = null;
        }
      }
      let dailyCurrent = null;
      if (dailyPath) {
        dailyCurrent = await this.readSuccessorNoteText(
          dailyPath,
          active,
          cache,
        );
      }
      const hint = active.closingEntry &&
          typeof active.closingEntry === "object"
        ? active.closingEntry
        : null;
      const dailyBefore = Array.isArray(active.dailyBefore)
        ? active.dailyBefore.map((line) => String(line ?? ""))
        : typeof dailyCurrent === "string"
          ? dailyCurrent.split(/\r?\n/)
          : [];
      const dailyAfter = typeof dailyCurrent === "string"
        ? dailyCurrent.split(/\r?\n/)
        : dailyBefore;
      let planClosingEntry = null;
      if (
        hint && Number.isInteger(hint.line) && hint.line >= 0 &&
        hint.line < dailyBefore.length
      ) {
        planClosingEntry = hint.line;
      }
      const pool = await this.buildSuccessorPool(closedTaskIds, active, cache);
      let tasks = pool.tasks;
      let noteTexts = pool.noteTexts;
      if (!pool.warm) {
        const cold = await this.readSuccessorColdDocuments(active, cache);
        if (cold.documents.length === 0 && !vault) {
          return null;
        }
        tasks = tasksFromDocuments(cold.documents);
        noteTexts = new Map(
          cold.documents.map((document) => [document.path, document.text]),
        );
        for (const [path, text] of pool.noteTexts) {
          if (!noteTexts.has(path)) {
            noteTexts.set(path, text);
          }
        }
      }
      // Basename uniqueness over the same eligible Markdown path set
      // capture walks (`vault_note_paths`): every vault `.md` file minus
      // dot-directories and always-excluded names, unioned with staged
      // and open-editor paths — without reading note bodies. A prose-only
      // same-named sibling must still force the long link form.
      const basenameCounts = countSuccessorBasenames(
        this.app,
        tasks,
        identities,
        dailyPath,
        noteTexts,
      );
      const noteTextsObject = {};
      for (const [path, text] of noteTexts) {
        noteTextsObject[path] = text;
      }
      let plan = null;
      try {
        plan = planSuccessors({
          closed: identities,
          index: buildDependentsIndex(tasks),
          dailyBefore,
          dailyAfter,
          dailyPath: dailyPath || "",
          today,
          linkUnblocked,
          cancelled: cancelledClose,
          isInbox: getSuccessorIsInbox(this.app),
          basenameCounts,
          closingEntry: planClosingEntry,
          noteTexts: noteTextsObject,
        });
      } catch (error) {
        return null;
      }
      if (!plan) {
        return null;
      }
      const noteOutcome = await this.applySuccessorNoteEdits(plan, active);
      // A dependent whose status edit failed is recovered-but-unlinked:
      // drop its placement so no link is inserted for it.
      if (noteOutcome.failed > 0) {
        const failedRows = new Set();
        for (let index = 0; index < plan.unblocked.length; index += 1) {
          if (plan.unblocked[index].not_linked === "failed") {
            failedRows.add(index);
          }
        }
        plan.placements = plan.placements.filter(
          (placement) => !failedRows.has(placement && placement.rowIndex),
        );
      }
      let insertion = { splices: [], links: [], skipped: [], text: null };
      if (plan.placements.length > 0 && dailyPath && dailyCurrent != null) {
        let relocated = null;
        let createdEntry = null;
        if (hint) {
          relocated = this.relocateSuccessorClosingEntry(dailyAfter, hint);
          if (
            relocated == null &&
            plan.placements.some((placement) =>
              !placement || !placement.anchor || placement.anchor.bulletLine == null
            )
          ) {
            for (const placement of plan.placements) {
              if (
                !placement || !placement.anchor ||
                placement.anchor.bulletLine != null
              ) {
                continue;
              }
              const row = plan.unblocked[placement.rowIndex];
              if (row && typeof row === "object" && row.link) {
                row.link = null;
                row.not_linked = "failed";
                noteOutcome.failed += 1;
                if (!noteOutcome.failureReason) {
                  noteOutcome.failureReason = "daily note changed";
                }
              }
            }
          }
          if (relocated != null && hint.createdPomodoro === true) {
            try {
              const entries = parseSuccessorLedgerEntries(dailyAfter);
              const createdName = typeof hint.createdName === "string"
                ? hint.createdName
                : "";
              const created = entries.find((entry) =>
                entry.open && entry.entryLine > relocated &&
                String(entry.name || "") === createdName
              ) || null;
              if (created) {
                createdEntry = { line: created.entryLine };
              }
            } catch (error) {
              createdEntry = null;
            }
          }
        }
        try {
          insertion = planSuccessorInsertions(dailyAfter, plan.placements, {
            ...(relocated != null ? { closingEntry: relocated } : {}),
            ...(createdEntry ? { createdEntry } : {}),
          });
        } catch (error) {
          insertion = { splices: [], links: [], skipped: [], text: null };
        }
        insertion.snapshot = dailyCurrent;
        const dailyOutcome = await this.applySuccessorDailyInsertions(
          plan,
          insertion,
          active,
          dailyPath,
        );
        noteOutcome.failed += dailyOutcome.failed;
        if (!noteOutcome.failureReason && dailyOutcome.failureReason) {
          noteOutcome.failureReason = dailyOutcome.failureReason;
        }
      } else if (plan.placements.length > 0) {
        for (const placement of plan.placements) {
          const row = plan.unblocked[placement && placement.rowIndex];
          if (row && typeof row === "object" && row.link) {
            row.link = null;
            row.not_linked = "failed";
            noteOutcome.failed += 1;
            if (!noteOutcome.failureReason) {
              noteOutcome.failureReason = "daily note unavailable";
            }
          }
        }
      }
      // `cycler_polish`: remember linked rows for the same-day reopen
      // take-back. Capture closes never reach this pass, so they gain no
      // receipt (Alt+N is their per-link undo).
      try {
        if (typeof this.rememberSuccessorPass === "function") {
          this.rememberSuccessorPass(identities, plan, insertion, {
            dailyPath,
            today,
          });
        }
      } catch (error) {
        // Best effort: a missed receipt only loses the take-back shortcut.
      }
      const predecessors = identities.map((identity) => ({
        note_path: String(identity.path || ""),
        block_id: identity.blockId ? String(identity.blockId) : "",
        text: identity.text ? String(identity.text) : "",
      }));
      let dailyContent = null;
      if (
        dailyPath &&
        (plan.unblocked.length > 0 || noteOutcome.failed > 0)
      ) {
        try {
          cache.delete(dailyPath);
          dailyContent = await this.readSuccessorNoteText(
            dailyPath,
            active,
            cache,
          );
        } catch (error) {
          dailyContent = null;
        }
        if (typeof dailyContent !== "string") {
          dailyContent = null;
        }
      }
      return {
        version: 1,
        predecessors,
        unblocked: plan.unblocked,
        still_blocked: plan.still_blocked,
        daily_path: dailyPath || "",
        daily_content: dailyContent,
        failure: noteOutcome.failed > 0
          ? {
            count: noteOutcome.failed,
            reason: noteOutcome.failureReason || "daily note changed",
          }
          : null,
      };
    } catch (error) {
      return null;
    }
  }

  // Plain-text form of a successor model for the walk toast, the
  // `completeTaskAtCursor` additive result, and the no-nav fallback. Null
  // when there is nothing to say (no unblocked rows and no failure).
  successorNoticeForModel(model) {
    try {
      if (!model || typeof model !== "object") {
        return null;
      }
      const text = successorNoticeText(model);
      return text ? String(text) : null;
    } catch (error) {
      return null;
    }
  }

  // Present exactly one notice for a successor model. Walk and cursor-api
  // callers pass `{ successorNoticeTarget: "return" }` to compose the text
  // themselves and show nothing here; every other close shows the nav
  // Unblocked card, falling back to a plain Notice without nav. Resolves to
  // the shown/composed text, or null when silent. Never throws.
  presentSuccessorModel(model, context) {
    try {
      const text = this.successorNoticeForModel(model);
      if (!text) {
        return null;
      }
      const active = context && typeof context === "object" ? context : {};
      if (active.successorNoticeTarget === "return") {
        return text;
      }
      const api = this.getNavNoticeApi();
      if (api) {
        try {
          const shown = api.showUnblocked(model);
          if (shown !== false) {
            return text;
          }
        } catch (error) {
          // Fall through to the plain Notice.
        }
      }
      try {
        new Notice(text);
      } catch (error) {
        // Best effort: the close already landed.
      }
      return text;
    } catch (error) {
      return null;
    }
  }
}
