const BOB_OPEN_NOTES_COUNT_RE = /^[1-8]$/;
const BOB_OPEN_NOTES_TIMEOUT_MS = 2000;
const BOB_OPEN_NOTES_POLL_MS = 50;
const BOB_OPEN_NOTES_FLASH_MS = 1200;
const BOB_OPEN_NOTES_REDUCED_FLASH_MS = 600;

const bobOpenNotesLandingFlashEffect =
  StateEffect && typeof StateEffect.define === "function"
    ? StateEffect.define()
    : null;
const bobOpenNotesLandingFlashMark =
  Decoration && typeof Decoration.line === "function"
    ? Decoration.line({ class: "bob-landing-flash" })
    : null;
const bobOpenNotesLandingFlashField =
  StateField && typeof StateField.define === "function" &&
  EditorView && EditorView.decorations &&
  typeof EditorView.decorations.from === "function" &&
  Decoration && Decoration.none && typeof Decoration.set === "function" &&
  bobOpenNotesLandingFlashEffect && bobOpenNotesLandingFlashMark
    ? StateField.define({
        create: () => Decoration.none,
        update: (decorations, transaction) => {
          let next =
            transaction.docChanged && decorations &&
            typeof decorations.map === "function"
              ? decorations.map(transaction.changes)
              : decorations;

          for (const effect of transaction.effects || []) {
            if (
              !effect ||
              typeof effect.is !== "function" ||
              !effect.is(bobOpenNotesLandingFlashEffect)
            ) {
              continue;
            }
            if (effect.value && effect.value.clear) {
              next = Decoration.none;
              continue;
            }

            const document = transaction.state && transaction.state.doc;
            const requestedLine = Number(effect.value && effect.value.line);
            if (
              !document ||
              !Number.isInteger(requestedLine) ||
              requestedLine < 0 ||
              typeof document.line !== "function" ||
              !bobOpenNotesLandingFlashMark
            ) {
              next = Decoration.none;
              continue;
            }

            try {
              const line = document.line(
                Math.min(requestedLine + 1, document.lines),
              );
              next = Decoration.set([
                bobOpenNotesLandingFlashMark.range(line.from),
              ]);
            } catch (error) {
              next = Decoration.none;
            }
          }

          return next;
        },
        provide: (field) => EditorView.decorations.from(field),
    })
    : null;

function bobOpenNotesParam(params, key) {
  if (!params || typeof params !== "object" ||
      !Object.prototype.hasOwnProperty.call(params, key)) {
    return Object.freeze({ present: false, valid: true, value: "" });
  }

  const raw = params[key];
  if (Array.isArray(raw)) {
    if (raw.length !== 1) {
      return Object.freeze({ present: true, valid: false, value: "" });
    }
    return Object.freeze({ present: true, valid: true, value: String(raw[0] ?? "") });
  }
  if (raw == null) {
    return Object.freeze({ present: true, valid: false, value: "" });
  }
  return Object.freeze({ present: true, valid: true, value: String(raw) });
}

function isAbsoluteBobOpenNotesPath(value) {
  const normalized = normalizeFilesystemPath(value);
  return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

function parseBobOpenNotesParams(params) {
  if (!params || typeof params !== "object") {
    return null;
  }

  const countParam = bobOpenNotesParam(params, "count");
  if (!countParam.valid || !BOB_OPEN_NOTES_COUNT_RE.test(countParam.value)) {
    return null;
  }
  const count = Number(countParam.value);

  const totalParam = bobOpenNotesParam(params, "total");
  let total = count;
  if (totalParam.present) {
    if (!totalParam.valid || !GO_TO_TASK_LINE_RE.test(totalParam.value)) {
      return null;
    }
    total = Number(totalParam.value);
    if (!Number.isSafeInteger(total) || total < count) {
      return null;
    }
  }

  const notes = [];
  for (let index = 1; index <= count; index += 1) {
    const pathParam = bobOpenNotesParam(params, `path${index}`);
    if (
      !pathParam.present ||
      !pathParam.valid ||
      !pathParam.value ||
      pathParam.value.includes("\0") ||
      !isAbsoluteBobOpenNotesPath(pathParam.value)
    ) {
      return null;
    }

    const lineParam = bobOpenNotesParam(params, `line${index}`);
    let line = null;
    if (lineParam.present) {
      if (
        !lineParam.valid ||
        !GO_TO_TASK_LINE_RE.test(lineParam.value)
      ) {
        return null;
      }
      line = Number(lineParam.value);
      if (!Number.isSafeInteger(line)) {
        return null;
      }
    }

    const refParam = bobOpenNotesParam(params, `ref${index}`);
    let ref = null;
    if (refParam.present) {
      if (
        !refParam.valid ||
        line === null ||
        !GO_TO_TASK_REF_RE.test(refParam.value)
      ) {
        return null;
      }
      ref = refParam.value;
    }

    const blockParam = bobOpenNotesParam(params, `block${index}`);
    let block = null;
    if (blockParam.present) {
      if (
        !blockParam.valid ||
        !GO_TO_TASK_BLOCK_RE.test(blockParam.value)
      ) {
        return null;
      }
      block = blockParam.value;
    }

    notes.push(
      Object.freeze({
        path: pathParam.value,
        line,
        ref,
        block,
      }),
    );
  }

  return Object.freeze({ count, total, notes: Object.freeze(notes) });
}

function isBobOpenNotesFile(plugin, file) {
  if (!file || typeof file.path !== "string" || !file.path) {
    return false;
  }
  if (plugin && typeof plugin.isMarkdownFile === "function" &&
      plugin.isMarkdownFile(file)) {
    return true;
  }
  return (
    typeof file.extension === "string" &&
    !Array.isArray(file.children)
  );
}

function resolveBobOpenNotesVaultFile(plugin, vaultPath) {
  return resolveGoToVaultFile(plugin, vaultPath, {
    acceptFile: (file) => isBobOpenNotesFile(plugin, file),
    allowNonMarkdown: true,
  });
}

class BobNavigationHotkeysOpenNotesUriMixin {
  enqueueBobOpenNotesUri(params) {
    const previous = this.bobOpenNotesQueue || Promise.resolve();
    const current = previous
      .catch(() => false)
      .then(() => this.handleBobOpenNotesUri(params));
    this.bobOpenNotesQueue = current.catch(() => false);
    return current;
  }

  async inspectBobOpenNotesEntry(candidate) {
    const file = resolveBobOpenNotesVaultFile(this, candidate.vaultPath);
    if (!file) {
      return Object.freeze({ ready: false, file: null, content: "", found: null });
    }
    if (!this.isMarkdownFile(file)) {
      return Object.freeze({ ready: true, file, content: "", found: null });
    }

    let content = "";
    try {
      content = await readGoToNoteContent(this, file);
    } catch (error) {
      content = "";
    }
    const lines = String(content || "").split(/\r?\n/);
    const found = candidate.note.line === null
      ? null
      : await refindGoToTaskLine(lines, {
          line: candidate.note.line,
          ref: candidate.note.ref,
          block: candidate.note.block,
          anyLineDigest: true,
        });
    const digestReady =
      !candidate.note.ref || Boolean(found && found.source !== "clamped");
    return Object.freeze({
      ready: digestReady,
      file,
      content,
      found,
    });
  }

  async waitForBobOpenNotesFreshness(candidates) {
    const vault = this.app && this.app.vault;
    const deadline = Date.now() + BOB_OPEN_NOTES_TIMEOUT_MS;
    let last = candidates.map(() =>
      Object.freeze({ ready: false, file: null, content: "", found: null }),
    );
    let wakeCurrent = null;
    let timeoutId = null;
    const timeoutResult = Object.freeze({ timeout: true });
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(timeoutResult), BOB_OPEN_NOTES_TIMEOUT_MS);
    });
    const wake = () => {
      if (wakeCurrent) {
        const resolve = wakeCurrent;
        wakeCurrent = null;
        resolve();
      }
    };
    const eventRefs = [];
    if (vault && typeof vault.on === "function") {
      for (const eventName of ["create", "modify"]) {
        try {
          const ref = vault.on(eventName, wake);
          if (ref) eventRefs.push(ref);
        } catch (error) {
          // The 50 ms poll remains the fallback when events are unavailable.
        }
      }
    }

    const refresh = async () => {
      const states = await Promise.all(
        candidates.map((candidate) => this.inspectBobOpenNotesEntry(candidate)),
      );
      last = states;
      return states;
    };
    const waitForWakeOrPoll = (delay) =>
      new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(pollId);
          if (wakeCurrent === onWake) wakeCurrent = null;
          resolve();
        };
        const pollId = setTimeout(finish, delay);
        const onWake = () => finish();
        wakeCurrent = onWake;
      });

    try {
      let outcome = await Promise.race([refresh(), timeout]);
      if (outcome === timeoutResult) {
        return last;
      }
      while (Date.now() < deadline && !outcome.every((state) => state.ready)) {
        const delay = Math.max(
          1,
          Math.min(BOB_OPEN_NOTES_POLL_MS, deadline - Date.now()),
        );
        const woke = await Promise.race([
          waitForWakeOrPoll(delay).then(() => true),
          timeout,
        ]);
        if (woke === timeoutResult) break;
        outcome = await Promise.race([refresh(), timeout]);
        if (outcome === timeoutResult) break;
      }
      return last;
    } finally {
      clearTimeout(timeoutId);
      if (vault && typeof vault.offref === "function") {
        for (const ref of eventRefs) {
          try {
            vault.offref(ref);
          } catch (error) {
            // Event cleanup is best-effort after the bounded wait.
          }
        }
      }
    }
  }

  async openBobOpenNotesEntry(candidate, state, index, previousEntryLeaf) {
    const workspace = this.app && this.app.workspace;
    const file = state && state.file;
    if (!workspace || !file) {
      return null;
    }

    let leaf = findLeafShowingPath(this, file.path);
    if (!leaf && index === 0) {
      const activeLeaf = workspace.activeLeaf;
      const viewType =
        activeLeaf &&
        activeLeaf.view &&
        typeof activeLeaf.view.getViewType === "function"
          ? activeLeaf.view.getViewType()
          : null;
      if (viewType === "empty") {
        leaf = activeLeaf;
      }
    }
    let createdNewTab = false;
    if (!leaf) {
      leaf =
        typeof this.createNewTabLeaf === "function"
          ? this.createNewTabLeaf(workspace, workspace.activeLeaf || null)
          : null;
      createdNewTab = Boolean(leaf);
    }
    if (
      createdNewTab &&
      previousEntryLeaf &&
      typeof this.placeDuplicateTabAfterSource === "function"
    ) {
      this.placeDuplicateTabAfterSource(previousEntryLeaf, leaf);
    }
    if (!leaf || typeof leaf.openFile !== "function") {
      return null;
    }

    const currentPath = leaf.view && leaf.view.file && leaf.view.file.path;
    if (currentPath !== file.path) {
      const line = state.found && state.found.line;
      const openState =
        this.isMarkdownFile(file) && Number.isInteger(line)
          ? { eState: { line } }
          : undefined;
      try {
        await leaf.openFile(file, openState);
      } catch (error) {
        return null;
      }
    }

    const line = state.found && state.found.line;
    const editor = leaf.view && leaf.view.editor;
    if (
      index !== 0 &&
      this.isMarkdownFile(file) &&
      Number.isInteger(line) &&
      editor
    ) {
      setEditorCursorWithoutScroll(editor, { line, ch: 0 });
      scrollEditorLineToCenter(editor, line, 0);
    }

    return Object.freeze({ leaf, file });
  }

  async focusBobOpenNotesPrimary(candidate, state, opened, jumpContext) {
    if (!opened || !opened.file || !opened.leaf) {
      return false;
    }
    const file = opened.file;
    const line = state && state.found && state.found.line;
    if (this.isMarkdownFile(file) && Number.isInteger(line)) {
      const lines = String(state.content || "").split(/\r?\n/);
      const text = String(lines[line] ?? "");
      const focused = await this.focusTaskAnchor(
        file,
        { line, text, blockId: candidate.note.block },
        {
          vimJumpContext: jumpContext,
          failureNotice: `Bob Open: could not open ${file.basename || getVaultPathBasenameWithoutExtension(file.path)}`,
          ensureEditing: true,
        },
      );
      if (!focused) {
        return false;
      }
      const view = this.getActiveMarkdownView();
      if (view && view.file && view.file.path === file.path && view.editor) {
        this.flashBobOpenNotesLandingLine(view.editor, line);
      }
      return true;
    }

    if (typeof this.activateWorkspaceLeaf === "function") {
      return Boolean(await this.activateWorkspaceLeaf(opened.leaf));
    }
    return false;
  }

  flashBobOpenNotesLandingLine(editor, line) {
    const editorView = getEditorViewFromEditor(editor);
    if (
      !editorView ||
      !bobOpenNotesLandingFlashEffect ||
      typeof editorView.dispatch !== "function"
    ) {
      return false;
    }
    const document = editorView.state.doc;
    if (!document || typeof document.line !== "function") {
      return false;
    }
    const requestedLine = Math.floor(Number(line));
    if (!Number.isFinite(requestedLine) || requestedLine < 0) {
      return false;
    }

    let zeroBasedLine = requestedLine;
    try {
      zeroBasedLine = Math.min(requestedLine, Math.max(0, document.lines - 1));
      editorView.dispatch({
        effects: bobOpenNotesLandingFlashEffect.of({
          line: zeroBasedLine,
          clear: false,
        }),
      });
    } catch (error) {
      return false;
    }

    if (!this.bobOpenNotesFlashTimers) {
      this.bobOpenNotesFlashTimers = new Map();
      this.register(() => {
        for (const timer of this.bobOpenNotesFlashTimers.values()) {
          clearTimeout(timer);
        }
        this.bobOpenNotesFlashTimers.clear();
      });
    }
    const previousTimer = this.bobOpenNotesFlashTimers.get(editorView);
    if (previousTimer) clearTimeout(previousTimer);

    let reducedMotion = false;
    try {
      reducedMotion = Boolean(
        window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    } catch (error) {
      reducedMotion = false;
    }
    const timer = setTimeout(() => {
      this.bobOpenNotesFlashTimers.delete(editorView);
      try {
        editorView.dispatch({
          effects: bobOpenNotesLandingFlashEffect.of({ clear: true }),
        });
      } catch (error) {
        // The short-lived decoration is already gone with the view.
      }
    }, this.bobOpenNotesLandingFlashDurationMs(reducedMotion));
    this.bobOpenNotesFlashTimers.set(editorView, timer);
    return true;
  }

  bobOpenNotesLandingFlashDurationMs(reducedMotion) {
    return reducedMotion
      ? BOB_OPEN_NOTES_REDUCED_FLASH_MS
      : BOB_OPEN_NOTES_FLASH_MS;
  }

  async handleBobOpenNotesUri(params) {
    const jumpContext =
      typeof this.captureGoToTaskJumpContext === "function"
        ? this.captureGoToTaskJumpContext()
        : null;
    try {
      await this.waitForGoToTaskLayout();
    } catch (error) {
      // Continue when the workspace does not provide a layout-ready callback.
    }

    const parsed = parseBobOpenNotesParams(params);
    if (!parsed) {
      new Notice("Bob Open: invalid link");
      return false;
    }

    const vaultBasePath =
      typeof this.getVaultBasePath === "function" ? this.getVaultBasePath() : "";
    const candidates = parsed.notes.map((note) => {
      const vaultPath = resolveGoToVaultRelativePath(note.path, vaultBasePath);
      return Object.freeze({
        note,
        vaultPath,
        outside: !vaultPath,
      });
    });
    const inside = candidates.filter((candidate) => !candidate.outside);
    const states = await this.waitForBobOpenNotesFreshness(inside);
    let stateIndex = 0;
    const stateByCandidate = new Map();
    for (const candidate of inside) {
      stateByCandidate.set(candidate, states[stateIndex++] || null);
    }

    let openedCount = 0;
    let primary = null;
    let previousEntryLeaf = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate.outside) {
        new Notice(`Bob Open: ${candidate.note.path} is outside this vault`);
        continue;
      }
      const state = stateByCandidate.get(candidate);
      if (!state || !state.file) {
        new Notice(`Bob Open: ${candidate.vaultPath} not found`);
        continue;
      }
      if (
        this.isMarkdownFile(state.file) &&
        candidate.note.ref &&
        state.found &&
        state.found.source === "clamped"
      ) {
        new Notice(
          `Task changed since capture — landed near line ${state.found.line + 1}`,
        );
      }

      let opened = null;
      try {
        opened = await this.openBobOpenNotesEntry(
          candidate,
          state,
          index,
          previousEntryLeaf,
        );
      } catch (error) {
        opened = null;
      }
      if (!opened) {
        const name =
          state.file.basename ||
          getVaultPathBasenameWithoutExtension(state.file.path);
        new Notice(`Bob Open: could not open ${name}`);
        continue;
      }
      openedCount += 1;
      previousEntryLeaf = opened.leaf;
      if (!primary) {
        primary = { candidate, state, opened };
      }
    }

    if (primary) {
      try {
        await this.focusBobOpenNotesPrimary(
          primary.candidate,
          primary.state,
          primary.opened,
          jumpContext,
        );
      } catch (error) {
        new Notice(`Bob Open: could not open ${primary.opened.file.basename || getVaultPathBasenameWithoutExtension(primary.opened.file.path)}`);
      }
    }

    if (parsed.total > parsed.count) {
      new Notice(`Bob Open: opened ${openedCount} of ${parsed.total} notes`);
    }
    return openedCount > 0;
  }
}
