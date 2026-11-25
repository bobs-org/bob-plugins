// Capture-phase == on album notes and bank.md opens the schema/setup card;
// == on a canonical record note opens its Record Card. A vimrc nnoremap ==
// never fires: CodeMirror Vim treats = as a complete operator, so the
// second = reindents instead of matching a mapping. Bare `-`, `_`, and `+`
// in Live Preview Vim normal mode toggle Properties, fold the mounted card
// section, and open the Property Editor. They use a content-target gate and
// do not wait for a pending `=`.

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

// Legacy gate default: built-ins only. Extension kinds live on each plugin
// instance's registry; callers pass that registry's kinds as allowedKinds.
function propertyCardGateKinds() {
  return [...PROPERTY_CARD_BUILTIN_KINDS];
}

// Shared matcher behind both the registry entries and the compatibility
// facade. One predicate per built-in kind, in bank → album → record order.
function propertyCardBuiltinMatch(kind, { path, frontmatter } = {}) {
  try {
    if (kind === "bank") {
      return typeof bankSetupIsHubPath === "function" && bankSetupIsHubPath(path) === true;
    }
    if (kind === "album") {
      return typeof albumSchemaEntryKindOf === "function"
        && albumSchemaEntryKindOf(frontmatter) === "album";
    }
    if (kind === "record") {
      // Records use the canonical check, never the loose kind fallback: the
      // fallback classifies notes like bank/2026-11.md as records, which must
      // keep their Vim reindent.
      return typeof recordSheetIsCanonicalRecordType === "function"
        && recordSheetIsCanonicalRecordType(frontmatter) === true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

function propertyCardSecondKeyCommonGate(input) {
  const snap = (input && input.vim) || { readable: false };
  if (!input || typeof input.key !== "string") return { act: false, reason: "not-second-key" };
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
  return { act: true, reason: "clean-pending-equals" };
}

function propertyCardSecondKeyGate(input) {
  const common = propertyCardSecondKeyCommonGate(input);
  if (!common.act) return common;
  const arm = input && input.arm;
  if (!arm || typeof arm.run !== "function" || typeof arm.canAct !== "function") {
    return { act: false, reason: "unregistered-arm" };
  }
  if (!input.canHandleKey) return { act: false, reason: "no-handle-key" };
  try {
    if (arm.canAct(input.context) !== true) return { act: false, reason: "arm-not-actionable" };
  } catch (_) {
    return { act: false, reason: "arm-not-actionable" };
  }
  return { act: true, reason: arm.reason || "second-key-arm" };
}

function propertyCardBareKeyGate(input) {
  const snap = (input && input.vim) || { readable: false };
  if (!input || (input.key !== "-" && input.key !== "+" && input.key !== "_")) {
    return { act: false, reason: "not-bare-key" };
  }
  if (input.ctrlKey || input.altKey || input.metaKey) {
    return { act: false, reason: "modified" };
  }
  if (input.repeat) return { act: false, reason: "repeat" };
  if (input.isComposing) return { act: false, reason: "composing" };
  if (input.defaultPrevented) return { act: false, reason: "default-prevented" };
  if (!input.inContent) return { act: false, reason: "not-content" };
  if (!input.livePreview) return { act: false, reason: "not-live-preview" };
  if (!snap.readable) return { act: false, reason: "no-vim" };
  if (snap.insertMode || snap.visualMode || snap.replaceMode) {
    return { act: false, reason: "not-normal" };
  }
  if (snap.operator != null) return { act: false, reason: "operator-pending" };
  if (!snap.keyBufferEmpty) return { act: false, reason: "key-buffer" };
  if (snap.countPending) return { act: false, reason: "counted" };
  if (snap.registerPending) return { act: false, reason: "register" };
  const arm = input.arm;
  if (!arm || typeof arm.run !== "function" || typeof arm.canAct !== "function") {
    return { act: false, reason: "unregistered-arm" };
  }
  try {
    if (arm.canAct(input.context) !== true) return { act: false, reason: "arm-not-actionable" };
  } catch (_) {
    return { act: false, reason: "arm-not-actionable" };
  }
  return { act: true, reason: arm.reason || "bare-key-arm" };
}

// Compatibility helper retained for existing == callers and tests. Runtime
// key dispatch uses the arm table below, with this arm's same species gate.
function schemaDoubleEqualsGate(input) {
  if (!input || input.key !== "=") return { act: false, reason: "not-equals" };
  const common = propertyCardSecondKeyCommonGate(input);
  if (!common.act) return common;
  const allowed = Array.isArray(input.allowedKinds) && input.allowedKinds.length > 0
    ? input.allowedKinds
    : propertyCardGateKinds();
  if (!allowed.includes(input.target)) {
    return { act: false, reason: "not-schema-note" };
  }
  if (!input.canHandleKey) return { act: false, reason: "no-handle-key" };
  return { act: true, reason: "schema-key" };
}

function schemaDoubleEqualsTargetKind(input = {}, registryOrPlugin) {
  const { path, frontmatter } = input || {};
  // Explicit instance registry context resolves extensions too. Accepts an
  // entry array or a plugin exposing propertyCardRegistry().
  let entries = null;
  try {
    if (Array.isArray(registryOrPlugin)) entries = registryOrPlugin;
    else if (registryOrPlugin && typeof registryOrPlugin.propertyCardRegistry === "function") {
      entries = registryOrPlugin.propertyCardRegistry();
    }
  } catch (_) {
    entries = null;
  }
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      try {
        if (entry && entry.match({ path, frontmatter }) === true) return entry.kind;
      } catch (_) {
        continue;
      }
    }
    return null;
  }
  // Compatibility facade over the shared matcher: same bank → album →
  // record results as the registry built-ins, without a separate predicate.
  for (const kind of PROPERTY_CARD_BUILTIN_KINDS) {
    try {
      if (propertyCardBuiltinMatch(kind, { path, frontmatter }) === true) return kind;
    } catch (_) {
      continue;
    }
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

function schemaDoubleEqualsContentDom(view, cm) {
  try {
    const fromEditor = view && view.editor && view.editor.cm && view.editor.cm.contentDOM;
    if (fromEditor) return fromEditor;
  } catch (_) {}
  try {
    if (cm && cm.cm6 && cm.cm6.contentDOM) return cm.cm6.contentDOM;
  } catch (_) {}
  return null;
}

function schemaDoubleEqualsEventInContent(event, view, cm) {
  const contentDOM = schemaDoubleEqualsContentDom(view, cm);
  const target = event && event.target;
  if (!contentDOM || !target) return false;
  if (target === contentDOM) return true;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return false;
  if (typeof target.closest !== "function") return false;
  try {
    return target.closest("[contenteditable]") === contentDOM;
  } catch (_) {
    return false;
  }
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
      match(input = {}) {
        return propertyCardBuiltinMatch("bank", input);
      },
      open({ path } = {}) {
        void plugin.openBankSetupCard({ sourcePath: path });
      },
    };
  }
  if (kind === "album") {
    return {
      kind: "album",
      match(input = {}) {
        return propertyCardBuiltinMatch("album", input);
      },
      open({ path } = {}) {
        void plugin.openAlbumSchemaEntry({ filePath: path });
      },
    };
  }
  return {
    kind: "record",
    match(input = {}) {
      return propertyCardBuiltinMatch("record", input);
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
    return true;
  }

  unregisterPropertyCard(kind) {
    const registry = this.propertyCardRegistry();
    const index = registry.findIndex((item) => item.kind === kind);
    if (index < 0) return false;
    registry.splice(index, 1);
    return true;
  }

  propertyCardSecondKeyArmRegistry() {
    if (!(this.propertyCardSecondKeyArms instanceof Map)) {
      this.propertyCardSecondKeyArms = new Map();
    }
    return this.propertyCardSecondKeyArms;
  }

  // The '=' and '-' arms are owned by this plugin. The historical
  // registerPropertyCardSecondKeyArm("+") API still registers the `+` arm;
  // that arm now runs on a bare normal-mode `+`, not after a pending `=`.
  registerPropertyCardSecondKeyArm(arm) {
    if (!arm || arm.key !== "+" || typeof arm.canAct !== "function" || typeof arm.run !== "function") {
      return false;
    }
    const registry = this.propertyCardSecondKeyArmRegistry();
    if (registry.has("+")) return false;
    registry.set("+", { key: "+", reason: arm.reason || "property-editor", canAct: arm.canAct, run: arm.run });
    return true;
  }

  unregisterPropertyCardSecondKeyArm(key) {
    if (key !== "+") return false;
    return this.propertyCardSecondKeyArmRegistry().delete("+");
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
    if (this.propertyCardToggleCommandRegistered !== true) {
      try {
        this.addCommand({
          id: "toggle-card-properties",
          name: "Toggle card properties",
          callback: () => {
            if (this.schemaDoubleEqualsActive === false) return false;
            const view = schemaDoubleEqualsActiveView(this);
            return typeof propertyCardToggleProperties === "function"
              ? propertyCardToggleProperties(view)
              : false;
          },
        });
        this.propertyCardToggleCommandRegistered = true;
      } catch (_) {}
    }
    if (this.propertyCardDetailsToggleCommandRegistered !== true) {
      try {
        this.addCommand({
          id: "toggle-card-details",
          name: "Toggle card details",
          callback: () => {
            if (this.schemaDoubleEqualsActive === false) return false;
            const view = schemaDoubleEqualsActiveView(this);
            return typeof propertyCardToggleDetails === "function"
              ? propertyCardToggleDetails(view)
              : false;
          },
        });
        this.propertyCardDetailsToggleCommandRegistered = true;
      } catch (_) {}
    }
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
    this.propertyCardRegistryEntries = [];
    this.propertyCardSecondKeyArms?.clear?.();
    this.handledSchemaDoubleEqualsEvents = null;
  }

  handleSchemaDoubleEqualsKeydown(event) {
    if (this.schemaDoubleEqualsActive === false) return;
    if (
      this.handledSchemaDoubleEqualsEvents &&
      this.handledSchemaDoubleEqualsEvents.has(event)
    ) {
      return;
    }
    const key = event && event.key;
    if (key !== "=" && key !== "-" && key !== "+" && key !== "_") return;
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
    // The species registry is the sole authority for '='. '-' checks the
    // live mount in this view. '_' targets a registered fold; '+' is the
    // registered Property Editor arm.
    // A runtime miss never mutates a registry or consumes Vim input.
    let entry = null;
    if (key === "=") {
      try {
        if (typeof this.resolvePropertyCard === "function") {
          entry = this.resolvePropertyCard({ path: filePath, frontmatter });
        }
      } catch (_) {
        entry = null;
      }
    }
    let arm = null;
    const context = { plugin: this, view, cm, path: filePath, frontmatter, entry, event };
    if (key === "=") {
      arm = {
        key,
        reason: "schema-key",
        canAct: () => Boolean(entry),
        run: () => { if (entry) void entry.open({ path: filePath, frontmatter }); },
      };
    } else if (key === "-") {
      arm = {
        key,
        reason: "properties-toggle",
        canAct: () => typeof propertyCardCanToggleProperties === "function"
          && propertyCardCanToggleProperties(view),
        run: () => { if (typeof propertyCardToggleProperties === "function") propertyCardToggleProperties(view); },
      };
    } else if (key === "_") {
      arm = {
        key,
        reason: "details-toggle",
        canAct: () => typeof propertyCardCanToggleDetails === "function"
          && propertyCardCanToggleDetails(view),
        run: () => { if (typeof propertyCardToggleDetails === "function") propertyCardToggleDetails(view); },
      };
    } else {
      arm = this.propertyCardSecondKeyArmRegistry().get("+") || null;
    }
    const wrappedArm = arm && {
      ...arm,
      canAct: () => arm.canAct(context),
    };
    const livePreview = schemaDoubleEqualsLivePreview(view, cm);
    const vim = schemaDoubleEqualsVimSnapshot(cm);
    const gate = key === "="
      ? propertyCardSecondKeyGate({
        key,
        ctrlKey: Boolean(event && event.ctrlKey),
        altKey: Boolean(event && event.altKey),
        metaKey: Boolean(event && event.metaKey),
        shiftKey: Boolean(event && event.shiftKey),
        repeat: Boolean(event && event.repeat),
        isComposing: Boolean(event && event.isComposing),
        defaultPrevented: Boolean(event && event.defaultPrevented),
        inEditor: schemaDoubleEqualsEventInEditor(event, view),
        livePreview,
        vim,
        canHandleKey: schemaDoubleEqualsCanHandleKey(),
        arm: wrappedArm,
        context,
      })
      : propertyCardBareKeyGate({
        key,
        ctrlKey: Boolean(event && event.ctrlKey),
        altKey: Boolean(event && event.altKey),
        metaKey: Boolean(event && event.metaKey),
        shiftKey: Boolean(event && event.shiftKey),
        repeat: Boolean(event && event.repeat),
        isComposing: Boolean(event && event.isComposing),
        defaultPrevented: Boolean(event && event.defaultPrevented),
        inContent: schemaDoubleEqualsEventInContent(event, view, cm),
        livePreview,
        vim,
        arm: wrappedArm,
        context,
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
    if (key === "=") {
      try {
        window.CodeMirrorAdapter.Vim.handleKey(cm, "<Esc>", "mapping");
      } catch (_) {}
    }
    try {
      arm.run(context);
    } catch (_) {}
  }
}
