// Capture-phase == on album notes and bank.md opens the schema/setup card.
// A vimrc nnoremap == never fires: CodeMirror Vim treats = as a complete
// operator, so the second = reindents instead of matching a mapping.

function schemaDoubleEqualsKeyBufferEmpty(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.length === 0;
  return true;
}

function schemaDoubleEqualsCountPending(value) {
  const text = Array.isArray(value)
    ? value.join("")
    : typeof value === "string"
      ? value
      : "";
  return /\d/.test(text);
}

function schemaDoubleEqualsVimSnapshot(cm) {
  const vimState = cm && cm.state && cm.state.vim;
  const inputState = vimState && vimState.inputState;
  if (!vimState || !inputState) {
    return {
      readable: false,
      insertMode: false,
      visualMode: false,
      replaceMode: false,
      operator: null,
      keyBufferEmpty: false,
      countPending: false,
      registerPending: false,
    };
  }
  return {
    readable: true,
    insertMode: vimState.insertMode === true,
    visualMode:
      vimState.visualMode === true ||
      vimState.visualBlock === true ||
      vimState.visualLine === true,
    replaceMode: vimState.replaceMode === true,
    operator: inputState.operator == null ? null : inputState.operator,
    keyBufferEmpty: schemaDoubleEqualsKeyBufferEmpty(inputState.keyBuffer),
    countPending:
      schemaDoubleEqualsCountPending(inputState.prefixRepeat) ||
      schemaDoubleEqualsCountPending(inputState.motionRepeat),
    registerPending: Boolean(inputState.registerName),
  };
}

function schemaDoubleEqualsGate(input) {
  const snap = (input && input.vim) || { readable: false };
  if (!input || input.key !== "=") return { act: false, reason: "not-equals" };
  if (input.ctrlKey || input.altKey || input.metaKey) {
    return { act: false, reason: "modified" };
  }
  if (input.repeat) return { act: false, reason: "repeat" };
  if (input.isComposing) return { act: false, reason: "composing" };
  if (input.defaultPrevented) return { act: false, reason: "default-prevented" };
  if (!input.inEditor) return { act: false, reason: "outside-editor" };
  if (!input.livePreview) return { act: false, reason: "not-live-preview" };
  if (!snap.readable) return { act: false, reason: "no-vim" };
  if (snap.insertMode || snap.visualMode || snap.replaceMode) {
    return { act: false, reason: "not-normal" };
  }
  if (snap.operator !== "indentAuto" || !snap.keyBufferEmpty) {
    return { act: false, reason: "no-pending-equals" };
  }
  if (snap.countPending) return { act: false, reason: "counted" };
  if (snap.registerPending) return { act: false, reason: "register" };
  if (input.target !== "album" && input.target !== "bank") {
    return { act: false, reason: "not-schema-note" };
  }
  if (!input.canHandleKey) return { act: false, reason: "no-handle-key" };
  return { act: true, reason: "schema-key" };
}

function schemaDoubleEqualsTargetKind({ path, frontmatter } = {}) {
  if (typeof bankSetupIsHubPath === "function" && bankSetupIsHubPath(path)) {
    return "bank";
  }
  const kind =
    typeof albumSchemaEntryKindOf === "function"
      ? albumSchemaEntryKindOf(frontmatter)
      : "other";
  if (kind === "album") return "album";
  return null;
}

function schemaDoubleEqualsEventInEditor(event, view) {
  const target = event && event.target;
  if (!target || typeof target.closest !== "function") return false;
  const editorEl = target.closest(".cm-editor");
  if (!editorEl) return false;
  const containerEl = view && view.containerEl;
  return (
    !containerEl ||
    typeof containerEl.contains !== "function" ||
    containerEl.contains(editorEl)
  );
}

function schemaDoubleEqualsResolveCm(view) {
  const editorCm = view && view.editor && view.editor.cm && view.editor.cm.cm;
  const viewCm =
    view &&
    view.editMode &&
    view.editMode.editor &&
    view.editMode.editor.cm &&
    view.editMode.editor.cm.cm;
  return editorCm || viewCm || null;
}

function schemaDoubleEqualsLivePreview(view, cm) {
  try {
    const state =
      (cm && cm.cm6 && cm.cm6.state) ||
      (view && view.editor && view.editor.cm && view.editor.cm.state) ||
      (view && view.editMode && view.editMode.cm && view.editMode.cm.state) ||
      null;
    if (state && editorLivePreviewField && typeof state.field === "function") {
      return state.field(editorLivePreviewField) === true;
    }
  } catch (_) {}
  try {
    const viewState =
      view && typeof view.getState === "function" ? view.getState() : null;
    if (viewState && typeof viewState.source === "boolean") {
      return viewState.source === false;
    }
  } catch (_) {}
  return false;
}

function schemaDoubleEqualsActiveView(plugin) {
  try {
    if (typeof getActiveMarkdownView === "function") {
      const view = getActiveMarkdownView(plugin && plugin.app);
      if (view) return view;
    }
  } catch (_) {}
  try {
    const view =
      plugin &&
      plugin.app &&
      plugin.app.workspace &&
      typeof plugin.app.workspace.getActiveViewOfType === "function"
        ? plugin.app.workspace.getActiveViewOfType(MarkdownView)
        : null;
    if (view) return view;
  } catch (_) {}
  try {
    const leaf = plugin && plugin.app && plugin.app.workspace && plugin.app.workspace.activeLeaf;
    if (leaf && leaf.view) return leaf.view;
  } catch (_) {}
  return null;
}

function schemaDoubleEqualsCanHandleKey() {
  try {
    const handle =
      typeof window !== "undefined" &&
      window &&
      window.CodeMirrorAdapter &&
      window.CodeMirrorAdapter.Vim &&
      window.CodeMirrorAdapter.Vim.handleKey;
    return typeof handle === "function";
  } catch (_) {
    return false;
  }
}

class BobLedgerToolsSchemaDoubleEqualsMixin {
  setupSchemaDoubleEquals() {
    if (this.schemaDoubleEqualsActive) return;
    this.schemaDoubleEqualsActive = true;
    this.handledSchemaDoubleEqualsEvents = new WeakSet();
    const keydownHandler = (event) => this.handleSchemaDoubleEqualsKeydown(event);
    const windowObject = typeof window === "undefined" ? null : window;
    const documentObject = typeof document === "undefined" ? null : document;
    const targets = [];
    if (windowObject) targets.push(windowObject);
    if (documentObject && documentObject !== windowObject) {
      targets.push(documentObject);
    }
    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") continue;
      target.addEventListener("keydown", keydownHandler, true);
      if (typeof this.register === "function") {
        this.register(() => {
          target.removeEventListener("keydown", keydownHandler, true);
        });
      }
    }
  }

  teardownSchemaDoubleEquals() {
    this.schemaDoubleEqualsActive = false;
  }

  handleSchemaDoubleEqualsKeydown(event) {
    if (this.schemaDoubleEqualsActive === false) return;
    if (
      this.handledSchemaDoubleEqualsEvents &&
      this.handledSchemaDoubleEqualsEvents.has(event)
    ) {
      return;
    }
    const view = schemaDoubleEqualsActiveView(this);
    const cm = schemaDoubleEqualsResolveCm(view);
    let frontmatter = {};
    let filePath = "";
    try {
      const file = view && view.file;
      filePath = file && typeof file.path === "string" ? file.path : "";
      const cache =
        file && this.app && this.app.metadataCache && typeof this.app.metadataCache.getFileCache === "function"
          ? this.app.metadataCache.getFileCache(file)
          : null;
      if (cache && cache.frontmatter && typeof cache.frontmatter === "object") {
        frontmatter = cache.frontmatter;
      }
    } catch (_) {}
    const target = schemaDoubleEqualsTargetKind({ path: filePath, frontmatter });
    const gate = schemaDoubleEqualsGate({
      key: event && event.key,
      ctrlKey: Boolean(event && event.ctrlKey),
      altKey: Boolean(event && event.altKey),
      metaKey: Boolean(event && event.metaKey),
      shiftKey: Boolean(event && event.shiftKey),
      repeat: Boolean(event && event.repeat),
      isComposing: Boolean(event && event.isComposing),
      defaultPrevented: Boolean(event && event.defaultPrevented),
      inEditor: schemaDoubleEqualsEventInEditor(event, view),
      livePreview: schemaDoubleEqualsLivePreview(view, cm),
      vim: schemaDoubleEqualsVimSnapshot(cm),
      target,
      canHandleKey: schemaDoubleEqualsCanHandleKey(),
    });
    if (!gate.act) return;
    if (this.handledSchemaDoubleEqualsEvents) {
      this.handledSchemaDoubleEqualsEvents.add(event);
    }
    try { event.preventDefault(); } catch (_) {}
    try { event.stopPropagation(); } catch (_) {}
    try {
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    } catch (_) {}
    try {
      window.CodeMirrorAdapter.Vim.handleKey(cm, "<Esc>", "mapping");
    } catch (_) {}
    try {
      if (target === "album") {
        void this.openAlbumSchemaEntry({ filePath });
      } else if (target === "bank") {
        void this.openBankSetupCard({ sourcePath: filePath });
      }
    } catch (_) {}
  }
}
