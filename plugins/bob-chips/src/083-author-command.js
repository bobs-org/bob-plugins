// Make-or-edit command (both chip kinds), clipboard prefill, Alt+Click
// entry from Live Preview chips, and one-transaction writes.
function copyChipAuthorCmView(editor, view) {
  try {
    if (editor && editor.cm && typeof editor.cm.dispatch === "function") return editor.cm;
    if (view && view.editor && view.editor.cm && typeof view.editor.cm.dispatch === "function") {
      return view.editor.cm;
    }
    if (view && view.cm && typeof view.cm.dispatch === "function") return view.cm;
    if (view && typeof view.dispatch === "function" && view.state) return view;
  } catch (error) {
    // View lookup is best-effort.
  }
  return null;
}

function copyChipAuthorMarkdownView(editor, view) {
  try {
    if (view && view.file) return view;
    if (view && view.editor && view.file) return view;
    if (editor && editor.editorComponent && editor.editorComponent.view) {
      return editor.editorComponent.view;
    }
  } catch (error) {
    // Markdown view lookup is best-effort.
  }
  return view || null;
}

function copyChipAuthorFilePath(editor, view) {
  try {
    const md = copyChipAuthorMarkdownView(editor, view);
    if (md && md.file && typeof md.file.path === "string") return md.file.path;
    if (view && view.file && typeof view.file.path === "string") return view.file.path;
  } catch (error) {
    // Path lookup is best-effort.
  }
  return null;
}

function copyChipAuthorPosToOffset(editor, pos) {
  try {
    if (!pos || typeof pos !== "object") return null;
    if (editor && typeof editor.posToOffset === "function") {
      const offset = editor.posToOffset(pos);
      if (Number.isFinite(offset)) return offset;
    }
    if (Number.isInteger(pos.line) && Number.isInteger(pos.ch) && editor && typeof editor.getValue === "function") {
      const lines = String(editor.getValue()).split("\n");
      return copyChipAuthorLineStart(lines, pos.line) + pos.ch;
    }
  } catch (error) {
    // Offset mapping is best-effort.
  }
  return null;
}

function copyChipAuthorOffsetToPos(editor, offset, source) {
  try {
    if (editor && typeof editor.offsetToPos === "function") {
      const pos = editor.offsetToPos(offset);
      if (pos && typeof pos === "object") return pos;
    }
    const text = source != null
      ? String(source)
      : (editor && typeof editor.getValue === "function" ? String(editor.getValue()) : "");
    return copyChipAuthorPosAt(copyChipAuthorSplitLines(text), offset);
  } catch (error) {
    return { line: 0, ch: 0 };
  }
}

function copyChipAuthorReadSelections(editor, view) {
  try {
    const cm = copyChipAuthorCmView(editor, view);
    if (cm && cm.state && cm.state.selection && Array.isArray(cm.state.selection.ranges)) {
      return cm.state.selection.ranges.map((range) => {
        const from = Number.isFinite(range.from) ? range.from : Number(range.anchor);
        const to = Number.isFinite(range.to) ? range.to : Number(range.head);
        return { from, to };
      }).filter((range) => Number.isFinite(range.from) && Number.isFinite(range.to));
    }
    if (editor && typeof editor.listSelections === "function") {
      const list = editor.listSelections() || [];
      return list.map((sel) => {
        const anchor = copyChipAuthorPosToOffset(editor, sel.anchor);
        const head = copyChipAuthorPosToOffset(editor, sel.head);
        if (!Number.isFinite(anchor) || !Number.isFinite(head)) return null;
        return { from: anchor, to: head };
      }).filter(Boolean);
    }
    if (editor && typeof editor.getCursor === "function") {
      const cursor = editor.getCursor();
      const offset = copyChipAuthorPosToOffset(editor, cursor);
      if (Number.isFinite(offset)) return [{ from: offset, to: offset }];
    }
  } catch (error) {
    // Selection reading is best-effort.
  }
  return [];
}

function copyChipAuthorReadSource(editor, view) {
  try {
    if (editor && typeof editor.getValue === "function") return String(editor.getValue());
    const cm = copyChipAuthorCmView(editor, view);
    if (cm && cm.state && cm.state.doc && typeof cm.state.doc.toString === "function") {
      return String(cm.state.doc.toString());
    }
  } catch (error) {
    // Source reading is best-effort.
  }
  return "";
}

function copyChipAuthorIdentity(editor, view) {
  try {
    return copyChipFreeze({
      editor,
      view: copyChipAuthorMarkdownView(editor, view),
      path: copyChipAuthorFilePath(editor, view),
    });
  } catch (error) {
    return copyChipFreeze({ editor: null, view: null, path: null });
  }
}

function copyChipAuthorIdentityMatches(expected, editor, view) {
  try {
    if (!expected) return false;
    const current = copyChipAuthorIdentity(editor, view);
    if (expected.editor && current.editor && expected.editor !== current.editor) return false;
    if (expected.view && current.view && expected.view !== current.view) return false;
    if (expected.path && current.path && expected.path !== current.path) return false;
    if (expected.editor && !current.editor) return false;
    return true;
  } catch (error) {
    return false;
  }
}

function copyChipAuthorEditorDetached(editor, view) {
  try {
    if (!editor && !view) return true;
    const md = copyChipAuthorMarkdownView(editor, view);
    if (md && md._loaded === false) return true;
    if (md && md.containerEl && md.containerEl.isConnected === false) return true;
  } catch (error) {
    // Detach probe is best-effort.
  }
  return false;
}

async function copyChipAuthorReadClipboard() {
  try {
    const clipboard = copyChipClipboard();
    if (clipboard && typeof clipboard.readText === "function") {
      try {
        const text = await clipboard.readText();
        return text == null ? "" : String(text);
      } catch (error) {
        return "";
      }
    }
  } catch (error) {
    return "";
  }
  return "";
}

function copyChipAuthorExitVisual(editor, view) {
  try {
    const cmView = copyChipAuthorCmView(editor, view);
    const cm =
      (editor && editor.cm && editor.cm.cm) ||
      (cmView && cmView.cm) ||
      null;
    const vim = cm && cm.state && cm.state.vim;
    if (!vim || vim.visualMode !== true) return false;
    try {
      const adapter =
        (typeof window !== "undefined" && window.CodeMirrorAdapter && window.CodeMirrorAdapter.Vim) ||
        (typeof CodeMirrorAdapter !== "undefined" && CodeMirrorAdapter.Vim) ||
        null;
      if (adapter && typeof adapter.handleKey === "function" && cm) {
        adapter.handleKey(cm, "<Esc>", "mapping");
        return true;
      }
    } catch (error) {
      // Adapter path is best-effort.
    }
    try {
      vim.visualMode = false;
      vim.sel = null;
    } catch (error) {
      // Direct state clear is best-effort.
    }
    return true;
  } catch (error) {
    return false;
  }
}

function copyChipAuthorApplyWrite(editor, view, from, to, markdown, wasVisual) {
  try {
    const cmView = copyChipAuthorCmView(editor, view);
    const insert = String(markdown == null ? "" : markdown);
    const start = Number(from) || 0;
    const end = Number(to) || 0;
    const cursor = start + insert.length;
    if (cmView && typeof cmView.dispatch === "function") {
      const spec = {
        changes: { from: start, to: end, insert },
        selection: { anchor: cursor, head: cursor },
        userEvent: "bob.copy-chip",
      };
      try {
        const annotations = [];
        if (CopyChipsIsolateHistory && typeof CopyChipsIsolateHistory.of === "function") {
          annotations.push(CopyChipsIsolateHistory.of("full"));
        }
        if (CopyChipsTransaction && CopyChipsTransaction.userEvent &&
            typeof CopyChipsTransaction.userEvent.of === "function") {
          annotations.push(CopyChipsTransaction.userEvent.of("bob.copy-chip"));
        }
        if (annotations.length) spec.annotations = annotations;
      } catch (error) {
        // History annotations are best-effort.
      }
      cmView.dispatch(spec);
      if (wasVisual) copyChipAuthorExitVisual(editor, view);
      return true;
    }
    if (editor && typeof editor.replaceRange === "function") {
      const source = copyChipAuthorReadSource(editor, view);
      const fromPos = copyChipAuthorOffsetToPos(editor, start, source);
      const toPos = copyChipAuthorOffsetToPos(editor, end, source);
      editor.replaceRange(insert, fromPos, toPos);
      try {
        if (typeof editor.setCursor === "function") {
          editor.setCursor(copyChipAuthorOffsetToPos(editor, cursor, source.slice(0, start) + insert + source.slice(end)));
        }
      } catch (error) {
        // Cursor restore is best-effort.
      }
      if (wasVisual) copyChipAuthorExitVisual(editor, view);
      return true;
    }
  } catch (error) {
    return false;
  }
  return false;
}

function copyChipAuthorCommit(plugin, draft, snapshot, identity) {
  try {
    if (!draft || !draft.valid) return false;
    const editor = identity && identity.editor;
    const view = identity && identity.view;
    if (copyChipAuthorEditorDetached(editor, view)) {
      copyChipNotify(COPY_CHIP_AUTHOR_STALE);
      return false;
    }
    if (!copyChipAuthorIdentityMatches(identity, editor, view)) {
      copyChipNotify(COPY_CHIP_AUTHOR_STALE);
      return false;
    }
    const current = copyChipAuthorReadSource(editor, view);
    if (copyChipAuthorIsStale(snapshot, current)) {
      copyChipNotify(COPY_CHIP_AUTHOR_STALE);
      return false;
    }
    const plan = copyChipAuthorPlan(snapshot, { label: draft.label, text: draft.text, kind: draft.kind });
    if (!plan || !plan.ok) {
      copyChipNotify((plan && plan.reason) || COPY_CHIP_NOTHING_TO_COPY);
      return false;
    }
    const wasVisual = (() => {
      try {
        const cm = editor && editor.cm && editor.cm.cm;
        return Boolean(cm && cm.state && cm.state.vim && cm.state.vim.visualMode === true);
      } catch (error) {
        return false;
      }
    })();
    return copyChipAuthorApplyWrite(editor, view, plan.from, plan.to, plan.markdown, wasVisual);
  } catch (error) {
    return false;
  }
}

function copyChipAuthorOpenModal(plugin, options) {
  try {
    if (!plugin) return false;
    if (plugin.copyChipAuthorModal) {
      try {
        plugin.copyChipAuthorModal.copyChipSave();
      } catch (error) {
        // Repeat-hotkey save is best-effort.
      }
      return true;
    }
    if (typeof CopyChipAuthorModal !== "function") return false;
    const app = plugin.app || (options && options.app) || null;
    const modal = new CopyChipAuthorModal(app, {
      plugin,
      snapshot: options && options.snapshot,
      identity: options && options.identity,
      clipboardPromise: options && options.clipboardPromise,
      onSave: (draft, snapshot, identity) => copyChipAuthorCommit(plugin, draft, snapshot, identity),
    });
    plugin.copyChipAuthorModal = modal;
    try {
      modal.open();
    } catch (error) {
      plugin.copyChipAuthorModal = null;
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function copyChipAuthorRun(plugin, editor, view, extra) {
  try {
    if (plugin && plugin.copyChipAuthorModal) {
      try {
        plugin.copyChipAuthorModal.copyChipSave();
      } catch (error) {
        // Repeat save is best-effort.
      }
      return true;
    }
    const source = copyChipAuthorReadSource(editor, view);
    const selections = copyChipAuthorReadSelections(editor, view);
    const extraSelections = extra && Array.isArray(extra.selections) ? extra.selections : null;
    const resolved = copyChipAuthorResolve({
      source,
      selections: extraSelections || selections,
      clipboardText: extra && extra.clipboardText != null ? extra.clipboardText : "",
      resolveCommand: runChipAuthorEngine(plugin).resolve,
    });
    if (!resolved || resolved.ok !== true) {
      copyChipNotify((resolved && resolved.reason) || COPY_CHIP_AUTHOR_ONE_SELECTION);
      return false;
    }
    const identity = copyChipAuthorIdentity(editor, view);
    let clipboardPromise = null;
    if (resolved.snapshot.mode === "insert" && !resolved.snapshot.text) {
      clipboardPromise = extra && extra.clipboardPromise
        ? extra.clipboardPromise
        : copyChipAuthorReadClipboard();
    }
    return copyChipAuthorOpenModal(plugin, {
      snapshot: resolved.snapshot,
      identity,
      clipboardPromise,
    });
  } catch (error) {
    return false;
  }
}

// Alt+Click on a Live Preview chip of either kind: open the card for that
// exact occurrence, after checking the document still holds that chip at
// `[from, to)`. `chip` is `{ label, text, kind? }` (kind defaults to copy).
// A stale span opens nothing. Returns true when the card opened.
function copyChipAuthorOpenFromWidget(plugin, cmView, from, to, chip) {
  try {
    if (!plugin || !cmView || !cmView.state) return false;
    const kind = copyChipAuthorKind(chip && chip.kind);
    let info = null;
    try {
      if (CopyChipsEditorInfoField && typeof cmView.state.field === "function") {
        info = cmView.state.field(CopyChipsEditorInfoField);
      }
    } catch (error) {
      info = null;
    }
    const editor = (info && info.editor) || (info && info.editMode && info.editMode.editor) || null;
    const mdView = info || null;
    const source = copyChipAuthorReadSource(editor, cmView);
    const start = Number(from);
    const end = Number(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > source.length) {
      return false;
    }
    const slice = source.slice(start, end);
    let stillChip = false;
    try {
      const lines = copyChipAuthorSplitLines(source);
      const pos = copyChipAuthorPosAt(lines, start);
      const lineText = String(lines[pos.line] || "");
      const table = copyChipAuthorLineIsTable(lineText);
      const found = chipScanLine(lineText, { table });
      const lineStart = copyChipAuthorLineStart(lines, pos.line);
      for (const hit of found) {
        if (copyChipAuthorKind(hit.kind) !== kind) continue;
        if (lineStart + hit.from === start && lineStart + hit.to === end) {
          if (chip && chip.text != null && hit.text !== chip.text) continue;
          stillChip = true;
          break;
        }
      }
    } catch (error) {
      stillChip = false;
    }
    if (!stillChip) return false;
    const resolved = copyChipAuthorResolve({
      source,
      selections: [{ from: start, to: start }],
    });
    if (!resolved || resolved.ok !== true || !resolved.snapshot) return false;
    if (resolved.snapshot.from !== start || resolved.snapshot.to !== end || resolved.snapshot.kind !== kind) {
      const snap = resolved.snapshot;
      const forced = copyChipAuthorSnapshot({
        originalSource: source,
        from: start,
        to: end,
        sourceSlice: slice,
        label: (chip && chip.label) || "",
        text: (chip && chip.text) || "",
        title: copyChipAuthorTitle("edit", kind),
        mode: "edit",
        form: "inline",
        table: snap.table,
        indent: snap.indent,
        focus: "label",
        selectText: false,
        openingIndent: "",
        kind,
      });
      return copyChipAuthorOpenModal(plugin, {
        snapshot: forced,
        identity: copyChipAuthorIdentity(editor, mdView),
      });
    }
    return copyChipAuthorOpenModal(plugin, {
      snapshot: resolved.snapshot,
      identity: copyChipAuthorIdentity(editor, mdView),
    });
  } catch (error) {
    return false;
  }
}

// The Live Preview editor a rendered element sits in, or null (Reading
// view, embeds, hover previews). Never throws.
function copyChipAuthorEditorViewOf(el) {
  try {
    if (!el || !CopyChipsEditorView || typeof CopyChipsEditorView.findFromDOM !== "function") return null;
    const root = typeof el.closest === "function" ? el.closest(".cm-editor") : null;
    if (!root) return null;
    const view = CopyChipsEditorView.findFromDOM(root);
    return view && view.state ? view : null;
  } catch (error) {
    return null;
  }
}

// Alt+Click on a Live Preview `bob-run` card: open the card for the fence
// whose opening is zero-based line `openLine`, only while that fence still
// holds `chip.text`. Returns true when the card opened.
function copyChipAuthorOpenFromFence(plugin, cmView, openLine, chip) {
  try {
    if (!plugin || !cmView || !cmView.state || !Number.isInteger(openLine) || openLine < 0) return false;
    let info = null;
    try {
      if (CopyChipsEditorInfoField && typeof cmView.state.field === "function") {
        info = cmView.state.field(CopyChipsEditorInfoField);
      }
    } catch (error) {
      info = null;
    }
    const editor = (info && info.editor) || (info && info.editMode && info.editMode.editor) || null;
    const source = copyChipAuthorReadSource(editor, cmView);
    const lines = copyChipAuthorSplitLines(source);
    if (openLine >= lines.length) return false;
    const at = copyChipAuthorLineStart(lines, openLine);
    const resolved = copyChipAuthorResolve({ source, selections: [{ from: at, to: at }] });
    if (!resolved || resolved.ok !== true || !resolved.snapshot) return false;
    const snap = resolved.snapshot;
    if (snap.kind !== "run" || snap.form !== "block") return false;
    if (!copyChipFencePayloadEquals(snap.text, chip && chip.text)) return false;
    return copyChipAuthorOpenModal(plugin, {
      snapshot: snap,
      identity: copyChipAuthorIdentity(editor, info || null),
    });
  } catch (error) {
    return false;
  }
}

function copyChipRegisterAuthorCommand(plugin) {
  try {
    if (!plugin || typeof plugin.addCommand !== "function") return false;
    if (plugin.copyChipAuthorCommandRegistered === true) return true;
    plugin.copyChipAuthorCommandRegistered = true;
    try {
      plugin.addCommand({
        id: "make-or-edit",
        name: "Make or edit chip",
        hotkeys: [{ modifiers: ["Mod", "Shift"], key: "y" }],
        editorCallback: (editor, view) => {
          try {
            copyChipAuthorRun(plugin, editor, view);
          } catch (error) {
            // Command callback never throws.
          }
        },
      });
    } catch (error) {
      return false;
    }
    try {
      if (typeof plugin.register === "function") {
        plugin.register(() => {
          try {
            if (plugin.copyChipAuthorModal) {
              plugin.copyChipAuthorModal.copyChipCancel();
            }
          } catch (error) {
            // Unload close is best-effort.
          }
          plugin.copyChipAuthorModal = null;
          plugin.copyChipAuthorCommandRegistered = false;
        });
      }
    } catch (error) {
      // Unload cleanup is best-effort.
    }
    return true;
  } catch (error) {
    return false;
  }
}
