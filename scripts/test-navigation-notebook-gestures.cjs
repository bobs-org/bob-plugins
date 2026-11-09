// Notebook gestures in bob-navigation-hotkeys (plan 202611/bob_notebooks.md,
// phase plugins-notebook-gestures): the notebook note kind and icon, the
// parent picker's notebook rules, task-move and inbox routing never offering
// a notebook, and the Create notebook here command.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices,
  NavigationHotkeysPlugin,
  helpers,
} = require("./navigation-hotkeys-harness.cjs");
const { ElementStub, pressKey, click } = require("./modal-harness.cjs");

const NOTEBOOK_FM = { type: "[[notebook]]", parent: "[[dev]]" };

function collectText(node) {
  if (!node) {
    return "";
  }
  const own = node.textContent || "";
  const kids = Array.isArray(node.children)
    ? node.children.map(collectText).join("")
    : "";
  return `${own}${kids}`;
}

// ---------------------------------------------------------------------------
// Kind recognition and display
// ---------------------------------------------------------------------------

test("getChildNoteInfo classifies a notebook with the notebook-tabs icon", () => {
  for (const type of [
    "[[notebook]]",
    " [[notebook]] ",
    ["[[notebook]]"],
    ["[[other]]", "[[notebook]]"],
  ]) {
    const info = helpers.getChildNoteInfo({ type });
    assert.equal(info.kind, "notebook", JSON.stringify(type));
    assert.equal(info.decorated, true);
    assert.equal(info.icon, "notebook-tabs");
    assert.equal(info.label, "Notebook");
    assert.equal(info.variant, "notebook");
    assert.equal(info.scheduled, false);
  }
});

test("area and project still win; other and missing types stay plain", () => {
  assert.equal(helpers.getChildNoteInfo({ type: "[[area]]" }).kind, "area");
  assert.equal(
    helpers.getChildNoteInfo({ type: "[[project]]", status: "wip" }).kind,
    "project",
  );
  assert.equal(helpers.getChildNoteInfo({ type: "[[ref]]" }).kind, "plain");
  assert.equal(helpers.getChildNoteInfo({ type: "[[notebooks]]" }).kind, "plain");
  assert.equal(helpers.getChildNoteInfo({}).kind, "plain");
  assert.equal(helpers.getChildNoteInfo(null).kind, "plain");
  assert.equal(helpers.isNotebookType("[[notebook]]"), true);
  assert.equal(helpers.isNotebookType("[[area]]"), false);
  assert.equal(helpers.isNotebookType(undefined), false);
});

test("the child-note summary, search text, and badge label know notebooks", () => {
  const notebook = helpers.getChildNoteInfo({ type: "[[notebook]]" });
  const area = helpers.getChildNoteInfo({ type: "[[area]]" });
  const files = [
    { path: "dev_git.md" },
    { path: "dev_rust.md" },
    { path: "dev_ops.md" },
  ];
  const summary = helpers.getChildNoteSummary(
    files,
    new Map([
      ["dev_git.md", notebook],
      ["dev_rust.md", notebook],
      ["dev_ops.md", area],
    ]),
  );
  assert.deepEqual(summary, ["1 area", "2 notebooks"]);
  assert.deepEqual(
    helpers.getChildNoteSummary(
      [files[0]],
      new Map([["dev_git.md", notebook]]),
    ),
    ["1 notebook"],
  );
  assert.match(
    helpers.getChildNoteSearchText({ path: "dev_git.md", basename: "dev_git" }, notebook),
    /notebook/,
  );
  assert.equal(helpers.childNoteKindAriaLabel(notebook), "Notebook");
  assert.equal(helpers.childNoteKindAriaLabel(area), "Area note");
  assert.equal(
    helpers.childNoteKindAriaLabel(
      helpers.getChildNoteInfo({ type: "[[project]]", status: "wip" }),
    ),
    "Project status: WIP",
  );
});

test("a typed note row renders the notebook icon and badge", () => {
  const info = helpers.getChildNoteInfo({ type: "[[notebook]]" });
  const rowEl = new ElementStub({ cls: "bob-cnp-row" });
  helpers.renderTypedNotePickerRow(
    { path: "dev_git.md", basename: "dev_git" },
    info,
    rowEl,
    "",
  );
  const text = collectText(rowEl);
  assert.match(text, /dev_git/);
  assert.match(text, /Notebook/);
  const iconEl = rowEl.children[0];
  assert.ok(iconEl.classes.includes("is-status-notebook"));
});

// ---------------------------------------------------------------------------
// Task routing never offers notebooks
// ---------------------------------------------------------------------------

test("task-move destinations never include a notebook", () => {
  const files = [
    { path: "Source.md", basename: "Source" },
    { path: "dev.md", basename: "dev" },
    { path: "ship.md", basename: "ship" },
    { path: "dev_git.md", basename: "dev_git" },
  ];
  const info = new Map([
    ["Source.md", helpers.getChildNoteInfo({ type: "[[area]]" })],
    ["dev.md", helpers.getChildNoteInfo({ type: "[[area]]" })],
    ["ship.md", helpers.getChildNoteInfo({ type: "[[project]]", status: "wip" })],
    ["dev_git.md", helpers.getChildNoteInfo(NOTEBOOK_FM)],
  ]);
  const destinations = helpers.collectTaskMoveDestinations(
    files,
    "Source.md",
    (file) => info.get(file.path),
  );
  assert.deepEqual(
    destinations.map((entry) => entry.file.path),
    ["dev.md", "ship.md"],
  );
});

test("a notebook is never a valid task-move destination at write time", () => {
  const verdict = helpers.parseTaskMoveDestinationFrontmatter(
    ["---", 'type: "[[notebook]]"', "---", "", "- a note", ""].join("\n"),
    { parseYaml: () => ({ type: "[[notebook]]" }) },
  );
  assert.equal(verdict.valid, false);
  assert.equal(verdict.kind, "notebook");
  assert.equal(verdict.error, "Destination is no longer an area or open project");
});

test("a notebook is never an inbox note, even under the inbox", () => {
  const inboxFile = { path: "inbox.md", basename: "inbox", extension: "md" };
  assert.equal(
    helpers.classifyInboxNote(
      {
        path: "mac_inbox.md",
        frontmatter: { type: "[[notebook]]", parent: "[[inbox]]" },
      },
      inboxFile,
      () => true,
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// Parent picker rules
// ---------------------------------------------------------------------------

function rec(path, ruleKind, extras = {}) {
  const basename = path.split("/").pop().replace(/\.md$/, "");
  return {
    path,
    basename,
    ruleKind,
    noteInfo: extras.noteInfo || { kind: "plain", decorated: false },
    parentPath: extras.parentPath || null,
    recentRank: extras.recentRank,
    file: { path, basename, extension: "md" },
  };
}

test("parentRuleKindOf mirrors bob's note classification", () => {
  const kind = helpers.parentRuleKindOf;
  assert.equal(kind({ type: "[[area]]" }), "area");
  assert.equal(kind({ type: "[[project]]" }), "project");
  assert.equal(kind({ type: "[[notebook]]" }), "notebook");
  assert.equal(kind({ type: "[[ref]]" }), "reference");
  assert.equal(kind({ type: "[[restaurant]]" }), "record");
  assert.equal(kind({ type: "[[eat/restaurant|Restaurant]]" }), "record");
  assert.equal(kind({ type: ["[[notebook]]"] }), "notebook");
  // YAML reads an unquoted [[x]] as a nested list.
  assert.equal(kind({ type: [["notebook"]] }), "notebook");
  assert.equal(kind({ type: "notebook" }), "notebook");
  for (const reserved of ["article", "mail", "day", "done", "type"]) {
    assert.equal(kind({ type: `[[${reserved}]]` }), "other", reserved);
  }
  assert.equal(kind({}), "other");
  assert.equal(kind(null), "other");
  // Area wins over a record-looking second type, like bob.
  assert.equal(kind({ type: ["[[restaurant]]", "[[area]]"] }), "area");
});

test("parentKindRefusal encodes the notebook parent rules", () => {
  const refusal = helpers.parentKindRefusal;
  for (const source of ["area", "project", "reference", "record"]) {
    assert.equal(refusal(source, "notebook"), "notebook", source);
    assert.equal(refusal(source, "area"), null, source);
    assert.equal(refusal(source, "other"), null, source);
  }
  assert.equal(refusal("other", "notebook"), null);
  assert.equal(refusal("notebook", "area"), null);
  assert.equal(refusal("notebook", "project"), null);
  assert.equal(refusal("notebook", "notebook"), null);
  for (const candidate of ["other", "reference", "record"]) {
    assert.equal(refusal("notebook", candidate), "not-notebook-parent", candidate);
  }
  assert.match(helpers.parentKindRefusalText("notebook", "dev_git"), /dev_git is a notebook/);
  assert.match(
    helpers.parentKindRefusalText("not-notebook-parent", "plain_note"),
    /can't hold a notebook/,
  );
  assert.equal(helpers.parentKindRefusalText(null, "x"), "");
});

function pickerRecords() {
  return [
    rec("dev.md", "area"),
    rec("ship.md", "project"),
    rec("dev_git.md", "notebook", { parentPath: "dev.md" }),
    rec("dev_rust.md", "notebook", { parentPath: "dev.md" }),
    rec("recipes.md", "reference"),
    rec("pasta.md", "record"),
    rec("scratch.md", "other"),
    rec("area_note.md", "area"),
    rec("project_note.md", "project"),
    rec("ref_note.md", "reference"),
    rec("record_note.md", "record"),
    rec("notebook_note.md", "notebook", { parentPath: "dev.md" }),
  ];
}

function visiblePaths(index, query = "") {
  return helpers.rankParentCandidates(index, query).items.map((item) => item.path);
}

test("areas, projects, references, and record notes never see notebooks", () => {
  for (const source of ["area_note.md", "project_note.md", "ref_note.md", "record_note.md"]) {
    const index = helpers.buildParentPickerIndex(pickerRecords(), { sourcePath: source });
    const empty = visiblePaths(index);
    assert.ok(!empty.includes("dev_git.md"), `${source} empty query`);
    assert.ok(!empty.includes("dev_rust.md"), `${source} empty query`);
    assert.ok(empty.includes("dev.md"), `${source} still sees areas`);
    const typed = visiblePaths(index, "dev_");
    assert.ok(!typed.some((path) => path.startsWith("dev_g") || path.startsWith("dev_r")), source);
    assert.equal(index.hiddenByKind.get("dev_git.md"), "notebook");
  }
});

test("a notebook sees only areas, projects, and notebooks", () => {
  const index = helpers.buildParentPickerIndex(pickerRecords(), {
    sourcePath: "notebook_note.md",
  });
  const all = visiblePaths(index, "");
  const seen = new Set(all);
  for (const path of ["dev.md", "ship.md", "area_note.md", "project_note.md", "dev_git.md", "dev_rust.md"]) {
    assert.ok(seen.has(path), path);
  }
  for (const path of ["recipes.md", "pasta.md", "scratch.md", "ref_note.md", "record_note.md"]) {
    assert.ok(!seen.has(path), path);
  }
  // A search by name finds nothing the rules hide.
  assert.deepEqual(visiblePaths(index, "scratch"), []);
  assert.deepEqual(visiblePaths(index, "recipes"), []);
});

test("other notes may still choose a notebook parent", () => {
  const index = helpers.buildParentPickerIndex(pickerRecords(), {
    sourcePath: "scratch.md",
  });
  assert.ok(visiblePaths(index, "dev_git").includes("dev_git.md"));
  assert.equal(index.hiddenByKind.size, 0);
});

test("a notebook's own subtree stays excluded alongside the kind rules", () => {
  const index = helpers.buildParentPickerIndex(pickerRecords(), {
    sourcePath: "dev_git.md",
  });
  assert.ok(index.excluded.has("dev_git.md"));
  assert.ok(!visiblePaths(index, "").includes("dev_git.md"));
});

test("the empty state teaches which parent rule hid every match", () => {
  const areaIndex = helpers.buildParentPickerIndex(pickerRecords(), {
    sourcePath: "area_note.md",
  });
  const ranked = helpers.rankParentCandidates(areaIndex, "dev_git");
  assert.equal(ranked.items.length, 0);
  assert.equal(ranked.excludedOnly, false);
  assert.equal(ranked.kindRefusal, "notebook");
  assert.equal(ranked.kindRefusalName, "dev_git");
  assert.equal(
    helpers.parentEmptyStateText("dev_git", false, ranked.kindRefusal, ranked.kindRefusalName),
    "dev_git is a notebook — areas, projects, references, and record notes can't hang under one",
  );

  const notebookIndex = helpers.buildParentPickerIndex(pickerRecords(), {
    sourcePath: "notebook_note.md",
  });
  const plain = helpers.rankParentCandidates(notebookIndex, "scratch");
  assert.equal(plain.kindRefusal, "not-notebook-parent");
  assert.match(
    helpers.parentEmptyStateText("scratch", false, plain.kindRefusal, plain.kindRefusalName),
    /scratch can't hold a notebook/,
  );

  // Without a rule hit the copy is unchanged.
  assert.match(
    helpers.parentEmptyStateText("zzz", false, null, null),
    /No note matches/,
  );
  // A subtree match wins over the rule teaching.
  const cyc = helpers.buildParentPickerIndex(pickerRecords(), {
    sourcePath: "dev.md",
  });
  const cycle = helpers.rankParentCandidates(cyc, "notebook_note");
  assert.equal(cycle.excludedOnly, true);
  assert.equal(cycle.kindRefusal, null);
});

// A plugin harness over a tiny vault, to drive the real picker and commit.
function makeVault(entries) {
  const filesByPath = new Map();
  const contents = new Map();
  const frontmatter = new Map();
  for (const entry of entries) {
    const basename = entry.path.split("/").pop().replace(/\.md$/, "");
    const file = { path: entry.path, basename, extension: "md", name: `${basename}.md` };
    filesByPath.set(entry.path, file);
    contents.set(entry.path, entry.body || "---\n---\n");
    frontmatter.set(entry.path, entry.frontmatter || {});
  }
  return { filesByPath, contents, frontmatter };
}

function makePlugin(vault, activePath, extra = {}) {
  const plugin = new NavigationHotkeysPlugin();
  const active = vault.filesByPath.get(activePath);
  const opened = [];
  plugin.app = {
    workspace: {
      getActiveFile: () => active,
      getActiveViewOfType: () => null,
      getLastOpenFiles: () => [],
      getLeaf: () => ({
        openFile: async (file) => {
          opened.push(file.path);
        },
      }),
      on: () => ({}),
      onLayoutReady: (callback) => callback && callback(),
    },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: vault.frontmatter.get(file.path) || {} }),
      getFirstLinkpathDest: (lookup) => {
        const needle = String(lookup || "").replace(/\.md$/, "");
        for (const file of vault.filesByPath.values()) {
          if (file.basename === needle || file.path.replace(/\.md$/, "") === needle) {
            return file;
          }
        }
        return null;
      },
    },
    vault: {
      getMarkdownFiles: () => Array.from(vault.filesByPath.values()),
      getAbstractFileByPath: (path) => vault.filesByPath.get(path) || null,
      cachedRead: async (file) => vault.contents.get(file.path) || "",
      process: async (file, fn) => {
        const next = fn(vault.contents.get(file.path) || "");
        vault.contents.set(file.path, next);
        return next;
      },
    },
    plugins: { plugins: extra.plugins || {} },
  };
  plugin.addCommand = () => {};
  plugin.activeParentNotePicker = null;
  plugin.parentChangePickerOpening = false;
  plugin.activeNotebookCreateModal = null;
  plugin.getActiveMarkdownContext = async () => ({
    file: active,
    content: vault.contents.get(activePath) || "",
  });
  plugin.getActiveMarkdownView = () => null;
  notices.length = 0;
  return { plugin, opened, active };
}

const NOTEBOOK_VAULT = [
  { path: "dev.md", frontmatter: { type: "[[area]]" }, body: '---\ntype: "[[area]]"\n---\n' },
  { path: "ship.md", frontmatter: { type: "[[project]]", status: "wip" } },
  {
    path: "dev_git.md",
    frontmatter: { type: "[[notebook]]", parent: "[[dev]]" },
    body: '---\nparent: "[[dev]]"\ntype: "[[notebook]]"\n---\n\n# Git\n',
  },
  { path: "scratch.md", frontmatter: {}, body: "---\n---\nbody\n" },
  {
    path: "tasks_area.md",
    frontmatter: { type: "[[area]]", parent: "[[dev]]" },
    body: '---\nparent: "[[dev]]"\ntype: "[[area]]"\n---\n',
  },
];

test("the real picker hides notebooks from an area and commit refuses a stale pick", async () => {
  const vault = makeVault(NOTEBOOK_VAULT);
  const { plugin, active } = makePlugin(vault, "tasks_area.md");
  const picker = await plugin.openParentChangePickerNow(active);
  const names = picker.index.records.map((record) => record.basename);
  assert.ok(names.includes("dev_git"));
  assert.ok(!visiblePaths(picker.index, "").includes("dev_git.md"));
  assert.ok(!picker.getFilteredItems().some((item) => item.path === "dev_git.md"));

  picker.inputEl.value = "dev_git";
  assert.deepEqual(picker.getFilteredItems(), []);
  assert.match(picker.emptyText, /dev_git is a notebook/);

  // A candidate that slipped past the filter is still refused at commit.
  const before = vault.contents.get("tasks_area.md");
  const notebook = picker.index.records.find((record) => record.basename === "dev_git");
  const ok = await plugin.commitParentChange({
    file: active,
    candidate: notebook,
    expected: picker.expectedRaw,
  });
  assert.equal(ok, false);
  assert.equal(vault.contents.get("tasks_area.md"), before);
  assert.match(notices.at(-1), /Can't change parent: dev_git is a notebook/);
});

test("a notebook picks a notebook parent and the real commit writes it", async () => {
  const vault = makeVault([
    ...NOTEBOOK_VAULT,
    {
      path: "dev_rust.md",
      frontmatter: { type: "[[notebook]]", parent: "[[dev]]" },
      body: '---\nparent: "[[dev]]"\ntype: "[[notebook]]"\n---\n\n# Rust\n',
    },
  ]);
  const { plugin, active } = makePlugin(vault, "dev_rust.md");
  const picker = await plugin.openParentChangePickerNow(active);
  const shown = picker.getFilteredItems().map((item) => item.path);
  assert.ok(!shown.includes("scratch.md"));
  const parent = picker.index.records.find((record) => record.basename === "dev_git");
  assert.ok(parent);
  const ok = await plugin.commitParentChange({
    file: active,
    candidate: parent,
    expected: picker.expectedRaw,
  });
  assert.equal(ok, true);
  assert.match(vault.contents.get("dev_rust.md"), /parent: "\[\[dev_git\]\]"/);

  // Choosing a plain note is refused with the notebook-parent teaching copy.
  const { plugin: second, active: secondActive } = makePlugin(vault, "dev_rust.md");
  const secondPicker = await second.openParentChangePickerNow(secondActive);
  const scratch = secondPicker.index.records.find((record) => record.basename === "scratch");
  const refused = await second.commitParentChange({
    file: secondActive,
    candidate: scratch,
    expected: secondPicker.expectedRaw,
  });
  assert.equal(refused, false);
  assert.match(notices.at(-1), /scratch can't hold a notebook/);
});

// ---------------------------------------------------------------------------
// Create notebook here: model
// ---------------------------------------------------------------------------

test("notebookCreateHostRefusal accepts areas, projects, and notebooks only", () => {
  for (const kind of ["area", "project", "notebook"]) {
    assert.equal(helpers.notebookCreateHostRefusal(kind, "x"), null, kind);
  }
  for (const kind of ["other", "reference", "record"]) {
    assert.match(
      helpers.notebookCreateHostRefusal(kind, "scratch"),
      /^scratch is not an area, project, or notebook/,
      kind,
    );
  }
  assert.match(helpers.notebookCreateHostRefusal("other"), /^This note is not/);
});

test("the file stem follows bob: parent, underscore, hyphens to underscores", () => {
  assert.equal(helpers.notebookCreateFileStem("dev", "nvim"), "dev_nvim");
  assert.equal(helpers.notebookCreateFileStem("dev", "nvim-plugins"), "dev_nvim_plugins");
  assert.equal(helpers.notebookCreateFileStem("dev_nvim", "lua"), "dev_nvim_lua");
});

test("the ID is suggested from the summary by the block-ID naming function", () => {
  const suggest = helpers.notebookCreateSuggestId;
  assert.equal(
    suggest("Linux machine setup, shell shortcuts, and troubleshooting notes.", "dev", []),
    "linux-machine-setup",
  );
  assert.equal(
    suggest("Neovim config notes and plugin picks", "dev", []),
    "neovim-config-notes",
  );
  assert.equal(suggest("", "dev", []), "");
  assert.equal(suggest("   ", "dev", []), "");
  // The same function the block-ID prompt uses for a note bullet.
  assert.equal(
    suggest("Git commands, configuration, and workflow tips.", "dev", []),
    helpers.suggestPromptBlockId(
      "- Git commands, configuration, and workflow tips.",
      "",
      {},
    ),
  );
});

test("the suggested ID walks past existing notebooks under the same parent", () => {
  const basenames = ["dev", "dev_git", "dev_git_2", "dev_other_thing", "ops_git", "DEV_GIT_3"];
  assert.equal(
    helpers.notebookCreateSuggestId("Git commands", "dev", basenames),
    "git-commands",
  );
  const taken = ["dev_git_commands", "dev_git_commands_2"];
  assert.equal(
    helpers.notebookCreateSuggestId("Git commands", "dev", taken),
    "git-commands-3",
  );
  // A sibling parent's files never collide.
  assert.equal(
    helpers.notebookCreateSuggestId("Git commands", "ops", taken),
    "git-commands",
  );
  const spent = helpers.notebookCreateTakenIds("dev", ["dev_nvim_lua", "dev_"]);
  assert.ok(spent.has("nvim_lua"));
  assert.ok(spent.has("nvim-lua"));
  assert.equal(spent.size, 2);
});

test("notebookCreateFileExists is case-insensitive on the file stem", () => {
  assert.equal(helpers.notebookCreateFileExists("dev", "nvim", ["Dev_Nvim"]), true);
  assert.equal(helpers.notebookCreateFileExists("dev", "nvim-lua", ["dev_nvim_lua"]), true);
  assert.equal(helpers.notebookCreateFileExists("dev", "nvim", ["dev_nvim_lua"]), false);
});

test("notebookCreateValidate requires a summary and a valid free ID", () => {
  const context = { parentStem: "dev", basenames: ["dev_git"] };
  const ok = helpers.notebookCreateValidate(
    { summary: "  Neovim   config notes ", id: " nvim ", title: "  Nvim  " },
    context,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.summary, "Neovim config notes");
  assert.equal(ok.id, "nvim");
  assert.equal(ok.title, "Nvim");
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.warning, "");

  const blank = helpers.notebookCreateValidate({ summary: " ", id: "" }, context);
  assert.equal(blank.ok, false);
  assert.match(blank.errors.summary, /one-line summary/);
  assert.match(blank.errors.id, /Choose an ID/);

  const badId = helpers.notebookCreateValidate({ summary: "x", id: "has space" }, context);
  assert.equal(badId.ok, false);
  assert.match(badId.errors.id, /letters, digits, and -/);
  assert.equal(
    helpers.notebookCreateValidate({ summary: "x", id: "under_score" }, context).ok,
    false,
  );

  const exists = helpers.notebookCreateValidate({ summary: "x", id: "git" }, context);
  assert.equal(exists.ok, false);
  assert.equal(exists.errors.id, "dev_git.md already exists");

  const long = helpers.notebookCreateValidate(
    { summary: "x".repeat(141), id: "long" },
    context,
  );
  assert.equal(long.ok, true);
  assert.match(long.warning, /141 characters; keep it to 140 or fewer/);
  assert.equal(helpers.NOTEBOOK_CREATE_SUMMARY_SOFT_MAX, 140);
  assert.equal(helpers.notebookCreateValidate(null, context).ok, false);
});

test("failure and success notices carry bob's message and hint", () => {
  assert.equal(
    helpers.notebookCreateFailureNotice({
      ok: false,
      code: "notebook_exists",
      message: "dev_nvim.md already exists",
      detail: "choose another ID",
    }),
    "Can't create notebook: dev_nvim.md already exists — choose another ID",
  );
  assert.equal(
    helpers.notebookCreateFailureNotice({ ok: false, code: "notebook_id_invalid", message: "bad id" }),
    "Can't create notebook: bad id",
  );
  assert.equal(
    helpers.notebookCreateFailureNotice({
      ok: false,
      code: "desktop_only",
      message: "Creating a notebook needs the desktop app",
    }),
    "Creating a notebook needs the desktop app",
  );
  assert.equal(
    helpers.notebookCreateFailureNotice(null),
    "Can't create notebook: bob notebooks create failed",
  );
  assert.equal(
    helpers.notebookCreateSuccessNotice({
      notebook: { path: "dev_nvim.md", parent: "dev" },
      warnings: [],
    }),
    "Created notebook dev_nvim.md under dev",
  );
  assert.match(
    helpers.notebookCreateSuccessNotice({
      notebook: { path: "dev_nvim.md", parent: "dev" },
      warnings: ["notebook_summary_long: 150 characters"],
    }),
    /\(notebook_summary_long: 150 characters\)$/,
  );
});

// ---------------------------------------------------------------------------
// Create notebook here: command and modal
// ---------------------------------------------------------------------------

test("create-notebook-here is registered as a palette command without a default hotkey", () => {
  const plugin = new NavigationHotkeysPlugin();
  const commands = [];
  plugin.addCommand = (command) => commands.push(command);
  plugin.registerNotebookCreateCommand();
  assert.equal(commands.length, 1);
  assert.equal(commands[0].id, "create-notebook-here");
  assert.equal(commands[0].name, "Create notebook here");
  assert.equal(commands[0].hotkeys, undefined);
  assert.equal(typeof commands[0].callback, "function");
});

test("the command refuses outside an area, project, or notebook with a notice", () => {
  const vault = makeVault(NOTEBOOK_VAULT);
  const { plugin } = makePlugin(vault, "scratch.md");
  assert.equal(plugin.openNotebookCreate(), false);
  assert.match(notices.at(-1), /^scratch is not an area, project, or notebook/);
  assert.equal(plugin.activeNotebookCreateModal, null);
});

test("the command opens for an area, a project, and a notebook", () => {
  for (const path of ["dev.md", "ship.md", "dev_git.md"]) {
    const vault = makeVault(NOTEBOOK_VAULT);
    const { plugin } = makePlugin(vault, path);
    assert.equal(plugin.openNotebookCreate(), true, path);
    const modal = plugin.activeNotebookCreateModal;
    assert.ok(modal instanceof helpers.NotebookCreateModal, path);
    assert.equal(modal.parentPath, path);
    assert.equal(modal.parentStem, path.replace(/\.md$/, ""));
    modal.close();
    assert.equal(plugin.activeNotebookCreateModal, null);
  }
});

test("a second press focuses the open modal instead of stacking another", () => {
  const vault = makeVault(NOTEBOOK_VAULT);
  const { plugin } = makePlugin(vault, "dev.md");
  plugin.openNotebookCreate();
  const first = plugin.activeNotebookCreateModal;
  plugin.openNotebookCreate();
  assert.equal(plugin.activeNotebookCreateModal, first);
  first.close();
});

function openModal(plugin) {
  plugin.openNotebookCreate();
  const modal = plugin.activeNotebookCreateModal;
  return modal;
}

function type(input, value) {
  input.value = value;
  const handlers = (input._listeners && input._listeners.input) || [];
  for (const handler of handlers) {
    handler.call(input, { target: input });
  }
}

test("the modal requires a summary and pre-fills the ID from it until the ID is edited", () => {
  const vault = makeVault(NOTEBOOK_VAULT);
  const { plugin } = makePlugin(vault, "dev.md");
  const modal = openModal(plugin);
  assert.equal(modal.createButton.disabled, true);
  assert.equal(modal.idInput.value, "");
  assert.equal(collectText(modal.contentEl).includes("A new notebook under dev"), true);

  type(modal.summaryInput, "Neovim config notes and plugin picks");
  assert.equal(modal.idInput.value, "neovim-config-notes");
  assert.equal(modal.createButton.disabled, false);
  assert.equal(modal.previewEl.textContent, "Creates dev_neovim_config_notes.md");

  type(modal.summaryInput, "Git commands and workflow tips");
  assert.equal(modal.idInput.value, "git-commands-workflow");

  // Editing the ID stops it following the summary.
  type(modal.idInput, "mine");
  type(modal.summaryInput, "Something else entirely");
  assert.equal(modal.idInput.value, "mine");
  assert.equal(modal.previewEl.textContent, "Creates dev_mine.md");

  // An invalid ID disables Create and says why.
  type(modal.idInput, "bad id");
  assert.equal(modal.createButton.disabled, true);
  assert.match(modal.statusEl.textContent, /letters, digits, and -/);
  assert.ok(modal.statusEl.classes.includes("is-error"));

  // Clearing the summary disables Create again.
  type(modal.idInput, "mine");
  type(modal.summaryInput, "");
  assert.equal(modal.createButton.disabled, true);
  modal.close();
});

test("the modal's suggested ID avoids a notebook that already exists", () => {
  const vault = makeVault([
    ...NOTEBOOK_VAULT,
    { path: "dev_git_commands.md", frontmatter: NOTEBOOK_FM },
  ]);
  const { plugin } = makePlugin(vault, "dev.md");
  const modal = openModal(plugin);
  type(modal.summaryInput, "Git commands");
  assert.equal(modal.idInput.value, "git-commands-2");
  type(modal.idInput, "git-commands");
  assert.equal(modal.createButton.disabled, true);
  assert.match(modal.statusEl.textContent, /dev_git_commands\.md already exists/);
  modal.close();
});

function ledgerWith(create) {
  return { "bob-ledger-tools": { api: { notebooks: { version: 1, create } } } };
}

test("Enter creates through api.notebooks.create, opens the note, and closes", async () => {
  const calls = [];
  const vault = makeVault(NOTEBOOK_VAULT);
  const { plugin, opened } = makePlugin(vault, "dev.md", {
    plugins: ledgerWith(async (request) => {
      calls.push(request);
      vault.filesByPath.set("dev_neovim_config_notes.md", {
        path: "dev_neovim_config_notes.md",
        basename: "dev_neovim_config_notes",
        extension: "md",
      });
      return {
        ok: true,
        report: {
          notebook: {
            path: "dev_neovim_config_notes.md",
            stem: "dev_neovim_config_notes",
            parent: "dev",
          },
          warnings: [],
        },
      };
    }),
  });
  const modal = openModal(plugin);
  type(modal.summaryInput, "Neovim config notes and plugin picks");
  type(modal.titleInput, "Nvim");
  const event = pressKey(modal, "Enter");
  assert.equal(event.defaultPrevented, true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    {
      parent: "dev.md",
      id: "neovim-config-notes",
      summary: "Neovim config notes and plugin picks",
      title: "Nvim",
    },
  ]);
  assert.deepEqual(opened, ["dev_neovim_config_notes.md"]);
  assert.equal(notices.at(-1), "Created notebook dev_neovim_config_notes.md under dev");
  assert.equal(modal.isOpen, false);
  assert.equal(plugin.activeNotebookCreateModal, null);
});

test("a bob refusal shows one notice and leaves the modal open to fix it", async () => {
  const vault = makeVault(NOTEBOOK_VAULT);
  const { plugin, opened } = makePlugin(vault, "dev.md", {
    plugins: ledgerWith(async () => ({
      ok: false,
      code: "notebook_catalog_damaged",
      message: "dev.md has a damaged notebooks catalog",
      detail: "repair the fences by hand",
    })),
  });
  const modal = openModal(plugin);
  type(modal.summaryInput, "Neovim config notes");
  click(modal.createButton);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    notices.at(-1),
    "Can't create notebook: dev.md has a damaged notebooks catalog — repair the fences by hand",
  );
  assert.equal(modal.isOpen, true);
  assert.equal(modal.busy, false);
  assert.equal(modal.createButton.disabled, false);
  assert.deepEqual(opened, []);
  modal.close();
});

test("without Bob Ledger Tools the create refuses and writes nothing", async () => {
  const vault = makeVault(NOTEBOOK_VAULT);
  const { plugin } = makePlugin(vault, "dev.md");
  assert.equal(plugin.notebookLedgerApi(), null);
  const result = await plugin.commitNotebookCreate({
    parent: "dev.md",
    id: "nvim",
    summary: "x",
  });
  assert.equal(result.ok, false);
  assert.match(notices.at(-1), /Bob Ledger Tools is not running/);
});

test("a rejecting api surfaces a failure notice instead of throwing", async () => {
  const vault = makeVault(NOTEBOOK_VAULT);
  const { plugin } = makePlugin(vault, "dev.md", {
    plugins: ledgerWith(async () => {
      throw new Error("boom");
    }),
  });
  const result = await plugin.commitNotebookCreate({
    parent: "dev.md",
    id: "nvim",
    summary: "x",
  });
  assert.equal(result.ok, false);
  assert.equal(notices.at(-1), "Can't create notebook: bob notebooks create failed");
});

test("a created note that Obsidian has not indexed yet still reports success", async () => {
  const vault = makeVault(NOTEBOOK_VAULT);
  const { plugin, opened } = makePlugin(vault, "dev.md", {
    plugins: ledgerWith(async () => ({
      ok: true,
      report: {
        notebook: { path: "dev_slow.md", stem: "dev_slow", parent: "dev" },
        warnings: [],
      },
    })),
  });
  const result = await plugin.commitNotebookCreate({
    parent: "dev.md",
    id: "slow",
    summary: "Slow to index",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(opened, []);
  assert.equal(notices.at(-1), "Created dev_slow.md — open it once Obsidian has indexed it");
});
