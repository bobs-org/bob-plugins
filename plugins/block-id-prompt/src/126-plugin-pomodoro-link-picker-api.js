// Versioned Pomodoro link picker api (docs/task-dependencies.md §12.13,
// obsidian_destination phase): nav's successor picker chains
// Ctrl+Shift+Enter here to retarget rows per row. `pick()` resolves today's
// daily note (open editor value first, vault read otherwise), opens the
// shared PomodoroLinkPickerModal with a generic successor task, and resolves
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
      return {
        kind: "existing",
        entryLine: choice.entryLine,
        entryText: choice.entryText,
        title,
      };
    }
    if (choice.kind === "new") {
      const name = typeof choice.name === "string" ? choice.name.trim() : "";
      if (!name || /[\r\n]/.test(name)) {
        return null;
      }
      return { kind: "new", name };
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
  async pickPomodoroLinkDestination(_request) {
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
      const request = {
        model,
        task: { displayText: "Successor pull-in", status: " " },
        needsBlockId: false,
        now: this.now(),
        budget: null,
      };
      let modal = null;
      this.promptOpen = true;
      try {
        modal = new PomodoroLinkPickerModal(this.app, request);
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
