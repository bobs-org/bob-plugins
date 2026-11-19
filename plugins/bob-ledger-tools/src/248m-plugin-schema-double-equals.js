// Capture-phase == on album notes and bank.md opens the schema/setup card;
// == on a canonical record note opens its Record Card. A vimrc nnoremap ==
// never fires: CodeMirror Vim treats = as a complete operator, so the
// second = reindents instead of matching a mapping.

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

const PROPERTY_CARD_BUILTIN_KINDS = ["bank", "album", "record"];
const propertyCardExtraKinds = [];

function propertyCardGateKinds() {
  return [...PROPERTY_CARD_BUILTIN_KINDS, ...propertyCardExtraKinds];
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
  const allowed = Array.isArray(input.allowedKinds) && input.allowedKinds.length > 0
    ? input.allowedKinds
    : propertyCardGateKinds();
  if (!allowed.includes(input.target)) {
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
  // Records use the canonical check, never the loose kind fallback: the
  // fallback classifies notes like bank/2026-11.md as records, which must
  // keep their Vim reindent.
  if (typeof recordSheetIsCanonicalRecordType === "function"
    && recordSheetIsCanonicalRecordType(frontmatter)) {
    return "record";
  }
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

function propertyCardBuiltinEntry(plugin, kind) {
  if (kind === "bank") {
    return {
      kind: "bank",
      match({ path } = {}) {
        try {
          return typeof bankSetupIsHubPath === "function" && bankSetupIsHubPath(path) === true;
        } catch (_) {
          return false;
        }
      },
      open({ path } = {}) {
        void plugin.openBankSetupCard({ sourcePath: path });
      },
    };
  }
  if (kind === "album") {
    return {
      kind: "album",
      match({ frontmatter } = {}) {
        try {
          return typeof albumSchemaEntryKindOf === "function"
            && albumSchemaEntryKindOf(frontmatter) === "album";
        } catch (_) {
          return false;
        }
      },
      open({ path } = {}) {
        void plugin.openAlbumSchemaEntry({ filePath: path });
      },
    };
  }
  return {
    kind: "record",
    match({ frontmatter } = {}) {
      try {
        return typeof recordSheetIsCanonicalRecordType === "function"
          && recordSheetIsCanonicalRecordType(frontmatter) === true;
      } catch (_) {
        return false;
      }
    },
    open({ path } = {}) {
      void plugin.openRecordCard({ filePath: path });
    },
  };
}

class BobLedgerToolsSchemaDoubleEqualsMixin {
  propertyCardRegistry() {
    if (!Array.isArray(this.propertyCardRegistryEntries)) this.propertyCardRegistryEntries = [];
    return this.propertyCardRegistryEntries;
  }

  propertyCardKinds() {
    return this.propertyCardRegistry().map((entry) => entry.kind);
  }

  registerPropertyCard(entry) {
    const kind = entry && entry.kind;
    const match = entry && entry.match;
    const open = entry && entry.open;
    if (typeof kind !== "string" || kind.length === 0) return false;
    if (typeof match !== "function" || typeof open !== "function") return false;
    const registry = this.propertyCardRegistry();
    if (registry.some((item) => item.kind === kind)) return false;
    registry.push({ kind, match, open });
    if (!PROPERTY_CARD_BUILTIN_KINDS.includes(kind) && !propertyCardExtraKinds.includes(kind)) {
      propertyCardExtraKinds.push(kind);
    }
    return true;
  }

  unregisterPropertyCard(kind) {
    const registry = this.propertyCardRegistry();
    const index = registry.findIndex((item) => item.kind === kind);
    if (index < 0) return false;
    registry.splice(index, 1);
    const extraIndex = propertyCardExtraKinds.indexOf(kind);
    if (extraIndex >= 0) propertyCardExtraKinds.splice(extraIndex, 1);
    return true;
  }

  ensurePropertyCardBuiltins() {
    const registry = this.propertyCardRegistry();
    for (const kind of PROPERTY_CARD_BUILTIN_KINDS) {
      if (!registry.some((item) => item.kind === kind)) {
        registry.push(propertyCardBuiltinEntry(this, kind));
      }
    }
    const order = new Map(PROPERTY_CARD_BUILTIN_KINDS.map((kind, index) => [kind, index]));
    registry.sort((a, b) => {
      const ai = order.has(a.kind) ? order.get(a.kind) : PROPERTY_CARD_BUILTIN_KINDS.length;
      const bi = order.has(b.kind) ? order.get(b.kind) : PROPERTY_CARD_BUILTIN_KINDS.length;
      return ai - bi;
    });
    return registry;
  }

  resolvePropertyCard({ path, frontmatter } = {}) {
    const registry = this.propertyCardRegistry();
    for (const entry of registry) {
      try {
        if (entry.match({ path, frontmatter }) === true) return entry;
      } catch (_) {
        continue;
      }
    }
    return null;
  }

  setupSchemaDoubleEquals() {
    if (this.schemaDoubleEqualsActive) return;
    this.schemaDoubleEqualsActive = true;
    this.ensurePropertyCardBuiltins();
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
    try {
      const registry = this.propertyCardRegistry();
      for (const entry of [...registry]) {
        const extraIndex = propertyCardExtraKinds.indexOf(entry.kind);
        if (extraIndex >= 0) propertyCardExtraKinds.splice(extraIndex, 1);
      }
    } catch (_) {}
    this.propertyCardRegistryEntries = [];
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
    let entry = null;
    try {
      if (typeof this.resolvePropertyCard === "function") {
        entry = this.resolvePropertyCard({ path: filePath, frontmatter });
      }
    } catch (_) {
      entry = null;
    }
    if (!entry) {
      try {
        const fallback = schemaDoubleEqualsTargetKind({ path: filePath, frontmatter });
        if (fallback && typeof this.ensurePropertyCardBuiltins === "function") {
          this.ensurePropertyCardBuiltins();
          entry = this.resolvePropertyCard({ path: filePath, frontmatter });
        }
      } catch (_) {
        entry = null;
      }
    }
    const target = entry ? entry.kind : null;
    let allowedKinds = null;
    try {
      allowedKinds = typeof this.propertyCardKinds === "function" ? this.propertyCardKinds() : null;
    } catch (_) {
      allowedKinds = null;
    }
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
      allowedKinds,
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
      if (entry) {
        void entry.open({ path: filePath, frontmatter });
      }
    } catch (_) {}
  }
}
