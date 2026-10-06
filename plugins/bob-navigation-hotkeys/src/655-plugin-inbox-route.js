// Inbox routing core (route-core): the plugin side of inbox routing. Owns
// the shared move plan-and-write core (Ctrl+Shift+M keeps its park, focus,
// and notice in `650-plugin-move-commit.js`), the inbox-note classifier,
// the route prompt, and the routed move commit. `promptInboxRoute` and
// `commitInboxRoute` never throw and never reject: every failure resolves
// to a cancel or a structured `{ ok: false }` result with nothing written.
class BobNavigationHotkeysInboxRouteMixin {

  // Shared move plan-and-write core: snapshots the vault, plans with
  // `planTaskMoveAcrossFiles`, writes destination, auxiliary, then source
  // with rollback, and leaves the source editor on `nextSourceLine`.
  // Returns `{ ok: true, plan, destinationFile, destinationName,
  // nextSourceLine }` or `{ ok: false, reason }` where `reason` is the exact
  // user-facing notice text. Never parks the walk and never opens or
  // focuses the destination; callers own settle and navigation.
  async planAndWriteTaskMoveFiles(options = {}) {
    const sourcePath = normalizeVaultRelativePath(options.sourcePath);
    const destinationPath = normalizeVaultRelativePath(options.destinationPath);
    const sourceContent = String(options.sourceContent || "");
    const targets = Array.isArray(options.targets) ? options.targets : [];
    const editor =
      options.editor && typeof options.editor.getValue === "function"
        ? options.editor
        : null;
    const cursor = options.cursor && typeof options.cursor === "object"
      ? options.cursor
      : { line: 0, ch: 0 };
    if (!sourcePath || !destinationPath) {
      return { ok: false, reason: "Task move source and destination are invalid" };
    }
    if (
      destinationPath === sourcePath ||
      TASK_MOVE_TEMPLATE_PATHS.has(destinationPath)
    ) {
      return { ok: false, reason: "Selected task destination is not eligible" };
    }
    if (editor && String(editor.getValue() || "") !== sourceContent) {
      return { ok: false, reason: "A selected task changed while the destination picker was open" };
    }

    const vault = this.app && this.app.vault;
    if (
      !vault ||
      typeof vault.getMarkdownFiles !== "function" ||
      typeof vault.process !== "function"
    ) {
      return { ok: false, reason: "Vault content updates are unavailable" };
    }

    const snapshots = new Map();
    const filesByPath = new Map();
    try {
      for (const file of vault.getMarkdownFiles()) {
        if (!this.isMarkdownFile(file)) {
          continue;
        }
        const snapshot = await this.getTaskMoveFileSnapshot(file);
        snapshots.set(file.path, snapshot.content);
        filesByPath.set(file.path, file);
      }
    } catch (error) {
      return { ok: false, reason: "Could not read every affected note; nothing was moved" };
    }
    const destinationFile = filesByPath.get(destinationPath) || null;
    if (!this.isMarkdownFile(destinationFile)) {
      return { ok: false, reason: "Source task note is no longer active; nothing was moved" };
    }
    if (
      snapshots.get(sourcePath) !== sourceContent ||
      !snapshots.has(destinationPath)
    ) {
      return { ok: false, reason: "Task move source or destination changed; nothing was moved" };
    }

    const destinationContent = snapshots.get(destinationPath);
    const otherContents = new Map(snapshots);
    otherContents.delete(sourcePath);
    otherContents.delete(destinationPath);
    const plan = planTaskMoveAcrossFiles({
      sourcePath,
      destinationPath,
      sourceContent,
      destinationContent,
      otherContents,
      targets,
      stampLine: this.getFreshnessStampLine(),
      freshDateText: this.getFreshnessDateText(),
    });
    if (!plan.valid) {
      return { ok: false, reason: `${plan.error}; nothing was moved` };
    }

    const sourceChange = plan.changes.get(sourcePath);
    const sourceLines = splitMarkdownContent(sourceChange.after).lines;
    const sourceLine = Math.min(
      plan.nextSourceLine,
      Math.max(sourceLines.length - 1, 0),
    );
    const finalCursor = {
      line: sourceLine,
      ch: Math.min(
        Math.max(numericOrDefault(cursor.ch, 0), 0),
        String(sourceLines[sourceLine] || "").length,
      ),
    };
    const auxiliaryPaths = Array.from(plan.changes.keys())
      .filter(
        (path) =>
          path !== destinationPath && path !== sourcePath,
      )
      .sort();
    const writeOrder = [
      destinationPath,
      ...auxiliaryPaths,
      sourcePath,
    ];
    const sessionLike = { sourcePath, editor };
    const written = [];
    try {
      for (const path of writeOrder) {
        const change = plan.changes.get(path);
        if (!change || change.before === change.after) {
          continue;
        }
        if (
          path === sourcePath &&
          editor &&
          (this.getActiveMarkdownView?.()?.editor !== editor ||
            String(editor.getValue() || "") !== change.before)
        ) {
          throw new Error("Source editor changed before final removal");
        }
        const file = filesByPath.get(path);
        if (!this.isMarkdownFile(file)) {
          throw new Error(`Affected Markdown file disappeared: ${path}`);
        }
        written.push(
          await this.writeTaskMoveChange(
            path,
            change,
            file,
            sessionLike,
            path === sourcePath ? finalCursor : null,
          ),
        );
      }
    } catch (error) {
      if (
        error &&
        error.taskMoveAppliedEntry &&
        !written.some((entry) => entry.path === error.taskMoveAppliedEntry.path)
      ) {
        written.push(error.taskMoveAppliedEntry);
      }
      const failedRollbacks = await this.rollbackTaskMoveChanges(written);
      if (failedRollbacks.length > 0) {
        return {
          ok: false,
          reason: `Task move could not finish; recoverable duplicates may need repair in ${failedRollbacks.join(", ")}`,
        };
      }
      return {
        ok: false,
        reason: "Task move failed; completed writes were rolled back and source tasks were retained",
      };
    }

    const destinationName =
      destinationFile.basename ||
      getVaultPathBasenameWithoutExtension(destinationFile.path);
    return {
      ok: true,
      reason: null,
      plan,
      destinationFile,
      destinationName,
      nextSourceLine: sourceLine,
      finalCursor,
    };
  }

  getInboxNoteFile() {
    try {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.getMarkdownFiles !== "function") {
        return null;
      }
      return (
        vault
          .getMarkdownFiles()
          .find(
            (file) =>
              normalizeVaultRelativePath(file && file.path) === INBOX_NOTE_PATH,
          ) || null
      );
    } catch (error) {
      return null;
    }
  }

  // Sync, never throws: is this vault path an inbox note?
  isInboxNotePath(path) {
    try {
      const normalized = normalizeVaultRelativePath(path);
      if (!normalized) {
        return false;
      }
      if (normalized === INBOX_NOTE_PATH) {
        return true;
      }
      const inboxFile = this.getInboxNoteFile();
      if (!inboxFile) {
        return false;
      }
      const vault = this.app && this.app.vault;
      const files =
        vault && typeof vault.getMarkdownFiles === "function"
          ? vault.getMarkdownFiles()
          : [];
      const file =
        files.find(
          (entry) =>
            normalizeVaultRelativePath(entry && entry.path) === normalized,
        ) || null;
      if (!file) {
        return false;
      }
      const frontmatter =
        this.app &&
        this.app.metadataCache &&
        typeof this.app.metadataCache.getFileCache === "function"
          ? this.app.metadataCache.getFileCache(file)?.frontmatter
          : null;
      return (
        classifyInboxNote({ path: normalized, frontmatter }, inboxFile, (fm) => {
          try {
            return this.frontmatterFieldPointsToFile(
              fm,
              "parent",
              inboxFile,
              normalized,
            );
          } catch (error) {
            return false;
          }
        }) === true
      );
    } catch (error) {
      return false;
    }
  }

  // Open the route picker for one inbox task (or counted run). Resolves
  // `{ kind: "move", path, name }`, `{ kind: "stay" }` (apply in place), or
  // `{ kind: "cancel" }` (nothing written). `suspend` is an optional
  // `{ hide(), restore(), isAlive?() }` pair the Task Card passes in while
  // the picker suspends its modal. Never rejects.
  async promptInboxRoute(request = {}) {
    try {
      const editor =
        request.editor && typeof request.editor.getValue === "function"
          ? request.editor
          : null;
      const sourcePath = normalizeVaultRelativePath(
        request.sourcePath ?? request.path,
      );
      if (!editor || !sourcePath) {
        return { kind: "cancel" };
      }
      const startLine = Number.isInteger(request.startLine)
        ? request.startLine
        : Number.isInteger(request.line)
          ? request.line
          : null;
      if (startLine === null) {
        return { kind: "cancel" };
      }
      const additionalRaw =
        request.additionalTaskCount ??
        (Number.isInteger(request.count) ? request.count - 1 : 0);
      const additionalTaskCount = Math.max(
        0,
        Math.floor(numericOrDefault(additionalRaw, 0)),
      );
      const count = additionalTaskCount + 1;
      const actionLabel = formatInboxRouteActionLabel(request.actionLabel);
      const suspend =
        request.suspend && typeof request.suspend === "object"
          ? request.suspend
          : null;
      if (suspend && typeof suspend.isAlive === "function") {
        let alive = true;
        try {
          alive = suspend.isAlive() !== false;
        } catch (error) {
          alive = false;
        }
        if (!alive) {
          return { kind: "cancel" };
        }
      }
      const active = this.activeTaskMoveDestinationPicker;
      if (active) {
        if (!isStaleRegisteredPicker(active)) {
          return { kind: "cancel" };
        }
        try {
          active.close();
        } catch (error) {
          // A stale picker never blocks routing.
        }
        if (this.activeTaskMoveDestinationPicker === active) {
          this.activeTaskMoveDestinationPicker = null;
        }
      }
      if (this.isInboxNotePath(sourcePath) !== true) {
        return { kind: "cancel" };
      }
      const sourceContent = String(editor.getValue() || "");
      const discovery = discoverMovableObsidianTaskTargets(
        sourceContent,
        startLine,
        additionalTaskCount,
      );
      const firstLine =
        discovery.valid && discovery.targets.length > 0
          ? discovery.targets[0].rawLine
          : String(splitMarkdownContent(sourceContent).lines[startLine] || "");
      const taskText = cleanTaskDisplayText(firstLine);
      const inboxName = getVaultPathBasenameWithoutExtension(sourcePath);
      const vault = this.app && this.app.vault;
      const markdownFiles =
        vault && typeof vault.getMarkdownFiles === "function"
          ? vault.getMarkdownFiles()
          : [];
      const destinations = filterInboxRouteDestinations(
        collectTaskMoveDestinations(
          markdownFiles,
          sourcePath,
          (file) => getFileChildNoteInfo(this.app, file, new Date()),
        ),
        (path) => this.isInboxNotePath(path),
        sourcePath,
      );
      const reserved =
        request.reservedBlockIds instanceof Set
          ? request.reservedBlockIds
          : new Set(request.reservedBlockIds || []);
      const picker = new InboxRoutePickerModal(this.app, this, {
        destinations,
        inboxName,
        taskText,
        count,
        actionLabel,
        cancelLabel: request.cancelLabel,
        preflight: async (file) => {
          try {
            const liveContent = String(editor.getValue() || "");
            const live = discoverMovableObsidianTaskTargets(
              liveContent,
              startLine,
              additionalTaskCount,
            );
            if (!live.valid) {
              return { ok: false, reason: live.error };
            }
            const snapshot = await this.getTaskMoveFileSnapshot(file);
            return preflightInboxRoute({
              sourcePath,
              sourceContent: liveContent,
              destinationPath: file.path,
              destinationContent: snapshot.content,
              targets: live.targets,
              reservedBlockIds: reserved,
            });
          } catch (error) {
            return { ok: false, reason: "Route preflight failed" };
          }
        },
      });
      this.activeTaskMoveDestinationPicker = picker;
      if (suspend && typeof suspend.hide === "function") {
        try {
          suspend.hide();
        } catch (error) {
          // Suspension is visual only; the route still prompts.
        }
      }
      try {
        picker.open();
      } catch (error) {
        if (this.activeTaskMoveDestinationPicker === picker) {
          this.activeTaskMoveDestinationPicker = null;
        }
        if (suspend && typeof suspend.restore === "function") {
          try {
            suspend.restore();
          } catch (ignoredError) {
            // Restore is best-effort after a failed open.
          }
        }
        return { kind: "cancel" };
      }
      let outcome = null;
      try {
        outcome = await picker.waitForRoute();
      } catch (error) {
        outcome = { kind: "cancel" };
      }
      if (suspend && typeof suspend.restore === "function") {
        try {
          suspend.restore();
        } catch (error) {
          // Restore is best-effort after the route resolves.
        }
      }
      if (outcome && outcome.kind === "stay") {
        return { kind: "stay" };
      }
      if (outcome && outcome.kind === "move" && outcome.file) {
        const file = outcome.file;
        return {
          kind: "move",
          path: file.path,
          name:
            file.basename ||
            getVaultPathBasenameWithoutExtension(file.path),
        };
      }
      return { kind: "cancel" };
    } catch (error) {
      return { kind: "cancel" };
    }
  }

  // Routed move commit: re-reads the live editor, re-discovers the routed
  // tasks, verifies them against the pre-gesture `expected`
  // (`captureInboxRouteExpected` rows), and moves them with the shared
  // core. Unlike Ctrl+Shift+M, a routed move does not focus the destination
  // or park the walk; the cursor stays in the inbox note on the line the
  // move leaves it on. Resolves `{ ok, count, destinationName,
  // destinationPath, notice, handledRefs, reason? }` and never throws.
  // `handledRefs` are the routed rows' pre-gesture `{ path, line, raw }`.
  async commitInboxRoute(request = {}) {
    const inboxNameFor = (sourcePath) =>
      getVaultPathBasenameWithoutExtension(sourcePath) || "inbox";
    const fail = (reason, sourcePath, destinationPath) => {
      const inboxName = sourcePath ? inboxNameFor(sourcePath) : "inbox";
      const text = String(reason || "Inbox route failed; nothing was moved");
      return Object.freeze({
        ok: false,
        count: 0,
        destinationName: "",
        destinationPath: String(destinationPath || ""),
        notice: `Not moved: ${text} · still in ${inboxName}`,
        handledRefs: Object.freeze([]),
        reason: text,
      });
    };
    try {
      const editor =
        request.editor && typeof request.editor.getValue === "function"
          ? request.editor
          : null;
      const sourcePath = normalizeVaultRelativePath(
        request.sourcePath ?? request.path,
      );
      const destinationPath = normalizeVaultRelativePath(
        request.destinationPath ?? (request.destination && request.destination.path),
      );
      const expected = Array.isArray(request.expected) ? request.expected : [];
      if (!editor || !sourcePath || !destinationPath || expected.length === 0) {
        return fail(
          "Routed tasks could not be verified; nothing was moved",
          sourcePath,
          destinationPath,
        );
      }
      const startLine = Number.isInteger(request.startLine)
        ? request.startLine
        : Number.isInteger(request.line)
          ? request.line
          : null;
      if (startLine === null) {
        return fail(
          "Routed tasks could not be verified; nothing was moved",
          sourcePath,
          destinationPath,
        );
      }
      const additionalTaskCount = Math.max(
        0,
        Math.floor(numericOrDefault(request.additionalTaskCount, expected.length - 1)),
      );
      const liveContent = String(editor.getValue() || "");
      const rediscovery = discoverMovableObsidianTaskTargets(
        liveContent,
        startLine,
        additionalTaskCount,
      );
      if (!rediscovery.valid) {
        return fail(
          "Routed tasks changed; nothing was moved",
          sourcePath,
          destinationPath,
        );
      }
      if (!verifyInboxRouteTargets(expected, rediscovery.targets)) {
        return fail(
          "Routed tasks changed; nothing was moved",
          sourcePath,
          destinationPath,
        );
      }
      let cursor = null;
      try {
        cursor =
          typeof editor.getCursor === "function"
            ? normalizePosition(editor.getCursor())
            : getEditorCursor(editor);
      } catch (error) {
        cursor = null;
      }
      const result = await this.planAndWriteTaskMoveFiles({
        sourcePath,
        sourceContent: liveContent,
        editor,
        cursor: cursor || { line: startLine, ch: 0 },
        targets: rediscovery.targets,
        destinationPath,
      });
      if (!result || result.ok !== true) {
        return fail(
          (result && result.reason) || "Task move failed; nothing was moved",
          sourcePath,
          destinationPath,
        );
      }
      const count = rediscovery.actualCount;
      const handledRefs = Object.freeze(
        expected
          .filter(
            (entry) =>
              entry &&
              Number.isInteger(entry.line) &&
              typeof entry.raw === "string",
          )
          .map((entry) =>
            Object.freeze({
              path: sourcePath,
              line: entry.line,
              raw: entry.raw,
            }),
          ),
      );
      return Object.freeze({
        ok: true,
        count,
        destinationName: result.destinationName,
        destinationPath,
        notice: formatInboxRouteMoveNotice({
          count,
          destinationName: result.destinationName,
        }),
        handledRefs,
        reason: null,
      });
    } catch (error) {
      return fail("Inbox route failed; nothing was moved", "", "");
    }
  }

}
