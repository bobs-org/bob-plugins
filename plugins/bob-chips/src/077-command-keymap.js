// ⌘↵ for command chips: the editor-bound `api.commandChips.targetAt` and
// `runAtCursor` members, the "Run command chip at cursor" palette command,
// and the hint (the armed chip plus a muted end-of-line keycap). Everything
// decides through commandChipAt, so the dispatcher, the palette command, and
// both cues can never disagree. Only bob-navigation-hotkeys owns the key:
// this file registers no hotkey and never spawns; runs go through
// commandChipActivate and so through Command Mode.
const COMMAND_CHIP_DISPATCH_COMMAND_ID = "bob-navigation-hotkeys:open-reference-pdf-in-highlights";
const COMMAND_CHIP_NAV_PLUGIN_ID = "bob-navigation-hotkeys";
const COMMAND_CHIP_HINT_CLASS = "bob-run-chip-hint";
const COMMAND_CHIP_HINT_DEBOUNCE_MS = 60;
const COMMAND_CHIP_HINT_LABEL_MAX = 40;
const COMMAND_CHIP_FIRED_MS = 600;
const COMMAND_CHIP_NOTHING_AT_CURSOR = "No command chip at the cursor";

function commandChipKeymapNone(skipped) {
  return copyChipFreeze({ state: "none", count: 0, skipped: skipped ? String(skipped) : null });
}

// The editor behind any of the shapes callers hold: a CM6 EditorView, an
// Obsidian Editor (`.cm`), or a MarkdownView-like `{ editor, file }`.
function commandChipEditorParts(input) {
  try {
    if (!input || typeof input !== "object") return null;
    if (input.state && input.state.doc) return { cm: input, editor: null, file: input.file || null };
    if (input.editor && typeof input.editor === "object") {
      const editor = input.editor;
      const cm = editor.cm && editor.cm.state ? editor.cm : null;
      return { cm, editor, file: input.file || null };
    }
    if (input.cm && input.cm.state) return { cm: input.cm, editor: input, file: null };
    if (typeof input.getValue === "function") return { cm: null, editor: input, file: null };
    return null;
  } catch (error) {
    return null;
  }
}

// The note the editor shows right now: the caller's file, else the CM6
// editor's own info field. Never the globally active leaf.
function commandChipEditorSourcePath(parts) {
  try {
    if (!parts) return null;
    if (parts.file && typeof parts.file.path === "string") return parts.file.path;
    return parts.cm ? commandChipLiveSourcePath(parts.cm) : null;
  } catch (error) {
    return null;
  }
}

// Lines, cursor, and selection shape, read fresh. Null when unreadable.
function commandChipEditorSnapshot(input) {
  try {
    const parts = commandChipEditorParts(input);
    if (!parts) return null;
    const lines = copyChipReadEditorLines(parts.editor, parts.cm);
    let cursor = null;
    let empty = true;
    let single = true;
    const selection = parts.cm && parts.cm.state && parts.cm.state.selection;
    if (selection && selection.main) {
      const main = selection.main;
      empty = main.from === main.to;
      single = !Array.isArray(selection.ranges) || selection.ranges.length === 1;
      cursor = copyChipReadEditorCursor(null, parts.cm);
    } else if (parts.editor) {
      cursor = copyChipReadEditorCursor(parts.editor, null);
      try {
        if (typeof parts.editor.somethingSelected === "function") empty = !parts.editor.somethingSelected();
        if (typeof parts.editor.listSelections === "function") {
          const list = parts.editor.listSelections();
          if (Array.isArray(list)) single = list.length <= 1;
        }
      } catch (error) {
        // Selection shape is best-effort; the cursor still decides.
      }
    }
    if (!lines || !cursor || !Number.isInteger(cursor.line) || !Number.isInteger(cursor.ch)) return null;
    if (cursor.line < 0 || cursor.line >= lines.length) return null;
    return { parts, lines, line: cursor.line, ch: Math.max(0, cursor.ch), empty, single, sourcePath: commandChipEditorSourcePath(parts) };
  } catch (error) {
    return null;
  }
}

// The zero-based line a run records as provenance: a fence's opening line.
function commandChipKeymapProvenanceLine(chip) {
  if (chip && chip.form === "block" && chip.fence && Number.isInteger(chip.fence.open)) return chip.fence.open;
  return chip && Number.isInteger(chip.line) ? chip.line : null;
}

// What ⌘↵ would do here, with the no-run, Command Mode, and resolve checks
// applied. Frozen and total:
//   { state: "none", count: 0, skipped }    the existing ⌘↵ chain runs
//                                           (`skipped` names a no-run context)
//   { state: "ambiguous", count, via, message }
//   { state: "blocked", count, via, chip, reason }   refuses with bob's reason
//   { state: "ready", count, via, chip, running, loading, key, sourcePath }
function commandChipTargetAt(plugin, input) {
  try {
    const snap = commandChipEditorSnapshot(input);
    if (!snap) return commandChipKeymapNone();
    const app = plugin && plugin.app;
    const policy = commandChipEligibility(app, { origin: "cursor", sourcePath: snap.sourcePath });
    if (policy.mode !== "run") return commandChipKeymapNone(policy.reason);
    const scope = copyChipTaskScopeFromNav(app, snap.lines, snap.line);
    const at = commandChipAt({ lines: snap.lines, line: snap.line, ch: snap.ch, scope });
    if (!at || at.state === "none") return commandChipKeymapNone();
    if (at.state === "ambiguous") {
      return copyChipFreeze({ state: "ambiguous", count: at.count, via: at.via, message: at.message });
    }
    const chip = at.chip;
    const runtime = commandChipRuntimeOf(plugin);
    const verdict = (runtime && runtime.cache.get(policy.engine, chip.text)) || commandChipFreshResolve(policy.engine, chip.text);
    if (verdict.state !== "ready" && verdict.state !== "loading") {
      return copyChipFreeze({
        state: "blocked",
        count: at.count,
        via: at.via,
        chip,
        reason: commandChipRefusalText(verdict),
      });
    }
    const key = commandChipStoreKey(verdict, chip.text);
    const snapshot = runtime ? runtime.store.snapshot(key) : null;
    return copyChipFreeze({
      state: "ready",
      count: at.count,
      via: at.via,
      chip,
      running: Boolean(snapshot && commandChipIsLiveState(snapshot.state)),
      loading: verdict.state === "loading",
      key,
      sourcePath: policy.sourcePath,
      line: snap.line,
      verdict,
    });
  } catch (error) {
    return commandChipKeymapNone();
  }
}

// Re-read the editor and confirm the targeted chip's text is still there.
function commandChipKeymapCheckSource(input, chip, raw) {
  try {
    const snap = commandChipEditorSnapshot(input);
    if (!snap) return commandChipSourceVerdict(false);
    if (chip.form === "block") {
      const open = chip.fence && Number.isInteger(chip.fence.open) ? chip.fence.open : chip.line;
      const block = copyChipFindFenceBlock(snap.lines, open);
      const again = block ? runChipFenceBlockChip(snap.lines, open, block) : null;
      return commandChipSourceVerdict(Boolean(again && again.text === chip.text));
    }
    return commandChipTextSourceCheck(snap.lines.join("\n"), { line: chip.line, from: chip.from, to: chip.to, raw });
  } catch (error) {
    return commandChipSourceVerdict(false);
  }
}

// A brief accent pulse on the chip ⌘↵ just fired: its mounted face (an
// inline pill or a `bob-run` card), or the revealed source range when the
// cursor sits inside the span. Cosmetic.
function commandChipKeymapPulse(plugin, cm, target) {
  try {
    if (!cm || !target || !target.chip) return false;
    const want = commandChipTargetId({ ...target.chip, sourcePath: target.sourcePath });
    const dom = cm.dom;
    if (want && dom && typeof dom.querySelectorAll === "function") {
      const list = dom.querySelectorAll(".bob-run-chip, .bob-run-fence");
      for (let index = 0; list && index < list.length; index += 1) {
        const el = list[index];
        const mount = commandChipMountOf(el);
        if (!mount || mount.plugin !== plugin) continue;
        if (commandChipTargetId({ ...mount.chip, sourcePath: target.sourcePath }) !== want) continue;
        commandChipSetClass(el, "is-fired", true);
        copyChipTimerHost(el.ownerDocument || null).set(() => commandChipSetClass(el, "is-fired", false), COMMAND_CHIP_FIRED_MS);
        return true;
      }
    }
    if (target.chip.form === "inline") return copyChipFlashSourceRange(cm, target.chip);
    return false;
  } catch (error) {
    return false;
  }
}

// Run the command chip ⌘↵ targets. Resolves to a frozen `{ handled,
// outcome, stage, reason, action, runId }` and never rejects:
//   none                → handled false: the caller's chain runs unchanged;
//   ambiguous, blocked  → one Notice, handled true, nothing runs;
//   ready               → commandChipActivate, settling after the run.
async function commandChipRunAtCursor(plugin, input) {
  const result = (handled, fields) => copyChipFreeze({
    handled,
    outcome: fields.outcome || null,
    stage: fields.stage || null,
    reason: fields.reason == null ? null : String(fields.reason),
    action: fields.action || null,
    runId: fields.runId || null,
  });
  try {
    const target = commandChipTargetAt(plugin, input);
    if (target.state === "none") return result(false, { outcome: "none", reason: target.skipped });
    if (target.state === "ambiguous") {
      commandChipNotice(target.message);
      return result(true, { outcome: "ambiguous", reason: target.message });
    }
    if (target.state === "blocked") {
      commandChipNotice(COMMAND_CHIP_REFUSED_PREFIX + target.reason);
      return result(true, { outcome: "refused", stage: "refused", reason: target.reason });
    }
    const chip = target.chip;
    const snap = commandChipEditorSnapshot(input);
    const raw = snap && chip.form !== "block" ? String(snap.lines[chip.line] || "").slice(chip.from, chip.to) : null;
    const cm = snap && snap.parts ? snap.parts.cm : null;
    commandChipKeymapPulse(plugin, cm, target);
    const ctx = {
      plugin,
      origin: "cursor",
      sourcePath: target.sourcePath,
      resolveSourcePath: () => {
        const parts = commandChipEditorParts(input);
        return parts ? commandChipEditorSourcePath(parts) : null;
      },
      line: commandChipKeymapProvenanceLine(chip),
      view: cm,
      checkSource: () => commandChipKeymapCheckSource(input, chip, raw),
      refresh: () => {
        if (cm) commandChipLiveRefresh(cm);
      },
    };
    const settled = await commandChipActivate(chip, ctx);
    return result(true, {
      outcome: (settled && (settled.outcome || settled.action)) || null,
      stage: settled && settled.stage,
      reason: settled && settled.reason,
      action: settled && settled.action,
      runId: settled && settled.runId,
    });
  } catch (error) {
    return result(true, { outcome: "error", reason: commandChipErrorReason(error, "command chip failed") });
  }
}

// --- The live binding --------------------------------------------------

function commandChipIsMac() {
  try {
    if (CommandChipsPlatform && CommandChipsPlatform.isMacOS === true) return true;
    if (typeof navigator === "object" && navigator) {
      return /Mac|iPhone|iPad/.test(String(navigator.platform || navigator.userAgent || ""));
    }
  } catch (error) {
    return false;
  }
  return false;
}

// The dispatcher's first live binding `{ modifiers, key }`, or null. A
// custom list (even an empty one) replaces the defaults, as in Obsidian.
function commandChipDispatchHotkey(app) {
  try {
    const manager = app && app.hotkeyManager;
    if (!manager) return null;
    let list = typeof manager.getHotkeys === "function" ? manager.getHotkeys(COMMAND_CHIP_DISPATCH_COMMAND_ID) : undefined;
    if (list === undefined && manager.customKeys) list = manager.customKeys[COMMAND_CHIP_DISPATCH_COMMAND_ID];
    if (list === undefined || list === null) {
      list = typeof manager.getDefaultHotkeys === "function" ? manager.getDefaultHotkeys(COMMAND_CHIP_DISPATCH_COMMAND_ID) : undefined;
      if ((list === undefined || list === null) && manager.defaultKeys) list = manager.defaultKeys[COMMAND_CHIP_DISPATCH_COMMAND_ID];
    }
    const first = Array.isArray(list) ? list[0] : list;
    if (!first || typeof first !== "object") return null;
    const key = first.key == null ? "" : String(first.key);
    if (!key) return null;
    return { modifiers: Array.isArray(first.modifiers) ? first.modifiers.map(String) : [], key };
  } catch (error) {
    return null;
  }
}

// Keycap glyphs in the `⌘↵ Gmail` hint's convention: Mac glyphs, else
// Emacs-style prefixes (`M-↵`). Empty without a binding.
function commandChipFormatHotkey(hotkey, isMac) {
  try {
    if (!hotkey || !hotkey.key) return "";
    const mods = Array.isArray(hotkey.modifiers) ? hotkey.modifiers : [];
    const key = hotkey.key === "Enter" || hotkey.key === "Return" ? "↵" : hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
    const order = isMac
      ? [["Mod", "⌘"], ["Meta", "⌘"], ["Ctrl", "⌃"], ["Control", "⌃"], ["Alt", "⌥"], ["Shift", "⇧"]]
      : [["Meta", "M-"], ["Mod", "C-"], ["Ctrl", "C-"], ["Control", "C-"], ["Alt", "A-"], ["Shift", "S-"]];
    const seen = new Set();
    let out = "";
    for (const [name, glyph] of order) {
      if (!mods.includes(name) || seen.has(glyph)) continue;
      seen.add(glyph);
      out += glyph;
    }
    return out + key;
  } catch (error) {
    return "";
  }
}

// The binding spelled out for screen readers: "Cmd+Enter".
function commandChipSpellHotkey(hotkey, isMac) {
  try {
    if (!hotkey || !hotkey.key) return "";
    const names = isMac
      ? { Mod: "Cmd", Meta: "Cmd", Ctrl: "Ctrl", Control: "Ctrl", Alt: "Option", Shift: "Shift" }
      : { Mod: "Ctrl", Meta: "Meta", Ctrl: "Ctrl", Control: "Ctrl", Alt: "Alt", Shift: "Shift" };
    const words = [];
    for (const name of ["Mod", "Meta", "Ctrl", "Control", "Alt", "Shift"]) {
      const word = names[name];
      if ((hotkey.modifiers || []).includes(name) && !words.includes(word)) words.push(word);
    }
    words.push(hotkey.key === "Return" ? "Enter" : hotkey.key);
    return words.join("+");
  } catch (error) {
    return "";
  }
}

// True when bob-navigation-hotkeys' ⌘↵ dispatcher runs command chips.
function commandChipDispatchLive(app) {
  try {
    const registry = app && app.plugins;
    const nav = registry && registry.plugins ? registry.plugins[COMMAND_CHIP_NAV_PLUGIN_ID] : null;
    return Boolean(nav && nav.commandChipDispatch === 1);
  } catch (error) {
    return false;
  }
}

// `{ hotkey, keycap, spoken }` when ⌘↵ really runs chips, else null.
function commandChipLiveBinding(app) {
  if (!commandChipDispatchLive(app)) return null;
  const hotkey = commandChipDispatchHotkey(app);
  const isMac = commandChipIsMac();
  const keycap = commandChipFormatHotkey(hotkey, isMac);
  if (!keycap) return null;
  return { hotkey, keycap, spoken: commandChipSpellHotkey(hotkey, isMac) || keycap };
}

// Keep the chip tooltips' "Click or ⌘↵ to run" truthful; repaint every
// mounted face when the binding appears, changes, or goes away.
function commandChipSyncRunHotkey(plugin) {
  try {
    if (!plugin) return null;
    const binding = commandChipLiveBinding(plugin.app);
    const next = binding ? binding.keycap : null;
    if ((plugin.commandChipRunHotkey || null) !== next) {
      plugin.commandChipRunHotkey = next;
      const runtime = commandChipRuntimeOf(plugin);
      if (runtime) {
        for (const token of [...runtime.catalogListeners]) commandChipCallListener(token.listener, null);
      }
    }
    return next;
  } catch (error) {
    return null;
  }
}

// --- The hint ------------------------------------------------------------

// The face text a keycap names when the target sits on another line.
function commandChipHintLabel(target) {
  try {
    const chip = target.chip;
    const face = commandChipFaceModel(chip, target.verdict);
    let text = commandChipFaceName(face);
    if (chip.form === "block" && (chip.label === null || chip.label === undefined)) {
      const count = face.count || 0;
      text = count > 1 ? count + " steps" : commandChipFirstLine(chip.text);
    }
    text = String(text || "").replace(/\s+/g, " ").trim();
    return text.length > COMMAND_CHIP_HINT_LABEL_MAX ? text.slice(0, COMMAND_CHIP_HINT_LABEL_MAX - 1).trimEnd() + "…" : text;
  } catch (error) {
    return "";
  }
}

// Everything one editor's cue shows, decided from live state. Frozen
// `{ visible, text, ariaLabel, armed, key, running }`. Visible only when ⌘↵
// would run the chip: a ready target (never loading, ambiguous, blocked,
// or copy-only), the dispatcher's capability flag, a live binding, a
// focused editor, and one empty selection.
function commandChipHintModel(plugin, cm) {
  const hidden = copyChipFreeze({ visible: false, text: "", ariaLabel: "", armed: null, key: null, running: false, line: null });
  try {
    if (!plugin || !cm || !cm.state) return hidden;
    if (cm.hasFocus === false) return hidden;
    const binding = commandChipLiveBinding(plugin.app);
    if (!binding) return hidden;
    const snap = commandChipEditorSnapshot(cm);
    if (!snap || !snap.empty || !snap.single) return hidden;
    const target = commandChipTargetAt(plugin, cm);
    if (target.state !== "ready" || target.loading) return hidden;
    const face = commandChipHintLabel(target);
    const elsewhere = target.via === "task" && target.chip.line !== snap.line;
    let text = binding.keycap + " Run";
    let ariaLabel = binding.spoken + " runs " + face;
    if (target.running) {
      text = binding.keycap + " Output";
      ariaLabel = binding.spoken + " opens the output of " + face;
    } else if (elsewhere && face) {
      text += " · " + face;
    }
    const armed = copyChipFreeze({ ...target.chip, key: target.key, sourcePath: target.sourcePath });
    return copyChipFreeze({ visible: true, text, ariaLabel, armed, key: target.key, running: target.running, line: snap.line });
  } catch (error) {
    return hidden;
  }
}

function buildCommandChipHintElement(doc, model) {
  try {
    if (!doc || typeof doc.createElement !== "function" || !model || !model.text) return null;
    const host = doc.createElement("span");
    host.setAttribute("class", COMMAND_CHIP_HINT_CLASS + (model.running ? " is-running" : ""));
    host.setAttribute("role", "img");
    host.setAttribute("aria-label", model.ariaLabel || model.text);
    host.setAttribute("data-tooltip-position", "top");
    host.textContent = String(model.text);
    return host;
  } catch (error) {
    return null;
  }
}

let CommandChipHintWidgetClass = null;
function commandChipEnsureHintWidget() {
  if (CommandChipHintWidgetClass) return CommandChipHintWidgetClass;
  try {
    if (!CopyChipsWidgetType || typeof CopyChipsWidgetType !== "function") return null;
    CommandChipHintWidgetClass = class extends CopyChipsWidgetType {
      constructor(model) {
        super();
        this.model = model;
      }

      eq(other) {
        return Boolean(
          other instanceof CommandChipHintWidgetClass &&
            other.model.text === this.model.text &&
            other.model.ariaLabel === this.model.ariaLabel &&
            other.model.running === this.model.running,
        );
      }

      toDOM(view) {
        const doc = (view && view.dom && view.dom.ownerDocument) || (typeof document !== "undefined" ? document : null);
        return buildCommandChipHintElement(doc, this.model) || doc.createElement("span");
      }

      ignoreEvent() {
        return true;
      }
    };
    return CommandChipHintWidgetClass;
  } catch (error) {
    return null;
  }
}

let commandChipHintRefreshEffect = null;
function commandChipEnsureHintRefresh() {
  if (commandChipHintRefreshEffect) return commandChipHintRefreshEffect;
  try {
    if (CopyChipsStateEffect && typeof CopyChipsStateEffect.define === "function") {
      commandChipHintRefreshEffect = CopyChipsStateEffect.define();
    }
  } catch (error) {
    commandChipHintRefreshEffect = null;
  }
  return commandChipHintRefreshEffect;
}

function commandChipHintDecorations(cm, model) {
  try {
    if (!model || !model.visible || !CopyChipsRangeSetBuilder) return CopyChipsDecoration.none;
    const Widget = commandChipEnsureHintWidget();
    const doc = cm.state.doc;
    if (!Widget || !doc || typeof doc.line !== "function") return CopyChipsDecoration.none;
    const line = doc.line(model.line + 1);
    const builder = new CopyChipsRangeSetBuilder();
    builder.add(line.to, line.to, CopyChipsDecoration.widget({ widget: new Widget(model), side: 1 }));
    return builder.finish();
  } catch (error) {
    return CopyChipsDecoration.none;
  }
}

function commandChipHintCursorLine(state) {
  try {
    return state.doc.lineAt(state.selection.main.head).number;
  } catch (error) {
    return null;
  }
}

// One painter per editor. Every side effect (resolve, arming, dispatch)
// runs in a debounced timer; update() only maps or hides the last cue and
// paints a model the timer delivered.
function commandChipCreateHintExtension(plugin) {
  try {
    if (!copyChipsEditorAvailable() || !commandChipEnsureHintRefresh() || !commandChipEnsureHintWidget()) return null;
    const refresh = commandChipEnsureHintRefresh();
    const views = plugin.commandChipHintViews instanceof Set ? plugin.commandChipHintViews : new Set();
    plugin.commandChipHintViews = views;
    const PainterClass = class {
      constructor(view) {
        this.view = view;
        this.timer = null;
        this.model = null;
        this.destroyed = false;
        this.decorations = CopyChipsDecoration.none;
        views.add(this);
        this.schedule();
      }

      schedule() {
        if (this.destroyed) return;
        try {
          if (this.timer !== null) clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.timer = null;
            this.recompute();
          }, COMMAND_CHIP_HINT_DEBOUNCE_MS);
        } catch (error) {
          this.timer = null;
        }
      }

      recompute() {
        if (this.destroyed || commandChipRuntimeOf(plugin) === null) return;
        commandChipSyncRunHotkey(plugin);
        const model = commandChipHintModel(plugin, this.view);
        const store = commandChipStoreOf(plugin);
        if (store) {
          if (model.armed) {
            store.setArmed(model.armed);
            plugin.commandChipArmedBy = this;
          } else if (plugin.commandChipArmedBy === this) {
            store.setArmed(null);
            plugin.commandChipArmedBy = null;
          }
        }
        this.model = model;
        try {
          this.view.dispatch({ effects: refresh.of({ owner: this, model }) });
        } catch (error) {
          // A detached editor keeps no cue.
        }
      }

      update(update) {
        try {
          for (const tr of update.transactions || []) {
            for (const effect of [].concat(tr.effects || [])) {
              if (effect && typeof effect.is === "function" && effect.is(refresh) && effect.value && effect.value.owner === this) {
                this.decorations = commandChipHintDecorations(update.view, effect.value.model);
                return;
              }
            }
          }
          const lineMoved = update.selectionSet &&
            commandChipHintCursorLine(update.startState) !== commandChipHintCursorLine(update.state);
          if (lineMoved || update.focusChanged || (update.selectionSet && !update.state.selection.main.empty)) {
            this.decorations = CopyChipsDecoration.none;
          } else if (update.docChanged && this.decorations && typeof this.decorations.map === "function") {
            this.decorations = this.decorations.map(update.changes);
          }
          if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged) this.schedule();
        } catch (error) {
          this.decorations = CopyChipsDecoration.none;
        }
      }

      destroy() {
        this.destroyed = true;
        views.delete(this);
        try {
          if (this.timer !== null) clearTimeout(this.timer);
        } catch (error) {
          // Timer cleanup is best-effort.
        }
        this.timer = null;
        if (plugin.commandChipArmedBy === this) {
          const store = commandChipStoreOf(plugin);
          if (store) store.setArmed(null);
          plugin.commandChipArmedBy = null;
        }
      }
    };
    return CopyChipsViewPlugin.fromClass(PainterClass, { decorations: (value) => value.decorations });
  } catch (error) {
    return null;
  }
}

function commandChipScheduleHints(plugin, onlyKey) {
  try {
    const views = plugin && plugin.commandChipHintViews;
    if (!(views instanceof Set)) return;
    for (const painter of views) {
      if (onlyKey !== undefined && !(painter.model && painter.model.key === onlyKey)) continue;
      painter.schedule();
    }
  } catch (error) {
    // Hint refreshes are best-effort.
  }
}

// Register the cue, the palette command, and the refresh triggers: catalog
// changes, run starts and ends of the painted target, and layout or leaf
// changes (which also resync the tooltip binding; every painter recompute
// does too). Idempotent per load.
function commandChipSetupKeymap(plugin) {
  try {
    if (!plugin || plugin.commandChipKeymapSetupDone === true) return false;
    plugin.commandChipKeymapSetupDone = true;
    const extension = commandChipCreateHintExtension(plugin);
    if (extension && typeof plugin.registerEditorExtension === "function") plugin.registerEditorExtension(extension);
    commandChipOnCatalogChanged(plugin, () => commandChipScheduleHints(plugin));
    const store = commandChipStoreOf(plugin);
    if (store) {
      store.subscribeAll((key, snapshot) => {
        const live = commandChipIsLiveState(snapshot && snapshot.state);
        for (const painter of plugin.commandChipHintViews || []) {
          if (painter.model && painter.model.key === key && painter.model.running !== live) painter.schedule();
        }
      });
    }
    const workspace = plugin.app && plugin.app.workspace;
    if (workspace && typeof workspace.on === "function" && typeof plugin.registerEvent === "function") {
      for (const name of ["layout-change", "active-leaf-change"]) {
        plugin.registerEvent(workspace.on(name, () => {
          commandChipSyncRunHotkey(plugin);
          commandChipScheduleHints(plugin);
        }));
      }
    }
    if (typeof plugin.addCommand === "function") {
      plugin.addCommand({
        id: "run-at-cursor",
        name: "Run command chip at cursor",
        editorCallback: (editor, view) => {
          const input = { editor, file: (view && view.file) || null };
          commandChipRunAtCursor(plugin, input).then((settled) => {
            if (settled && settled.handled === false) {
              commandChipNotice(settled.reason ? "Command chips don't run here: " + settled.reason : COMMAND_CHIP_NOTHING_AT_CURSOR);
            }
          }, () => {});
        },
      });
    }
    if (typeof plugin.register === "function") {
      plugin.register(() => {
        plugin.commandChipKeymapSetupDone = false;
        plugin.commandChipArmedBy = null;
        if (plugin.commandChipHintViews instanceof Set) plugin.commandChipHintViews.clear();
      });
    }
    return true;
  } catch (error) {
    return false;
  }
}

// `api.commandChips` plus the editor-bound keymap members, which callers
// feature-detect with `typeof`. Frozen; neither member throws or rejects.
function commandChipBindKeymapApi(plugin, base) {
  try {
    const pure = base && typeof base === "object" ? base : commandChipFallbackApi();
    return copyChipFreeze({
      ...pure,
      targetAt(view) {
        try {
          return commandChipTargetAt(plugin, view);
        } catch (error) {
          return commandChipKeymapNone();
        }
      },
      runAtCursor(view) {
        try {
          return commandChipRunAtCursor(plugin, view);
        } catch (error) {
          return Promise.resolve(copyChipFreeze({ handled: false, outcome: "none", stage: null, reason: null, action: null, runId: null }));
        }
      },
    });
  } catch (error) {
    return base;
  }
}
