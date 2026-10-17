const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  NavigationHotkeysPlugin,
  helpers,
  notices,
} = require("./navigation-hotkeys-harness.cjs");

const BASE = "/vault";

function makeHarness(content, options = {}) {
  const files = new Map();
  const addFile = (filePath, body = "", frontmatter = {}) => {
    const file = {
      path: filePath,
      extension: path.extname(filePath).slice(1).toLowerCase(),
      content: body,
    };
    files.set(filePath, { file, body, frontmatter });
    return file;
  };
  const currentPath = options.currentPath || "sase.md";
  const currentFile = addFile(
    currentPath,
    content,
    options.currentFrontmatter || {},
  );
  for (const entry of options.files || []) {
    addFile(entry.path, entry.content, entry.frontmatter);
  }

  const editorElement = {};
  const bodyElement = {};
  const activeElement = options.focusOutside
    ? { closest: () => null }
    : options.focusBody
      ? bodyElement
      : { closest: () => editorElement };
  const view = {
    file: currentFile,
    editor: {
      getValue: () => content,
      getCursor: () => ({ line: options.line || 0, ch: 0 }),
      replaceRange() {
        throw new Error("The PDF key must never write the editor");
      },
    },
    getMode: () => options.mode || "source",
    containerEl: {
      ownerDocument: { activeElement, body: bodyElement },
      contains: (element) => element === editorElement,
    },
  };
  const delegates = [];
  const launches = [];
  const pdfs = new Set(options.pdfs || ["lib/chat/x.pdf"]);
  for (const pdfPath of pdfs) {
    if (!files.has(pdfPath)) {
      addFile(pdfPath);
    }
  }
  const plugin = Object.create(NavigationHotkeysPlugin.prototype);
  plugin.app = {
    workspace: { getActiveViewOfType: () => options.noView ? null : view },
    commands: {
      executeCommandById: (id) => delegates.push(id),
    },
    metadataCache: {
      getFileCache: (file) => {
        const entry = file && files.get(file.path);
        return entry ? { frontmatter: entry.frontmatter } : null;
      },
    },
    vault: {
      adapter: {
        exists: async (filePath) => pdfs.has(filePath),
        getBasePath: () => BASE,
      },
      getAbstractFileByPath: (filePath) =>
        (files.get(filePath) || {}).file || null,
      cachedRead: async (file) => {
        const entry = file && files.get(file.path);
        return entry ? entry.body : null;
      },
      modify() {
        throw new Error("The PDF key must never modify the vault");
      },
      process() {
        throw new Error("The PDF key must never process the vault");
      },
    },
  };
  plugin.isMarkdownFile = (file) => Boolean(file && file.extension === "md");
  plugin.getVaultBasePath = () => BASE;
  plugin.resolveLinkTargetFile = (target, sourcePath) => {
    const targetPath = String(target || "").split("#", 1)[0].trim();
    if (!targetPath) {
      return (files.get(sourcePath) || {}).file || null;
    }
    const candidates = [targetPath, `${targetPath}.md`];
    return candidates
      .map((candidate) => (files.get(candidate) || {}).file)
      .find(Boolean) || null;
  };
  plugin.readLinkPickerNoteContent = async (filePath, file) => {
    const entry = files.get(filePath || (file && file.path));
    return entry ? entry.body : null;
  };
  const execFile = (executable, args, execOptions, callback) => {
    launches.push({ executable, args: [...args], options: execOptions });
    const outcome = (options.execOutcomes || [])[launches.length - 1] || {};
    queueMicrotask(() =>
      callback(outcome.error || null, "", outcome.stderr || ""),
    );
  };
  const openReferencePdfPath = plugin.openReferencePdfPath.bind(plugin);
  plugin.openReferencePdfPath = (filePath) =>
    openReferencePdfPath(filePath, {
      execFile,
      isMacOS: options.isMacOS !== false,
      basePath: BASE,
      exists: async (vaultPath) => pdfs.has(vaultPath),
    });

  return { plugin, view, files, currentFile, delegates, launches };
}

async function trigger(plugin) {
  await plugin.openReferencePdfInHighlightsOrLink();
}

function resetNotices() {
  notices.length = 0;
}

function v2Files(source = "lib/chat/x.pdf") {
  return [
    {
      path: "ref/chat/x.md",
      content: "# Reference",
      frontmatter: { source_pdf: source },
    },
  ];
}

test("v2 reading task opens its source_pdf in Highlights without writes", async () => {
  resetNotices();
  const harness = makeHarness(
    "- [/] #task #ref [[ref/chat/x|project stats]] ^ref-x",
    { files: v2Files() },
  );
  await trigger(harness.plugin);
  assert.deepEqual(harness.launches.map((call) => call.executable), [
    "/usr/bin/open",
  ]);
  assert.deepEqual(harness.launches[0].args, [
    "-b",
    "net.highlightsapp.universal",
    `${BASE}/lib/chat/x.pdf`,
  ]);
  assert.deepEqual(notices, ["Opened x.pdf in Highlights"]);
  assert.deepEqual(harness.delegates, []);
});

test("every reading-task lane and #REF casing opens", async () => {
  for (const mark of [" ", "*", "?", "x", "-"]) {
    resetNotices();
    const harness = makeHarness(
      `- [${mark}] #task #REF [[ref/chat/x]] ^ref-x`,
      { files: v2Files() },
    );
    await trigger(harness.plugin);
    assert.equal(harness.launches.length, 1, `[${mark}] should open`);
    assert.deepEqual(harness.delegates, []);
  }
});

test("v1 tracker resolves a PDF link or falls back to its own source_pdf", async () => {
  for (const [line, frontmatter] of [
    ["- [ ] #task #ref [[lib/chat/x.pdf]] #hide ^ref", {}],
    ["- [ ] #task #ref #hide ^ref", { source_pdf: "lib/chat/x.pdf" }],
  ]) {
    resetNotices();
    const harness = makeHarness(line, {
      currentPath: "ref/chat/x.md",
      currentFrontmatter: frontmatter,
      files: line.includes("lib/chat/x.pdf") ? [{ path: "lib/chat/x.pdf" }] : [],
    });
    await trigger(harness.plugin);
    assert.equal(harness.launches.length, 1);
    assert.deepEqual(harness.delegates, []);
  }
});

test("plain, embedded, struck, and 🍅 Task Links resolve reading tasks", async () => {
  for (const link of [
    "- [[sase#^ref-x]]",
    "- ![[sase#^ref-x]]",
    "- ~~[[sase#^ref-x]]~~",
    "- 🍅 [[sase#^ref-x]]",
  ]) {
    resetNotices();
    const harness = makeHarness(link, {
      files: [
        {
          path: "sase.md",
          content: "- [?] #task #ref [[ref/chat/x]] ^ref-x",
        },
        ...v2Files(),
      ],
    });
    await trigger(harness.plugin);
    assert.equal(harness.launches.length, 1, link);
    assert.deepEqual(harness.delegates, []);
  }
});

test("bare managed embed in a reference note resolves its embedded task", async () => {
  resetNotices();
  const harness = makeHarness("![[sase#^ref-x]]", {
    currentPath: "ref/chat/x.md",
    currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
    files: [
      {
        path: "sase.md",
        content: "- [x] #task #ref [[ref/chat/x]] ^ref-x",
      },
      ...v2Files(),
    ],
  });
  await trigger(harness.plugin);
  assert.equal(harness.launches.length, 1);
  assert.deepEqual(harness.delegates, []);
});

test("ordinary lines, unresolved Task Links, fences, and outside focus delegate once", async () => {
  const cases = [
    { content: "- [ ] #task Write docs" },
    { content: "prose [[ref/chat/x]]" },
    { content: "## Heading" },
    {
      content: "- [[sase#^ordinary]]",
      files: [{ path: "sase.md", content: "- [ ] #task Ordinary ^ordinary" }],
    },
    { content: "- [[sase#^missing]]", files: [{ path: "sase.md", content: "" }] },
    { content: "```md\n- [ ] #task #ref [[ref/chat/x]]\n```", line: 1 },
    { content: "- [ ] #task #ref [[ref/chat/x]]", focusOutside: true },
  ];
  for (const item of cases) {
    resetNotices();
    const harness = makeHarness(item.content, item);
    await trigger(harness.plugin);
    assert.deepEqual(harness.delegates, [
      "editor:open-link-in-new-leaf",
    ]);
    assert.deepEqual(harness.launches, []);
  }
});

test("identified reading tasks show notices without delegating", async () => {
  const cases = [
    {
      content: "- [ ] #task #ref [[ref/chat/legacy]]",
      files: [{ path: "ref/chat/legacy.md", content: "# Legacy" }],
      notice: "ref/chat/legacy.md has no source_pdf (legacy reference)",
    },
    {
      content: "- [ ] #task #ref [[not-in-vault]]",
      notice: "Reading task links no reference PDF",
    },
    {
      content: "- [ ] #task #ref [[ref/chat/x]]",
      files: v2Files(),
      pdfs: [],
      notice: "Reference PDF not found: lib/chat/x.pdf",
    },
  ];
  for (const item of cases) {
    resetNotices();
    const harness = makeHarness(item.content, item);
    await trigger(harness.plugin);
    assert.deepEqual(harness.delegates, []);
    assert.deepEqual(harness.launches, []);
    assert.equal(notices.at(-1), item.notice);
  }
});

test("unsafe source_pdf values are refused", async () => {
  for (const unsafe of ["../x.pdf", "/abs/x.pdf", "ref/x.md"]) {
    resetNotices();
    const harness = makeHarness("# prose");
    assert.equal(
      await harness.plugin.openReferencePdfPath(unsafe, {
        isMacOS: true,
        basePath: BASE,
        exists: async () => true,
        execFile: () => assert.fail("unsafe PDF path launched"),
      }),
      false,
    );
    assert.equal(notices.at(-1), `Unsafe source_pdf: ${unsafe}`);
  }
});

test("bundle launch retries with the app name, and reports stderr on total failure", async () => {
  resetNotices();
  const retry = makeHarness("# prose", {
    execOutcomes: [
      { error: new Error("bundle missing"), stderr: "first failed\nmore" },
      {},
    ],
  });
  await retry.plugin.openReferencePdfPath("lib/chat/x.pdf");
  assert.deepEqual(retry.launches.map((call) => call.args), [
    ["-b", "net.highlightsapp.universal", `${BASE}/lib/chat/x.pdf`],
    ["-a", "Highlights", `${BASE}/lib/chat/x.pdf`],
  ]);
  assert.equal(notices.at(-1), "Opened x.pdf in Highlights");

  resetNotices();
  const failed = makeHarness("# prose", {
    execOutcomes: [
      { error: new Error("bundle failed"), stderr: "specific stderr\nextra" },
      { error: new Error("fallback failed") },
    ],
  });
  await failed.plugin.openReferencePdfPath("lib/chat/x.pdf");
  assert.equal(failed.launches.length, 2);
  assert.match(notices.at(-1), /Could not open x\.pdf in Highlights: specific stderr/);
});

test("off macOS shows the selected notice and managed ref-note prose delegates", async () => {
  resetNotices();
  const harness = makeHarness("- [ ] #task #ref [[ref/chat/x]]", {
    files: v2Files(),
    isMacOS: false,
  });
  await trigger(harness.plugin);
  assert.deepEqual(harness.delegates, []);
  assert.equal(notices.at(-1), "Highlights is macOS-only: lib/chat/x.pdf");
  assert.deepEqual(harness.launches, []);

  resetNotices();
  const prose = makeHarness("# Reference", {
    currentPath: "ref/chat/x.md",
    currentFrontmatter: { source_pdf: "lib/chat/x.pdf" },
  });
  await trigger(prose.plugin);
  assert.deepEqual(prose.delegates, ["editor:open-link-in-new-leaf"]);
  assert.deepEqual(prose.launches, []);
});

test("pure helpers normalize and parse reference PDF paths", () => {
  assert.deepEqual(helpers.parseRefPdfBlockLinkLine("- 🍅 [[sase#^ref-x]]"), {
    target: "sase",
    blockId: "ref-x",
  });
  assert.deepEqual(helpers.parseRefPdfBlockLinkLine("![[sase#^ref-x|Read]]"), {
    target: "sase",
    blockId: "ref-x",
  });
  assert.equal(helpers.parseRefPdfBlockLinkLine("prose [[sase#^ref-x]]"), null);
  assert.equal(helpers.normalizeRefSourcePdfPath("./lib\\chat\\x.PDF"), "lib/chat/x.PDF");
  assert.equal(helpers.normalizeRefSourcePdfPath("a/../x.pdf"), null);
  assert.deepEqual(helpers.buildHighlightsOpenAttempts(`${BASE}/lib/x.pdf`), [
    ["-b", "net.highlightsapp.universal", `${BASE}/lib/x.pdf`],
    ["-a", "Highlights", `${BASE}/lib/x.pdf`],
  ]);
});

test("command registration is custom-hotkey only", () => {
  const sourcePath = path.join(
    __dirname,
    "../plugins/bob-navigation-hotkeys/src/490-plugin-lifecycle.js",
  );
  const source = fs.readFileSync(sourcePath, "utf8");
  const start = source.indexOf('id: "open-reference-pdf-in-highlights"');
  assert.notEqual(start, -1);
  const command = source.slice(start, source.indexOf("    });", start));
  assert.match(command, /name: "Open reference PDF in Highlights \(or link in new tab\)"/);
  assert.match(command, /callback: \(\) => void this\.openReferencePdfInHighlightsOrLink\(\)/);
  assert.doesNotMatch(command, /hotkeys:/);
});
