// Dashboard collections: PROJECTS / REFERENCES membership, Base contracts,
// snapshot isolation, and chip rendering (`api.dashboardCollections` v1).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

class TestPlugin {
  constructor(app) {
    this.app = app;
  }

  addCommand() {}
  registerEditorExtension() {}
  registerEvent() {}
  registerMarkdownCodeBlockProcessor(language, handler) {
    this.codeBlocks = this.codeBlocks || {};
    this.codeBlocks[language] = handler;
  }

  registerInterval(handle) {
    return handle;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Notice: class {},
      Platform: { isDesktopApp: true },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
const { helpers } = LedgerToolsPlugin;
Module._load = originalLoad;

const {
  DASHBOARD_COLLECTIONS_VERSION,
  DASHBOARD_COLLECTION_PROJECTS_VIEW,
  DASHBOARD_COLLECTION_REFERENCES_VIEW,
  dashboardCollectionIsProjectMember,
  dashboardCollectionIsReferenceMember,
  dashboardCollectionStatusContainsAny,
  dashboardCollectionValidateProjectsBase,
  dashboardCollectionValidateRefsBase,
  dashboardCollectionEntryFor,
  dashboardCollectionChipModel,
} = helpers;

function resolverTo(destPath) {
  return () => (destPath === null ? null : { path: destPath });
}

function projectNote(overrides = {}) {
  return {
    path: "work.md",
    frontmatter: { type: "[[project]]", status: "wip" },
    ...overrides,
    frontmatter: {
      type: "[[project]]",
      status: "wip",
      ...(overrides.frontmatter || {}),
    },
  };
}

test("collections namespace version is additive v1", () => {
  assert.equal(DASHBOARD_COLLECTIONS_VERSION, 1);
  assert.equal(DASHBOARD_COLLECTION_PROJECTS_VIEW, "🚀 Active & Waiting");
  assert.equal(DASHBOARD_COLLECTION_REFERENCES_VIEW, "🔖 Reading Queue");
});

test("projects: scalar resolved links count, lists never widen", () => {
  const toProject = resolverTo("project.md");
  assert.equal(
    dashboardCollectionIsProjectMember(projectNote(), toProject),
    true,
  );
  assert.equal(
    dashboardCollectionIsProjectMember(
      projectNote({ frontmatter: { type: "[[project|P]]", status: "waiting" } }),
      toProject,
    ),
    true,
  );
  assert.equal(
    dashboardCollectionIsProjectMember(
      projectNote({ frontmatter: { type: "project", status: "wip" } }),
      toProject,
    ),
    true,
  );
  assert.equal(
    dashboardCollectionIsProjectMember(
      projectNote({ frontmatter: { type: "[[area]]", status: "wip" } }),
      resolverTo("area.md"),
    ),
    false,
  );
  assert.equal(
    dashboardCollectionIsProjectMember(
      projectNote({ frontmatter: { type: ["[[project]]"], status: "wip" } }),
      toProject,
    ),
    false,
  );
  assert.equal(
    dashboardCollectionIsProjectMember(
      projectNote({ frontmatter: { type: undefined, status: "wip" } }),
      toProject,
    ),
    false,
  );
});

test("projects: templates, status, and containsAny edges", () => {
  const toProject = resolverTo("project.md");
  assert.equal(
    dashboardCollectionIsProjectMember(
      projectNote({ path: "_templates/work.md" }),
      toProject,
    ),
    false,
  );
  assert.equal(
    dashboardCollectionIsProjectMember(
      projectNote({ path: "a/_templates/work.md" }),
      toProject,
    ),
    false,
  );
  assert.equal(
    dashboardCollectionIsProjectMember(
      projectNote({ path: "_templates.md" }),
      toProject,
    ),
    true,
  );
  for (const status of ["wip", "waiting"]) {
    assert.equal(
      dashboardCollectionIsProjectMember(
        projectNote({ frontmatter: { type: "[[project]]", status } }),
        toProject,
      ),
      true,
    );
  }
  for (const status of ["done", "canceled", "active", undefined, null, 42]) {
    assert.equal(
      dashboardCollectionIsProjectMember(
        projectNote({ frontmatter: { type: "[[project]]", status } }),
        toProject,
      ),
      false,
    );
  }
  assert.equal(dashboardCollectionStatusContainsAny("wip", ["wip", "waiting"]), true);
  assert.equal(dashboardCollectionStatusContainsAny("my-waiting-note", ["wip", "waiting"]), true);
  assert.equal(dashboardCollectionStatusContainsAny(["wip"], ["wip", "waiting"]), true);
  assert.equal(dashboardCollectionStatusContainsAny(["done"], ["wip", "waiting"]), false);
  assert.equal(dashboardCollectionStatusContainsAny(["wip-extra"], ["wip"]), false);
  assert.equal(dashboardCollectionStatusContainsAny(null, ["wip"]), false);
});

test("references: exact prefix, md only, exact scalar status", () => {
  const ref = (path, status) => ({ path, frontmatter: { status } });
  assert.equal(dashboardCollectionIsReferenceMember(ref("ref/a.md", "next")), true);
  assert.equal(dashboardCollectionIsReferenceMember(ref("ref/nested/b.md", "wip")), true);
  assert.equal(dashboardCollectionIsReferenceMember(ref("ref/a.md", "ready")), true);
  assert.equal(dashboardCollectionIsReferenceMember(ref("ref.md", "next")), false);
  assert.equal(dashboardCollectionIsReferenceMember(ref("refs/a.md", "next")), false);
  assert.equal(dashboardCollectionIsReferenceMember(ref("Ref/a.md", "next")), false);
  assert.equal(dashboardCollectionIsReferenceMember(ref("ref/a.pdf", "next")), false);
  assert.equal(dashboardCollectionIsReferenceMember(ref("lib/a.md", "next")), false);
  assert.equal(dashboardCollectionIsReferenceMember(ref("ref/a.md", "read")), false);
  assert.equal(dashboardCollectionIsReferenceMember(ref("ref/a.md", "Next")), false);
  assert.equal(dashboardCollectionIsReferenceMember(ref("ref/a.md", "unread")), false);
  assert.equal(dashboardCollectionIsReferenceMember(ref("ref/a.md", ["next"])), false);
  assert.equal(dashboardCollectionIsReferenceMember(ref("ref/a.md", null)), false);
  assert.equal(dashboardCollectionIsReferenceMember({ path: "ref/a.md", frontmatter: null }), false);
});

test("base contracts: accept current files, reject drift, tolerate presentation", () => {
  const projects = {
    filters: { and: ['note.type == link("project")', 'file.inFolder("_templates") == false'] },
    views: [
      {
        name: "🚀 Active & Waiting",
        filters: { and: ['status.containsAny("wip", "waiting")'] },
        order: ["a"],
        sort: [{ property: "b" }],
      },
      { name: "⏳ Waiting", filters: { and: ['status == "waiting"'] } },
    ],
  };
  assert.equal(dashboardCollectionValidateProjectsBase(projects).ok, true);
  assert.equal(
    dashboardCollectionValidateProjectsBase({
      filters: { and: ['note.type == link("project")'] },
      views: [{ name: "🚀 Active & Waiting", filters: { and: ['status.containsAny("wip", "waiting")'] } }],
    }).ok,
    false,
  );
  assert.equal(
    dashboardCollectionValidateProjectsBase({
      filters: { and: ['note.type == link("project")', 'file.inFolder("_templates") == false'] },
      views: [{ name: "Renamed", filters: { and: ['status.containsAny("wip", "waiting")'] } }],
    }).ok,
    false,
  );
  assert.equal(
    dashboardCollectionValidateProjectsBase({ ...projects, limit: 10 }).ok,
    false,
  );
  const refs = {
    filters: { and: ['file.path.startsWith("ref/")', 'file.ext == "md"'] },
    views: [
      {
        name: "🔖 Reading Queue",
        filters: { or: ['status == "next"', 'status == "wip"', 'status == "ready"'] },
      },
      { name: "📚 All Refs", filters: { and: ['status.containsAny("next", "wip", "ready")'] } },
    ],
  };
  assert.equal(dashboardCollectionValidateRefsBase(refs).ok, true);
  assert.equal(
    dashboardCollectionValidateRefsBase({
      filters: { and: ['file.path.startsWith("ref/")', 'file.ext == "md"'] },
      views: [{ name: "🔖 Reading Queue", filters: { or: ['status == "next"', 'status == "wip"'] } }],
    }).ok,
    false,
  );
  assert.equal(dashboardCollectionValidateRefsBase(null).ok, false);
});

test("entries: true zero vs unavailable with reason, failure isolation", () => {
  const zero = dashboardCollectionEntryFor("projects", 0, true, null);
  assert.equal(zero.count, 0);
  assert.equal(zero.available, true);
  assert.equal(zero.valueText, "0");
  assert.match(zero.tooltip, /0 projects in Active & Waiting/);
  const missing = dashboardCollectionEntryFor("projects", null, false, "projects.base is unreadable");
  assert.equal(missing.available, false);
  assert.equal(missing.valueText, "–");
  assert.match(missing.tooltip, /unreadable/);
  const chip = dashboardCollectionChipModel("references", null);
  assert.equal(chip.valueText, "–");
  assert.equal(chip.placeholder, true);
  assert.equal(chip.destination, "dash_references");
});

function stubApp(filesByPath, { baseOk = true } = {}) {
  const files = Object.keys(filesByPath).map((path) => ({ path }));
  const caches = {};
  for (const [path, frontmatter] of Object.entries(filesByPath)) {
    caches[path] = frontmatter === null ? null : { frontmatter };
  }
  return {
    vault: {
      getMarkdownFiles: () => files.slice(),
      getAbstractFileByPath: () => null,
    },
    metadataCache: {
      getFileCache: (file) => {
        const path = file && file.path;
        if (!(path in caches)) {
          return null;
        }
        return caches[path];
      },
      getFirstLinkpathDest: (target) => {
        if (String(target).toLowerCase() === "project" || String(target).toLowerCase() === "project.md") {
          return { path: "project.md" };
        }
        return { path: `${target}.md` };
      },
    },
    workspace: {},
    baseOk,
  };
}

function pluginWith(app) {
  const plugin = new LedgerToolsPlugin(app);
  plugin.dashboardCollectionWidgets = new Set();
  plugin.dashboardCollectionsRefreshTimer = null;
  plugin.dashboardCollectionsBaseToken = 0;
  plugin.dashboardCollectionsBase = {
    projects: { ok: true, reason: null },
    references: { ok: true, reason: null },
  };
  return plugin;
}

test("snapshot counts both collections once, true zero stays clickable", () => {
  const app = stubApp({
    "a.md": { type: "[[project]]", status: "wip" },
    "b.md": { type: "[[project]]", status: "done" },
    "ref/r1.md": { status: "next" },
    "ref/r2.md": { status: "read" },
    "plain.md": {},
  });
  const plugin = pluginWith(app);
  const snapshot = plugin.dashboardCollectionsSnapshot();
  assert.equal(snapshot.projects.count, 1);
  assert.equal(snapshot.projects.available, true);
  assert.equal(snapshot.projects.destination, "dash_projects");
  assert.equal(snapshot.references.count, 1);
  assert.equal(snapshot.references.available, true);
  assert.equal(snapshot.references.destination, "dash_references");
  const empty = pluginWith(stubApp({ "plain.md": {} })).dashboardCollectionsSnapshot();
  assert.equal(empty.projects.count, 0);
  assert.equal(empty.projects.available, true);
});

test("snapshot never presents partial counts as final", () => {
  const app = stubApp({
    "a.md": { type: "[[project]]", status: "wip" },
    "missing.md": null,
  });
  const plugin = pluginWith(app);
  const snapshot = plugin.dashboardCollectionsSnapshot();
  assert.equal(snapshot.projects.available, false);
  assert.equal(snapshot.projects.count, null);
  assert.match(snapshot.projects.reason, /metadata pending/);
  assert.equal(snapshot.references.available, false);
});

test("changed definitions fail closed per collection, never stale", () => {
  const app = stubApp({ "a.md": { type: "[[project]]", status: "wip" } });
  const plugin = pluginWith(app);
  plugin.dashboardCollectionsBase = {
    projects: { ok: false, reason: "projects.base Active & Waiting filters changed" },
    references: { ok: true, reason: null },
  };
  const snapshot = plugin.dashboardCollectionsSnapshot();
  assert.equal(snapshot.projects.available, false);
  assert.match(snapshot.projects.reason, /filters changed/);
  assert.equal(snapshot.references.available, true);
});

function stubHost() {
  const children = [];
  return {
    children,
    createEl: (tag, opts = {}) => {
      const el = {
        tag,
        cls: opts.cls || "",
        attrs: {},
        children: [],
        parentNode: null,
        isConnected: true,
        setAttribute: (k, v) => {
          el.attrs[k] = String(v);
        },
        hasAttribute: () => false,
        addEventListener: (name, fn) => {
          el.listeners = el.listeners || {};
          el.listeners[name] = fn;
        },
        createEl: (childTag, childOpts = {}) => {
          const child = {
            tag: childTag,
            cls: childOpts.cls || "",
            text: childOpts.text || "",
            attrs: {},
            setAttribute: () => {},
          };
          el.children.push(child);
          return child;
        },
        querySelector: () => null,
      };
      el.parentNode = null;
      children.push(el);
      return el;
    },
  };
}

test("renderChip links, labels, and cleans up per component", () => {
  const app = stubApp({ "a.md": { type: "[[project]]", status: "wip" } });
  const plugin = pluginWith(app);
  const host = stubHost();
  const cleanups = [];
  const component = { register: (fn) => cleanups.push(fn) };
  const first = plugin.dashboardCollectionsRenderChip(host, {
    kind: "projects",
    sourcePath: "dash.md",
    component,
  });
  assert.ok(first);
  assert.equal(plugin.dashboardCollectionWidgets.size, 1);
  const second = plugin.dashboardCollectionsRenderChip(host, {
    kind: "projects",
    sourcePath: "dash.md",
    component,
  });
  assert.ok(second);
  assert.equal(plugin.dashboardCollectionWidgets.size, 1);
  const other = plugin.dashboardCollectionsRenderChip(host, {
    kind: "references",
    sourcePath: "dash.md",
    component,
  });
  assert.ok(other);
  assert.equal(plugin.dashboardCollectionWidgets.size, 2);
  for (const fn of cleanups) {
    fn();
  }
  assert.equal(plugin.dashboardCollectionWidgets.size, 0);
  assert.equal(plugin.dashboardCollectionsRenderChip(host, { kind: "bogus" }), null);
});
