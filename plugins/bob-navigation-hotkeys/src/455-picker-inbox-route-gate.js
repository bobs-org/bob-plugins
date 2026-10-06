// Task Card inbox-route gate (task-card-gate): one helper,
// `runInboxRoutedCommit(action, write)`, that routes every non-closing
// single and counted Task Card commit on an inbox task through the route
// picker (prompt, write, move, settle the walk once). Armed only when
// `openBulletPropertyPicker` attached `inboxRoute` context (inbox note +
// open #task, never link sessions). Closing actions, unarmed pickers, and
// re-entrant nested writers bypass with `await write()`. Cancel restores
// the card with nothing written; stay restores and runs today's write;
// move writes then moves via `plugin.commitInboxRoute`, settling exactly
// once with a `route` walk outcome. Never throws.
class BulletPropertyPickerInboxRouteGateMixin extends FilteredPickerModal {
  isInboxRouteArmed() {
    try {
      if (!this.inboxRoute || typeof this.inboxRoute !== "object") {
        return false;
      }
      if (typeof this.isLinkSession === "function" && this.isLinkSession()) {
        return false;
      }
      if (!this.filePath) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  isInboxRouteClosingAction(action) {
    try {
      if (!action || typeof action !== "object") {
        return false;
      }
      if (action.closing === true) {
        return true;
      }
      if (action.id === "cancel" || action.kind === "cancel" || action.kind === "cancel-task") {
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  inboxRouteSuspendPair() {
    const modalEl = this.modalEl || null;
    let focusTarget = null;
    try {
      focusTarget =
        this.stage === "task-card" ? this.taskCardListEl : this.inputEl;
    } catch (error) {
      focusTarget = null;
    }
    let fallbackActive = null;
    try {
      fallbackActive =
        typeof document !== "undefined" && document.activeElement
          ? document.activeElement
          : null;
    } catch (error) {
      fallbackActive = null;
    }
    return {
      isAlive: () => {
        try {
          return this.pickerOpen !== false;
        } catch (error) {
          return false;
        }
      },
      hide: () => {
        try {
          if (modalEl && typeof modalEl.addClass === "function") {
            modalEl.addClass("bob-task-card-suspended");
          } else if (modalEl && modalEl.classList) {
            modalEl.classList.add("bob-task-card-suspended");
          }
        } catch (error) {
          // Suspension is visual only.
        }
      },
      restore: () => {
        try {
          if (modalEl && typeof modalEl.removeClass === "function") {
            modalEl.removeClass("bob-task-card-suspended");
          } else if (modalEl && modalEl.classList) {
            modalEl.classList.remove("bob-task-card-suspended");
          }
        } catch (error) {
          // Restore is best-effort.
        }
        try {
          const target = focusTarget || fallbackActive;
          if (target && typeof target.focus === "function") {
            target.focus();
          }
        } catch (error) {
          // Focus restore never throws.
        }
      },
    };
  }

  captureInboxRouteTargets() {
    try {
      const session = this.taskSession;
      if (
        session &&
        session.explicit === true &&
        Array.isArray(session.targets) &&
        session.targets.length > 0
      ) {
        const startLine = session.targets[0].line;
        return {
          startLine: Number.isInteger(startLine) ? startLine : null,
          additionalTaskCount: Math.max(0, session.targets.length - 1),
          expected: captureInboxRouteExpected(
            session.targets.map((target) => ({
              line: target.line,
              rawLine: target.rawLine,
              raw: target.rawLine,
            })),
          ),
        };
      }
      const line = Number.isInteger(this.reviewLineIndex)
        ? this.reviewLineIndex
        : this.cursor && Number.isInteger(this.cursor.line)
          ? this.cursor.line
          : null;
      const raw =
        typeof this.reviewBeforeLine === "string" && this.reviewBeforeLine
          ? this.reviewBeforeLine
          : typeof this.lineText === "string"
            ? this.lineText
            : "";
      if (line === null) {
        return { startLine: null, additionalTaskCount: 0, expected: [] };
      }
      return {
        startLine: line,
        additionalTaskCount: 0,
        expected: captureInboxRouteExpected([{ line, rawLine: raw, raw }]),
      };
    } catch (error) {
      return { startLine: null, additionalTaskCount: 0, expected: [] };
    }
  }

  inboxRouteIsAlive(suspend) {
    try {
      if (this.pickerOpen === false) {
        return false;
      }
      if (suspend && typeof suspend.isAlive === "function") {
        try {
          if (suspend.isAlive() === false) {
            return false;
          }
        } catch (error) {
          return false;
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  async captureInboxRouteWriteSnapshot() {
    let editorContent = null;
    try {
      editorContent =
        this.editor && typeof this.editor.getValue === "function"
          ? String(this.editor.getValue() || "")
          : null;
    } catch (error) {
      editorContent = null;
    }
    const vaultContents = new Map();
    try {
      const plugin = this.plugin;
      const vault = plugin && plugin.app && plugin.app.vault;
      if (vault && typeof vault.getMarkdownFiles === "function") {
        const files = vault.getMarkdownFiles() || [];
        for (const file of files) {
          if (!file || typeof file.path !== "string") {
            continue;
          }
          let content = null;
          try {
            if (
              plugin &&
              typeof plugin.getTaskMoveFileSnapshot === "function" &&
              typeof plugin.isMarkdownFile === "function"
            ) {
              try {
                if (plugin.isMarkdownFile(file) !== true) {
                  continue;
                }
              } catch (ignoredError) {
                // Fall through to a direct read.
              }
              const snapshot = await plugin.getTaskMoveFileSnapshot(file);
              content = String(snapshot && snapshot.content !== undefined ? snapshot.content : "");
            } else if (typeof vault.cachedRead === "function") {
              content = String((await vault.cachedRead(file)) || "");
            } else if (typeof vault.read === "function") {
              content = String((await vault.read(file)) || "");
            } else {
              continue;
            }
          } catch (error) {
            continue;
          }
          vaultContents.set(file.path, content);
        }
      }
    } catch (error) {
      // Vault snapshot is best-effort; editor content still guards the common case.
    }
    return { editorContent, vaultContents };
  }

  async didInboxRouteWriteChange(before) {
    try {
      let afterEditor = null;
      try {
        afterEditor =
          this.editor && typeof this.editor.getValue === "function"
            ? String(this.editor.getValue() || "")
            : null;
      } catch (error) {
        afterEditor = null;
      }
      if (
        before &&
        before.editorContent !== null &&
        afterEditor !== null &&
        afterEditor !== before.editorContent
      ) {
        return true;
      }
      const plugin = this.plugin;
      const vault = plugin && plugin.app && plugin.app.vault;
      if (
        vault &&
        typeof vault.getMarkdownFiles === "function" &&
        before &&
        before.vaultContents instanceof Map
      ) {
        const files = vault.getMarkdownFiles() || [];
        for (const file of files) {
          if (!file || typeof file.path !== "string") {
            continue;
          }
          if (!before.vaultContents.has(file.path)) {
            continue;
          }
          let content = null;
          let readOk = false;
          try {
            if (
              plugin &&
              typeof plugin.getTaskMoveFileSnapshot === "function"
            ) {
              const snapshot = await plugin.getTaskMoveFileSnapshot(file);
              content = String(snapshot && snapshot.content !== undefined ? snapshot.content : "");
              readOk = true;
            } else if (typeof vault.cachedRead === "function") {
              content = String((await vault.cachedRead(file)) || "");
              readOk = true;
            } else if (typeof vault.read === "function") {
              content = String((await vault.read(file)) || "");
              readOk = true;
            }
          } catch (error) {
            continue;
          }
          if (readOk && content !== before.vaultContents.get(file.path)) {
            return true;
          }
        }
      }
      // When neither the editor nor any snapshotted vault file changed, the
      // action wrote zero bytes: a genuine no-op even when the writer
      // returned a truthy "unchanged" success. A genuine auxiliary-file
      // action changes at least one vault file, so it still counts.
      return false;
    } catch (error) {
      return true;
    }
  }

  settleInboxRouteDeadOrigin() {
    try {
      const origin = this.reviewOrigin || null;
      if (!origin) {
        return;
      }
      this.reviewOrigin = null;
      const plugin = this.plugin;
      if (plugin && typeof plugin.continueReviewWalkAfter === "function") {
        try {
          void plugin.continueReviewWalkAfter(origin, null);
        } catch (error) {
          // Settle is best-effort after close.
        }
      }
    } catch (error) {
      // Never throws out of a dead-card path.
    }
  }

  inboxRouteCardFallbackRefs() {
    try {
      const session = this.taskSession;
      if (
        session &&
        session.explicit === true &&
        Array.isArray(session.targets) &&
        session.targets.length > 0
      ) {
        return session.targets
          .filter((target) => target && Number.isInteger(target.line))
          .map((target) => ({
            path: this.filePath || null,
            line: target.line,
            raw: String(target.rawLine ?? ""),
          }));
      }
      return [
        {
          path: this.filePath || null,
          line: this.reviewLineIndex,
          raw:
            typeof this.reviewBeforeLine === "string"
              ? this.reviewBeforeLine
              : "",
        },
      ];
    } catch (error) {
      return [];
    }
  }

  async runInboxRoutedCommit(action, write) {
    const runWrite = typeof write === "function" ? write : async () => false;
    try {
      if (
        !this.isInboxRouteArmed() ||
        this.isInboxRouteClosingAction(action) ||
        this.inboxRouteCommitInFlight === true
      ) {
        return await runWrite();
      }
    } catch (error) {
      try {
        return await runWrite();
      } catch (ignoredError) {
        return false;
      }
    }
    const plugin = this.plugin;
    if (
      !plugin ||
      typeof plugin.promptInboxRoute !== "function" ||
      typeof plugin.commitInboxRoute !== "function"
    ) {
      return await runWrite();
    }
    let actionLabel = "apply";
    try {
      actionLabel = formatInboxRouteActionLabel(action);
    } catch (error) {
      actionLabel = "apply";
    }
    const captured = this.captureInboxRouteTargets();
    if (captured.startLine === null || captured.expected.length === 0) {
      return await runWrite();
    }
    const { startLine, additionalTaskCount, expected } = captured;
    const sourcePath = this.filePath;
    this.reviewSettleDeferred = true;
    this.inboxRouteCommitInFlight = true;
    const suspend = this.inboxRouteSuspendPair();
    let route = { kind: "cancel" };
    try {
      route = await plugin.promptInboxRoute({
        editor: this.editor,
        sourcePath,
        startLine,
        additionalTaskCount,
        actionLabel,
        reservedBlockIds: new Set(),
        suspend,
        cancelLabel: "back",
      });
    } catch (error) {
      route = { kind: "cancel" };
    }
    // Lifetime recheck: closing the Task Card or unloading nav while the
    // route is pending cancels that route. A delayed prompt or preflight
    // result after close must never write. Settle the captured origin once
    // so the walk lock is released without advancing.
    if (this.inboxRouteIsAlive(suspend) !== true) {
      this.inboxRouteCommitInFlight = false;
      this.reviewSettleDeferred = false;
      this.settleInboxRouteDeadOrigin();
      return false;
    }
    if (!route || route.kind === "cancel") {
      this.inboxRouteCommitInFlight = false;
      this.reviewSettleDeferred = false;
      // Ordinary route Esc restores the still-live card/stage with its
      // input and focus intact; nothing was written.
      try {
        if (typeof suspend.restore === "function") {
          suspend.restore();
        } else {
          if (this.modalEl && typeof this.modalEl.removeClass === "function") {
            this.modalEl.removeClass("bob-task-card-suspended");
          } else if (this.modalEl && this.modalEl.classList) {
            this.modalEl.classList.remove("bob-task-card-suspended");
          }
          try {
            const focusTarget =
              this.stage === "task-card" ? this.taskCardListEl : this.inputEl;
            if (focusTarget && typeof focusTarget.focus === "function") {
              focusTarget.focus();
            }
          } catch (focusError) {
            // Focus restore never throws.
          }
        }
      } catch (error) {
        // Best-effort restore only.
      }
      return false;
    }
    if (route.kind === "stay") {
      let result = false;
      try {
        if (this.inboxRouteIsAlive(suspend) !== true) {
          this.inboxRouteCommitInFlight = false;
          this.reviewSettleDeferred = false;
          this.settleInboxRouteDeadOrigin();
          return false;
        }
        result = await runWrite();
      } finally {
        this.inboxRouteCommitInFlight = false;
        this.reviewSettleDeferred = false;
      }
      // A stay that wrote nothing still preserves today's settlement: the
      // cleared deferral lets onClose settle normally as a card outcome.
      return result;
    }
    if (!route || route.kind !== "move" || !route.path) {
      this.inboxRouteCommitInFlight = false;
      this.reviewSettleDeferred = false;
      return false;
    }
    // Snapshot before the write so a truthy "unchanged" writer result
    // cannot move. Public writer return behavior is preserved; the route
    // boundary independently verifies that at least one byte changed in
    // the editor or any vault note (task line, children, or auxiliary
    // dependency/Pomodoro files).
    const writeSnapshot = await this.captureInboxRouteWriteSnapshot();
    let result = false;
    try {
      if (this.inboxRouteIsAlive(suspend) !== true) {
        this.inboxRouteCommitInFlight = false;
        this.reviewSettleDeferred = false;
        this.settleInboxRouteDeadOrigin();
        return false;
      }
      result = await runWrite();
    } catch (error) {
      this.inboxRouteCommitInFlight = false;
      this.reviewSettleDeferred = false;
      return false;
    }
    if (this.inboxRouteIsAlive(suspend) !== true) {
      this.inboxRouteCommitInFlight = false;
      this.reviewSettleDeferred = false;
      this.settleInboxRouteDeadOrigin();
      return result === true ? true : result;
    }
    const committed =
      result === true ||
      (result &&
        typeof result === "object" &&
        (result.deleted === true ||
          result.ok === true ||
          result.applied === true));
    if (!committed) {
      this.inboxRouteCommitInFlight = false;
      this.reviewSettleDeferred = false;
      return result;
    }
    let wroteAny = true;
    try {
      wroteAny = await this.didInboxRouteWriteChange(writeSnapshot);
    } catch (error) {
      wroteAny = true;
    }
    if (wroteAny !== true) {
      // All-unchanged/no-eligible results never move, even when the writer
      // reported success. Clear the deferral so today's card settlement
      // applies; the caller still sees its ordinary truthy result.
      this.inboxRouteCommitInFlight = false;
      this.reviewSettleDeferred = false;
      return result;
    }
    let move = null;
    try {
      move = await plugin.commitInboxRoute({
        editor: this.editor,
        sourcePath,
        startLine,
        additionalTaskCount,
        expected,
        destinationPath: route.path,
      });
    } catch (error) {
      move = null;
    }
    if (!move) {
      move = {
        ok: false,
        reason: "route-failed",
        notice: "",
        handledRefs: [],
        destinationName: "",
        destinationPath: route.path,
      };
    }
    this.inboxRouteResult = move;
    this.inboxRouteCommitInFlight = false;
    const origin = this.reviewOrigin || null;
    const inboxName =
      (this.inboxRoute && this.inboxRoute.inboxName) ||
      getVaultPathBasenameWithoutExtension(sourcePath) ||
      "inbox";
    if (origin && typeof plugin.continueReviewWalkAfter === "function") {
      this.reviewOrigin = null;
      this.reviewSettleDeferred = false;
      try {
        if (move.ok === true) {
          void plugin.continueReviewWalkAfter(origin, {
            kind: "route",
            handledRefs: Array.isArray(move.handledRefs)
              ? move.handledRefs
              : [],
            notice: String(move.notice || ""),
          });
        } else {
          let afterLine = "";
          try {
            const live =
              this.editor && Number.isInteger(this.reviewLineIndex)
                ? getEditorLine(this.editor, this.reviewLineIndex)
                : null;
            afterLine = typeof live === "string" ? live : "";
          } catch (error) {
            afterLine = "";
          }
          const partial = String(
            move.notice || `Not moved · still in ${inboxName}`,
          );
          void plugin.continueReviewWalkAfter(origin, {
            kind: "card",
            beforeLine:
              typeof this.reviewBeforeLine === "string"
                ? this.reviewBeforeLine
                : "",
            afterLine,
            handledRefs: this.inboxRouteCardFallbackRefs(),
            notice: partial,
          });
        }
      } catch (error) {
        // Settle is best-effort after the move.
      }
      return result;
    }
    this.reviewSettleDeferred = false;
    try {
      if (move.ok === true) {
        new Notice(String(move.notice || ""));
      } else {
        new Notice(String(move.notice || `Not moved · still in ${inboxName}`));
      }
    } catch (error) {
      // Notices are best-effort off the walk.
    }
    return result;
  }

  describeInboxRouteLaneAction() {
    try {
      const content =
        typeof this.getEditorContent === "function"
          ? this.getEditorContent()
          : "";
      if (this.isCountedSession && this.isCountedSession()) {
        return { label: "toggle lane" };
      }
      const line =
        this.cursor && Number.isInteger(this.cursor.line)
          ? String(
              (splitMarkdownContent(content).lines[this.cursor.line] || ""),
            )
          : String(this.lineText || "");
      const status = getObsidianTaskCheckboxStatus(line);
      if (status === "*") {
        return { label: "commit to Next" };
      }
      if (status === "/" || status === " ") {
        return { label: "release to Ready" };
      }
      return { label: "toggle lane" };
    } catch (error) {
      return { label: "toggle lane" };
    }
  }

  async applyInboxRoutedLaneToggle(options = {}) {
    const action = this.describeInboxRouteLaneAction();
    const write = async () =>
      await this.plugin.applyLaneToggleFromPicker(this, options);
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(action, write);
    }
    return await write();
  }

  async applyInboxRoutedRefreshCustom(query) {
    const custom = parseRefreshCustomValue(query);
    if (custom === null) {
      return false;
    }
    const action = { label: `review every ${custom}d` };
    const write = async () =>
      await this.plugin.applyRefreshIntervalFromPicker(
        this,
        Object.freeze({
          kind: "value",
          value: custom,
          label: `${custom} days`,
          refreshDays: custom,
        }),
      );
    if (typeof this.runInboxRoutedCommit === "function") {
      return await this.runInboxRoutedCommit(action, write);
    }
    return await write();
  }
}
