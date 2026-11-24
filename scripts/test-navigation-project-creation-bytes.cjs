const test = require("node:test");
const assert = require("node:assert/strict");
const {
  notices, NavigationHotkeysPlugin, TransactionEditor,
} = require("./navigation-hotkeys-harness.cjs");

function harness(content, { editor = false, type = "[[project]]" } = {}) {
  const plugin = new NavigationHotkeysPlugin();
  const file = { path: "new.md", extension: "md" };
  const buffer = editor ? new TransactionEditor(content, { line: 0, ch: 0 }) : null;
  let disk = content;
  let writes = 0;
  plugin.getTemplaterPlugin = () => ({ templater: {
    create_new_note_from_template: async () => file,
  } });
  plugin.getNoteTemplateFile = () => ({ path: "_templates/new_project.md" });
  plugin.isMarkdownFile = (f) => f?.extension === "md";
  plugin.getFrontmatterWikiLinkToFile = () => "[[Parent]]";
  plugin.getOpenMarkdownEditorForPath = () => buffer;
  plugin.app = {
    metadataCache: { getFileCache: () => ({ frontmatter: { type } }) },
    fileManager: { processFrontMatter: () => assert.fail("No YAML serializer") },
    vault: {
      getRoot: () => "",
      process: async (_file, fn) => { writes += 1; disk = fn(disk); },
    },
  };
  return { plugin, file, content: () => buffer ? buffer.getValue() : disk, writes: () => writes };
}

for (const editor of [false, true]) {
  for (const ending of ["\n", "\r\n"]) {
    test(`creation preserves template bytes: editor=${editor}, ${JSON.stringify(ending)}`, async () => {
      const before = ["---", "# authored comment", "type: '[[project]]'", "parent: '[[old]]' # home",
        "status: wip # template owns this", "created: 2026-11-24 09:00", "names: [one, two]",
        "custom: |", "  exact text", "---", "", "- [ ] #task #prj Goal #hide ^prj", ""].join(ending);
      const h = harness(before, { editor });
      assert.equal(await h.plugin.createProjectNoteFile({}, "new"), h.file);
      assert.equal(h.content(), before.replace("parent: '[[old]]'", 'parent: "[[Parent]]"'));
      assert.equal(h.writes(), editor ? 0 : 1);
    });
  }
}

test("creation warns on missing type without adding type, status, or schedule", async () => {
  const before = "---\ncreated: 'original'\n---\nBody\n";
  const h = harness(before, { type: undefined });
  // Explicitly model the not-yet-populated metadata cache.
  h.plugin.app.metadataCache.getFileCache = () => null;
  notices.length = 0;
  assert.equal(await h.plugin.createProjectNoteFile({}, "new"), h.file);
  assert.equal(h.content(), before.replace("---\n", '---\nparent: "[[Parent]]"\n'));
  assert.ok(notices.some((notice) => String(notice).includes("Project template")));
});

test("creation refuses damaged parent frontmatter without changing the template", async () => {
  for (const before of ["---\nparent: old\n", "---\nparent: a\nparent: b\n---\nbody"]) {
    const h = harness(before);
    assert.equal(await h.plugin.createProjectNoteFile({}, "new"), null);
    assert.equal(h.content(), before);
  }
});
