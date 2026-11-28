"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const originalLoad = Module._load;
const obsidianStub = {
  MarkdownView: class MarkdownView {}, Modal: class {}, Notice: class {}, Plugin: class {},
  Platform: { isDesktopApp: true }, normalizePath: (value) => value, parseYaml: () => ({}),
};
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") return obsidianStub;
  if (request === "@codemirror/state") return {};
  if (request === "@codemirror/view") return {};
  return originalLoad.call(this, request, parent, isMain);
};
const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers: H } = LedgerToolsPlugin;
const MarkdownView = obsidianStub.MarkdownView;

function matchSimple(node, selector) {
  let rest = String(selector || "");
  const tag = /^[a-zA-Z][\w-]*/.exec(rest);
  if (tag) {
    if (node.tagName !== tag[0].toUpperCase()) return false;
    rest = rest.slice(tag[0].length);
  }
  while (rest) {
    const cls = /^\.([\w-]+)/.exec(rest);
    if (cls) {
      if (!String(node.className || "").split(/\s+/).includes(cls[1])) return false;
      rest = rest.slice(cls[0].length);
      continue;
    }
    const attr = /^\[([^\]]+)\]/.exec(rest);
    if (!attr) return false;
    const body = /^([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?$/.exec(attr[1]);
    if (!body) return false;
    const value = node.getAttribute(body[1]);
    if (body[2] !== undefined || body[3] !== undefined || body[4] !== undefined) {
      if (value !== (body[2] ?? body[3] ?? body[4])) return false;
    } else if (value == null) return false;
    rest = rest.slice(attr[0].length);
  }
  return true;
}

function matchSelector(node, selector) {
  return String(selector).split(",").some((part) => {
    const pieces = part.trim().split(/\s+/).filter(Boolean);
    if (!pieces.length) return false;
    if (!matchSimple(node, pieces[pieces.length - 1])) return false;
    let ancestor = node.parentElement;
    for (let index = pieces.length - 2; index >= 0; index -= 1) {
      while (ancestor && !matchSimple(ancestor, pieces[index])) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

function el(tag, attrs = {}, text = "") {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    className: attrs.class || "",
    attrs: { ...attrs },
    children: [],
    parentElement: null,
    parentNode: null,
    textContent: text,
    isConnected: true,
    clicked: 0,
    scrolled: false,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    click() {
      this.clicked += 1;
      if (this.attrs["aria-expanded"] !== "true") this.attrs["aria-expanded"] = "true";
    },
    scrollIntoView() { this.scrolled = true; },
    matches(selector) { return matchSelector(this, selector); },
    closest(selector) {
      let current = this;
      while (current) {
        if (matchSelector(current, selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const found = [];
      const visit = (current) => {
        for (const child of current.children) {
          if (matchSelector(child, selector)) found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    },
    append(...kids) {
      for (const child of kids) {
        child.parentElement = this;
        child.parentNode = this;
        this.children.push(child);
      }
      return this;
    },
  };
  return node;
}

function clickEvent(target) {
  return {
    target,
    defaultPrevented: false,
    stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}

function pluginFor({ path, dest = {}, root, cm = {}, renderer = {} }) {
  const active = {
    file: { path },
    previewMode: { containerEl: root, renderer },
    containerEl: root,
    editor: { cm },
  };
  return {
    app: {
      workspace: {
        getActiveViewOfType(ctor) { return !ctor || ctor === MarkdownView ? active : null; },
      },
      metadataCache: {
        getFirstLinkpathDest(linkpath) { return dest[linkpath] || null; },
      },
    },
    active,
  };
}

function hostPanel(kind, path) {
  const toggle = el("button", { class: "bob-cabinet-toggle", "aria-expanded": "false" }, kind);
  const head = el("div", { class: "bob-cabinet-head" }).append(toggle);
  const panel = el("div", { "data-cabinet-kind": kind, "data-cabinet-source": path }).append(head);
  const absorbed = el("div", { class: "bob-cabinet-absorbed", "data-callout": kind });
  const stack = el("div", { class: "bob-property-card-cabinets" }).append(panel);
  const root = el("div").append(stack, absorbed);
  return { root, panel, toggle, head, absorbed };
}

test("navigation headings include host catalogs and Records", () => {
  assert.deepEqual(H.PROPERTY_CARD_NAVIGATION_HEADINGS, {
    areas: "Areas", projects: "Projects", notebooks: "Notebooks", albums: "Albums", records: "Records",
  });
  assert.equal("records" in H.PROPERTY_CARD_HOST_CATALOG_HEADINGS, false);
});

test("a same-note #Projects link and an Outline Projects item reveal the host cabinet", () => {
  const { root, toggle, head } = hostPanel("projects", "cash.md");
  const plugin = pluginFor({ path: "cash.md", dest: { cash: { path: "cash.md" } }, root });
  const link = el("a", { class: "internal-link", href: "#Projects", "data-href": "cash#Projects" }, "Jump to Projects");
  root.append(link);
  const event = clickEvent(link);
  assert.equal(H.propertyCardCabinetHostRevealNavigation(plugin, event), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(toggle.clicked, 1);
  assert.equal(head.scrolled, true);

  toggle.attrs["aria-expanded"] = "false";
  toggle.clicked = 0;
  head.scrolled = false;
  const outline = el("div", { class: "outline" }).append(
    el("div", { class: "tree-item-self" }).append(el("div", { class: "tree-item-inner" }, "Projects")),
  );
  const inner = outline.children[0].children[0];
  const outlineEvent = clickEvent(inner);
  assert.equal(H.propertyCardCabinetHostRevealNavigation(plugin, outlineEvent), true);
  assert.equal(outlineEvent.defaultPrevented, true);
  assert.equal(toggle.clicked, 1);
});

test("#Records, eat#Records, and an Outline Records item call the Records reveal", () => {
  const root = el("div");
  const view = {};
  const plugin = pluginFor({
    path: "eat.md",
    dest: { eat: { path: "eat.md" } },
    root,
    renderer: view,
  });
  plugin.active.previewMode.renderer = view;
  const revealed = [];
  const release = H.propertyCardCatalogClaim({
    view, path: "eat.md", kind: "records", fingerprint: "fnv1a:records",
    reveal: () => { revealed.push("records"); return true; },
  });

  const hashLink = el("a", { class: "internal-link", href: "#Records" }, "Jump to Records");
  const hashEvent = clickEvent(hashLink);
  assert.equal(H.propertyCardCabinetHostRevealNavigation(plugin, hashEvent), true);
  assert.equal(hashEvent.defaultPrevented, true);
  assert.deepEqual(revealed, ["records"]);

  revealed.length = 0;
  const named = el("a", { class: "internal-link", href: "eat#Records", "data-href": "eat#Records" }, "Jump to Records");
  const namedEvent = clickEvent(named);
  assert.equal(H.propertyCardCabinetHostRevealNavigation(plugin, namedEvent), true);
  assert.equal(namedEvent.defaultPrevented, true);
  assert.deepEqual(revealed, ["records"]);

  revealed.length = 0;
  const outline = el("div", { class: "outline" }).append(
    el("div", { class: "tree-item-self" }, "Records"),
  );
  const outlineEvent = clickEvent(outline.children[0]);
  assert.equal(H.propertyCardCabinetHostRevealNavigation(plugin, outlineEvent), true);
  assert.equal(outlineEvent.defaultPrevented, true);
  assert.deepEqual(revealed, ["records"]);
  release();
});

test("cross-note Records, Notes, prose, and an unclaimed view fall through", () => {
  const root = el("div");
  const view = {};
  const plugin = pluginFor({
    path: "eat.md",
    dest: { other: { path: "other.md" }, eat: { path: "eat.md" } },
    root,
    renderer: view,
  });
  plugin.active.previewMode.renderer = view;
  H.propertyCardCatalogClaim({
    view, path: "eat.md", kind: "records", fingerprint: "fnv1a:records",
    reveal: () => true,
  });

  const other = clickEvent(el("a", { class: "internal-link", href: "other#Records", "data-href": "other#Records" }, "other"));
  assert.equal(H.propertyCardCabinetHostRevealNavigation(plugin, other), false);
  assert.equal(other.defaultPrevented, false);

  const notes = clickEvent(el("a", { class: "internal-link", href: "#Notes" }, "Notes"));
  assert.equal(H.propertyCardCabinetHostRevealNavigation(plugin, notes), false);
  assert.equal(notes.defaultPrevented, false);

  const proseRoot = el("div");
  const prose = pluginFor({ path: "essay.md", root: proseRoot });
  const proseEvent = clickEvent(el("a", { class: "internal-link", href: "#Records" }, "Records"));
  assert.equal(H.propertyCardCabinetHostRevealNavigation(prose, proseEvent), false);
  assert.equal(proseEvent.defaultPrevented, false);

  const emptyRoot = el("div");
  const emptyView = {};
  const empty = pluginFor({ path: "eat.md", root: emptyRoot, renderer: emptyView });
  empty.active.previewMode.renderer = emptyView;
  const emptyEvent = clickEvent(el("a", { class: "internal-link", href: "#Records" }, "Records"));
  assert.equal(H.propertyCardCabinetHostRevealNavigation(empty, emptyEvent), false);
  assert.equal(emptyEvent.defaultPrevented, false);
});
