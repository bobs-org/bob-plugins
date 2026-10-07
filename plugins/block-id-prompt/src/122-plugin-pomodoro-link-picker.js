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
      const current = this.readPlanBudgetMeter(dailyContent);
      const pickerSnapshot = dailyContent;
      const pickerDailyPath = dailyFile.path;
      const pickerTaskPath = taskFile ? taskFile.path : source.sourcePath;
      const plugin = this;
      const budget = {
        current,
        forNewName(name) {
          try {
            const canonical = canonicalizePomodoroLinkName(name);
            if (!canonical.valid) {
              return null;
            }
            const blockId = task.existingId || "pomodoro-picker-projection";
            let linkTargetText = "";
            try {
              if (taskFile && pickerDailyPath !== taskFile.path) {
                linkTargetText = plugin.buildPomodoroLinkTargetText(
                  taskFile,
                  pickerDailyPath,
                );
              }
            } catch (error) {
              linkTargetText = "";
            }
            let linkText = null;
            try {
              linkText = sourceReplacement(
                { targetText: linkTargetText, aliasSuffix: "" },
                blockId,
                CANONICAL_BLOCK_LINK_PREFIX,
              );
            } catch (error) {
              return null;
            }
            const planned = planExplicitPomodoroLinkInsertion(pickerSnapshot, {
              blockId,
              targetPath: pickerTaskPath,
              sourcePath: pickerDailyPath,
              resolveTarget: (reference, referrerPath) =>
                plugin.resolveReferenceDestination(reference, referrerPath),
              linkText,
              target: { kind: "new", name: canonical.name },
            });
            if (!planned || planned.error || typeof planned.content !== "string") {
              return null;
            }
            return plugin.readPlanBudgetMeter(planned.content);
          } catch (error) {
            return null;
          }
        },
      };

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
