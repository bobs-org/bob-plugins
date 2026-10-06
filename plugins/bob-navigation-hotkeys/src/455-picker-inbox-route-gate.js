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
    let route = { kind: "cancel" };
    try {
      const suspend = this.inboxRouteSuspendPair();
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
    if (!route || route.kind === "cancel") {
      this.inboxRouteCommitInFlight = false;
      this.reviewSettleDeferred = false;
      try {
        if (this.modalEl && typeof this.modalEl.removeClass === "function") {
          this.modalEl.removeClass("bob-task-card-suspended");
        } else if (this.modalEl && this.modalEl.classList) {
          this.modalEl.classList.remove("bob-task-card-suspended");
        }
      } catch (error) {
        // Best-effort restore only.
      }
      try {
        const focusTarget =
          this.stage === "task-card" ? this.taskCardListEl : this.inputEl;
        if (focusTarget && typeof focusTarget.focus === "function") {
          focusTarget.focus();
        }
      } catch (error) {
        // Focus restore never throws.
      }
      return false;
    }
    if (route.kind === "stay") {
      let result = false;
      try {
        result = await runWrite();
      } finally {
        this.inboxRouteCommitInFlight = false;
        this.reviewSettleDeferred = false;
      }
      return result;
    }
    if (!route || route.kind !== "move" || !route.path) {
      this.inboxRouteCommitInFlight = false;
      this.reviewSettleDeferred = false;
      return false;
    }
    let result = false;
    try {
      result = await runWrite();
    } catch (error) {
      this.inboxRouteCommitInFlight = false;
      this.reviewSettleDeferred = false;
      return false;
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
