// Tree-index budgets (bob-cli-ra engine): the index build takes at most
// 30 ms best-of-5 CPU for 8,000 synthetic files, and a warm resolve does
// no vault scan. Wall-clock hrtime charges scheduler preemption; CPU time
// matches the other plugin perf tests.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const {
  cpuBudgetDiagnostic,
  isWithinCpuBudget,
  sampleCpuWork,
} = require("./cpu-work-perf-support.cjs");

class TestPlugin {
  constructor(app) { this.app = app; }
}

const originalLoad = Module._load;
Module._load = function loadObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      Notice: class { constructor() {} },
      Platform: { isDesktopApp: false },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {}, keymap: { of: (value) => value } };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let LedgerToolsPlugin;
try {
  LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
} finally {
  Module._load = originalLoad;
}

const FILE_COUNT = 8000;
const BUILD_BUDGET_MS = 30;

function makeIndexApp(count) {
  const files = [
    { path: "area.md" },
    { path: "project.md" },
  ];
  const caches = new Map([
    ["area.md", { frontmatter: {} }],
    ["project.md", { frontmatter: {} }],
  ]);
  const add = (path, cache) => {
    files.push({ path });
    caches.set(path, cache);
  };
  // Tree members (~2,500): areas, projects in open and closed lanes,
  // notebooks with H1/alias/stem titles, and prose with title/alias stems.
  // The rest is ordinary vault contents (period notes, records, refs,
  // excluded paths, untyped notes): none joins the walk, but all of it
  // passes through membership filtering, so the build measures vault
  // scale rather than a members-only worst case.
  const areaCount = 250;
  for (let index = 0; index < areaCount; index += 1) {
    const parent = index % 6 === 5 ? "[[areas/a" + (index - 5) + "]]" : "[[area]]";
    add("areas/a" + index + ".md", { frontmatter: { type: "[[area]]", parent } });
  }
  for (let index = 0; index < 800; index += 1) {
    const group = index % 150;
    const parent = group % 5 === 4 ? "[[project]]" : "[[areas/a" + (group % areaCount) + "]]";
    const path = "projects/p" + index + ".md";
    const frontmatter = { type: "[[project]]", parent };
    if (index % 2 === 0) {
      add(path, {
        frontmatter,
        blocks: { prj: { position: { start: { line: 0 } } } },
        listItems: [{ position: { start: { line: 0 } }, task: "x" }],
      });
    } else {
      add(path, { frontmatter });
    }
  }
  // One deep chain exercises outline keys up to 10 hops.
  for (let depth = 0; depth < 10; depth += 1) {
    const parent = depth === 0 ? "[[areas/a0]]" : "[[chain/c" + (depth - 1) + "]]";
    add("chain/c" + depth + ".md", { frontmatter: { type: "[[project]]", parent } });
  }
  for (let index = 0; index < 600; index += 1) {
    const group = index % 150;
    const parent = group % 3 === 0
      ? "[[areas/a" + (group % areaCount) + "]]"
      : group % 3 === 1
        ? "[[projects/p" + group + "]]"
        : "[[notes/n" + (group % 600) + "]]";
    const path = "notes/n" + index + ".md";
    const mode = index % 5;
    if (mode < 3) {
      add(path, {
        frontmatter: { type: "[[notebook]]", parent },
        headings: [{ heading: "Note " + index, level: 1 }],
      });
    } else if (mode === 3) {
      add(path, { frontmatter: { type: "[[notebook]]", parent, aliases: ["Alias " + index] } });
    } else {
      add(path, { frontmatter: { type: "[[notebook]]", parent } });
    }
  }
  for (let index = 0; index < 400; index += 1) {
    const group = index % 150;
    const path = "prose/e" + index + ".md";
    const parent = "[[areas/a" + (group % areaCount) + "]]";
    const mode = index % 4;
    if (mode === 0) {
      add(path, { frontmatter: { type: "[[prose]]", parent, title: "Essay " + index } });
    } else if (mode === 1) {
      add(path, { frontmatter: { type: "[[prose]]", parent, aliases: ["Prose alias " + index] } });
    } else if (mode === 2) {
      add(path, { frontmatter: { type: "[[article]]", parent } });
    } else {
      add(path, { frontmatter: { type: "[[prose]]", parent } });
    }
  }
  let remaining = count - files.length;
  const take = (wanted) => Math.max(0, Math.min(wanted, remaining));
  const days = take(1400);
  remaining -= days;
  const epoch = Date.UTC(2020, 0, 1);
  for (let index = 0; index < days; index += 1) {
    const date = new Date(epoch + index * 86400000);
    const year = date.getUTCFullYear();
    const stamp = year + String(date.getUTCMonth() + 1).padStart(2, "0") + String(date.getUTCDate()).padStart(2, "0");
    add(year + "/" + stamp + ".md", { frontmatter: {} });
  }
  const weeks = take(300);
  remaining -= weeks;
  for (let index = 0; index < weeks; index += 1) {
    const year = 2020 + (index % 9);
    add(year + "/" + year + "-W" + String(1 + (index % 52)).padStart(2, "0") + ".md", { frontmatter: {} });
  }
  const periods = take(60);
  remaining -= periods;
  for (let index = 0; index < periods; index += 1) {
    if (index === 0) add("all_time.md", { frontmatter: {} });
    else if (index % 3 === 1) add((2030 + index) + ".md", { frontmatter: {} });
    else if (index % 3 === 2) add("2031/2031-Q" + (1 + (index % 4)) + ".md", { frontmatter: {} });
    else add("2032/2032-W" + String(1 + (index % 52)).padStart(2, "0") + ".md", { frontmatter: {} });
  }
  const typed = take(800);
  remaining -= typed;
  for (let index = 0; index < typed; index += 1) {
    const mode = index % 4;
    if (mode === 0) add("records/r" + index + ".md", { frontmatter: { type: "[[record]]" } });
    else if (mode === 1) add("albums/b" + index + ".md", { frontmatter: { type: "[[album]]" } });
    else if (mode === 2) add("ref/r" + index + ".md", { frontmatter: { type: "[[ref]]" } });
    else add("notes/stray" + index + ".md", { frontmatter: { type: "[[ref]]" } });
  }
  const excluded = take(600);
  remaining -= excluded;
  for (let index = 0; index < excluded; index += 1) {
    const mode = index % 6;
    if (mode === 0) add("done/old" + index + ".md", { frontmatter: { type: "[[project]]", parent: "[[areas/a0]]" } });
    else if (mode === 1) add("_templates/t" + index + ".md", { frontmatter: {} });
    else if (mode === 2) add("work/_conflicts/c" + index + ".md", { frontmatter: {} });
    else if (mode === 3 && index === 3) add("bank.md", { frontmatter: {} });
    else if (mode === 4 && index === 4) add("dash.md", { frontmatter: {} });
    else add("vault/x" + index + ".md", { frontmatter: {} });
  }
  // Notebook-typed period paths stay temporal and out of the walk.
  const temporalTyped = take(20);
  remaining -= temporalTyped;
  for (let index = 0; index < temporalTyped; index += 1) {
    const month = String(1 + (index % 12)).padStart(2, "0");
    const day = String(1 + (index % 28)).padStart(2, "0");
    add("2027/2027" + month + day + ".md", { frontmatter: { type: "[[notebook]]" } });
  }
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    add("misc/m" + index + ".md", { frontmatter: index % 7 === 0 ? { title: "Misc" } : {} });
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  const linkTargets = new Map();
  for (const file of files) linkTargets.set(file.path, file);
  const calls = { markdownFiles: 0, fileCache: 0, link: 0 };
  const metadataCache = {
    getFileCache: (file) => {
      calls.fileCache += 1;
      return caches.get(file && file.path) || null;
    },
    getFirstLinkpathDest: (target, sourcePath) => {
      calls.link += 1;
      const clean = String(target || "").replace(/\.md$/i, "");
      void sourcePath;
      const direct = clean + ".md";
      if (linkTargets.has(direct)) return { path: direct };
      const base = (clean.split("/").pop() || "") + ".md";
      for (const path of linkTargets.keys()) {
        if (path === base || path.endsWith("/" + base)) return { path };
      }
      return null;
    },
    on: () => ({}),
  };
  return {
    calls,
    vault: {
      getAbstractFileByPath: (path) => byPath.get(path) || null,
      getMarkdownFiles: () => {
        calls.markdownFiles += 1;
        return files.slice();
      },
      getFiles: () => files.slice(),
      on: () => ({}),
    },
    metadataCache,
    workspace: { onLayoutReady() {} },
  };
}

function makePlugin(app) {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = app;
  plugin.addCommand = () => {};
  plugin.registerEvent = (reference) => reference;
  plugin.setupNavGroups();
  return plugin;
}

test("tree index builds 8,000 files within 30 ms best-of-5 CPU", () => {
  const { cpuSamples, wallSamples } = sampleCpuWork(
    () => {
      const app = makeIndexApp(FILE_COUNT);
      const plugin = makePlugin(app);
      return () => {
        plugin.navGroupsTreeEnsureBuilt();
      };
    },
    { warmups: 2, samples: 5 },
  );
  assert.ok(
    isWithinCpuBudget(cpuSamples, BUILD_BUDGET_MS),
    cpuBudgetDiagnostic("tree index build", cpuSamples, wallSamples, BUILD_BUDGET_MS),
  );
});

test("a warm tree resolve does no vault scan", () => {
  const app = makeIndexApp(FILE_COUNT);
  assert.equal(app.vault.getFiles().length, FILE_COUNT);
  const plugin = makePlugin(app);
  plugin.navGroupsTreeEnsureBuilt();
  const before = { ...app.calls };
  const answer = plugin.navGroupsResolve({ path: "projects/p1.md" });
  assert.equal(answer.route, "tree");
  assert.equal(answer.kind, "project");
  assert.deepEqual(app.calls, before);
  const lazy = plugin.navGroupsResolve({ path: "projects/p5.md", lazy: true });
  assert.equal(lazy.route, "tree");
  assert.deepEqual(app.calls, before);
});
