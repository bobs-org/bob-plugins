// --- Pomodoro split by type: Ctrl+S dispatch, picker, and commit --------
// R4 Ctrl+S splits the selected open merged Pomodoro by type. Two types
// split the right one immediately; three or more open a multi-select
// picker (Tab marks, Enter applies marked else highlighted, Esc cancels).
// Refusals are notices with no edit; the cursor stays on its own line and
// follows a moved bullet. Pure helpers are exported for the harness.

function isPomodoroSplitKeydown(event) {
  if (!event || event.repeat === true) {
    return false;
  }
  if (event.isComposing === true || event.keyCode === 229) {
    return false;
  }
  if (
    event.ctrlKey !== true ||
    event.shiftKey === true ||
    event.altKey === true ||
    event.metaKey === true
  ) {
    return false;
  }
  return event.code === "KeyS" || event.key === "s" || event.key === "S";
}

// Resolve the Pomodoro entry Ctrl+S acts on: the cursor on an entry line
// (`findPomodoroEntryContext`) or anywhere in its child block
// (`findPomodoroBulletContext`, mapped to its owning entry). Returns
// `{ entry, entryLine, fromBullet }` or null when the cursor is outside
// every Pomodoro block of the first `## Pomodoros` section.
function resolvePomodoroSplitEntry(content, line) {
  const text = String(content || "");
  const entryContext = findPomodoroEntryContext(text, line);
  if (entryContext && entryContext.entry) {
    return Object.freeze({
      entry: entryContext.entry,
      entries: entryContext.entries,
      entryLine: entryContext.entry.entryLine,
      fromBullet: false,
    });
  }
  const bulletContext = findPomodoroBulletContext(text, line);
  if (bulletContext && bulletContext.entry) {
    return Object.freeze({
      entry: bulletContext.entry,
      entries: bulletContext.entries,
      entryLine: bulletContext.entry.entryLine,
      fromBullet: true,
    });
  }
  return null;
}

function pomodoroSplitTargetName(entry) {
  if (!entry || typeof entry.name !== "string") {
    return "Pomodoro";
  }
  const trimmed = entry.name.trim();
  return trimmed || "Pomodoro";
}

// Teaching refusal for a planSplit error outcome, mirroring
// bob-cli `capture/pomodoro_split.rs::split_guard_error`.
function pomodoroSplitRefusalForPlanError(plan, targetName) {
  const name = String(targetName || "Pomodoro");
  if (!plan || plan.kind !== "error") {
    return null;
  }
  if (plan.code === "split_closed") {
    return "Closed Pomodoros are history";
  }
  if (plan.code === "split_meet") {
    return "MEET entries never split; calendar sync owns the MEET name";
  }
  if (plan.code === "split_not_merged") {
    return `${name} has one type — nothing to split`;
  }
  if (plan.code === "split_type_not_needed") {
    return `${name} splits implicitly`;
  }
  if (plan.code === "split_base_type") {
    return `${plan.name || name} is the base of ${name} and stays`;
  }
  if (plan.code === "split_type_unknown") {
    return `${plan.selector || "That type"} is not part of ${name}`;
  }
  if (plan.code === "split_type_repeated") {
    return `${plan.name || "That type"} is named twice; list each type once`;
  }
  return "Pomodoro split could not be planned";
}

// Container refusal when the entry holds no type component at all.
function pomodoroSplitContainerRefusal(name, components) {
  const list = Array.isArray(components) ? components : [];
  if (list.some((item) => item && item.isType === true)) {
    return null;
  }
  return `${String(name || "Pomodoro")} holds any type — nothing to split`;
}

function pomodoroSplitTaskCountLabel(count) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  return `${total} task${total === 1 ? "" : "s"}`;
}

// Success notice: `Split FIX out of BUILD + FIX · 2 tasks → FIX below`.
function buildPomodoroSplitNotice(plan, sourceName) {
  const source = String(sourceName || "Pomodoro");
  const names = Array.isArray(plan && plan.splitNames)
    ? plan.splitNames.filter(Boolean)
    : [];
  const label = names.length > 0 ? names.join(" + ") : "Pomodoro";
  const count = Math.max(0, Math.floor(Number(plan && plan.movedCount) || 0));
  return `Split ${label} out of ${source} · ${pomodoroSplitTaskCountLabel(count)} → ${label} below`;
}

// Picker rows for three or more types. The `All` row preselects every
// merged-in type (the same as `=/`); base is never offered.
function buildPomodoroSplitPickerRows(sourceName, mergedIn, linkCounts) {
  const counts = linkCounts && typeof linkCounts === "object" ? linkCounts : {};
  const rows = [
    Object.freeze({
      key: "__all__",
      kind: "all",
      label: `All · ${mergedIn.map((item) => item.name).join(", ")}`,
      detail: "",
      selectable: true,
    }),
  ];
  for (const item of mergedIn) {
    const count = Math.max(0, Math.floor(Number(counts[item.key]) || 0));
    rows.push(
      Object.freeze({
        key: item.key,
        kind: "type",
        label: item.name,
        detail:
          count === 0
            ? "no tasks"
            : `${count} task${count === 1 ? "" : "s"}`,
        count,
        selectable: true,
      }),
    );
  }
  return Object.freeze(rows);
}

// Footer preview of the resulting lineup: `BUILD + READ · FIX ↓`.
function pomodoroSplitPickerPreview(sourceName, mergedIn, keys) {
  const wanted = new Set(Array.isArray(keys) ? keys : []);
  const kept = [];
  const split = [];
  for (const item of mergedIn.base || []) {
    kept.push(item.name);
  }
  for (const item of mergedIn.merged || []) {
    if (wanted.has(item.key)) {
      split.push(item.name);
    } else {
      kept.push(item.name);
    }
  }
  void sourceName;
  return `${kept.join(" + ")} · ${split.join(" + ")} ↓`;
}

const POMODORO_SPLIT_PICKER_HINTS = Object.freeze([
  { keys: ["↵"], label: "split" },
  { keys: ["⇥"], label: "mark" },
  { keys: ["esc"], label: "cancel" },
]);

class PomodoroSplitPickerModal extends FilteredPickerModal {
  constructor(app, options = {}) {
    super(app, {
      items: Array.isArray(options.rows) ? options.rows : [],
      title: options.title || "Split Pomodoro",
      headerIcon: "split",
      inputLabel: "Filter types to split",
      placeholder: "Filter types",
      resultsLabel: "Types to split out",
      emptyText: "No matching types",
      footerHints: POMODORO_SPLIT_PICKER_HINTS.slice(),
      getSubtitle: () => options.header || "",
    });
    this.splitBase = options.base || "";
    this.splitMerged = Array.isArray(options.merged) ? options.merged : [];
    this.splitCounts = options.counts && typeof options.counts === "object" ? options.counts : {};
    this.markedKeys = new Set(
      Array.isArray(options.preselected)
        ? options.preselected.filter(Boolean)
        : [],
    );
    this.splitResult = null;
    this.splitSettled = false;
    this.onSplitSettle =
      typeof options.onSettle === "function" ? options.onSettle : () => {};
  }

  prospectiveSplitKeys() {
    const marked = [...this.markedKeys].filter((key) => key !== "__all__");
    if (marked.length > 0) {
      return marked;
    }
    const active = this.visibleItems && this.visibleItems[this.selectedIndex];
    if (!active) {
      return [];
    }
    if (active.key === "__all__") {
      return this.splitMerged.map((item) => item.key);
    }
    return active.selectable ? [active.key] : [];
  }

  prospectiveSplitPreview() {
    return pomodoroSplitPickerPreview(
      "",
      { base: [{ name: this.splitBase }], merged: this.splitMerged },
      this.prospectiveSplitKeys(),
    );
  }

  renderFooter() {
    super.renderFooter();
    if (!this.footerEl) {
      return;
    }
    this.footerEl.createDiv({
      cls: "bob-cnp-consequence-strip-text",
      text: this.prospectiveSplitPreview(),
    });
  }

  renderResults() {
    super.renderResults();
    this.renderFooter();
  }

  renderItem(row, rowEl, query) {
    const classes = ["bob-cnp-row", "bob-cnp-pomodoro-row"];
    if (row && row.key && this.markedKeys.has(row.key)) {
      classes.push("is-marked");
    }
    if (rowEl && rowEl.classList && typeof rowEl.classList.add === "function") {
      rowEl.classList.add(...classes);
    } else if (rowEl && typeof rowEl.addClass === "function") {
      classes.forEach((cls) => rowEl.addClass(cls));
    }
    const iconEl = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
    applyIcon(iconEl, row && row.kind === "all" ? "layers" : "split");
    const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
    const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
    if (row && row.kind === "type" && this.app) {
      try {
        const api = getNavigationPomodoroThemesApi(this.app);
        renderNavigationPomodoroThemeSwatches(titleEl, api, row.label);
      } catch (_error) {
        // Swatches stay optional in the harness.
      }
    }
    appendHighlighted(titleEl, row && row.kind === "all" ? row.label : `${row.label} · ${row.detail}`, query);
    const markEl = rowEl.createDiv({ cls: "bob-cnp-row-badges" });
    markEl.createDiv({
      cls: "bob-cnp-row-status",
      text: row && row.key && this.markedKeys.has(row.key) ? "☑" : "□",
      attr: { "aria-hidden": "true" },
    });
  }

  filterItem(row, query) {
    if (!query) {
      return true;
    }
    return String((row && row.label) || "").toLowerCase().includes(query);
  }

  toggleMark(key) {
    if (!key) {
      return;
    }
    if (this.markedKeys.has(key)) {
      this.markedKeys.delete(key);
    } else {
      this.markedKeys.add(key);
    }
    this.renderAll();
  }

  settle(result) {
    if (this.splitSettled) {
      return;
    }
    this.splitSettled = true;
    this.splitResult = result;
  }

  onClose() {
    try {
      super.onClose();
    } finally {
      this.onSplitSettle(this.splitResult);
    }
  }

  handleKeydown(event) {
    if (!event || typeof event !== "object") {
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const active = this.visibleItems && this.visibleItems[this.selectedIndex];
      if (active && active.selectable) {
        this.toggleMark(active.key);
      }
      this.moveSelection(1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const keys = this.prospectiveSplitKeys();
      if (keys.length === 0) {
        return;
      }
      this.settle(keys);
      this.close();
      return;
    }
    super.handleKeydown(event);
  }
}

// Collect the entry's top-level Task Link bullets in child order with
// their effective type keys. Unresolvable links keep a null key and stay
// with the base. Mirrors `resolvePomodoroBulletMoveTypePreview` over the
// whole entry instead of the selected bullets.
async function resolvePomodoroSplitTypes(plugin, sourceContent, sourcePath, entry) {
  const api = getNavigationPomodoroThemesApi(plugin && plugin.app);
  const outcome = {
    api,
    linkBullets: [],
    linkKeys: [],
    linkTargets: [],
    unresolved: 0,
    error: null,
  };
  if (
    !api ||
    typeof api.effectiveTypeFor !== "function" ||
    typeof api.taskThemeOf !== "function" ||
    typeof api.planSplit !== "function" ||
    typeof api.typeComponentsOf !== "function"
  ) {
    outcome.error = "Task type routing is unavailable";
    return outcome;
  }
  const text = String(sourceContent || "");
  const discovery = discoverPomodoroEntryMoveTargets(text, entry.entryLine);
  if (!discovery.valid) {
    outcome.error = discovery.error || "Pomodoro entry could not be found";
    return outcome;
  }
  const bullets = [];
  for (const target of discovery.targets || []) {
    if (parseLinkPickerTaskLink(String(target.rawLine || ""))) {
      bullets.push(target);
    }
  }
  if (bullets.length === 0) {
    return outcome;
  }
  const noteContents = new Map();
  const keys = [];
  for (const target of bullets) {
    const link = parseLinkPickerTaskLink(String(target.rawLine || ""));
    const linkTarget = `${link.target}#^${link.blockId}`;
    let file = null;
    try {
      file = plugin.resolveLinkTargetFile(linkTarget, sourcePath);
    } catch (_error) {
      file = null;
    }
    let key = null;
    if (file && plugin.isMarkdownFile(file)) {
      const notePath = normalizeVaultRelativePath(file.path);
      if (notePath) {
        let content = null;
        if (noteContents.has(notePath)) {
          content = noteContents.get(notePath);
        } else if (notePath === normalizeVaultRelativePath(sourcePath)) {
          content = text;
          noteContents.set(notePath, content);
        } else {
          try {
            content = await plugin.readLinkPickerNoteContent(notePath, file);
          } catch (_error) {
            content = null;
          }
          if (typeof content === "string") {
            noteContents.set(notePath, content);
          }
        }
        if (typeof content === "string") {
          const resolved = findUniqueLinkPickerTargetLine(
            content,
            link.blockId,
            { allowClosed: true },
          );
          if (resolved.valid && isOpenObsidianTaskLine(resolved.rawLine)) {
            try {
              const field = api.taskThemeOf(resolved.rawLine);
              const effective = api.effectiveTypeFor({
                path: notePath,
                line: resolved.line + 1,
                text: content,
              });
              const theme =
                effective && effective.theme && typeof effective.theme === "object"
                  ? effective.theme
                  : null;
              if (theme && typeof theme.key === "string" && theme.key) {
                key = theme.key;
              } else if (
                field &&
                typeof field.value === "string" &&
                field.value.trim()
              ) {
                key = field.value.trim();
              }
            } catch (_error) {
              key = null;
            }
          }
        }
      }
    }
    if (key === null) {
      outcome.unresolved += 1;
    }
    keys.push(key);
  }
  outcome.linkBullets = bullets;
  outcome.linkKeys = keys;
  outcome.linkTargets = bullets.map((target) =>
    Object.freeze({ line: target.line, rawLine: target.rawLine }),
  );
  return outcome;
}

function pomodoroSplitLinkCounts(mergedIn, linkKeys) {
  const counts = {};
  for (const item of mergedIn) {
    counts[item.key] = 0;
  }
  for (const key of linkKeys) {
    if (key === null || key === undefined || key === "") {
      continue;
    }
    const normalized =
      typeof pomodoroThemeNormalizeKey === "function"
        ? pomodoroThemeNormalizeKey(key)
        : String(key).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, normalized)) {
      counts[normalized] += 1;
    }
  }
  return counts;
}

async function commitPomodoroSplitKeys(plugin, editor, view, resolved, keys) {
  const sourceView = view || plugin.getActiveMarkdownView();
  const sourceFile = sourceView && sourceView.file;
  if (
    !editor ||
    typeof editor.getValue !== "function" ||
    !sourceFile ||
    sourceView.file.path !== resolved.sourcePath ||
    sourceView.editor !== editor ||
    String(editor.getValue() || "") !== resolved.sourceContent
  ) {
    new Notice("Source note is no longer active; nothing was split");
    return false;
  }
  const api = resolved.preview.api;
  const split =
    keys === null
      ? api.planSplit({
          name: resolved.entry.name,
          open: resolved.entry.open,
          linkKeys: resolved.preview.linkKeys,
          splitSelectors: null,
          sources: undefined,
        })
      : api.planSplit({
          name: resolved.entry.name,
          open: resolved.entry.open,
          linkKeys: resolved.preview.linkKeys,
          splitSelectors: keys,
          sources: undefined,
        });
  if (!split || split.kind !== "ok") {
    new Notice(
      `${pomodoroSplitRefusalForPlanError(split, pomodoroSplitTargetName(resolved.entry))}; nothing was split`,
    );
    return false;
  }
  const plan = planPomodoroTypeSplit(resolved.sourceContent, {
    sourceEntryLine: resolved.entry.entryLine,
    sourceRawLine: String(
      splitMarkdownContent(resolved.sourceContent).lines[resolved.entry.entryLine] || "",
    ),
    split: { remaining: split.remaining, created: split.created },
    linkTargets: resolved.preview.linkTargets,
  });
  if (!plan.valid) {
    new Notice(`${plan.error}; nothing was split`);
    return false;
  }
  const cursor = getEditorCursor(editor) || { line: plan.firstMovedLine, ch: 0 };
  const finalCursor = mapPomodoroSplitCursor(
    resolved.sourceContent,
    plan.after,
    plan,
    cursor,
  );
  let applied = false;
  try {
    applied = applyEditorContentTransaction(
      editor,
      resolved.sourceContent,
      plan.after,
      finalCursor,
    );
  } catch (_error) {
    applied = String(editor.getValue() || "") === plan.after;
  }
  if (!applied || String(editor.getValue() || "") !== plan.after) {
    new Notice("Pomodoro split failed; nothing was split");
    return false;
  }
  new Notice(buildPomodoroSplitNotice(plan, resolved.entry.name));
  return true;
}

class BobNavigationHotkeysPomodoroSplitMixin {
  async splitPomodoroAtCursor(editor, view, options = {}) {
    const sourceView = view || this.getActiveMarkdownView();
    const sourceFile = sourceView && sourceView.file;
    if (
      !editor ||
      typeof editor.getValue !== "function" ||
      !this.isMarkdownFile(sourceFile)
    ) {
      return false;
    }
    const cursor = getEditorCursor(editor);
    if (!cursor) {
      return false;
    }
    const sourceContent = String(editor.getValue() || "");
    const sourcePath = sourceFile.path;
    const split = resolvePomodoroSplitEntry(sourceContent, cursor.line);
    if (!split) {
      return false;
    }
    const entry = split.entry;
    const targetName = pomodoroSplitTargetName(entry);
    if (!entry.open) {
      new Notice("Closed Pomodoros are history; nothing was split");
      return true;
    }
    const api = getNavigationPomodoroThemesApi(this.app);
    if (!api || typeof api.planSplit !== "function") {
      new Notice("Task type routing is unavailable; nothing was split");
      return true;
    }
    if (typeof api.isMeetName === "function" && api.isMeetName(entry.name)) {
      new Notice("MEET entries never split; calendar sync owns the MEET name");
      return true;
    }
    let components = [];
    try {
      components =
        typeof api.typeComponentsOf === "function"
          ? api.typeComponentsOf(entry.name)
          : [];
    } catch (_error) {
      components = [];
    }
    const containerRefusal = pomodoroSplitContainerRefusal(entry.name, components);
    if (containerRefusal) {
      new Notice(`${containerRefusal}; nothing was split`);
      return true;
    }
    const types = (Array.isArray(components) ? components : []).filter(
      (item) => item && item.isType === true,
    );
    if (types.length < 2) {
      new Notice(`${targetName} has one type — nothing to split; nothing was split`);
      return true;
    }
    const preview = await resolvePomodoroSplitTypes(
      this,
      sourceContent,
      sourcePath,
      entry,
    );
    if (preview.error) {
      new Notice(`${preview.error}; nothing was split`);
      return true;
    }
    const resolved = { entry, sourceContent, sourcePath, preview };
    if (types.length === 2) {
      await commitPomodoroSplitKeys(this, editor, sourceView, resolved, null);
      return true;
    }
    const counts = pomodoroSplitLinkCounts(types.slice(1), preview.linkKeys);
    const rows = buildPomodoroSplitPickerRows(
      entry.name,
      types.slice(1).map((item) => ({ key: item.key, name: item.name })),
      counts,
    );
    const merged = types.slice(1).map((item) => ({ key: item.key, name: item.name }));
    const picked = await new Promise((settle) => {
      const modal = new PomodoroSplitPickerModal(this.app, {
        title: `Split ${entry.name}`,
        header: `${types[0].name} stays`,
        base: types[0].name,
        merged,
        counts,
        rows,
        preselected: ["__all__"],
        onSettle: settle,
      });
      try {
        modal.open();
      } catch (_error) {
        settle(null);
      }
    });
    if (!picked) {
      return true;
    }
    const selected = picked.includes("__all__") || picked.length === merged.length
      ? null
      : picked.map((key) => {
          const found = merged.find((item) => item.key === key);
          return found ? found.name : key;
        });
    if (selected !== null && selected.length === 0) {
      return true;
    }
    await commitPomodoroSplitKeys(this, editor, sourceView, resolved, selected);
    return true;
  }

  pomodoroSplitPaletteCheck(editor, view) {
    try {
      const sourceView = view || this.getActiveMarkdownView();
      const sourceFile = sourceView && sourceView.file;
      if (
        !editor ||
        typeof editor.getValue !== "function" ||
        !sourceFile ||
        typeof this.isMarkdownFile === "function" && !this.isMarkdownFile(sourceFile)
      ) {
        return false;
      }
      const cursor = getEditorCursor(editor);
      if (!cursor) {
        return false;
      }
      return resolvePomodoroSplitEntry(String(editor.getValue() || ""), cursor.line) !== null;
    } catch (_error) {
      return false;
    }
  }

  registerPomodoroSplitCommand() {
    this.addCommand({
      id: "split-pomodoro-by-type",
      name: "Split Pomodoro by type",
      editorCheckCallback: (checking, editor, view) => {
        if (checking) {
          return this.pomodoroSplitPaletteCheck(editor, view);
        }
        void this.splitPomodoroAtCursor(editor, view);
      },
    });
  }

  registerPomodoroSplitInputListeners() {
    this.handledPomodoroSplitEvents = new WeakSet();
    this.pendingPomodoroSplitSave = null;
    const keydownHandler = (event) => this.handlePomodoroSplitPhysicalKeydown(event);
    const targets = [];
    if (typeof window !== "undefined") {
      targets.push(window);
    }
    if (typeof document !== "undefined" && document !== window) {
      targets.push(document);
    }
    for (const target of targets) {
      if (!target || typeof target.addEventListener !== "function") {
        continue;
      }
      target.addEventListener("keydown", keydownHandler, true);
      this.register(() => {
        target.removeEventListener("keydown", keydownHandler, true);
      });
    }
  }

  handlePomodoroSplitPhysicalKeydown(event) {
    if (!isPomodoroSplitKeydown(event)) {
      return false;
    }
    if (event && event.defaultPrevented === true) {
      return false;
    }
    if (
      this.handledPomodoroSplitEvents &&
      this.handledPomodoroSplitEvents.has(event)
    ) {
      return false;
    }
    const view = this.getActiveMarkdownView();
    if (!view || !view.editor || !view.file) {
      return false;
    }
    const cursor = getEditorCursor(view.editor);
    if (!cursor) {
      return false;
    }
    const content = String(view.editor.getValue() || "");
    if (!resolvePomodoroSplitEntry(content, cursor.line)) {
      return false;
    }
    if (this.handledPomodoroSplitEvents) {
      this.handledPomodoroSplitEvents.add(event);
    }
    this.pendingPomodoroSplitSave = {
      path: view.file.path,
      at: Date.now(),
      editor: view.editor,
      view,
    };
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    void this.splitPomodoroAtCursor(view.editor, view);
    return true;
  }

  wrapPomodoroSplitSaveCommand() {
    try {
      const commands =
        this.app && this.app.commands && this.app.commands.commands;
      const command = commands && commands["editor:save-file"];
      if (!command || typeof command.callback !== "function") {
        return;
      }
      if (command.callback.__bobPomodoroSplitWrapped === true) {
        return;
      }
      const plugin = this;
      const original = command.callback;
      // Fallback for hosts where Obsidian's built-in Mod+S cannot be
      // pre-empted by the capture-phase listener: the keydown handler
      // above always runs first and stamps `pendingPomodoroSplitSave`,
      // so a save arriving with a fresh stamp is the Ctrl+S we already
      // split, and the original save must not run. Every other save —
      // palette, menu, or a cursor outside a Pomodoro block — falls
      // through untouched.
      const wrapper = async (...args) => {
        const pending = plugin.pendingPomodoroSplitSave;
        plugin.pendingPomodoroSplitSave = null;
        if (pending && Date.now() - pending.at < 1500) {
          try {
            if (
              pending.view &&
              pending.view.file &&
              pending.editor &&
              typeof pending.editor.getValue === "function" &&
              pending.path === pending.view.file.path &&
              plugin.getActiveMarkdownView() === pending.view
            ) {
              return;
            }
          } catch (_error) {
            // Fall through to the original save.
          }
        }
        return original.apply(command, args);
      };
      wrapper.__bobPomodoroSplitWrapped = true;
      command.callback = wrapper;
      this.pomodoroSplitSaveCommand = { command, original, wrapper };
      this.register(() => {
        try {
          if (command.callback === wrapper) {
            command.callback = original;
          }
        } catch (_error) {
          // Startup teardown stays best-effort.
        }
      });
    } catch (_error) {
      // Save stays untouched when the command registry is unavailable.
    }
  }
}
