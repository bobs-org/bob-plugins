// Shared meter and creation projection for direct picker opens and the
// versioned public API. A supplied task is projected through the same guarded
// Pomodoro insertion planner in either entry point.
function createBlockPomodoroLinkPickerBudget(plugin, options = {}) {
  const current = plugin.readPlanBudgetMeter(options.dailyContent);
  const task = options.task || {};
  const taskFile = options.taskFile || null;
  const dailyContent = options.dailyContent;
  const dailyPath = options.dailyPath;
  const taskPath = options.taskPath || (taskFile && taskFile.path) || task.path || "";
  return {
    current,
    forNewName(name) {
      try {
        const canonical = canonicalizePomodoroLinkName(name);
        if (!canonical.valid) {
          return null;
        }
        const blockId = task.existingId || task.blockId || task.id || "pomodoro-picker-projection";
        let linkTargetText = "";
        try {
          if (taskFile && dailyPath !== taskFile.path) {
            linkTargetText = plugin.buildPomodoroLinkTargetText(taskFile, dailyPath);
          }
        } catch (_error) {
          linkTargetText = "";
        }
        let linkText = null;
        try {
          linkText = sourceReplacement(
            { targetText: linkTargetText, aliasSuffix: "" },
            blockId,
            CANONICAL_BLOCK_LINK_PREFIX,
          );
        } catch (_error) {
          return null;
        }
        const planned = planExplicitPomodoroLinkInsertion(dailyContent, {
          blockId,
          targetPath: taskPath,
          sourcePath: dailyPath,
          resolveTarget: (reference, referrerPath) =>
            plugin.resolveReferenceDestination(reference, referrerPath),
          linkText,
          target: { kind: "new", name: canonical.name },
        });
        if (!planned || planned.error || typeof planned.content !== "string") {
          return null;
        }
        return plugin.readPlanBudgetMeter(planned.content);
      } catch (_error) {
        return null;
      }
    },
  };
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
      const pickerSnapshot = dailyContent;
      const pickerDailyPath = dailyFile.path;
      const pickerTaskPath = taskFile ? taskFile.path : source.sourcePath;
      const budget = createBlockPomodoroLinkPickerBudget(this, {
        dailyContent: pickerSnapshot,
        dailyPath: pickerDailyPath,
        task,
        taskFile,
        taskPath: pickerTaskPath,
      });
      let taskText = "";
      try {
        taskText = source.editor.getValue();
      } catch (_error) {
        taskText = "";
      }
      const themeSnapshot = safeBlockPomodoroThemePickerSnapshot(
        this.app,
        model,
        {
          path: source.sourcePath,
          line: source.line + 1,
          text: taskText,
        },
        budget.current,
      );
      attachBlockPomodoroThemePickerSnapshot(model, themeSnapshot);

      const request = {
        model,
        task: { displayText, status: task.status },
        needsBlockId,
        now: this.now(),
        budget,
      };

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
