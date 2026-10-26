const test = require("node:test");
const assert = require("node:assert/strict");

const {
  helpers,
  fixtureCatalog,
  makeRunner,
  installDocument,
  makeApp,
  takeNotices,
} = require("./command-mode-harness.cjs");

const { pressKey } = require("./modal-harness.cjs");

function makeModal(options = {}) {
  const restore = installDocument();
  const catalog = options.catalog || fixtureCatalog();
  const base = makeRunner({ catalog });
  const app = makeApp(options.app || {});
  const plugin = {
    app,
    commandModeCatalog: catalog,
    commandModeRunner: base.runner,
    commandModeVimrcExmaps: options.exmaps || [],
    commandModeResolveBob: () => ({ path: "bob", source: "path" }),
    commandModeSheet: null,
  };
  const modal = new helpers.CommandModeSheetModal(app, plugin, {
    context: options.context || { notePath: null, noteKind: null, clipboardUrl: null },
    completionExecFile: options.execFile,
  });
  plugin.commandModeSheet = modal;
  modal.open();
  return { modal, plugin, base, restore };
}

test("typed argv tokenizer handles quotes, escapes, literal shell syntax, and errors", () => {
  const parsed = helpers.cmTokenizeBobArgv("ref create 'A note'");
  assert.deepEqual(parsed.tokens, ["ref", "create"]);
  assert.equal(parsed.partial, "A note");
  assert.equal(parsed.error, null);
  const full = helpers.cmTokenizeBobArgv('ref create "a \\\"quote\\\" \\\\ path" $(literal) `also literal` ');
  assert.deepEqual(helpers.cmTokenizedWords(full), ["ref", "create", 'a "quote" \\ path', "$(literal)", "`also", "literal`"]);
  assert.equal(helpers.cmTokenizeBobArgv("ref create 'unfinished").error, "Unbalanced quote");
  assert.equal(helpers.cmTokenizeBobArgv("ref create tail\\").error, "Unfinished escape");
});

test("typed argv resolves aliases to the longest catalog entry and refuses excluded paths", () => {
  const catalog = {
    ...fixtureCatalog(),
    aliases: [
      { from: ["ref", "clip"], to: ["ref", "create"] },
      { from: ["task-status-hooks"], to: ["task", "reconcile"] },
    ],
    entries: [
      ...fixtureCatalog().entries,
      { id: "task-reconcile", path: ["task", "reconcile"], fixed: [], title: "Reconcile tasks", args: [] },
    ],
  };
  const alias = helpers.cmResolveTypedBobArgv(catalog, "ref clip 'notes/a note.md'");
  assert.equal(alias.entry.id, "ref-create");
  assert.deepEqual(alias.argv, ["ref", "create", "notes/a note.md"]);
  assert.deepEqual(alias.userArgs, ["notes/a note.md"]);
  const longest = helpers.cmResolveTypedBobArgv(catalog, "task-status-hooks --retry-timeout 10");
  assert.equal(longest.entry.id, "task-reconcile");
  assert.deepEqual(longest.argv, ["task", "reconcile", "--retry-timeout", "10"]);
  const excluded = helpers.cmResolveTypedBobArgv(catalog, "capture =");
  assert.match(excluded.excluded, /named capture rows/);
  assert.equal(helpers.cmResolveTypedBobArgv(catalog, "ref create 'unfinished").error, "Unbalanced quote");
});

test("the list pins typed metadata, disabled exclusions, and the explicit Vim fallback", () => {
  const catalog = {
    ...fixtureCatalog(),
    aliases: [{ from: ["ref", "clip"], to: ["ref", "create"] }],
  };
  const { modal, restore } = makeModal({ catalog });
  try {
    modal.query = "ref clip 'notes/a note.md'";
    modal.rebuildRows();
    const typed = modal.visible[0];
    assert.equal(typed.kind, "typed");
    assert.equal(typed.entryId, "ref-create");
    assert.equal(typed.effect, "writes");
    assert.equal(typed.policy, "run");
    assert.deepEqual(typed.argv, ["ref", "create", "notes/a note.md"]);

    modal.query = "capture =";
    modal.rebuildRows();
    assert.equal(modal.visible[0].kind, "excluded");
    assert.match(modal.visible[0].unavailable, /named capture rows/);
    assert.match(modal.visible[0].about, /Use the named capture rows/);

    modal.query = "unmatched-zebra-query";
    modal.rebuildRows();
    assert.equal(modal.visible[0].kind, "vim");
    assert.equal(modal.visible[0].unavailable, "Open a note first");
  } finally {
    modal.close();
    restore();
  }
});

test("Vim-shaped input follows the agreed positive and negative rules", () => {
  for (const input of ["%s/a/b/g", "42", "noh", "sort", "bob_daily", "g/foo/d", "<,'>w"]) {
    assert.equal(helpers.cmIsVimShaped(input, ["bob_daily"]), true, input);
  }
  for (const input of ["sync", "ref create", "stats", "capture"]) {
    assert.equal(helpers.cmIsVimShaped(input, ["bob_daily"]), false, input);
  }
});

test("vimrc parser finds recursive colon mappings and exmap names", () => {
  const parsed = helpers.cmParseVimrc([
    '" map x :commented-out',
    "map <silent> <buffer> - :bob_daily<CR>",
    "nmap <expr> <C-x> :w",
    "nnoremap : :bob_command<CR>",
    "exmap bob_daily obcommand bob-ledger-tools:open-today-daily-note",
    "map j gj",
  ].join("\n"));
  assert.deepEqual(parsed.recursiveMaps, ["-", "<C-x>"]);
  assert.deepEqual(parsed.exmapNames, ["bob_daily"]);
  assert.match(helpers.cmVimrcLintNotice(parsed.recursiveMaps), /`-` and 1 other replay `:`/);
  assert.match(helpers.cmVimrcLintNotice(["x"]), /`x` replays `:`/);
});

test("argument completion passes the entry path, fixed args, and current tokens to bob", async () => {
  let seen = null;
  const execFile = (binary, argv, options, callback) => {
    seen = { binary, argv, options };
    callback(null, "daily\tDaily workflow\tSections\tspace\n", "");
  };
  const baseCatalog = fixtureCatalog();
  const catalog = {
    ...baseCatalog,
    entries: baseCatalog.entries.map((entry) => entry.id === "ref-create" ? { ...entry, fixed: ["-f", "json"] } : entry),
  };
  const { modal, restore } = makeModal({ execFile, catalog });
  try {
    const row = modal.rows.find((item) => item.entryId === "ref-create");
    assert.ok(row);
    modal.enterArgumentStage(row);
    modal.query = "https://example.com/a";
    const result = await modal.loadArgumentCompletions();
    assert.equal(result.ok, true);
    assert.equal(seen.binary, "bob");
    assert.deepEqual(seen.argv, ["__complete", "bash", "--protocol", "1", "--", "bob", "ref", "create", "-f", "json", "https://example.com/a"]);
    assert.equal(seen.options.timeout, 1000);
    assert.equal(modal.argCompletionGroups[0].title, "Sections");
    assert.equal(modal.argCompletions[0].value, "daily");
  } finally {
    modal.close();
    restore();
  }
});

test("completion directives group candidates, preserve prefixes, and expand vault paths", () => {
  const app = makeApp({
    vault: {
      configDir: ".obsidian",
      adapter: { getBasePath: () => "/vault" },
      getFiles: () => [
        { path: "refs/other.md" },
        { path: "refs/active.md" },
        { path: "refs/image.png" },
      ],
      getAllLoadedFiles: () => [
        { path: "refs" , children: [] },
        { path: "areas" , children: [] },
      ],
    },
  });
  const parsed = helpers.cmParseBobCompletion([
    "!prefix 2",
    "!message Choose a reference",
    "cdef\tReference name\tRefs\tnospace",
  ].join("\n"), app, { partial: "ab", activePath: "refs/active.md" });
  assert.equal(parsed.message, "Choose a reference");
  assert.equal(parsed.candidates[0].insertValue, "abcdef");
  assert.ok(parsed.groups.some((group) => group.title === "Refs"));
  const paths = helpers.cmParseBobCompletion("!files-in refs\t*.md\n!dirs", app, { partial: "", activePath: "refs/active.md" });
  const vaultFiles = paths.candidates.filter((candidate) => candidate.group === "Vault files");
  assert.deepEqual(vaultFiles.map((item) => item.value), ["refs/active.md", "refs/other.md"]);
  assert.ok(paths.candidates.some((item) => item.group === "Folders" && item.value === "refs"));
});

test("stale completion replies are discarded and Enter reports missing required positionals", async () => {
  const callbacks = [];
  const execFile = (_binary, _argv, _options, callback) => callbacks.push(callback);
  const baseCatalog = fixtureCatalog();
  const catalog = {
    ...baseCatalog,
    entries: [...baseCatalog.entries, {
      id: "ref-rename", path: ["ref", "rename"], fixed: [], title: "Rename a reference",
      about: "Rename", section: "vault", keywords: ["rename"], effect: "syncs",
      presentation: "action", policy: "preview-first", preview: ["--dry-run"], confirm: null,
      budget_secs: 180, args: [
        { name: "REF", required: true, repeat: false, slot: "ref" },
        { name: "NAME", required: true, repeat: false, slot: "text" },
      ], exit_codes: [], adapter: null, hosts: [], invalidates: [],
    }],
  };
  const { modal, restore } = makeModal({ execFile, catalog });
  try {
    const row = modal.rows.find((item) => item.entryId === "ref-rename");
    modal.enterArgumentStage(row);
    const first = modal.loadArgumentCompletions();
    modal.query = "refs/a.md";
    const second = modal.loadArgumentCompletions();
    callbacks[0](null, "old\told value\tOld\tspace\n", "");
    callbacks[1](null, "new\tnew value\tNew\tspace\n", "");
    await Promise.all([first, second]);
    assert.deepEqual(modal.argCompletions.map((item) => item.value), ["new"]);
    const result = await modal.runArgumentStage();
    assert.equal(result.ok, false);
    assert.equal(modal.hint, "Needs NAME");
    assert.equal(modal.stage, "args");
  } finally {
    modal.close();
    restore();
  }
});

test("argument completion requests debounce edits by 60 ms", async () => {
  let calls = 0;
  const execFile = (_binary, _argv, _options, callback) => {
    calls += 1;
    callback(null, "", "");
  };
  const { modal, restore } = makeModal({ execFile });
  try {
    const row = modal.rows.find((item) => item.entryId === "ref-create");
    modal.enterArgumentStage(row);
    modal.query = "a";
    modal.scheduleArgumentCompletions();
    modal.query = "ab";
    modal.scheduleArgumentCompletions();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(calls, 1);
  } finally {
    modal.close();
    restore();
  }
});

test("Vim ex dispatch restores and targets the editor captured when the sheet opened", () => {
  let called = null;
  const cm = { getCursor: () => ({ line: 0, ch: 0 }) };
  const editor = { cm: { cm }, focused: 0, focus() { this.focused += 1; } };
  const previousWindow = global.window;
  global.window = { CodeMirrorAdapter: { Vim: { handleEx: (target, command) => { called = [target, command]; } } } };
  const { modal, restore } = makeModal({
    exmaps: ["bob_daily"],
    context: { notePath: "Notes.md", originEditor: editor, originView: { editor }, originLeaf: { id: "origin" } },
  });
  try {
    modal.enterVimStage("");
    assert.equal(modal.visible[0].vimText, "bob_daily");
    const result = modal.runVimCommand(":bob_daily");
    assert.equal(result.ok, true);
    assert.deepEqual(called, [cm, "bob_daily"]);
    assert.equal(editor.focused, 1);
  } finally {
    modal.close();
    restore();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test("double colon enters Vim stage and Escape returns to the list", () => {
  const { modal, restore } = makeModal();
  try {
    modal.query = ":";
    modal.rebuildRows();
    pressKey(modal, ":");
    assert.equal(modal.stage, "vim");
    pressKey(modal, "Escape");
    assert.equal(modal.stage, "list");
  } finally {
    modal.close();
    restore();
  }
});

test("vimrc lint reads the configured file and shows only one session notice", async () => {
  takeNotices();
  const files = {
    ".obsidian/plugins/obsidian-vimrc-support/data.json": JSON.stringify({ vimrcFileName: "obsidian_vimrc.md" }),
    "obsidian_vimrc.md": "nmap - :bob_daily<CR>\nexmap bob_daily obcommand bob:daily",
  };
  const plugin = {
    app: { vault: { configDir: ".obsidian", adapter: { read: async (path) => files[path] } } },
    commandModeVimrcLintShown: false,
    commandModeVimrcLintActive: true,
  };
  const first = await helpers.cmRefreshVimrcLint(plugin);
  const second = await helpers.cmRefreshVimrcLint(plugin);
  assert.equal(first.ok, true);
  assert.deepEqual(first.exmapNames, ["bob_daily"]);
  assert.deepEqual(plugin.commandModeVimrcRecursiveMaps, ["-"]);
  assert.equal(second.ok, true);
  assert.equal(takeNotices().length, 1);
});
