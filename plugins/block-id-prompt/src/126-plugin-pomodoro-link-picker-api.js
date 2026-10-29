// Versioned Pomodoro link picker api (docs/task-dependencies.md §12.13,
// obsidian_destination phase): nav's successor picker chains
// Ctrl+Shift+Enter here to retarget rows per row. `pick()` resolves today's
// daily note (open editor value first, vault read otherwise), opens the
// shared PomodoroLinkPickerModal with optional task context, and resolves
// `{kind: "existing", entryLine, entryText, title} | {kind: "new", name} |
// null`. Never rejects; null means none (cancel, unload, missing note, no
// Pomodoros section, or a second call while one picker is already open).
function normalizePomodoroLinkPickerChoice(choice) {
  try {
    if (!choice || typeof choice !== "object") {
      return null;
    }
    if (choice.kind === "existing") {
      if (!Number.isInteger(choice.entryLine) || choice.entryLine < 0) {
        return null;
      }
      if (typeof choice.entryText !== "string" || !choice.entryText) {
        return null;
      }
      const title = typeof choice.title === "string" ? choice.title : "";
      // A malformed optional intent is dropped so it can never enable a
      // write; absent intent keeps the legacy return shape. API version
      // stays 1.
      const existingIntent = normalizePomodoroLinkPickerThemeIntent(choice.themeIntent);
      return {
        kind: "existing",
        entryLine: choice.entryLine,
        entryText: choice.entryText,
        title,
        ...(existingIntent ? { themeIntent: existingIntent } : {}),
      };
    }
    if (choice.kind === "new") {
      const name = typeof choice.name === "string" ? choice.name.trim() : "";
      if (!name || /[\r\n]/.test(name)) {
        return null;
      }
      const newIntent = normalizePomodoroLinkPickerThemeIntent(choice.themeIntent);
      return {
        kind: "new",
        name,
        ...(choice.preserveSpelling === true ? { preserveSpelling: true } : {}),
        ...(newIntent ? { themeIntent: newIntent } : {}),
      };
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function createPomodoroLinkPickerApi(plugin) {
  return Object.freeze({
    version: 1,
    pick(request) {
      try {
        if (
          !plugin ||
          typeof plugin.pickPomodoroLinkDestination !== "function"
        ) {
          return Promise.resolve(null);
        }
        return Promise.resolve()
          .then(() => plugin.pickPomodoroLinkDestination(request || {}))
          .then((choice) => {
            try {
              return normalizePomodoroLinkPickerChoice(choice);
            } catch (_error) {
              return null;
            }
          })
          .catch(() => null);
      } catch (_error) {
        return Promise.resolve(null);
      }
    },
  });
}

class BlockIdPromptPomodoroLinkPickerApiMixin {
  // Test seam for the versioned api: resolves today's daily content, opens
  // the picker, and resolves its choice. Never throws (null carries every
  // refusal); holds `promptOpen` while the modal is up.
  async pickPomodoroLinkDestination(apiRequest) {
    if (this.promptOpen === true || this.activePomodoroLinkPicker) {
      return null;
    }
    try {
      const dailyFile = this.resolveTodayDailyFile();
      if (!dailyFile) {
        return null;
      }
      let dailyContent = null;
      try {
        const open = findOpenPromptTargetEditors(this, dailyFile.path);
        if (open.length > 0) {
          dailyContent = open[0].content;
        } else {
          dailyContent = await this.app.vault.read(dailyFile);
        }
      } catch (_error) {
        return null;
      }
      if (typeof dailyContent !== "string") {
        return null;
      }
      const model = buildPomodoroLinkPickerModel(dailyContent, {
        now: this.now(),
      });
      if (!model || model.ok !== true) {
        return null;
      }

      const candidateTask = apiRequest && apiRequest.task;
      const taskContext = candidateTask &&
        typeof candidateTask.path === "string" && candidateTask.path &&
        Number.isInteger(candidateTask.line) && candidateTask.line >= 1 &&
        typeof candidateTask.text === "string"
        ? {
          path: candidateTask.path,
          line: candidateTask.line,
          text: candidateTask.text,
        }
        : null;
      const taskFile = taskContext
        ? (() => {
          try {
            return this.resolveTaskFile(taskContext.path) || { path: taskContext.path };
          } catch (_error) {
            return { path: taskContext.path };
          }
        })()
        : null;
      const budget = taskContext
        ? createBlockPomodoroLinkPickerBudget(this, {
          dailyContent,
          dailyPath: dailyFile.path,
          task: taskContext,
          taskFile,
          taskPath: taskFile.path,
        })
        : null;
      const themeSnapshot = taskContext
        ? safeBlockPomodoroThemePickerSnapshot(
          this.app,
          model,
          taskContext,
          budget.current,
        )
        : null;
      attachBlockPomodoroThemePickerSnapshot(model, themeSnapshot);
      const displayText = taskContext && typeof candidateTask.displayText === "string"
        ? candidateTask.displayText
        : "Successor pull-in";
      const status = taskContext && typeof candidateTask.status === "string"
        ? candidateTask.status
        : " ";
      // The task line text powers the footer's pending-edit preview; its
      // presence marks the pick task-aware even when no suggestion resolved.
      const taskLineText = taskContext ? taskLineTextAt(taskContext.text, taskContext.line) : "";
      const pickerRequest = {
        model,
        task: taskContext
          ? { displayText, status, lineText: taskLineText }
          : { displayText, status },
        needsBlockId: false,
        now: this.now(),
        budget,
      };
      let modal = null;
      this.promptOpen = true;
      try {
        modal = new PomodoroLinkPickerModal(this.app, pickerRequest);
        this.activePomodoroLinkPicker = modal;
        modal.open();
        return await modal.waitForChoice();
      } catch (_error) {
        return null;
      } finally {
        this.activePomodoroLinkPicker = null;
        this.promptOpen = false;
      }
    } catch (_error) {
      return null;
    }
  }

  closePomodoroLinkPickerForUnload() {
    const modal = this.activePomodoroLinkPicker;
    this.activePomodoroLinkPicker = null;
    if (modal) {
      try {
        modal.close();
      } catch (_error) {
        try {
          modal.settleChoice(null);
        } catch (_settleError) {
          // Teardown is best effort during unload.
        }
      }
    }
  }
}
