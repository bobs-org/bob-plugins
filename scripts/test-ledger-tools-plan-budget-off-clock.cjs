// Plan budget off-clock vectors: every case runs through the plugin
// predicate and computePlanBudget, with a fake app and metadata cache
// built the way test-ledger-tools-off-clock-link-chips.cjs builds them
// from the pomodoro_clock vectors. today_count is Rust-only and skipped.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const {
  clockEnvFor,
  parseVectorFrontmatter,
  planCapsForVector,
} = require("./pomodoro-clock-vector-helpers.cjs");

class FakePlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand(command) {
    this.commands = this.commands || [];
    this.commands.push(command);
  }

  registerEditorExtension(extension) {
    this.editorExtensions = this.editorExtensions || [];
    this.editorExtensions.push(extension);
  }

  registerEvent(ref) {
    this.registeredEvents = this.registeredEvents || [];
    this.registeredEvents.push(ref);
  }
}

const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Notice: class {},
      Platform: { isDesktopApp: true },
      Plugin: FakePlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: () => ({}) } },
      keymap: { of: () => ({}) },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;
const h = LedgerToolsPlugin.helpers;

const DAILY = "2026/20261105.md";
const vectors = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "plugins",
      "bob-ledger-tools",
      "scripts",
      "fixtures",
      "plan_budget_off_clock",
      "vectors.json",
    ),
    "utf8",
  ),
);
const sharedClockVectors = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../plugins/bob-ledger-tools/scripts/fixtures/pomodoro_clock/vectors.json"),
    "utf8",
  ),
);

function frontmatter(source) {
  return parseVectorFrontmatter(source);
}

function blocksFor(source) {
  const blocks = {};
  const lines = String(source || "").split("\n");
  lines.forEach((line, index) => {
    const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(line);
    if (match) {
      blocks[match[1]] = { position: { start: { line: index } } };
      blocks[match[1].toLowerCase()] = {
        position: { start: { line: index } },
      };
    }
  });
  return blocks;
}

function envFor(vector) {
  const sources = new Map(Object.entries(vector.notes || {}));
  sources.set(DAILY, vector.day);
  const files = new Map(
    [...sources.keys()].map((notePath) => [notePath, { path: notePath }]),
  );
  const resolve = (target) => {
    const name = String(target || "").replace(/\.md$/i, "");
    const exact = `${name}.md`;
    if (files.has(exact)) {
      return files.get(exact);
    }
    const stem = name.split("/").pop().toLowerCase();
    return (
      [...files.values()].find(
        (file) =>
          path.basename(file.path, ".md").toLowerCase() === stem,
      ) || null
    );
  };
  const vault = {
    getAbstractFileByPath: (notePath) => files.get(notePath) || null,
    cachedRead: (file) =>
      Promise.resolve(sources.get(file && file.path) || null),
  };
  const metadataCache = {
    getFileCache: (file) => ({
      frontmatter: frontmatter(sources.get(file.path)),
      blocks: blocksFor(sources.get(file.path)),
    }),
    getFirstLinkpathDest: (target) => resolve(target),
  };
  return { files, sources, vault, metadataCache, resolve };
}

function pluginFor(vector) {
  const env = envFor(vector);
  const app = {
    vault: env.vault,
    metadataCache: env.metadataCache,
    workspace: { getActiveFile: () => ({ path: DAILY }) },
  };
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = app;
  for (const [notePath, text] of env.sources) {
    try {
      plugin.taskThemeRememberSourceText(notePath, text);
    } catch (error) {
      // Source-cache seeding is best-effort.
    }
  }
  return plugin;
}

for (const vector of vectors.cases) {
  test(`plan off-clock vectors: ${vector.id}`, () => {
    const plugin = pluginFor(vector);
    const predicate = plugin.planBudgetOffClockPredicate(
      DAILY,
      vector.day,
      planCapsForVector(vector, h.defaultPlanCaps()),
    );
    const caps =
      vector.max_links !== undefined
        ? { maxLinks: vector.max_links }
        : undefined;
    const budget = h.computePlanBudget(vector.day, caps, DAILY, {
      isOffClockLink: predicate,
    });
    assert.equal(budget.links.count, vector.links_count, vector.id);
    assert.equal(
      budget.links.offClock,
      vector.links_off_clock,
      vector.id,
    );
    assert.equal(budget.status, vector.status, vector.id);
    assert.deepEqual(
      budget.entries.map((entry) => entry.links),
      vector.entry_links,
      vector.id,
    );
    if (vector.status === "over") {
      assert.ok(
        budget.warnings.some(
          (warning) => warning.code === "plan_link_cap_exceeded",
        ),
        `${vector.id}: expected cap lint`,
      );
    }
  });
}

for (const vector of sharedClockVectors.cases.filter((item) => item.config)) {
  test(`plan budget predicate honors shared clock config: ${vector.id}`, () => {
    const plugin = pluginFor(vector);
    const env = clockEnvFor(vector.notes, DAILY, vector.day);
    const caps = planCapsForVector(vector, h.defaultPlanCaps());
    const predicate = plugin.planBudgetOffClockPredicate(DAILY, vector.day, caps);
    const lines = vector.day.split("\n");
    const entry = lines.findIndex((line, index) => index > lines.findIndex((item) => /^## Pomodoros\s*$/.test(item)) && /^- \[[ xX-]\]/.test(line));
    assert.ok(entry >= 0, `${vector.id}: expected a ledger row`);
    for (const link of h.pomodoroClockCountedLinks(lines, entry)) {
      const file = link.pathPart ? env.resolve(link.pathPart) : env.files.get(DAILY);
      const lineText = link.pathPart
        ? String((vector.notes || {})[`${link.pathPart}.md`] || "").split("\n").find((line) => new RegExp(`(?:^|\\s)\\^${link.blockId}\\s*$`).test(line))
        : h.pomodoroClockTaskLineText(lines, link.blockId);
      const expected = file && lineText
        ? h.taskEffectiveClockResolution(file.path, lineText, env.metadataCache, env.vault, caps).offClock
        : false;
      assert.equal(predicate(link.pathPart, link.blockId), expected, `${vector.id}: ${link.token}`);
    }
  });
}
