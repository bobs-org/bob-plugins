// Bob Command Mode: argument completion, typed bob argv, and Vim ex routing.

function cmTokenizeBobArgv(text) {
  const source = String(text || "");
  const tokens = [];
  let current = "";
  let tokenStarted = false;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      current += char;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      tokenStarted = true;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
        tokenStarted = true;
      } else if (char === "\\" && (source[index + 1] === '"' || source[index + 1] === "\\")) {
        current += source[index + 1];
        index += 1;
        tokenStarted = true;
      } else {
        current += char;
        tokenStarted = true;
      }
      continue;
    }
    if (/\s/.test(char)) {
      if (tokenStarted) tokens.push(current);
      current = "";
      tokenStarted = false;
      continue;
    }
    if (char === "\\") {
      if (index + 1 >= source.length) {
        return { tokens, partial: current, partialStarted: tokenStarted, trailingSpace: false, error: "Unfinished escape" };
      }
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      tokenStarted = true;
      continue;
    }
    current += char;
    tokenStarted = true;
  }
  if (escaped) return { tokens, partial: current, partialStarted: tokenStarted, trailingSpace: false, error: "Unfinished escape" };
  if (quote) return { tokens, partial: current, partialStarted: tokenStarted, trailingSpace: false, error: "Unbalanced quote" };
  const trailingSpace = !tokenStarted && /\s$/.test(source);
  return { tokens, partial: current, partialStarted: tokenStarted, trailingSpace, error: null };
}

function cmTokenizedWords(parsed) {
  if (!parsed) return [];
  return [...(parsed.tokens || []), ...(parsed.partialStarted ? [String(parsed.partial || "")] : [])];
}

function cmApplyCatalogAliases(catalog, words) {
  let result = Array.isArray(words) ? [...words] : [];
  const seen = new Set();
  const aliases = (catalog && Array.isArray(catalog.aliases) && catalog.aliases) || [];
  for (let pass = 0; pass < aliases.length + 1; pass += 1) {
    const signature = JSON.stringify(result);
    if (seen.has(signature)) break;
    seen.add(signature);
    let best = null;
    for (const alias of aliases) {
      if (!alias || !Array.isArray(alias.from) || !alias.from.length || !Array.isArray(alias.to)) continue;
      if (alias.from.length > result.length) continue;
      if (!alias.from.every((word, index) => word === result[index])) continue;
      if (!best || alias.from.length > best.from.length) best = alias;
    }
    if (!best) break;
    result = [...best.to, ...result.slice(best.from.length)];
  }
  return result;
}

function cmResolveTypedBobArgv(catalog, input) {
  const parsed = typeof input === "string" ? cmTokenizeBobArgv(input) : input;
  if (parsed && parsed.error) return { ok: false, error: parsed.error, parsed };
  const words = cmApplyCatalogAliases(catalog, cmTokenizedWords(parsed));
  const excluded = cmExcludedReason(catalog, words);
  if (excluded) return { ok: false, excluded, argv: words, parsed };
  const entry = cmFindEntryForArgv(catalog, words);
  if (!entry || words.length <= entry.path.length) return { ok: true, entry: null, argv: words, parsed };
  return { ok: true, entry, argv: words, userArgs: words.slice(entry.path.length), parsed };
}

const CM_VIM_DEFAULT_EX_NAMES = new Set([
  "w", "write", "q", "quit", "wq", "x", "exit", "noh", "nohlsearch", "sort",
  "set", "normal", "reg", "registers", "marks", "undo", "redo", "delmarks",
  "obcommand", "exmap",
]);

function cmIsVimShaped(text, exmapNames) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (/^[%.$',;+\-/?&~!<\d]/.test(value)) return true;
  if (/^(?:s|g|v|substitute|global|vglobal)\W/.test(value)) return true;
  const word = value.split(/\s+/, 1)[0];
  const names = new Set(CM_VIM_DEFAULT_EX_NAMES);
  for (const name of (Array.isArray(exmapNames) ? exmapNames : [])) names.add(String(name));
  return names.has(word);
}

function cmParseVimrc(text) {
  const recursiveMaps = [];
  const exmapNames = [];
  const options = new Set(["<buffer>", "<nowait>", "<silent>", "<script>", "<expr>", "<unique>", "<special>"]);
  for (const sourceLine of String(text || "").split(/\r?\n/)) {
    let line = sourceLine.trim();
    if (!line || line.startsWith('"')) continue;
    line = line.replace(/\s+"[^\"]*$/, "").trim();
    const exmap = line.match(/^exmap\s+(\S+)/);
    if (exmap) {
      exmapNames.push(exmap[1]);
      continue;
    }
    const mapping = line.match(/^(?:map|nmap)\s+(.+)$/);
    if (!mapping) continue;
    const parts = mapping[1].trim().split(/\s+/);
    while (parts.length && options.has(parts[0].toLowerCase())) parts.shift();
    if (parts.length < 2) continue;
    const key = parts.shift();
    if (parts.join(" ").includes(":")) recursiveMaps.push(key);
  }
  return {
    recursiveMaps: [...new Set(recursiveMaps)],
    exmapNames: [...new Set(exmapNames)],
  };
}

function cmVimrcLintNotice(keys) {
  const names = Array.isArray(keys) ? keys : [];
  if (!names.length) return null;
  const quoted = names.map((name) => "`" + String(name) + "`");
  if (quoted.length === 1) {
    return quoted[0] + " replays `:`; change it to nnoremap so `:` command mode cannot capture it.";
  }
  const other = quoted.length === 2 ? " other" : " others";
  return quoted[0] + " and " + (quoted.length - 1) + other + " replay `:`; change them to nnoremap so `:` command mode cannot capture them.";
}

function cmNormalizeVaultPath(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw) return null;
  const normalized = cmPath().posix.normalize(raw.replace(/^\.\//, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

async function cmRefreshVimrcLint(plugin) {
  if (plugin && plugin.commandModeVimrcLintActive === false) return { ok: false, reason: "plugin unloaded" };
  const app = plugin && plugin.app;
  const adapter = app && app.vault && app.vault.adapter;
  if (!adapter || typeof adapter.read !== "function") return { ok: false, reason: "vault adapter unavailable" };
  const configDir = String((app.vault && app.vault.configDir) || ".obsidian").replace(/\/$/, "");
  const configPath = configDir + "/plugins/obsidian-vimrc-support/data.json";
  let settings;
  try {
    settings = JSON.parse(await adapter.read(configPath));
  } catch (error) {
    plugin.commandModeVimrcFilePath = null;
    plugin.commandModeVimrcExmaps = [];
    return { ok: false, reason: "vimrc settings unavailable" };
  }
  const vimrcPath = cmNormalizeVaultPath(settings && settings.vimrcFileName);
  plugin.commandModeVimrcFilePath = vimrcPath;
  if (!vimrcPath) {
    plugin.commandModeVimrcExmaps = [];
    return { ok: false, reason: "vimrc path unavailable" };
  }
  let source;
  try {
    source = await adapter.read(vimrcPath);
  } catch (error) {
    plugin.commandModeVimrcExmaps = [];
    return { ok: false, reason: "vimrc unavailable" };
  }
  const parsed = cmParseVimrc(source);
  plugin.commandModeVimrcExmaps = parsed.exmapNames;
  plugin.commandModeVimrcRecursiveMaps = parsed.recursiveMaps;
  if (parsed.recursiveMaps.length && !plugin.commandModeVimrcLintShown) {
    plugin.commandModeVimrcLintShown = true;
    try { new Notice(cmVimrcLintNotice(parsed.recursiveMaps)); } catch (error) { /* Notice is best effort. */ }
  }
  const sheet = plugin.commandModeSheet;
  if (sheet && sheet.sheetOpen) {
    sheet.recomputeVisible();
    sheet.render();
  }
  return { ok: true, path: vimrcPath, ...parsed };
}

function cmVimTarget(context) {
  const view = context && context.originView;
  const editor = (context && context.originEditor) || (view && view.editor) || null;
  const cm = (editor && editor.cm && editor.cm.cm) ||
    (view && view.editMode && view.editMode.editor && view.editMode.editor.cm && view.editMode.editor.cm.cm) || null;
  const vim = typeof window !== "undefined" && window.CodeMirrorAdapter && window.CodeMirrorAdapter.Vim;
  if (!editor || !cm || typeof cm.getCursor !== "function" || !vim || typeof vim.handleEx !== "function") {
    return { ok: false, editor, cm: null, vim: vim || null };
  }
  return { ok: true, editor, cm, vim };
}

function cmGlobToRegExp(glob) {
  let source = "^";
  const pattern = String(glob || "*");
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(source + "$", "i");
}

function cmVaultPathCandidates(app, options = {}) {
  const vault = app && app.vault;
  if (!vault) return [];
  let files = [];
  let folders = [];
  try { files = typeof vault.getFiles === "function" ? vault.getFiles() : []; } catch (error) { files = []; }
  try {
    const all = typeof vault.getAllLoadedFiles === "function" ? vault.getAllLoadedFiles() : [];
    folders = (all || []).filter((file) => file && Array.isArray(file.children));
  } catch (error) { folders = []; }
  const partial = String(options.partial || "").toLowerCase();
  const kind = options.kind || "files";
  const root = String(options.root || "").replace(/\/$/, "");
  const glob = options.glob ? cmGlobToRegExp(options.glob) : null;
  const source = kind === "dirs" ? folders : files;
  let candidates = source.filter((file) => {
    const path = String(file && file.path || "");
    if (!path || !path.toLowerCase().startsWith(partial)) return false;
    if (root && path !== root && !path.startsWith(root + "/")) return false;
    if (glob) {
      const relative = root && path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
      if (!glob.test(relative)) return false;
    }
    return true;
  }).map((file) => ({ value: String(file.path), description: kind === "dirs" ? "Folder" : "Vault note", group: kind === "dirs" ? "Folders" : "Vault files", space: kind === "dirs" ? "nospace" : "space" }));
  const activePath = String(options.activePath || "");
  candidates.sort((left, right) => {
    if (left.value === activePath) return -1;
    if (right.value === activePath) return 1;
    return left.value.localeCompare(right.value);
  });
  return candidates;
}

function cmParseBobCompletion(stdout, app, options = {}) {
  const lines = String(stdout || "").split(/\r?\n/).filter(Boolean);
  const rawCandidates = [];
  const directives = { prefix: 0, message: null, files: null, filesIn: null, dirs: false };
  for (const line of lines) {
    if (line.startsWith("!prefix ")) {
      directives.prefix = Math.max(0, Number.parseInt(line.slice(8), 10) || 0);
    } else if (line.startsWith("!message ")) directives.message = line.slice(9);
    else if (line === "!dirs") directives.dirs = true;
    else if (line === "!files") directives.files = "*";
    else if (line.startsWith("!files ")) directives.files = line.slice(7);
    else if (line.startsWith("!files-in ")) {
      const [root, glob] = line.slice(10).split("\t");
      directives.filesIn = { root, glob };
    } else if (line.startsWith("!")) {
      // Ignore directives added by a newer completion protocol.
    } else {
      const fields = line.split("\t");
      if (!fields[0]) continue;
      rawCandidates.push({
        value: fields[0], description: fields[1] || "", group: fields[2] || "Values",
        space: fields[3] || "space",
      });
    }
  }
  const prefix = Array.from(String(options.partial || "")).slice(0, directives.prefix).join("");
  const candidates = rawCandidates.map((item) => ({ ...item, insertValue: prefix + item.value }));
  const pathOptions = { partial: options.partial, activePath: options.activePath };
  if (directives.dirs) candidates.push(...cmVaultPathCandidates(app, { ...pathOptions, kind: "dirs" }));
  if (directives.files) candidates.push(...cmVaultPathCandidates(app, { ...pathOptions, kind: "files", glob: directives.files }));
  if (directives.filesIn) candidates.push(...cmVaultPathCandidates(app, {
    ...pathOptions, kind: "files", root: directives.filesIn.root, glob: directives.filesIn.glob,
  }));
  const groups = [];
  const byGroup = new Map();
  for (const item of candidates) {
    const group = String(item.group || "Values");
    if (!byGroup.has(group)) {
      const value = { id: group, title: group, rows: [] };
      byGroup.set(group, value);
      groups.push(value);
    }
    byGroup.get(group).rows.push(item);
  }
  return { candidates, groups, message: directives.message, prefix: directives.prefix };
}

function cmRequestBobCompletions(bobPath, entry, userWords, options = {}) {
  const execFile = options.execFile || cmChildProcess().execFile;
  const argv = ["__complete", "bash", "--protocol", "1", "--", "bob"];
  argv.push(...(Array.isArray(entry && entry.path) ? entry.path : []));
  argv.push(...(Array.isArray(entry && entry.fixed) ? entry.fixed.map(String) : []));
  argv.push(...(Array.isArray(userWords) ? userWords.map(String) : []));
  const resultOptions = {
    timeout: 1000,
    maxBuffer: 1024 * 1024,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
  };
  return new Promise((resolve) => {
    try {
      execFile(bobPath || "bob", argv, resultOptions, (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, error: String((error && error.message) || error), stderr: String(stderr || "") });
          return;
        }
        resolve({ ok: true, stdout: String(stdout || "") });
      });
    } catch (error) {
      resolve({ ok: false, error: String((error && error.message) || error) });
    }
  });
}

function cmArgPositionals(entry, userArgs) {
  const args = Array.isArray(entry && entry.args) ? entry.args : [];
  const words = Array.isArray(userArgs) ? userArgs : [];
  const required = args.filter((arg) => arg && arg.required);
  const missing = required[Math.min(words.length, Math.max(required.length - 1, 0))];
  return { required, missing: words.length < required.length ? missing || required[words.length] : null };
}

const cmOriginalSheetRecomputeVisible = CommandModeSheetModal.prototype.recomputeVisible;
const cmOriginalSheetRender = CommandModeSheetModal.prototype.render;
const cmOriginalSheetRenderList = CommandModeSheetModal.prototype.renderList;
const cmOriginalSheetRenderFooter = CommandModeSheetModal.prototype.renderFooter;
const cmOriginalSheetActivateRow = CommandModeSheetModal.prototype.activateRow;
const cmOriginalSheetHandleKeydown = CommandModeSheetModal.prototype.handleSheetKeydown;
const cmOriginalSheetRefocusInput = CommandModeSheetModal.prototype.refocusInput;

CommandModeSheetModal.prototype.refocusInput = function refocusInputForEveryStage() {
  if (this.stage === "list") return cmOriginalSheetRefocusInput.call(this);
  try {
    if (this.inputEl && typeof this.inputEl.focus === "function") this.inputEl.focus();
  } catch (error) { /* Focus is best effort. */ }
};

CommandModeSheetModal.prototype.recomputeVisible = function recomputeVisibleWithTypedRows() {
  if (this.stage === "vim") {
    const names = (this.plugin && this.plugin.commandModeVimrcExmaps) || [];
    const rows = names.map((name) => ({
      key: "vim-exmap:" + name, kind: "vim-suggestion", icon: "vim", path: [":" + name],
      title: "Vim ex command", about: "Run the " + name + " mapping", keywords: [name],
      vimText: name, unavailable: cmVimTarget(this.context).ok ? null : "Open a note first",
    }));
    const query = String(this.query || "").trim();
    this.visible = query ? cmRankSheetRows(query.replace(/^:/, ""), rows, {}) : rows;
    if (!this.visible.some((row) => row.key === this.selectedKey)) this.selectedKey = null;
    return;
  }
  cmOriginalSheetRecomputeVisible.call(this);
  if (this.stage !== "list" || !String(this.query || "").trim()) return;
  const query = String(this.query || "").trim();
  const parsed = cmTokenizeBobArgv(query);
  this.queryTokenError = parsed.error;
  if (parsed.error) this.hint = parsed.error;
  else this.hint = null;
  const ranked = [...this.visible];
  const pins = [];
  if (!parsed.error) {
    const typed = cmResolveTypedBobArgv(this.catalog, parsed);
    if (typed.excluded) {
      const excludedPath = (((this.catalog && this.catalog.excluded) || []).find((rule) =>
        rule && Array.isArray(rule.path) && (typed.argv || []).length >= rule.path.length &&
        rule.path.every((word, index) => word === typed.argv[index])) || {}).path || [];
      const suggestions = ((this.catalog && this.catalog.entries) || [])
        .filter((entry) => entry && Array.isArray(entry.path) && entry.path.length >= excludedPath.length &&
          excludedPath.every((word, index) => word === entry.path[index]))
        .map((entry) => entry.path.join(" "));
      pins.push({
        key: "excluded:" + JSON.stringify(typed.argv), kind: "excluded", icon: "vim",
        path: ["bob", ...(typed.argv || [])], title: "Typed command refused", about: [typed.excluded, suggestions.length ? "Use: " + suggestions.join(", ") : ""].filter(Boolean).join(" · "),
        unavailable: typed.excluded,
      });
    } else if (typed.entry) {
      const entry = typed.entry;
      pins.push({
        key: "typed:" + JSON.stringify(typed.argv), kind: "typed", icon: cmSheetEntryKind(entry),
        path: ["bob", ...(typed.argv || [])], title: "Run typed bob command",
        about: (entry.about || "").split("\n")[0], keywords: entry.keywords || [],
        effect: cmNormalizeEffect(entry.effect), presentation: cmNormalizePresentation(entry.presentation),
        policy: cmNormalizePolicy(entry.policy), hasPreview: Array.isArray(entry.preview) && entry.preview.length > 0,
        confirm: entry.confirm || null, required: cmRequiredPositionals(entry), entryId: entry.id,
        argv: [...entry.path, ...(typed.userArgs || [])], userArgs: [...(typed.userArgs || [])],
        basePath: [...entry.path], fixed: [...(entry.fixed || [])], unavailable: cmSheetEntryUnavailable(entry, this.host),
      });
    }
  }
  if (!parsed.error && cmIsVimShaped(query, (this.plugin && this.plugin.commandModeVimrcExmaps) || [])) {
    pins.push({
      key: "vim-run:" + query, kind: "vim", icon: "vim", path: [":" + query],
      title: "Run as Vim :" + query, about: "Send this ex command to the origin editor",
      vimText: query.replace(/^:/, ""), unavailable: cmVimTarget(this.context).ok ? null : "Open a note first",
    });
  } else if (!parsed.error && !pins.length && ranked.length === 0) {
    pins.push({
      key: "vim-fallback:" + query, kind: "vim", icon: "vim", path: [":" + query],
      title: "Run as Vim :" + query, about: "No bob command matches this text",
      vimText: query.replace(/^:/, ""), unavailable: cmVimTarget(this.context).ok ? null : "Open a note first",
    });
  }
  this.visible = [...pins, ...ranked];
  if (!this.visible.some((row) => row && row.key === this.selectedKey)) this.selectedKey = this.visible.length ? this.visible[0].key : null;
};

CommandModeSheetModal.prototype.renderHeader = function renderHeaderWithStage() {
  const header = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-header" });
  header.createEl("span", { cls: "bob-cmd-sheet-brand", text: "bob" });
  const version = this.catalog && this.catalog.bob_version ? "bob " + this.catalog.bob_version : "";
  header.createEl("span", { cls: "bob-cmd-sheet-host", text: [this.host, version].filter(Boolean).join(" · ") });
  const inputWrap = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-input-wrap" });
  if (this.stage === "args") {
    const entry = this.argEntry;
    inputWrap.createEl("span", { cls: "bob-cmd-stage-pill", text: entry ? entry.path.join(" ") : "args" });
  } else if (this.stage === "vim") {
    inputWrap.createEl("span", { cls: "bob-cmd-stage-pill is-vim", text: "VIM" });
  } else {
    inputWrap.createEl("span", { cls: "bob-cmd-sheet-prompt", text: "❯" });
  }
  this.inputEl = inputWrap.createEl("input", { cls: "bob-cmd-sheet-input", attr: { type: "text" } });
  try {
    this.inputEl.value = this.query;
    this.inputEl.setAttribute("placeholder", this.stage === "args" ? "Arguments…" : this.stage === "vim" ? "Vim ex command…" : "Type a command…");
  } catch (error) { /* Headless stubs may not store attributes. */ }
  if (this.stage === "args" && this.argEntry) {
    const missing = cmArgPositionals(this.argEntry, cmTokenizedWords(cmTokenizeBobArgv(this.query))).required;
    const words = cmTokenizedWords(cmTokenizeBobArgv(this.query));
    missing.slice(words.length).forEach((arg) => {
      inputWrap.createEl("span", { cls: "bob-cmd-arg-ghost", text: "‹" + String(arg.name || arg.slot || "VALUE") + (arg.repeat ? "…" : "") + "›" });
    });
  }
  this.inputEl.addEventListener("input", () => {
    this.query = String(this.inputEl.value || "");
    this.hint = null;
    if (this.stage === "list" && this.query.startsWith("::")) {
      this.enterVimStage(this.query.slice(2));
      return;
    }
    if (this.stage === "args") {
      this.argSelectedKey = null;
      this.scheduleArgumentCompletions();
    } else if (this.stage === "list" || this.stage === "vim") {
      this.recomputeVisible();
    }
    this.render();
    this.refocusInput();
  });
};

CommandModeSheetModal.prototype.render = function renderWithArgumentStage() {
  if (this.stage !== "args") return cmOriginalSheetRender.call(this);
  if (!this.sheetOpen && !this.contentEl) return;
  this.contentEl.empty();
  if (this.contentEl.addClass) this.contentEl.addClass("bob-cmd-sheet-content");
  this.renderHeader();
  this.renderArguments();
  this.renderFooter();
};

CommandModeSheetModal.prototype.renderList = function renderListWithVimRows() {
  if (this.stage !== "vim") return cmOriginalSheetRenderList.call(this);
  const list = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-list" });
  this.listEl = list;
  this.rowEls = new Map();
  this.sectionHeadingEls = new Map();
  this.aboutEl = null;
  if (!this.visible.length) {
    list.createEl("div", { cls: "bob-cmd-sheet-empty", text: "No Vim mappings in the vimrc" });
    return;
  }
  for (const row of this.visible) this.renderRow(list, row);
};

function cmArgRenderedRows(sheet) {
  const groups = (sheet && sheet.argCompletionGroups) || [];
  return groups.flatMap((group) => group.rows || []);
}

CommandModeSheetModal.prototype.renderArguments = function renderArguments() {
  const entry = this.argEntry;
  const summary = this.contentEl.createEl("div", { cls: "bob-cmd-args-summary" });
  const fixed = entry && Array.isArray(entry.fixed) ? entry.fixed : [];
  if (fixed.length) summary.createEl("span", { cls: "bob-cmd-args-fixed", text: fixed.map(cmQuoteArg).join(" ") });
  const list = this.contentEl.createEl("div", { cls: "bob-cmd-args-completions" });
  this.argListEl = list;
  this.argRowEls = new Map();
  const groups = this.argCompletionGroups || [];
  if (!groups.length) {
    if (!this.hint && entry && !this.argCompletionPending) list.createEl("div", { cls: "bob-cmd-sheet-empty", text: "No completions" });
    return;
  }
  for (const group of groups) {
    list.createEl("div", { cls: "bob-cmd-sheet-section", text: group.title });
    for (const item of group.rows) {
      const selected = item.key === this.argSelectedKey;
      const row = list.createEl("div", { cls: "bob-cmd-completion-row" + (selected ? " is-selected" : "") });
      row.createEl("span", { cls: "bob-cmd-completion-value", text: item.insertValue || item.value });
      if (item.description) row.createEl("span", { cls: "bob-cmd-completion-description", text: item.description });
      row.addEventListener("click", () => this.acceptArgumentCompletion(item));
      this.argRowEls.set(item.key, row);
    }
  }
};

CommandModeSheetModal.prototype.renderFooter = function renderFooterWithStage() {
  if (this.stage !== "args" && this.stage !== "vim") return cmOriginalSheetRenderFooter.call(this);
  const footer = this.contentEl.createEl("div", { cls: "bob-cmd-sheet-footer" });
  if (this.hint) {
    footer.createEl("span", { cls: "bob-cmd-sheet-hint is-warning", text: this.hint });
    return;
  }
  footer.createEl("span", {
    cls: "bob-cmd-sheet-hint",
    text: this.stage === "args"
      ? "⌃N/⌃P completion · ⇥ accept · ↵ run · ⇧↵ preview · ⌃↵ run now · esc back"
      : "⌃N/⌃P mapping · ↵ run Vim ex · esc back",
  });
};

CommandModeSheetModal.prototype.enterArgumentStage = function enterArgumentStage(row) {
  const entry = cmEntryById(this.catalog, row && row.entryId);
  if (!entry || !row || !["entry", "typed"].includes(row.kind)) return false;
  this.listQuery = this.query;
  this.argRow = row;
  this.argEntry = entry;
  this.query = (Array.isArray(row.userArgs) ? row.userArgs : []).map(cmQuoteArg).join(" ");
  this.argCompletionGroups = [];
  this.argCompletions = [];
  this.argSelectedKey = null;
  this.argCompletionPending = false;
  this.stage = "args";
  this.hint = null;
  this.render();
  this.refocusInput();
  this.scheduleArgumentCompletions();
  return true;
};

CommandModeSheetModal.prototype.leaveArgumentStage = function leaveArgumentStage() {
  if (this.argCompletionTimer) clearTimeout(this.argCompletionTimer);
  this.argCompletionTimer = null;
  this.argCompletionSequence = (this.argCompletionSequence || 0) + 1;
  this.stage = "list";
  this.query = (this.argRow && this.argRow.basePath || this.argEntry && this.argEntry.path || []).join(" ");
  this.argRow = null;
  this.argEntry = null;
  this.argCompletionGroups = [];
  this.argCompletions = [];
  this.hint = null;
  this.rebuildRows();
  this.render();
  this.refocusInput();
};

CommandModeSheetModal.prototype.scheduleArgumentCompletions = function scheduleArgumentCompletions() {
  if (this.argCompletionTimer) clearTimeout(this.argCompletionTimer);
  this.argCompletionSequence = (this.argCompletionSequence || 0) + 1;
  this.argCompletionPending = true;
  this.argCompletionTimer = setTimeout(() => {
    this.argCompletionTimer = null;
    void this.loadArgumentCompletions();
  }, 60);
  if (this.argCompletionTimer && typeof this.argCompletionTimer.unref === "function") this.argCompletionTimer.unref();
};

CommandModeSheetModal.prototype.loadArgumentCompletions = async function loadArgumentCompletions() {
  if (this.stage !== "args" || !this.argEntry) return { ok: false, reason: "not in argument mode" };
  const parsed = cmTokenizeBobArgv(this.query);
  const sequence = (this.argCompletionSequence || 0) + 1;
  this.argCompletionSequence = sequence;
  if (parsed.error) {
    this.hint = parsed.error;
    this.argCompletions = [];
    this.argCompletionGroups = [];
    this.argCompletionPending = false;
    this.render();
    this.refocusInput();
    return { ok: false, error: parsed.error };
  }
  this.argCompletionPending = true;
  const words = [...parsed.tokens, parsed.partialStarted ? parsed.partial : ""];
  const resolution = this.plugin && typeof this.plugin.commandModeResolveBob === "function"
    ? this.plugin.commandModeResolveBob() : { path: "bob" };
  const runner = this.runner();
  const vaultBase = runner && runner.deps && typeof runner.deps.vaultBase === "function"
    ? runner.deps.vaultBase() : cmVaultBasePath(this.app);
  const env = cmBuildChildEnv({
    env: (typeof process !== "undefined" && process.env) || {},
    vaultBase,
    features: (this.catalog && this.catalog.features) || [],
    home: cmHomeDir({}),
    pathModule: cmPath(),
  });
  const reply = await cmRequestBobCompletions(resolution && resolution.path, this.argEntry, words, {
    execFile: this.completionExecFile,
    cwd: vaultBase,
    env,
  });
  if (sequence !== this.argCompletionSequence || this.stage !== "args" || !this.sheetOpen) return { ok: false, stale: true };
  this.argCompletionPending = false;
  if (!reply.ok) {
    this.argCompletionGroups = [];
    this.argCompletions = [];
    this.hint = null;
    this.render();
    this.refocusInput();
    return reply;
  }
  const result = cmParseBobCompletion(reply.stdout, this.app, {
    partial: parsed.partial,
    activePath: this.context && this.context.notePath,
  });
  this.argCompletions = result.candidates.map((item, index) => ({ ...item, key: "completion:" + index }));
  const keyed = new Map(this.argCompletions.map((item, index) => [index, item]));
  this.argCompletionGroups = result.groups.map((group) => ({
    ...group,
    rows: group.rows.map((item) => keyed.get(result.candidates.indexOf(item))).filter(Boolean),
  }));
  this.hint = result.message || null;
  this.render();
  this.refocusInput();
  return { ok: true, ...result };
};

CommandModeSheetModal.prototype.acceptArgumentCompletion = function acceptArgumentCompletion(item) {
  if (!item || this.stage !== "args") return false;
  const parsed = cmTokenizeBobArgv(this.query);
  if (parsed.error) {
    this.hint = parsed.error;
    this.render();
    this.refocusInput();
    return false;
  }
  const value = String(item.insertValue !== undefined ? item.insertValue : item.value);
  const words = [...parsed.tokens, value];
  this.query = words.map(cmQuoteArg).join(" ") + (item.space === "nospace" ? "" : " ");
  this.argSelectedKey = null;
  this.hint = null;
  this.render();
  this.refocusInput();
  this.scheduleArgumentCompletions();
  return true;
};

CommandModeSheetModal.prototype.moveArgumentCompletion = function moveArgumentCompletion(delta) {
  const rows = cmArgRenderedRows(this);
  if (!rows.length) return;
  let index = rows.findIndex((item) => item.key === this.argSelectedKey);
  index = index < 0 ? (delta > 0 ? 0 : rows.length - 1) : (index + delta + rows.length) % rows.length;
  this.argSelectedKey = rows[index].key;
  this.render();
  this.refocusInput();
};

CommandModeSheetModal.prototype.runArgumentStage = async function runArgumentStage(options = {}) {
  const parsed = cmTokenizeBobArgv(this.query);
  if (parsed.error) {
    this.hint = parsed.error;
    this.render();
    this.refocusInput();
    return { ok: false, reason: parsed.error };
  }
  const userArgs = cmTokenizedWords(parsed);
  const row = {
    ...this.argRow,
    kind: "entry",
    path: [...this.argEntry.path, ...(this.argEntry.fixed || [])],
    basePath: [...this.argEntry.path],
    fixed: [...(this.argEntry.fixed || [])],
    required: cmRequiredPositionals(this.argEntry),
    userArgs,
    argv: [...this.argEntry.path, ...userArgs],
  };
  const missing = cmSheetMissingPositional(row);
  if (missing) {
    this.hint = "Needs " + missing;
    this.render();
    this.refocusInput();
    return { ok: false, reason: "missing " + missing };
  }
  const type = options.preview ? "preview" : options.force ? "run-now" : "run";
  return cmOriginalSheetActivateRow.call(this, row, {
    ...(type === "preview" ? { preview: true } : {}),
    ...(type === "run-now" ? { force: true } : {}),
  });
};

CommandModeSheetModal.prototype.enterVimStage = function enterVimStage(query) {
  if (this.stage !== "vim") this.listQuery = this.query.startsWith("::") ? "" : this.query;
  this.stage = "vim";
  this.query = String(query || "").replace(/^:/, "");
  this.hint = null;
  this.recomputeVisible();
  this.render();
  this.refocusInput();
};

CommandModeSheetModal.prototype.leaveVimStage = function leaveVimStage() {
  this.stage = "list";
  this.query = String(this.listQuery || "");
  this.hint = null;
  this.rebuildRows();
  this.render();
  this.refocusInput();
};

CommandModeSheetModal.prototype.runVimCommand = function runVimCommand(text) {
  const target = cmVimTarget(this.context);
  if (!target.ok) {
    this.hint = "Open a note first";
    this.render();
    this.refocusInput();
    return { ok: false, reason: "Open a note first" };
  }
  const command = String(text || "").trim().replace(/^:/, "");
  if (!command) {
    this.hint = "Type a Vim ex command";
    this.render();
    this.refocusInput();
    return { ok: false, reason: this.hint };
  }
  try {
    const workspace = this.app && this.app.workspace;
    if (workspace && this.context.originLeaf && typeof workspace.setActiveLeaf === "function") {
      workspace.setActiveLeaf(this.context.originLeaf, { focus: true });
    }
    if (target.editor && typeof target.editor.focus === "function") target.editor.focus();
    this.close();
    target.vim.handleEx(target.cm, command);
    return { ok: true, command };
  } catch (error) {
    this.hint = String((error && error.message) || error);
    this.render();
    return { ok: false, reason: this.hint };
  }
};

CommandModeSheetModal.prototype.activateRow = function activateRowWithArgsVim(row, opts = {}) {
  if (!row) return { ok: false, reason: "no row" };
  if (row.kind === "excluded") return { ok: false, reason: row.unavailable || "excluded" };
  if (row.kind === "vim" || row.kind === "vim-suggestion") return this.runVimCommand(row.vimText);
  if (row.kind === "entry" || row.kind === "typed") {
    const missing = cmSheetMissingPositional(row);
    if (missing) {
      this.enterArgumentStage(row);
      return { ok: true, stage: "args" };
    }
  }
  return cmOriginalSheetActivateRow.call(this, row, opts);
};

CommandModeSheetModal.prototype.handleSheetKeydown = function handleSheetKeydownWithArgsVim(event) {
  if (this.stage === "output" || this.stage === "confirm") return cmOriginalSheetHandleKeydown.call(this, event);
  if (!event || typeof event.key !== "string") return false;
  const consume = () => {
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopPropagation === "function") event.stopPropagation();
  };
  if (this.stage === "list" && event.key === ":" && String(this.query || "").startsWith(":")) {
    consume();
    this.enterVimStage("");
    return true;
  }
  if (this.stage === "args") {
    if (event.key === "Escape" || (event.key === "Backspace" && !this.query)) {
      consume();
      this.leaveArgumentStage();
      return true;
    }
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
      consume(); this.moveArgumentCompletion(1); return true;
    }
    if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
      consume(); this.moveArgumentCompletion(-1); return true;
    }
    if (event.key === "Tab") {
      consume();
      const rendered = cmArgRenderedRows(this);
      const selected = rendered.find((item) => item.key === this.argSelectedKey) || rendered[0];
      if (selected) this.acceptArgumentCompletion(selected);
      return true;
    }
    if (event.key === "Enter") {
      consume();
      const selected = cmArgRenderedRows(this).find((item) => item.key === this.argSelectedKey);
      if (selected && !event.shiftKey && !event.ctrlKey) this.acceptArgumentCompletion(selected);
      else void this.runArgumentStage({ preview: Boolean(event.shiftKey), force: Boolean(event.ctrlKey && !event.shiftKey) });
      return true;
    }
    return false;
  }
  if (this.stage === "vim") {
    if (event.key === "Escape") { consume(); this.leaveVimStage(); return true; }
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
      consume(); this.select(1); return true;
    }
    if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
      consume(); this.select(-1); return true;
    }
    if (event.key === "Enter") {
      consume();
      const row = this.visible.find((item) => item.key === this.selectedKey);
      if (row && row.kind === "vim-suggestion") this.runVimCommand(row.vimText);
      else this.runVimCommand(this.query);
      return true;
    }
    return false;
  }
  const action = cmSheetListAction(event, { query: this.query });
  if (action.type === "args") {
    consume();
    const row = this.selectedRow();
    if (row && (row.kind === "entry" || row.kind === "typed")) this.enterArgumentStage(row);
    return true;
  }
  return cmOriginalSheetHandleKeydown.call(this, event);
};

// Keep async completion work scoped to the modal lifetime.
const cmOriginalSheetOnClose = CommandModeSheetModal.prototype.onClose;
CommandModeSheetModal.prototype.onClose = function onCloseArgsVim() {
  if (this.argCompletionTimer) clearTimeout(this.argCompletionTimer);
  this.argCompletionTimer = null;
  this.argCompletionSequence = (this.argCompletionSequence || 0) + 1;
  return cmOriginalSheetOnClose.call(this);
};

const cmOriginalPluginOnloadArgsVim = BobCommandModePlugin.prototype.onload;
const cmOriginalPluginOnunloadArgsVim = BobCommandModePlugin.prototype.onunload;
BobCommandModePlugin.prototype.onload = async function onloadVimrcLint(...args) {
  await cmOriginalPluginOnloadArgsVim.apply(this, args);
  this.commandModeVimrcLintShown = false;
  this.commandModeVimrcExmaps = [];
  this.commandModeVimrcRecursiveMaps = [];
  this.commandModeVimrcFilePath = null;
  this.commandModeVimrcLintActive = true;
  const vault = this.app && this.app.vault;
  if (vault && typeof vault.on === "function") {
    const adapter = vault.adapter;
    const configDir = String(vault.configDir || ".obsidian").replace(/\/$/, "");
    const settingsPath = configDir + "/plugins/obsidian-vimrc-support/data.json";
    const ref = vault.on("modify", (file) => {
      const changed = String(file && file.path || file || "");
      if (changed === settingsPath || changed === this.commandModeVimrcFilePath) void cmRefreshVimrcLint(this);
    });
    if (typeof this.registerEvent === "function") this.registerEvent(ref);
    void cmRefreshVimrcLint(this);
  }
};
BobCommandModePlugin.prototype.onunload = function onunloadVimrcLint(...args) {
  this.commandModeVimrcLintActive = false;
  return cmOriginalPluginOnunloadArgsVim.apply(this, args);
};
