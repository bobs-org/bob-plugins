// Shared Task Link meter for direct picker opens and the versioned public API.
// The task's own line text (one-based line into the full live note) powers
// the footer's pending-edit preview; its presence marks a pick task-aware.
// Anything unreadable degrades to "" while staying task-aware.
function taskLineTextAt(text, oneBasedLine) {
  try {
    if (typeof text !== "string" || !Number.isInteger(oneBasedLine) || oneBasedLine < 1) {
      return "";
    }
    const lines = text.split("\n");
    return oneBasedLine - 1 < lines.length ? lines[oneBasedLine - 1] : "";
  } catch (_error) {
    return "";
  }
}

function createBlockPomodoroLinkPickerBudget(plugin, dailyContent) {
  return { current: plugin.readPlanBudgetMeter(dailyContent) };
}

function attachBlockPomodoroThemePickerSnapshot(model, snapshot) {
  if (!model || !snapshot) {
    return;
  }
  model.themeSnapshot = snapshot;
  model.themeSuggestion = snapshot.suggestion;
  model.themePreselection = snapshot.choice;
}

class BlockIdPromptPomodoroLinkPickerMixin {
  // Test seam for the "Link to today" picker: opens the modal and resolves
  // its choice. Never throws (logs and resolves null).
  async promptPomodoroLinkTarget(request) {
    try {
      const modal = new PomodoroLinkPickerModal(this.app, request);
      modal.open();
      return await modal.waitForChoice();
    } catch (error) {
      try {
        console.error("Block ID Prompt pomodoro picker failed", error);
      } catch (ignoredError) {
        // Logging is best effort; the null below carries the refusal.
      }
      return null;
    }
  }

  // Preflight plus picker for the Ctrl+Shift+Enter link direction. Resolves
  // today's daily note and reads its snapshot (the live editor value when
  // the task note is the daily note), refuses with today's Notice texts and
  // opens nothing when the note is missing, unreadable, or has no
  // `## Pomodoros` section, otherwise opens the picker with `promptOpen`
  // held true and resolves its choice (or null on cancel).
  async choosePomodoroLinkTarget(source) {
    let heldPromptOpen = false;
    try {
      const dailyFile = this.resolveTodayDailyFile();
      if (!dailyFile) {
        new Notice("Task link blocked: today's daily note could not be found");
        return null;
      }

      const taskFile = this.resolveTaskFile(source.sourcePath);
      const sameNote = Boolean(taskFile && dailyFile.path === taskFile.path);
      const dailyContent = sameNote
        ? source.editor.getValue()
        : await this.readFileSnapshot(dailyFile, source);
      if (dailyContent === null) {
        new Notice(`Task link blocked: ${dailyFile.path} could not be read`);
        return null;
      }

      const model = buildPomodoroLinkPickerModel(dailyContent, {
        now: this.now(),
      });
      if (!model || model.ok !== true) {
        new Notice(`Task link blocked: ${dailyFile.path} has no Pomodoros section`);
        return null;
      }

      const task = (source && source.task) || {};
      const needsBlockId = !task.existingId;
      const displayText =
        task.displayText ||
        (typeof task.rawLine === "string" ? cleanTaskDisplayText(task.rawLine) : "(untitled task)");
      const budget = createBlockPomodoroLinkPickerBudget(this, dailyContent);
      let taskText = "";
      try {
        taskText = source.editor.getValue();
      } catch (_error) {
        taskText = "";
      }
      const themeSnapshot = safeBlockPomodoroThemePickerSnapshot(
        this.app,
        model,
        pomodoroLinkThemeTaskContext(source, taskText),
      );
      attachBlockPomodoroThemePickerSnapshot(model, themeSnapshot);

      // The task's own line (source.line is zero-based) powers the footer's
      // pending-edit preview; the direct gesture is always task-aware.
      const request = {
        model,
        task: {
          displayText,
          status: task.status,
          lineText: taskLineTextAt(taskText, Number.isInteger(source.line) ? source.line + 1 : 0),
        },
        needsBlockId,
        now: this.now(),
        budget,
      };
      const routeGate = source && source.inboxRouteGate;
      if (routeGate && routeGate.kind === "move" && typeof routeGate.name === "string" && routeGate.name) {
        request.route = { name: routeGate.name };
      }

      this.promptOpen = true;
      heldPromptOpen = true;
      try {
        return await this.promptPomodoroLinkTarget(request);
      } finally {
        this.promptOpen = false;
        heldPromptOpen = false;
      }
    } catch (error) {
      try {
        console.error("Block ID Prompt pomodoro picker failed", error);
      } catch (ignoredError) {
        // Logging is best effort; the null below carries the refusal.
      }
      if (heldPromptOpen) {
        this.promptOpen = false;
      }
      return null;
    }
  }
}
