const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NavigationHotkeysPlugin,
  helpers,
  notices,
} = require("./navigation-hotkeys-harness.cjs");

function makeRenamePlugin(path, frontmatter) {
  const file = { path };
  const calls = [];
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = {
    workspace: { getActiveFile: () => file },
    metadataCache: { getFileCache: () => ({ frontmatter }) },
    vault: { getAbstractFileByPath: () => null },
    fileManager: {
      renameFile: async (renamedFile, newPath) => {
        calls.push({ file: renamedFile, newPath });
      },
    },
  };
  return { plugin, file, calls };
}

test("managed reference rename modal and submit are refused", async () => {
  notices.length = 0;
  const { plugin, calls } = makeRenamePlugin("ref/blogs/article.md", {
    source_pdf: "lib/blogs/article.pdf",
  });

  plugin.openRenameCurrentFileModal();
  assert.match(notices.at(-1), /Managed reference note/);
  assert.match(notices.at(-1), /bob ref rename ref\/blogs\/article\.md <new-name>/);

  assert.equal(await plugin.renameCurrentFileToName("renamed"), false);
  assert.equal(calls.length, 0);
  assert.match(notices.at(-1), /PDF, reading task, and links move together/);
});

test("legacy ref notes and non-ref notes still rename", async () => {
  for (const [path, frontmatter] of [
    ["ref/blogs/legacy.md", {}],
    ["notes/ordinary.md", { source_pdf: "lib/blogs/ordinary.pdf" }],
  ]) {
    notices.length = 0;
    const { plugin, calls } = makeRenamePlugin(path, frontmatter);
    assert.equal(await plugin.renameCurrentFileToName("renamed"), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].newPath, path.replace(/[^/]+$/, "renamed.md"));
    assert.doesNotMatch(notices.at(-1), /Managed reference note/);
  }
});

test("managed reference predicate checks path and non-empty source_pdf", () => {
  const { isManagedRefNote } = helpers;
  assert.equal(
    isManagedRefNote("ref/blogs/article.md", { source_pdf: "lib/a.pdf" }),
    true,
  );
  assert.equal(
    isManagedRefNote("ref\\blogs\\article.md", { source_pdf: " lib/a.pdf " }),
    true,
  );
  assert.equal(isManagedRefNote("ref/blogs/legacy.md", {}), false);
  assert.equal(
    isManagedRefNote("ref/blogs/empty.md", { source_pdf: "  " }),
    false,
  );
  assert.equal(
    isManagedRefNote("notes/article.md", { source_pdf: "lib/a.pdf" }),
    false,
  );
  assert.equal(
    isManagedRefNote("ref/blogs/article.pdf", { source_pdf: "lib/a.pdf" }),
    false,
  );
  assert.equal(isManagedRefNote(null, { source_pdf: "lib/a.pdf" }), false);
});
