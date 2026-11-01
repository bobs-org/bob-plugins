// bob-ledger-tools JavaScript mirror of bob-cli's Today roots contract.
// Shared vectors live in plugins/bob-ledger-tools/scripts/fixtures/pomodoro_homes/
// (copied byte-for-byte from bob-cli). `planTodayRoots` is a view, never a budget.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

class TestMarkdownView {}
class TestPlugin {
  constructor(app) {
    this.app = app;
  }
}

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      MarkdownView: TestMarkdownView,
      Notice: class {},
      Platform: { isDesktopApp: false },
      Plugin: TestPlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
      Keymap: {
        isModEvent: (evt) => Boolean(evt && (evt.metaKey || evt.ctrlKey)),
      },
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: { define: () => ({ of: (value) => ({ value }) }) },
      RangeSetBuilder: class {
        constructor() {
          this.adds = [];
        }
        add(from, to, value) {
          this.adds.push({ from, to, value });
        }
        finish() {
          return this.adds;
        }
      },
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
      ViewPlugin: { fromClass: (cls, options) => ({ cls, options }) },
      Decoration: { none: {}, widget: (spec) => spec },
      WidgetType: class {},
    };
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

const {
  planTodayRoots,
  planBlockModel,
  paintPlanTodayRoots,
  planTodayRootsAriaLabel,
  defaultPlanCaps,
} = LedgerToolsPlugin.helpers;

const fixturePath = path.join(
  __dirname,
  "../plugins/bob-ledger-tools/scripts/fixtures/pomodoro_homes/vectors.json",
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function parseYamlFlow(text, start) {
  let index = start;
  if (text[index] !== "[") {
    return { value: "", next: start };
  }
  index += 1;
  const items = [];
  while (index < text.length) {
    while (text[index] === " " || text[index] === "\t") {
      index += 1;
    }
    if (text[index] === "]") {
      return { value: items, next: index + 1 };
    }
    if (text[index] === "[") {
      const inner = parseYamlFlow(text, index);
      items.push(inner.value);
      index = inner.next;
    } else if (text[index] === '"' || text[index] === "'") {
      const quote = text[index];
      index += 1;
      let raw = "";
      while (index < text.length && text[index] !== quote) {
        raw += text[index];
        index += 1;
      }
      if (text[index] === quote) {
        index += 1;
      }
      items.push(raw);
    } else {
      const from = index;
      while (index < text.length && text[index] !== "," && text[index] !== "]") {
        index += 1;
      }
      items.push(text.slice(from, index).trim());
    }
    while (text[index] === " " || text[index] === "\t") {
      index += 1;
    }
    if (text[index] === ",") {
      index += 1;
    }
  }
  return { value: items, next: index };
}

function parseFrontmatter(note) {
  const match = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(String(note || ""));
  const values = {};
  if (!match) {
    return values;
  }
  for (const line of match[1].split("\n")) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (!field) {
      continue;
    }
    let value = field[2];
    if (value.startsWith("[")) {
      values[field[1]] = parseYamlFlow(value, 0).value;
      continue;
    }
    if (value === "true" || value === "false") {
      values[field[1]] = value === "true";
      continue;
    }
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[field[1]] = value;
  }
  return values;
}

function fakeVault(notes) {
  const files = new Map(
    Object.keys(notes).map((filePath) => [filePath, { path: filePath }]),
  );
  const getFirstLinkpathDest = (target) => {
    let wanted = String(target || "").trim().replace(/\.md$/i, "");
    if (!wanted) {
      return null;
    }
    const exact = `${wanted}.md`.toLowerCase();
    const exactPath = Array.from(files.keys()).find(
      (filePath) => filePath.toLowerCase() === exact,
    );
    if (exactPath) {
      return files.get(exactPath);
    }
    const basename = wanted.split("/").pop().toLowerCase();
    const matches = Array.from(files.keys()).filter(
      (filePath) =>
        filePath.split("/").pop().replace(/\.md$/i, "").toLowerCase() ===
        basename,
    );
    return matches.length === 1 ? files.get(matches[0]) : null;
  };
  const cacheForPath = (filePath) => {
    if (!files.has(filePath)) {
      return null;
    }
    const blocks = {};
    String(notes[filePath] || "")
      .split(/\r?\n/)
      .forEach((line, index) => {
        const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(line);
        if (match) {
          blocks[match[1]] = { position: { start: { line: index } } };
        }
      });
    return { frontmatter: parseFrontmatter(notes[filePath]), blocks };
  };
  const metadataCache = {
    getFirstLinkpathDest,
    getCache(filePath) {
      return cacheForPath(filePath);
    },
    getFileCache(file) {
      return cacheForPath(file && file.path);
    },
  };
  const vault = {
    getAbstractFileByPath: (filePath) => files.get(filePath) || null,
    getMarkdownFiles: () => Array.from(files.values()),
    cachedRead: (file) => Promise.resolve(String(notes[file.path] || "")),
  };
  return { metadataCache, vault };
}

function taskLineForBlock(notes) {
  return (filePath, blockId) => {
    const wanted = String(blockId || "").toLowerCase();
    const note = notes[filePath];
    if (!wanted || typeof note !== "string") return null;
    return (
      note.split(/\r?\n/).find((line) => {
        const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(line);
        return match && match[1].toLowerCase() === wanted;
      }) || null
    );
  };
}

function statusFromSymbol(symbol) {
  if (symbol === "x" || symbol === "X") {
    return { symbol, type: "DONE", name: "Done" };
  }
  if (symbol === "-") {
    return { symbol, type: "CANCELLED", name: "Cancelled" };
  }
  if (symbol === "/") {
    return { symbol, type: "IN_PROGRESS", name: "In Progress" };
  }
  if (symbol === "*") {
    return { symbol, type: "ON_HOLD", name: "Next" };
  }
  if (symbol === "?") {
    return { symbol, type: "ON_HOLD", name: "Blocked" };
  }
  return { symbol, type: "TODO", name: "Todo" };
}

function tasksFromNotes(notes) {
  const tasks = [];
  for (const [filePath, content] of Object.entries(notes)) {
    for (const line of String(content || "").split(/\r?\n/)) {
      const task = /^\s*[-*+]\s+\[([^\]]+)\]\s+#task\b/.exec(line);
      const block = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(line);
      if (!task || !block) {
        continue;
      }
      tasks.push({
        path: filePath,
        blockLink: ` ^${block[1]}`,
        status: statusFromSymbol(task[1]),
        description: line,
      });
    }
  }
  return tasks;
}

function notesForCase(vector) {
  return {
    ...fixture.notes,
    ...(vector.tasks_notes || {}),
    [vector.daily_path]: vector.daily,
  };
}

function fakeEl(tag, options = {}) {
  const node = {
    tag,
    tagName: String(tag || "span").toUpperCase(),
    cls: options.cls || "",
    text: options.text || "",
    title: options.title || "",
    href: options.href,
    attrs: { ...(options.attr || {}) },
    children: [],
    listeners: {},
    parentNode: null,
    createEl(childTag, childOptions = {}) {
      const child = fakeEl(childTag, childOptions);
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      node.attrs[name] = String(value);
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(node.attrs, name);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(node.attrs, name)
        ? node.attrs[name]
        : null;
    },
    addEventListener(name, handler) {
      node.listeners[name] = node.listeners[name] || [];
      node.listeners[name].push(handler);
    },
    querySelector(selector) {
      const wanted = String(selector || "").replace(/^\./, "");
      const match = node.children.find((child) =>
        String(child.cls || "")
          .split(/\s+/)
          .includes(wanted),
      );
      return match || null;
    },
    querySelectorAll(selector) {
      const wanted = String(selector || "").replace(/^\./, "");
      const out = [];
      const walk = (current) => {
        for (const child of current.children || []) {
          if (
            String(child.cls || "")
              .split(/\s+/)
              .includes(wanted)
          ) {
            out.push(child);
          }
          walk(child);
        }
      };
      walk(node);
      return out;
    },
  };
  if (options.cls) {
    node.attrs.class = options.cls;
  }
  if (options.title) {
    node.attrs.title = options.title;
  }
  if (options.href) {
    node.attrs.href = options.href;
  }
  return node;
}

function textOf(node) {
  if (!node) {
    return "";
  }
  return `${node.text || ""}${ (node.children || []).map(textOf).join("") }`;
}

assert.ok(Array.isArray(fixture.today_roots) && fixture.today_roots.length > 0);

for (const vector of fixture.today_roots) {
  test(`today_roots vector: ${vector.name}`, () => {
    const notes = notesForCase(vector);
    const { metadataCache, vault } = fakeVault(notes);
    const actual = planTodayRoots({
      content: vector.daily,
      dailyPath: vector.daily_path,
      metadataCache,
      vault,
      tasks: tasksFromNotes(notes),
      taskLineForBlock: taskLineForBlock(notes),
    });
    assert.deepEqual(actual, vector.expected, vector.name);
    const total = (actual || []).reduce((sum, root) => sum + root.tasks, 0);
    const todayCount = (vector.expected || []).reduce(
      (sum, root) => sum + root.tasks,
      0,
    );
    assert.equal(total, todayCount, `partition: ${vector.name}`);
  });
}

test("planTodayRoots returns null when Tasks is unavailable", () => {
  const notes = notesForCase(fixture.today_roots[0]);
  const { metadataCache, vault } = fakeVault(notes);
  assert.equal(
    planTodayRoots({
      content: fixture.today_roots[0].daily,
      dailyPath: fixture.today_roots[0].daily_path,
      metadataCache,
      vault,
      tasks: null,
      taskLineForBlock: taskLineForBlock(notes),
    }),
    null,
  );
});

test("planTodayRoots never throws on garbage input", () => {
  assert.equal(planTodayRoots(), null);
  assert.deepEqual(planTodayRoots({ tasks: [] }), []);
  assert.equal(
    planTodayRoots({
      content: null,
      dailyPath: null,
      metadataCache: null,
      vault: null,
      tasks: undefined,
    }),
    null,
  );
});

test("planBlockModel todayRoots is empty without a Pomodoros section", () => {
  const model = planBlockModel({
    content: "# 2026-11-01\n\n- [ ] #task Chore ^chore\n",
    tasks: [],
    today: new Date(2026, 10, 1),
    caps: defaultPlanCaps(),
  });
  assert.deepEqual(model.todayRoots, []);
});

test("planBlockModel todayRoots is null when Tasks is unavailable", () => {
  const model = planBlockModel({
    content: "## Pomodoros\n\n- [ ] () — BUILD\n  - [[t_bob#^b1]]\n",
    tasks: null,
    today: new Date(2026, 10, 1),
    caps: defaultPlanCaps(),
  });
  assert.equal(model.todayRoots, null);
});

test("paintPlanTodayRoots paints hue, counts, unfiled, aria, and click", () => {
  const roots = [
    { key: "bob.md", label: "bob", hue: "orange", tasks: 5 },
    { key: "sase.md", label: "sase", hue: "blue", tasks: 2 },
    { key: "@unfiled", label: "unfiled", hue: null, tasks: 1 },
  ];
  const container = fakeEl("div", { cls: "bob-plan" });
  container.createEl("span", { cls: "bob-plan-themes", text: "★ BUILD" });
  const opened = [];
  const group = paintPlanTodayRoots(
    container,
    roots,
    "2026/20261101.md",
    (stem, newLeaf) => {
      opened.push({ stem, newLeaf });
    },
  );
  assert.equal(container.children[0].cls, "bob-plan-themes");
  assert.equal(container.children[1].cls, "bob-plan-roots");
  assert.equal(group.attrs.role, "group");
  assert.equal(
    group.attrs["aria-label"],
    planTodayRootsAriaLabel(roots),
  );
  assert.equal(
    group.attrs["aria-label"],
    "Root parents scheduled: bob, 5 tasks; sase, 2 tasks; unfiled, 1 task",
  );
  const items = group.children;
  assert.equal(items.length, 3);
  assert.equal(items[0].tag, "a");
  assert.equal(items[0].attrs["data-root-hue"], "orange");
  assert.equal(items[0].querySelector("bob-plan-root-ring").attrs["data-root-hue"], "orange");
  assert.equal(items[0].querySelector("bob-plan-root-ring").attrs["aria-hidden"], "true");
  assert.equal(textOf(items[0].querySelector("bob-plan-root-label")), "bob");
  assert.equal(textOf(items[0].querySelector("bob-plan-root-count")), "\u00a05");
  assert.match(items[0].title, /bob · 5 scheduled tasks/);
  assert.match(items[0].title, /Open bob/);
  assert.equal(items[1].attrs["data-root-hue"], "blue");
  assert.equal(items[2].tag, "span");
  assert.equal(items[2].cls, "bob-plan-root bob-plan-root-unfiled");
  assert.equal(items[2].attrs["data-root-hue"], undefined);
  assert.equal(items[2].attrs.role, undefined);
  assert.equal(items[2].listeners.click, undefined);
  assert.match(items[2].title, /unfiled · 1 scheduled task/);
  assert.match(
    items[2].title,
    /File the task in an area or project, or give it a root field/,
  );
  items[0].listeners.click[0]({ preventDefault() {}, metaKey: true });
  assert.deepEqual(opened, [{ stem: "bob", newLeaf: true }]);
  items[0].listeners.keydown[0]({ preventDefault() {}, key: "Enter" });
  assert.equal(opened[1].stem, "bob");
  assert.ok(items[0].listeners.mousedown);
});

test("paintPlanTodayRoots paints no line when roots are empty", () => {
  const container = fakeEl("div", { cls: "bob-plan" });
  assert.equal(paintPlanTodayRoots(container, [], "daily.md", () => {}), null);
  assert.equal(paintPlanTodayRoots(container, null, "daily.md", () => {}), null);
  assert.equal(container.children.length, 0);
});
