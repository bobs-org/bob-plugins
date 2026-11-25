"use strict";
// Real-Obsidian project conversion: promote a scratch area task, reverse a
// prepared project, and refuse an invalid heading without writing.
const assert = require("node:assert/strict");

const TEMPLATE = [
  "---",
  'parent: "[[Engineering]]"',
  'template: "[[new_project]]"',
  'type: "[[project]]"',
  "status: wip",
  "created: 2026-11-25T12:00:00Z",
  "---",
  "- [ ] #task #prj (REPLACE WITH PROJECT COMPLETION CRITERIA) #hide ^prj",
  "",
  "## Tasks",
  "",
  "- [ ] #task (REPLACE WITH TASK DESCRIPTION)  [created::2026-11-25]",
  "",
].join("\n");

const AREA = [
  "---",
  'type: "[[area]]"',
  "---",
  "# Engineering",
  "",
  "## Tasks",
  "",
  "- [ ] #task Ship drawers ^ship",
  "\t- **API Design**",
  "\t\t- Review the endpoint",
  "\t- **API  Design**",
  "\t\t- Preserve the authored spacing",
  "\t- **C++ Notes**",
  "\t\t- Keep the ABI",
  "\t- **Q1: Goals**",
  "\t\t- Name the milestone",
  "\t- **Café**",
  "\t\t- Order cards",
  "\t- **Empty**",
  "",
].join("\n");

const PROJECT = [
  "---",
  'parent: "[[Engineering]]"',
  'template: "[[new_project]]"',
  'type: "[[project]]"',
  "status: wip",
  "created: 2026-11-25T12:00:00Z",
  "---",
  "",
  "- [ ] #task #prj Reverse drawers #hide ^prj",
  "",
  "## Tasks",
  "",
  "- [ ] #task Keep going [created::2026-11-25]",
  "",
  "## API Design",
  "",
  "- Review the endpoint",
  "",
  "## API  Design",
  "",
  "- Preserve the authored spacing",
  "",
  "## C++ Notes",
  "",
  "- Keep the ABI",
  "",
  "## Q1: Goals",
  "",
  "- Name the milestone",
  "",
  "## Café",
  "",
  "- Order cards",
  "",
  "## Empty",
  "",
].join("\n");

const REFUSAL_PROJECT = [
  "---",
  'parent: "[[Engineering]]"',
  'template: "[[new_project]]"',
  'type: "[[project]]"',
  "status: wip",
  "created: 2026-11-25T12:00:00Z",
  "---",
  "",
  "- [ ] #task #prj Broken heading #hide ^prj",
  "",
  "## Tasks",
  "",
  "- [ ] #task Keep [created::2026-11-25]",
  "",
  "## Options:",
  "",
  "- Something",
  "",
].join("\n");

const CASES = [
  { name: "promote bold drawers and an empty section" },
  { name: "reverse bold headings to verbatim drawers" },
  { name: "named refusal leaves every file untouched" },
];

const COMMAND = "bob-navigation-hotkeys:create-project-note-from-task";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureFile(client, vaultPath, contents) {
  return client.evaluate(
    `(async () => {
      const path = ${JSON.stringify(vaultPath)};
      const contents = ${JSON.stringify(contents)};
      const existing = window.app.vault.getAbstractFileByPath(path);
      if (existing) {
        await window.app.vault.modify(existing, contents);
        return { ok: true, existed: true };
      }
      const slash = path.lastIndexOf("/");
      if (slash > 0) {
        const folder = path.slice(0, slash);
        if (!window.app.vault.getAbstractFileByPath(folder)) {
          await window.app.vault.createFolder(folder);
        }
      }
      await window.app.vault.create(path, contents);
      return { ok: true, existed: false };
    })()`,
  );
}

async function stubTemplater(client) {
  return client.evaluate(`(() => {
    const nav = window.app.plugins.plugins["bob-navigation-hotkeys"];
    if (!nav) return { ok: false, reason: "nav missing" };
    nav.getTemplaterPlugin = () => ({
      templater: {
        create_new_note_from_template: async (templateFile, _folder, basename) => {
          const raw = await window.app.vault.read(templateFile);
          const name = String(basename || "project").replace(/\\.md$/i, "");
          return window.app.vault.create(name + ".md", raw);
        },
      },
    });
    return { ok: true };
  })()`);
}

async function openPath(client, vaultPath, caret) {
  const opened = await client.evaluate(
    `(async () => {
      const path = ${JSON.stringify(vaultPath)};
      const file = window.app.vault.getAbstractFileByPath(path);
      if (!file) return { ok: false, reason: "missing " + path };
      const leaf = window.app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: { mode: "source", source: true } });
      window.app.workspace.setActiveLeaf(leaf, { focus: true });
      const view = leaf.view;
      if (view && view.editor && view.editor.focus) view.editor.focus();
      if (view && view.editor) view.editor.setCursor({ line: ${caret[0]}, ch: ${caret[1]} });
      return { ok: !!(view && view.editor), path: view && view.file && view.file.path };
    })()`,
  );
  if (!opened || !opened.ok) throw new Error("could not open " + vaultPath + ": " + JSON.stringify(opened));
  await pause(500);
}

async function waitCache(client, vaultPath, waitFor) {
  await waitFor(
    client,
    `(() => { const f = window.app.vault.getAbstractFileByPath(${JSON.stringify(vaultPath)}); const c = f && window.app.metadataCache.getFileCache(f); return Boolean(c && c.frontmatter); })()`,
    Boolean,
    vaultPath + " cache",
    15000,
  );
}

async function runCommand(client) {
  // executeCommandById returns a boolean and does not await an async
  // editorCallback. Fire the mixin method on the page and poll: awaiting
  // the promise over CDP races reversal, which trashes the active file
  // ("Promise was collected").
  const started = await client.evaluate(`(() => {
    const nav = window.app.plugins.plugins["bob-navigation-hotkeys"];
    const view = window.app.workspace.activeLeaf && window.app.workspace.activeLeaf.view;
    const editor = view && view.editor;
    if (!nav || !editor || typeof nav.createProjectNoteFromTask !== "function") {
      return { ok: false, reason: "nav or editor missing" };
    }
    window.__bobDrawerConversion = { done: false, result: null, error: null };
    Promise.resolve(nav.createProjectNoteFromTask(editor, view)).then(
      (result) => {
        window.__bobDrawerConversion.done = true;
        window.__bobDrawerConversion.result = result;
      },
      (error) => {
        window.__bobDrawerConversion.done = true;
        window.__bobDrawerConversion.error = String(error && error.message ? error.message : error);
      },
    );
    return { ok: true };
  })()`);
  if (!started || started.ok !== true) return started;
  const deadline = Date.now() + 20000;
  let last = null;
  while (Date.now() < deadline) {
    last = await client.evaluate(`window.__bobDrawerConversion || null`).catch((error) => ({ error: String(error) }));
    if (last && last.done) return { ok: last.result !== false, result: last.result, error: last.error || null };
    await pause(200);
  }
  return { ok: false, reason: "conversion timed out", last };
}

async function vaultSnapshot(client) {
  return client.evaluate(`(async () => {
    const files = window.app.vault.getMarkdownFiles().map((file) => file.path).sort();
    const notices = Array.from(document.querySelectorAll(".notice")).map((el) => el.textContent);
    const contents = {};
    for (const path of files) {
      const file = window.app.vault.getAbstractFileByPath(path);
      contents[path] = await window.app.vault.read(file);
    }
    return { files, notices, contents };
  })()`);
}

function assertTitles(content, label) {
  for (const title of ["API Design", "API  Design", "C++ Notes", "Q1: Goals", "Café", "Empty"]) {
    assert.ok(content.includes("## " + title), label + " missing ## " + title);
  }
  assert.ok(content.includes("- Review the endpoint"), label + " missing API Design note");
  assert.ok(/## Empty\s*$/m.test(content) || content.includes("## Empty\n\n##") || /## Empty\n\s*\n/.test(content),
    label + " missing empty section");
}

async function runPromote(client, helpers) {
  await ensureFile(client, "_templates/new_project.md", TEMPLATE);
  await ensureFile(client, "Engineering.md", AREA);
  await waitCache(client, "Engineering.md", helpers.waitFor);
  const stub = await stubTemplater(client);
  assert.equal(stub && stub.ok, true, "templater stub");
  await openPath(client, "Engineering.md", [7, 8]);
  const before = await vaultSnapshot(client);
  const command = await runCommand(client);
  const after = await vaultSnapshot(client);
  const ignore = new Set(["Engineering.md", "task-reqs-fixture.md", "_templates/new_project.md"]);
  const created = after.files.find((name) => !ignore.has(name) && !name.startsWith(".trash/")
    && !before.files.includes(name));
  assert.ok(created, "promotion did not create a project note: " + after.files.join(", ")
    + " notices=" + JSON.stringify(after.notices) + " command=" + JSON.stringify(command));
  const body = after.contents[created];
  assertTitles(body, created);
  assert.ok(body.includes("#prj"), "seeded ^prj task");
  assert.ok(!after.contents["Engineering.md"].includes("^ship"), "source task should leave the area");
}

async function runReverse(client, helpers) {
  await ensureFile(client, "Engineering.md", [
    "---",
    'type: "[[area]]"',
    "---",
    "# Engineering",
    "",
    "## Tasks",
    "",
  ].join("\n"));
  await ensureFile(client, "Ship.md", PROJECT);
  await waitCache(client, "Engineering.md", helpers.waitFor);
  await waitCache(client, "Ship.md", helpers.waitFor);
  await stubTemplater(client);
  await openPath(client, "Ship.md", [8, 8]);
  const command = await runCommand(client);
  const after = await vaultSnapshot(client);
  const parent = after.contents["Engineering.md"];
  assert.ok(parent.includes("- **API Design**"), parent);
  assert.ok(parent.includes("- **API  Design**"), parent);
  assert.ok(parent.includes("- **C++ Notes**"), parent);
  assert.ok(parent.includes("- **Q1: Goals**"), parent);
  assert.ok(parent.includes("- **Café**"), parent);
  assert.ok(parent.includes("- **Empty**"), parent);
  assert.ok(!parent.includes("## API Design"), "reversed drawers must not remain as headings");
  const markdown = after.files.filter((name) => !name.startsWith(".trash/"));
  assert.equal(markdown.includes("Ship.md"), false, "reversal should trash the project note; notices="
    + JSON.stringify(after.notices) + " command=" + JSON.stringify(command)
    + " files=" + after.files.join(", "));
}

async function runRefusal(client, helpers) {
  await ensureFile(client, "Engineering.md", [
    "---",
    'type: "[[area]]"',
    "---",
    "# Engineering",
    "",
    "## Tasks",
    "",
  ].join("\n"));
  await ensureFile(client, "Broken.md", REFUSAL_PROJECT);
  await waitCache(client, "Broken.md", helpers.waitFor);
  await stubTemplater(client);
  await openPath(client, "Broken.md", [8, 8]);
  const before = await vaultSnapshot(client);
  const command = await runCommand(client);
  const after = await vaultSnapshot(client);
  assert.deepEqual(after.files, before.files, "refusal must not create or trash files");
  assert.equal(after.contents["Broken.md"], before.contents["Broken.md"]);
  assert.equal(after.contents["Engineering.md"], before.contents["Engineering.md"]);
  assert.ok(
    after.notices.some((text) => /not_a_drawer_title|Options:|cannot be converted/i.test(text)),
    "refusal notice missing: " + JSON.stringify(after.notices) + " command=" + JSON.stringify(command),
  );
}

async function run(client, entry, helpers) {
  // /tmp scratch vaults cannot use the system trash (gio fails on internal
  // mounts). Local vault trash lets reversal delete the project note.
  await client.evaluate(`(() => { window.app.vault.setConfig("trashOption", "local"); return true; })()`);
  if (entry.name === CASES[0].name) return runPromote(client, helpers);
  if (entry.name === CASES[1].name) return runReverse(client, helpers);
  if (entry.name === CASES[2].name) return runRefusal(client, helpers);
  throw new Error("unknown conversion case: " + entry.name);
}

module.exports = { CASES, TEMPLATE, AREA, PROJECT, REFUSAL_PROJECT, run };
