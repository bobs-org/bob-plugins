// Notebook/Prose kit: the ownership coordinator mounts both kinds on their
// mount-source attributes behind the props_v1-only gate (no contract).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) { this.app = app; }
  registerEditorExtension(extension) { (this.extensions ||= []).push(extension); }
}

const Platform = { isDesktopApp: true };
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return {
    MarkdownRenderChild: class {}, MarkdownView: class {}, Notice: class {},
    Plugin: TestPlugin, Platform, normalizePath: (value) => value,
  };
  if (request === "@codemirror/state") return {};
  if (request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
Module._load = originalLoad;

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.parentNode = null;
    this.childNodes = [];
    this.attrs = new Map();
    this.classes = new Set();
    this.isConnected = true;
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains(node)); }
  closest() { return null; }
  querySelector(selector) {
    if (selector === ".bob-property-card-foot") {
      return this.childNodes.find((child) => child.classes.has("bob-property-card-foot")) || null;
    }
    return null;
  }
  get classList() {
    const self = this;
    return {
      add: (name) => self.classes.add(name),
      remove: (name) => self.classes.delete(name),
      contains: (name) => self.classes.has(name),
    };
  }
}

function readingScope(attr, filePath) {
  const scope = new FakeNode("div");
  scope.classList.add("markdown-preview-view");
  const mount = new FakeNode("section");
  mount.setAttribute(attr, filePath);
  const foot = new FakeNode("footer");
  foot.classList.add("bob-property-card-foot");
  mount.appendChild(foot);
  scope.appendChild(mount);
  return { scope, mount };
}

function makePlugin(frontmatterByPath = {}) {
  const plugin = new TestPlugin({
    workspace: { getLeavesOfType: () => [] },
    vault: { getAbstractFileByPath: (filePath) => ({ path: filePath }) },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: frontmatterByPath[file?.path] || null }),
    },
  });
  plugin.propertyCapabilityRoutingReady = () => true;
  plugin.propertyCapabilityCurrentBobKey = () => "bob";
  plugin.propertyCapabilityConfirmed = () => true;
  return plugin;
}

const parse = (yaml) => Object.fromEntries(String(yaml).split(/\r?\n/).filter(Boolean).map((line) => {
  const index = line.indexOf(":");
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));

function acquire(plugin, scope, view, mount, kind, filePath, sourceText) {
  return H.propertyCardFrontmatterOwnMounted(plugin, {
    scope, view, mount, kind, path: filePath, sourceText,
    currentPath: () => view.file.path,
    active: () => true,
    parseYaml: parse,
  });
}

test("notebook and prose mounts own their scope", () => {
  for (const [kind, attr, type] of [
    ["notebook", "data-notebook-source", "notebook"],
    ["prose", "data-prose-source", "prose"],
  ]) {
    const filePath = `${kind}.md`;
    const plugin = makePlugin({ [filePath]: { type } });
    const sourceText = `---\ntype: ${type}\n---\n`;
    const { scope, mount } = readingScope(attr, filePath);
    const view = { file: { path: filePath }, getMode: () => "preview" };
    const release = acquire(plugin, scope, view, mount, kind, filePath, sourceText);
    assert.equal(typeof release, "function", `${kind} can own after its card and foot mount`);
    assert.ok(scope.classList.contains("bob-property-card-owns-frontmatter"), `${kind} paints ownership`);
    release();
    assert.ok(!scope.classList.contains("bob-property-card-owns-frontmatter"), `${kind} release clears ownership`);
  }
});

test("notebook and prose gate on props_v1 alone", () => {
  for (const kind of ["notebook", "prose"]) {
    const filePath = `${kind}.md`;
    const plugin = makePlugin({ [filePath]: { type: kind } });
    // An explicit contract refusal must not block the new species: they
    // never required props_contract_v1.
    plugin.propertyCapabilityContractConfirmed = () => false;
    const { scope, mount } = readingScope(
      kind === "notebook" ? "data-notebook-source" : "data-prose-source", filePath,
    );
    const view = { file: { path: filePath }, getMode: () => "preview" };
    const release = acquire(plugin, scope, view, mount, kind, filePath, `---\ntype: ${kind}\n---\n`);
    assert.equal(typeof release, "function", `${kind} mounts without a contract`);
    release();
  }
  const areaPath = "area.md";
  const plugin = makePlugin({ [areaPath]: { type: "area" } });
  const areaFx = readingScope("data-home-source", areaPath);
  const view = { file: { path: areaPath }, getMode: () => "preview" };
  plugin.propertyCapabilityContractConfirmed = () => false;
  assert.equal(
    acquire(plugin, areaFx.scope, view, areaFx.mount, "area", areaPath, "---\ntype: area\n---\n"),
    null,
    "area still needs its contract",
  );
});

test("a mismatched mount-source attribute stays native", () => {
  const filePath = "notebook.md";
  const plugin = makePlugin({ [filePath]: { type: "notebook" } });
  const { scope, mount } = readingScope("data-prose-source", "other.md");
  const view = { file: { path: filePath }, getMode: () => "preview" };
  assert.equal(
    acquire(plugin, scope, view, mount, "notebook", filePath, "---\ntype: notebook\n---\n"),
    null,
    "a notebook mount pointing elsewhere cannot own",
  );
  assert.ok(!scope.classList.contains("bob-property-card-owns-frontmatter"));
});
