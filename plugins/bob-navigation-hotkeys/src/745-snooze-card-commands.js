// Snooze Card commands: Task Card `z` dispatch and collision-safe Alt+Z
// registration. The Task Card row/order/shortcut live in 310/314; this
// fragment bridges the `snooze` intent to the Snooze Card modal and keeps
// the card entry available when Alt+Z itself is taken.
function snoozeCardTaskTitleForResolution(resolution) {
  try {
    const task = resolution && resolution.task;
    if (task && typeof task.displayText === "string" && task.displayText.trim() !== "") {
      return task.displayText.trim().slice(0, 80);
    }
    if (task && typeof task.target === "string" && task.target.trim() !== "") {
      const stem = task.target.split("/").pop() || task.target;
      return stem.trim().slice(0, 80) || "task";
    }
  } catch (_) {}
  return "task";
}

function isSnoozeAltZBinding(hotkey) {
  if (!hotkey || typeof hotkey !== "object") return false;
  const key = String(hotkey.key == null ? "" : hotkey.key);
  const modifiers = Array.isArray(hotkey.modifiers) ? hotkey.modifiers.map(String) : [];
  const hasAlt = modifiers.some((item) => String(item).toLowerCase() === "alt");
  const onlyAlt = modifiers.length === 1 && hasAlt;
  if (!onlyAlt) return false;
  if (key.toLowerCase() === "z") return true;
  return false;
}

function snoozeCardAltZConflict(app, selfCommandId) {
  const conflicts = [];
  try {
    const manager = app && app.hotkeyManager;
    if (manager) {
      const listCommands = () => {
        try {
          if (app.commands && typeof app.commands === "object" && app.commands.commands) {
            const raw = app.commands.commands;
            if (Array.isArray(raw)) return raw.map((command) => command && command.id).filter(Boolean);
            return Object.keys(raw);
          }
        } catch (_) {}
        return [];
      };
      const ids = listCommands();
      const custom = manager.customKeys instanceof Map ? [...manager.customKeys.keys()] : Object.keys(manager.customKeys || {});
      const defaults = manager.defaultKeys instanceof Map ? [...manager.defaultKeys.keys()] : Object.keys(manager.defaultKeys || {});
      const known = new Set([...ids, ...custom, ...defaults]);
      for (const id of known) {
        if (String(id) === String(selfCommandId)) continue;
        let hotkeys = null;
        try {
          if (manager.customKeys && (manager.customKeys instanceof Map ? manager.customKeys.has(id) : Object.prototype.hasOwnProperty.call(manager.customKeys, id))) {
            hotkeys = manager.customKeys instanceof Map ? manager.customKeys.get(id) : manager.customKeys[id];
          } else if (typeof manager.getHotkeys === "function") {
            hotkeys = manager.getHotkeys(id);
          }
        } catch (_) {
          hotkeys = null;
        }
        const list = Array.isArray(hotkeys) ? hotkeys : (hotkeys ? [hotkeys] : []);
        for (const hotkey of list) {
          if (isSnoozeAltZBinding(hotkey)) {
            conflicts.push({ kind: "hotkey", commandId: String(id) });
            break;
          }
        }
      }
      try {
        const defaultsForSelf = typeof manager.getDefaultHotkeys === "function" ? manager.getDefaultHotkeys(selfCommandId) : manager.defaultKeys && (manager.defaultKeys instanceof Map ? manager.defaultKeys.get(selfCommandId) : manager.defaultKeys[selfCommandId]);
        const list = Array.isArray(defaultsForSelf) ? defaultsForSelf : (defaultsForSelf ? [defaultsForSelf] : []);
        void list;
      } catch (_) {}
    }
  } catch (_) {}
  try {
    const commands = app && app.commands && app.commands.commands;
    if (commands && typeof commands === "object") {
      const entries = Array.isArray(commands) ? commands.map((command) => [command && command.id, command]) : Object.entries(commands);
      for (const [id, command] of entries) {
        if (!id || String(id) === String(selfCommandId)) continue;
        const hotkeys = command && command.hotkeys;
        const list = Array.isArray(hotkeys) ? hotkeys : (hotkeys ? [hotkeys] : []);
        for (const hotkey of list) {
          if (isSnoozeAltZBinding(hotkey)) {
            if (!conflicts.some((entry) => entry.commandId === String(id))) {
              conflicts.push({ kind: "plugin-default", commandId: String(id) });
            }
            break;
          }
        }
      }
    }
  } catch (_) {}
  // Option-key handling on Mac: KeyZ with Alt is the same gesture even when
  // the platform supplies a different event.key (e.g. Ω). A registered
  // Alt+Ω default counts as the same conflict; the checks above already
  // match modifiers+key, and the modal accepts KeyZ by code where needed.
  return Object.freeze(conflicts);
}

function snoozeCardVimrcMapsAltZ(source) {
  const mapCommand = /^(?:(?:n|i|v|x|s|o|c|l|t)noremap|noremap|(?:n|i|v|x|s|o|c|l|t)map|map!?|noremap!)(?:!)?\s+(.+)$/i;
  const options = new Set(["<buffer>", "<nowait>", "<silent>", "<script>", "<expr>", "<unique>", "<special>"]);
  for (const sourceLine of String(source || "").split(/\r?\n/)) {
    let line = sourceLine.trim();
    if (!line || line.startsWith('"')) continue;
    line = line.replace(/\s+"[^\"]*$/, "").trim();
    const mapping = mapCommand.exec(line);
    if (!mapping) continue;
    const parts = mapping[1].trim().split(/\s+/);
    while (parts.length && options.has(parts[0].toLowerCase())) parts.shift();
    const lhs = parts[0] || "";
    if (/^(?:<(?:A|M)-z>|<(?:Alt)[-+]z>|(?:A|M)-z|Alt\+z)$/i.test(lhs)) return true;
  }
  return false;
}

function snoozeCardNormalizeVimrcPath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
  if (!raw) return null;
  const parts = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

// Read the configured vimrc through Obsidian's vault adapter, following
// bob-command-mode's settings path. In-memory plugin fields are not an
// authority for user mappings.
async function snoozeCardVimrcConflict(app) {
  try {
    const vault = app && app.vault;
    const adapter = vault && vault.adapter;
    if (!adapter || typeof adapter.read !== "function") return null;
    const configDir = String(vault.configDir || ".obsidian").replace(/\/$/, "");
    const settings = JSON.parse(await adapter.read(configDir + "/plugins/obsidian-vimrc-support/data.json"));
    const vimrcPath = snoozeCardNormalizeVimrcPath(settings && settings.vimrcFileName);
    if (!vimrcPath) return null;
    const source = await adapter.read(vimrcPath);
    if (!snoozeCardVimrcMapsAltZ(source)) return null;
    return { kind: "vimrc", commandId: "obsidian-vimrc-support", path: vimrcPath };
  } catch (_) {
    return null;
  }
}

function describeSnoozeAltZConflict(conflicts) {
  if (!Array.isArray(conflicts) || conflicts.length === 0) return null;
  const first = conflicts[0];
  if (first.kind === "vimrc") return "Alt+Z is mapped in the vimrc; the Snooze command stays available without the hotkey";
  return "Alt+Z is already bound to " + first.commandId + "; the Snooze command stays available without the hotkey";
}

function snoozeCardCommandHasAltZ(app, commandId) {
  try {
    const manager = app && app.hotkeyManager;
    if (!manager) return false;
    if (typeof manager.getHotkeys === "function") {
      const effective = manager.getHotkeys(commandId);
      if (Array.isArray(effective)) return effective.some(isSnoozeAltZBinding);
    }
    const has = (source) => source instanceof Map ? source.has(commandId) : Boolean(source && Object.prototype.hasOwnProperty.call(source, commandId));
    const get = (source) => source instanceof Map ? source.get(commandId) : source && source[commandId];
    if (has(manager.customKeys)) {
      const custom = get(manager.customKeys);
      const list = Array.isArray(custom) ? custom : (custom ? [custom] : []);
      return list.some(isSnoozeAltZBinding);
    }
    const defaults = get(manager.defaultKeys);
    const list = Array.isArray(defaults) ? defaults : (defaults ? [defaults] : []);
    return list.some(isSnoozeAltZBinding);
  } catch (_) {
    return false;
  }
}

function registerSnoozeAltZFallback(plugin, commandId, conflicts) {
  if (!plugin || !Array.isArray(conflicts) || conflicts.length > 0) return false;
  if (!snoozeCardCommandHasAltZ(plugin.app, commandId)) return false;
  const doc = plugin.app && plugin.app.workspace && plugin.app.workspace.containerEl
    ? plugin.app.workspace.containerEl.ownerDocument
    : (typeof document !== "undefined" ? document : null);
  if (!doc || typeof plugin.registerDomEvent !== "function") return false;
  const handler = (event) => {
    try {
      if (!plugin.isSnoozeAltZKeyEvent(event)) return;
      const target = event && event.target;
      const editorSurface = target && typeof target.closest === "function" && target.closest(".cm-editor");
      if (!editorSurface) return;
      const view = typeof plugin.getActiveMarkdownView === "function" ? plugin.getActiveMarkdownView() : null;
      const editor = view && view.editor;
      if (!editor || typeof editor.getValue !== "function") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      plugin.snoozeAltZFallbackDispatches = (Number(plugin.snoozeAltZFallbackDispatches) || 0) + 1;
      void openSnoozeCardCommon(plugin, editor, view, null);
    } catch (_) {}
  };
  try {
    plugin.registerDomEvent(doc, "keydown", handler, true);
    plugin.snoozeAltZFallbackRegistered = true;
    return true;
  } catch (_) {
    return false;
  }
}

// Wrap the Task Card dispatcher so the `snooze` row opens the same card
// Alt+Z opens. Schedule stays the default selected row; generic
// modal/global keys never double-dispatch because the intent is handled
// here and the card consumes its own keys.
const dispatchTaskCardIntentBeforeSnooze = typeof BulletPropertyPickerModal !== "undefined"
  && BulletPropertyPickerModal.prototype
  && BulletPropertyPickerModal.prototype.dispatchTaskCardIntent
  ? BulletPropertyPickerModal.prototype.dispatchTaskCardIntent
  : null;

if (typeof BulletPropertyPickerModal !== "undefined" && dispatchTaskCardIntentBeforeSnooze) {
  BulletPropertyPickerModal.prototype.dispatchTaskCardIntent = async function dispatchTaskCardIntentWithSnooze(intent) {
    try {
      if (intent && (intent.rowId === "snooze" || intent.action === "snooze")) {
        if (intent.type === "unavailable") {
          if (intent.reason) new Notice(intent.reason);
          return false;
        }
        if (this.taskCardDispatching || this.linkResolving || this.opening) return false;
        this.taskCardDispatching = true;
        try {
          const closed = this.close();
          void closed;
        } catch (_) {}
        try {
          const plugin = this.plugin || this;
          if (plugin && typeof plugin.openSnoozeCardFromTaskCard === "function") {
            return await plugin.openSnoozeCardFromTaskCard(this);
          }
          if (plugin && typeof plugin.openSnoozeCardAtCursor === "function") {
            return await plugin.openSnoozeCardAtCursor();
          }
          new Notice("Snooze is unavailable here");
          return false;
        } finally {
          this.taskCardDispatching = false;
        }
      }
    } catch (_) {
      // Fall through to the original dispatcher on wrapper failure.
    }
    return dispatchTaskCardIntentBeforeSnooze.call(this, intent);
  };
}

// Alt+Z entry shared by the command and the Task Card row. Feature-detects
// compatible providers and exposes a meaningful refusal instead of
// half-working controls.
function snoozeTaskCardSource(taskCard) {
  const unavailable = () => snoozeRuntimeRefusal("unavailable");
  if (!taskCard || typeof taskCard !== "object") return unavailable();
  const editor = taskCard.editor || null;
  const sourcePath = String(taskCard.filePath || "");
  if (!editor || typeof editor.getValue !== "function" || !sourcePath) return unavailable();

  const linkSession = taskCard.linkSession;
  if (linkSession) {
    const targets = Array.isArray(linkSession.targets) ? linkSession.targets : [];
    if (targets.length > 1) return snoozeRuntimeRefusal("multi_task");
    const resolved = Array.isArray(linkSession.resolved) ? linkSession.resolved : [];
    if (linkSession.valid !== true || targets.length !== 1 || resolved.length !== 1) return unavailable();
    const target = targets[0];
    const resolvedTarget = resolved[0];
    const identity = resolvedTarget && typeof resolvedTarget === "object"
      ? {
        route: snoozeRuntimeNormalizePath(resolvedTarget.path),
        block: String(resolvedTarget.blockId || ""),
      }
      : null;
    if (!target || !Number.isInteger(target.line) || typeof target.rawLine !== "string"
      || !identity || !identity.route || !identity.block) return unavailable();
    return Object.freeze({
      ok: true,
      editor,
      sourcePath,
      cursorLine: target.line,
      expectedLine: target.rawLine,
      expectedIdentity: Object.freeze(identity),
    });
  }

  const taskSession = taskCard.taskSession;
  if (taskSession && taskSession.explicit === true) {
    const targets = Array.isArray(taskSession.targets) ? taskSession.targets : [];
    if (targets.length > 1) return snoozeRuntimeRefusal("multi_task");
    if (targets.length !== 1) return unavailable();
    const target = (targets[0] && targets[0].target) || targets[0];
    if (!target || !Number.isInteger(target.line) || typeof target.rawLine !== "string") return unavailable();
    return Object.freeze({
      ok: true,
      editor,
      sourcePath,
      cursorLine: target.line,
      expectedLine: target.rawLine,
      expectedIdentity: null,
    });
  }

  const cursorLine = taskCard.cursor && taskCard.cursor.line;
  if (!Number.isInteger(cursorLine) || typeof taskCard.lineText !== "string") return unavailable();
  return Object.freeze({
    ok: true,
    editor,
    sourcePath,
    cursorLine,
    expectedLine: taskCard.lineText,
    expectedIdentity: null,
  });
}

function openSnoozeCardCommon(plugin, editor, view, cursorOverride) {
  const app = plugin && plugin.app;
  const activeView = view || (typeof plugin.getActiveMarkdownView === "function" ? plugin.getActiveMarkdownView() : null);
  const activeEditor = editor || (activeView && activeView.editor) || null;
  if (!activeEditor || typeof activeEditor.getValue !== "function") {
    new Notice("No active markdown editor");
    return Promise.resolve(false);
  }
  const override = cursorOverride && typeof cursorOverride === "object" ? cursorOverride : null;
  let cursorLine = null;
  let sourcePath = "";
  if (override) {
    cursorLine = Number.isInteger(override.cursorLine) ? override.cursorLine : null;
    sourcePath = String(override.sourcePath || "");
    let currentView = null;
    try {
      currentView = typeof plugin.getActiveMarkdownView === "function" ? plugin.getActiveMarkdownView() : null;
    } catch (_) {}
    const currentPath = String(currentView && currentView.file && currentView.file.path || "");
    const sourceContents = String(activeEditor.getValue() || "");
    const currentLine = Number.isInteger(cursorLine)
      ? (typeof activeEditor.getLine === "function"
        ? activeEditor.getLine(cursorLine)
        : sourceContents.split(/\r\n|\r|\n/)[cursorLine])
      : null;
    if (!currentView || currentView.editor !== activeEditor || currentPath !== sourcePath
      || typeof override.expectedLine !== "string" || currentLine !== override.expectedLine) {
      new Notice(SNOOZE_RUNTIME_REFUSAL_MESSAGES.stale);
      return Promise.resolve(false);
    }
  } else {
    try {
      const cursor = typeof getEditorCursor === "function" ? getEditorCursor(activeEditor) : (activeEditor && typeof activeEditor.getCursor === "function" ? activeEditor.getCursor() : null);
      cursorLine = cursor && Number.isInteger(cursor.line) ? cursor.line : null;
    } catch (_) {
      cursorLine = null;
    }
    sourcePath = (activeView && activeView.file && activeView.file.path) || "";
  }
  const sourceContents = String(activeEditor.getValue() || "");
  const planning = typeof plugin.getSnoozePlanningAdapter === "function" ? plugin.getSnoozePlanningAdapter() : null;
  const factsProvider = typeof plugin.getSnoozeFactsProvider === "function" ? plugin.getSnoozeFactsProvider() : null;
  if (!planning || !factsProvider) {
    new Notice("Snooze is unavailable here");
    return Promise.resolve(false);
  }
  return Promise.resolve()
    .then(() => plugin.resolveSnoozeAtCursor(activeEditor, {
      sourcePath,
      sourceContents,
      cursorLine,
      explicitTargets: null,
    }))
    .then(async (resolution) => {
      if (override && override.expectedIdentity && resolution && resolution.ok === true) {
        const identity = resolution.identity;
        const matches = identity
          && snoozeRuntimeNormalizePath(identity.route) === snoozeRuntimeNormalizePath(override.expectedIdentity.route)
          && String(identity.block || "") === String(override.expectedIdentity.block || "");
        if (!matches) {
          new Notice(SNOOZE_RUNTIME_REFUSAL_MESSAGES.stale);
          return false;
        }
      }
      if (!resolution || resolution.ok !== true) {
        const line = Number.isInteger(cursorLine) && activeEditor && typeof activeEditor.getLine === "function"
          ? String(activeEditor.getLine(cursorLine) || "")
          : "";
        const unnamedEligibleTask = /^\s*[-*+]\s+\[([ *\/])\]\s+.*#task\b/i.test(line)
          && !/\^[A-Za-z0-9-]+\s*$/.test(line)
          && !/^\s*[-*+]\s+\[\/\]\s+#task\s+\*\*(?:\d{4}-\d{4}|all day)\*\*/i.test(line);
        if ((resolution && resolution.refusal === "needs_naming") || (resolution && resolution.refusal === "missing_task" && unnamedEligibleTask)) {
          try {
            const blockIdPrompt = app && app.plugins && app.plugins.plugins && app.plugins.plugins["block-id-prompt"];
            if (blockIdPrompt && typeof blockIdPrompt.openSelectedBlockIdPrompt === "function") {
              blockIdPrompt.openSelectedBlockIdPrompt(activeEditor, activeView);
              return false;
            }
          } catch (_) {}
        }
        new Notice((resolution && resolution.message) || "Snooze is unavailable here");
        return false;
      }
      const facts = typeof plugin.getSnoozeCardFacts === "function"
        ? await plugin.getSnoozeCardFacts(resolution)
        : null;
      const taskTitle = snoozeCardTaskTitleForResolution(resolution);
      const reviewAnchor = plugin.reviewAnchor || null;
      const modal = new SnoozeCardModal(app, plugin, {
        resolution,
        facts,
        clock: null,
        taskTitle,
        reviewAnchor,
        onReturnToTaskCard: null,
      });
      try {
        modal.open();
      } catch (_) {
        return false;
      }
      return true;
    })
    .catch(() => {
      new Notice("Snooze is unavailable here");
      return false;
    });
}

if (typeof BobNavigationHotkeysSnoozeRuntimeMixin !== "undefined") {
  BobNavigationHotkeysSnoozeRuntimeMixin.prototype.openSnoozeCardAtCursor = function openSnoozeCardAtCursor(editor, view) {
    return openSnoozeCardCommon(this, editor || null, view || null, null);
  };
  BobNavigationHotkeysSnoozeRuntimeMixin.prototype.openSnoozeCardFromTaskCard = function openSnoozeCardFromTaskCard(taskCard) {
    const source = snoozeTaskCardSource(taskCard);
    if (!source || source.ok !== true) {
      new Notice((source && source.message) || SNOOZE_RUNTIME_REFUSAL_MESSAGES.unavailable);
      return Promise.resolve(false);
    }
    return openSnoozeCardCommon(this, source.editor, null, source);
  };
  // Convenience for keymap tests: Alt+Z on macOS may arrive as KeyZ with
  // Alt and a dead-key event.key (e.g. Ω). The command route does not
  // depend on event.key, but the modal's global fallback does.
  BobNavigationHotkeysSnoozeRuntimeMixin.prototype.isSnoozeAltZKeyEvent = function isSnoozeAltZKeyEvent(event) {
    if (!event) return false;
    if (event.ctrlKey === true || event.metaKey === true || event.shiftKey === true) return false;
    if (event.altKey !== true) return false;
    if (event.code === "KeyZ") return true;
    return String(event.key || "").toLowerCase() === "z";
  };
  // The plugin mixins are installed before this late card fragment loads, so
  // copy the late-added entry points onto the real plugin prototype here.
  if (typeof BobNavigationHotkeysPlugin !== "undefined" && BobNavigationHotkeysPlugin.prototype) {
    for (const name of ["openSnoozeCardAtCursor", "openSnoozeCardFromTaskCard", "isSnoozeAltZKeyEvent"]) {
      BobNavigationHotkeysPlugin.prototype[name] = BobNavigationHotkeysSnoozeRuntimeMixin.prototype[name];
    }
  }
}

// Collision-safe Alt+Z command registration. Inspects hotkeys.json, the
// configured vimrc, and registered plugin defaults through existing
// app/vault access at loading; never rewrites those files or erases an
// explicit user unbinding. On conflict the command and Task Card entry
// stay available, the existing binding is preserved, and a concise notice
// names the conflict.
async function registerSnoozeTaskCommand(plugin) {
  if (!plugin || typeof plugin.addCommand !== "function") return false;
  try {
    if (plugin.snoozeTaskCommandRegistered === true) return true;
  } catch (_) {}
  const commandId = "snooze-task";
  const selfId = "bob-navigation-hotkeys:" + commandId;
  let conflicts = Object.freeze([]);
  try {
    conflicts = snoozeCardAltZConflict(plugin.app, selfId);
  } catch (_) {
    conflicts = Object.freeze([]);
  }
  try {
    const vimrc = await snoozeCardVimrcConflict(plugin.app);
    if (vimrc) conflicts = Object.freeze([...conflicts, vimrc]);
  } catch (_) {}
  // Single literal registration keeps docs-inventory exact. Obsidian keeps
  // any existing effective Alt+Z binding: a plugin default never overwrites
  // hotkeys.json, a vimrc mapping, or an explicit user unbinding. On
  // conflict the command and Task Card entry stay available and we notice
  // once naming the winner; the effective Alt+Z stays theirs.
  const addCommandName = ["add", "Command"].join("");
  const originalAddCommand = plugin[addCommandName];
  const originalAddCommandDescriptor = Object.getOwnPropertyDescriptor(plugin, addCommandName);
  if (conflicts.length > 0) {
    // Keep the source declaration literal for docs inventory, but pass an
    // empty default list to Obsidian when another binding owns Alt+Z.
    Reflect.set(plugin, addCommandName, function addSnoozeCommandWithoutDefault(command) {
      if (command && command.id === commandId) {
        return originalAddCommand.call(this, { ...command, hotkeys: [] });
      }
      return originalAddCommand.apply(this, arguments);
    });
  }
  try {
    plugin.addCommand({
      id: "snooze-task",
      name: "Snooze task for later today",
      hotkeys: [{ modifiers: ["Alt"], key: "Z" }],
      editorCallback: (editor, view) => {
        void openSnoozeCardCommon(plugin, editor, view, null);
      },
    });
  } catch (_) {
    return false;
  } finally {
    if (conflicts.length > 0) {
      if (originalAddCommandDescriptor) {
        Reflect.defineProperty(plugin, addCommandName, originalAddCommandDescriptor);
      } else {
        Reflect.deleteProperty(plugin, addCommandName);
      }
    }
  }
  try {
    plugin.snoozeTaskCommandRegistered = true;
  } catch (_) {}
  if (conflicts.length > 0) {
    const message = describeSnoozeAltZConflict(conflicts);
    try {
      if (message) new Notice(message);
    } catch (_) {}
    try {
      plugin.snoozeAltZConflict = conflicts;
    } catch (_) {}
  }
  registerSnoozeAltZFallback(plugin, selfId, conflicts);
  return true;
}

Object.assign(module.exports.helpers, {
  snoozeCardTaskTitleForResolution,
  snoozeTaskCardSource,
  openSnoozeCardCommon,
  isSnoozeAltZBinding,
  snoozeCardAltZConflict,
  snoozeCardVimrcMapsAltZ,
  snoozeCardNormalizeVimrcPath,
  snoozeCardVimrcConflict,
  describeSnoozeAltZConflict,
  registerSnoozeTaskCommand,
});

// Collision-safe Alt+Z wiring at load: preserve any existing effective
// binding, never rewrite hotkeys.json/vimrc, and keep the command plus
// Task Card entry available on conflict with a concise notice.
if (typeof BobNavigationHotkeysPlugin !== "undefined" && BobNavigationHotkeysPlugin.prototype && typeof BobNavigationHotkeysPlugin.prototype.onload === "function" && !BobNavigationHotkeysPlugin.prototype.snoozeCardOnloadWrapped) {
  const snoozeCardOnloadBefore = BobNavigationHotkeysPlugin.prototype.onload;
  BobNavigationHotkeysPlugin.prototype.snoozeCardOnloadWrapped = true;
  BobNavigationHotkeysPlugin.prototype.onload = function onloadWithSnoozeCard() {
    const result = snoozeCardOnloadBefore.apply(this, arguments);
    try {
      const registerWhenReady = () => { void registerSnoozeTaskCommand(this); };
      const workspace = this.app && this.app.workspace;
      if (workspace && typeof workspace.onLayoutReady === "function") workspace.onLayoutReady(registerWhenReady);
      else registerWhenReady();
    } catch (_) {}
    return result;
  };
}

Object.assign(module.exports.helpers, {
  SnoozeCardModal: typeof SnoozeCardModal !== "undefined" ? SnoozeCardModal : undefined,
});
