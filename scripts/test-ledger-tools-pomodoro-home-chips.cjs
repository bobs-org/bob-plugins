// bob-ledger-tools JavaScript mirror of bob-cli's Pomodoro home contract.
// The shared fixture is copied verbatim from bob-cli; rust_only vectors need
// ambiguity behavior that Obsidian's JavaScript link resolver cannot promise.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

function hideNodeFields(node, fields) {
  for (const field of fields) {
    Object.defineProperty(node, field, {
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  assert.deepEqual(fields.filter((field) => Object.keys(node).includes(field)), []);
}

class TestMarkdownView {}
class TestPlugin {
  constructor(app) {
    this.app = app;
  }
}

const EDITOR_INFO_FIELD = {};
const LIVE_PREVIEW_FIELD = {};

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
      editorInfoField: EDITOR_INFO_FIELD,
      editorLivePreviewField: LIVE_PREVIEW_FIELD,
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
  buildPomodoroHomeChipElement,
  pomodoroHomeFnv1a,
  pomodoroHomeLinkFromBody,
  pomodoroHomeModels,
  pomodoroHomeParseEntries,
  pomodoroHomeTaskHome,
  rootMarkModel,
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
      (filePath) => filePath.split("/").pop().replace(/\.md$/i, "").toLowerCase() === basename,
    );
    return matches.length === 1 ? files.get(matches[0]) : null;
  };
  const cacheForPath = (filePath) => {
    if (!files.has(filePath)) {
      return null;
    }
    const blocks = {};
    String(notes[filePath] || "").split(/\r?\n/).forEach((line, index) => {
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
      assert.equal(typeof filePath, "string", "metadataCache.getCache expects a vault path");
      return cacheForPath(filePath);
    },
    getFileCache(file) {
      assert.equal(typeof file, "object", "metadataCache.getFileCache expects a TFile");
      assert.equal(typeof file.path, "string", "metadataCache.getFileCache expects a TFile path");
      assert.strictEqual(files.get(file.path), file, "cache lookup must use the resolved vault file");
      return cacheForPath(file.path);
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
    return note.split(/\r?\n/).find((line) => {
      const match = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(line);
      return match && match[1].toLowerCase() === wanted;
    }) || null;
  };
}

function expectedEntry(entry) {
  return {
    state: entry.state,
    kind: entry.kind,
    label: entry.label,
    chip: entry.chip,
    hue: entry.hue,
    parts: entry.parts.map((part) => {
      const copy = {};
      for (const key of [
        "key",
        "label",
        "kind",
        "area",
        "area_label",
        "hue",
        "tasks",
        "share",
        "minutes",
      ]) {
        if (Object.prototype.hasOwnProperty.call(part, key)) {
          copy[key] = part[key];
        }
      }
      return copy;
    }),
  };
}

for (const vector of fixture.cases.filter((item) => !item.rust_only)) {
  test(`shared vector: ${vector.name}`, () => {
    const { metadataCache, vault } = fakeVault(fixture.notes);
    const result = pomodoroHomeModels(
      `## Pomodoros\n${vector.pomodoros}`,
      vector.daily_path,
      metadataCache,
      vault,
      taskLineForBlock(fixture.notes),
    );
    assert.deepEqual(
      result.entries.map(expectedEntry),
      vector.expected,
    );
    if (vector.expected_lead_homes) {
      assert.deepEqual(
        result.entries.map((entry) => entry.lead_home),
        vector.expected_lead_homes,
      );
    }
    if (vector.expected_health) {
      assert.deepEqual(result.health, vector.expected_health);
    }
  });
}

test("root-fields keeps home state, root, and hue in parity with root marks", () => {
  const vector = fixture.cases.find((item) => item.name === "root-fields");
  assert.ok(vector);
  const { metadataCache, vault } = fakeVault(fixture.notes);
  const lookup = taskLineForBlock(fixture.notes);
  const links = pomodoroHomeParseEntries(`## Pomodoros\n${vector.pomodoros}`).flatMap((entry) => entry.links);
  const expected = [
    { state: "compact", target: "gtd_daily.md", home: "gtd_daily.md", hue: "orange" },
    { state: "set", target: "sase.md", home: "sase.md", hue: "blue" },
    { state: "set", target: "sase.md", home: "sase.md", hue: "blue" },
    { state: "rolls-up", target: "sase_goals.md", home: "sase_goals.md", hue: "blue" },
    { state: "repair", target: null, home: "inbox.md", hue: null },
    { state: "repair", target: null, home: "inbox.md", hue: null },
    { state: "repair", target: null, home: "inbox.md", hue: null },
    { state: "repair", target: "unfiled.md", home: "inbox.md", hue: null },
    { state: "set", target: "sase.md", home: "sase.md", hue: "blue" },
  ];
  assert.equal(links.length, expected.length);
  links.forEach((link, index) => {
    const file = link.target
      ? metadataCache.getFirstLinkpathDest(link.target, vector.daily_path)
      : vault.getAbstractFileByPath(vector.daily_path);
    assert.ok(file, `source file resolves for ${link.blockId}`);
    const line = lookup(file.path, link.blockId);
    const mark = rootMarkModel(line, {
      sourcePath: file.path,
      metadataCache,
      vault,
    });
    assert.ok(mark, `root mark exists for ${link.blockId}`);
    assert.deepEqual(
      { state: mark.state, target: mark.targetPath || null, hue: mark.hue || null },
      { state: expected[index].state, target: expected[index].target, hue: expected[index].hue },
      `root mark for ${link.blockId}`,
    );
    const home = pomodoroHomeTaskHome(
      link,
      file,
      vector.daily_path,
      metadataCache,
      vault,
      [],
      new Set(),
      lookup,
    );
    if (expected[index].home) {
      assert.equal(home.key, expected[index].home);
      if (mark.state === "repair") {
        assert.equal(home.hue, "aqua");
      } else {
        assert.equal(home.hue, mark.hue);
      }
    }
  });
});

test("home chips refresh after a linked task source read supplies its root field", async () => {
  const { metadataCache, vault } = fakeVault(fixture.notes);
  const plugin = new LedgerToolsPlugin({ metadataCache, vault }, {});
  let refreshes = 0;
  plugin.schedulePomodoroHomeChipRefresh = () => { refreshes += 1; };
  plugin.scheduleTaskThemeMarksRefresh = () => {};
  const content = "## Pomodoros\n- [x] (0800-0805 5m)\n  - [[inbox#^inbox-sase]]\n";
  const pending = plugin.pomodoroHomeChipModels(content, "2026/20261028.md");
  assert.equal(pending.entries[0].parts[0].key, "inbox.md");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshes, 1);
  const ready = plugin.pomodoroHomeChipModels(content, "2026/20261028.md");
  assert.equal(ready.entries[0].parts[0].key, "sase.md");
  assert.equal(ready.entries[0].parts[0].hue, "blue");
});

test("dedicated link parser keeps embeds and one struck link, but rejects prose", () => {
  assert.deepEqual(pomodoroHomeLinkFromBody("🍅 ![[bob#^task|Bob]]"), {
    target: "bob",
    blockId: "task",
  });
  assert.deepEqual(pomodoroHomeLinkFromBody("~~[[bob#^task]]~~"), {
    target: "bob",
    blockId: "task",
  });
  assert.equal(pomodoroHomeLinkFromBody("See [[bob#^task]]"), null);
  assert.equal(pomodoroHomeLinkFromBody("[[bob]]#"), null);
});

test("FNV-1a fallback for job maps to the pinned magenta slot", () => {
  assert.equal(pomodoroHomeFnv1a("job") % 8, 4);
});

test("area-color lints are reported once per note", () => {
  const notes = { ...fixture.notes };
  const { metadataCache, vault } = fakeVault(notes);
  const result = pomodoroHomeModels(
    "## Pomodoros\n- [x] (1000-1002)\n  - [[invalid_project#^one]]\n  - [[invalid_project#^two]]\n",
    "2026/20261018.md",
    metadataCache,
    vault,
    null,
  );
  assert.equal(result.health.area_color_invalid, 1);
  assert.deepEqual(
    result.warnings.map((warning) => warning.code).sort(),
    ["area_color_invalid"],
  );
});

test("a leftover rollup key neither regroups nor warns", () => {
  const notes = {
    ...fixture.notes,
    "sase_blog.md": "---\ntype: [[project]]\nparent: [[sase]]\nrollup: subprojects\n---\n",
  };
  const { metadataCache, vault } = fakeVault(notes);
  const result = pomodoroHomeModels(
    "## Pomodoros\n- [x] (0800-0805 5m)\n  - [[sase_blog#^one]]\n",
    "2026/20261018.md",
    metadataCache,
    vault,
    null,
  );
  assert.equal(result.warnings.length, 0);
  assert.equal(result.entries.length, 1);
  assert.deepEqual(
    result.entries[0].parts.map((part) => part.key),
    ["sase_blog.md"],
  );
});

test("chip DOM exposes forecast, hue, accessible text, and tooltip", () => {
  function element(tagName) {
    return {
      tagName,
      attributes: {},
      children: [],
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      appendChild(child) {
        this.children.push(child);
      },
    };
  }
  const chip = buildPomodoroHomeChipElement(
    { createElement: element },
    {
      state: "forecast",
      label: "sase · bob",
      chip: "sase · bob",
      hue: "blue",
      tooltip: "sase · 1 task\nbob · 1 task",
    },
  );
  assert.equal(chip.attributes["data-home-state"], "forecast");
  assert.equal(chip.attributes["data-home-hue"], "blue");
  assert.equal(chip.attributes["aria-label"], "Pomodoro home: sase · bob");
  assert.equal(chip.attributes.title, "sase · 1 task\nbob · 1 task");
  assert.equal(chip.children[1].textContent, "sase · bob");
});

test("Reading view appends a forecast chip before its Task Link list", () => {
  class Node {
    // Hidden back-references bound assert diffs; this descriptor keeps inspect and reporter output short.
    [require("node:util").inspect.custom]() {
      const cls = this.attributes ? this.attributes.class : null;
      const kids = Array.isArray(this.childNodes) ? this.childNodes.length : 0;
      const raw = typeof this._text === "string" ? this._text : "";
      const flat = raw.replace(/\s+/g, " ");
      const text = flat.length > 40 ? flat.slice(0, 40) + "…" : flat;
      const dot = cls ? "." + String(cls).split(/\s+/).filter(Boolean).join(".") : "";
      return `Node(${this.tagName}${dot} children=${kids} text=${JSON.stringify(text)})`;
    }

    constructor(tagName, nodeType = 1, text = "") {
      this.tagName = tagName;
      this.nodeName = tagName;
      this.nodeType = nodeType;
      this.childNodes = [];
      this.attributes = {};
      this.dataset = {};
      this.parentNode = null;
      this.previousSibling = null;
      this.nextSibling = null;
      this.ownerDocument = doc;
      this.isConnected = true;
      this._text = text;
      this.nodeValue = nodeType === 3 ? text : null;
    hideNodeFields(this, ["parentNode", "ownerDocument", "previousSibling", "nextSibling"]);
    }

    get children() {
      return this.childNodes.filter((node) => node.nodeType === 1);
    }

    get textContent() {
      return this._text + this.childNodes.map((node) => node.textContent || "").join("");
    }

    set textContent(value) {
      this._text = String(value);
      this.childNodes = [];
    }

    appendChild(node) {
      node.parentNode = this;
      this.childNodes.push(node);
      this.relink();
      return node;
    }

    insertBefore(node, before) {
      const index = this.childNodes.indexOf(before);
      node.parentNode = this;
      this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
      this.relink();
      return node;
    }

    removeChild(node) {
      const index = this.childNodes.indexOf(node);
      if (index >= 0) {
        this.childNodes.splice(index, 1);
        node.parentNode = null;
        this.relink();
      }
      return node;
    }

    relink() {
      this.childNodes.forEach((node, index) => {
        node.previousSibling = this.childNodes[index - 1] || null;
        node.nextSibling = this.childNodes[index + 1] || null;
      });
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name.startsWith("data-")) {
        const key = name
          .slice(5)
          .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        this.dataset[key] = String(value);
      }
    }

    getAttribute(name) {
      return this.attributes[name] || null;
    }

    querySelectorAll(selector) {
      const result = [];
      const matches = (node) => {
        if (selector === "li") {
          return node.tagName === "LI";
        }
        return (
          (node.tagName === "A" && String(node.attributes.class || "").split(/\s+/).includes("internal-link")) ||
          String(node.attributes.class || "").split(/\s+/).includes("internal-embed")
        );
      };
      const visit = (node) => {
        for (const child of node.childNodes || []) {
          if (child.nodeType === 1 && matches(child)) {
            result.push(child);
          }
          if (child.nodeType === 1) {
            visit(child);
          }
        }
      };
      visit(this);
      return result;
    }
  }
  const doc = {
    createElement: (tagName) => new Node(String(tagName).toUpperCase()),
    createTextNode: (text) => new Node("#text", 3, String(text)),
  };
  const root = doc.createElement("div");
  const heading = doc.createElement("H2");
  heading.textContent = "Pomodoros";
  const topList = doc.createElement("UL");
  root.appendChild(heading);
  root.appendChild(topList);
  const entry = doc.createElement("LI");
  entry.setAttribute("data-task", " ");
  entry.appendChild(doc.createTextNode(" (1350-1405) — BLOG"));
  const taskList = doc.createElement("UL");
  const task = doc.createElement("LI");
  const anchor = doc.createElement("A");
  anchor.setAttribute("class", "internal-link");
  anchor.setAttribute("data-href", "sase_blog#^home-chip");
  anchor.textContent = "Blog note";
  task.appendChild(anchor);
  taskList.appendChild(task);
  entry.appendChild(taskList);
  topList.appendChild(entry);

  const notes = { ...fixture.notes };
  const { metadataCache, vault } = fakeVault(notes);
  const plugin = new LedgerToolsPlugin({ metadataCache, vault }, {});
  plugin.pomodoroHomeChipsEnabled = true;
  plugin.pomodoroHomeChipReadingWidgets = new Set();
  assert.equal(plugin.pomodoroHomeChipDailyPath("2026/20261018.md"), true);
  assert.deepEqual(plugin.pomodoroHomeReadingLinkFromRow(task), {
    target: "sase_blog",
    blockId: "home-chip",
  });
  assert.ok(plugin.pomodoroHomeReadingEntry(entry, "2026/20261018.md"));
  const record = { el: entry, path: "2026/20261018.md", chip: null };
  assert.equal(plugin.renderPomodoroHomeReadingRecord(record), true);
  assert.equal(record.chip.getAttribute("data-home-state"), "forecast");
  assert.equal(record.chip.getAttribute("data-home-hue"), "blue");
  assert.equal(record.chip.children[1].textContent, "sase_blog");
  assert.equal(entry.children.at(-2), record.chip);
  assert.equal(plugin.pomodoroHomeReadingEntry(entry, "2026/20261018.md").entry.name, "BLOG");
  assert.equal(
    entry.children.filter((child) => child.getAttribute("class") === "bob-pomodoro-home-chip").length,
    1,
  );

  anchor.setAttribute("data-href", "bob#^home-chip");
  assert.equal(plugin.renderPomodoroHomeReadingRecord(record), true);
  assert.equal(record.chip.children[1].textContent, "bob");
  assert.equal(plugin.pomodoroHomeReadingEntry(entry, "2026/20261018.md").entry.name, "BLOG");
  assert.equal(
    entry.children.filter((child) => child.getAttribute("class") === "bob-pomodoro-home-chip").length,
    1,
  );

  notes["sase_blog.md"] = notes["sase_blog.md"].replace("parent: [[sase]]", "parent: [[dev]]");
  anchor.setAttribute("data-href", "sase_blog#^home-chip");
  assert.equal(plugin.renderPomodoroHomeReadingRecord(record), true);
  assert.equal(record.chip.children[1].textContent, "sase_blog");
  assert.equal(plugin.pomodoroHomeReadingEntry(entry, "2026/20261018.md").entry.name, "BLOG");
  assert.equal(
    entry.children.filter((child) => child.getAttribute("class") === "bob-pomodoro-home-chip").length,
    1,
  );

  const makeEntry = (text, href) => {
    const row = doc.createElement("LI");
    row.setAttribute("data-task", " ");
    row.appendChild(doc.createTextNode(text));
    const rowList = doc.createElement("UL");
    const taskRow = doc.createElement("LI");
    const taskLink = doc.createElement("A");
    taskLink.setAttribute("class", "internal-link");
    taskLink.setAttribute("data-href", href);
    taskRow.appendChild(taskLink);
    rowList.appendChild(taskRow);
    row.appendChild(rowList);
    topList.appendChild(row);
    return row;
  };
  const reviewEntry = makeEntry(" (1400-1410)", "2026/20261018#^gtd");
  const reviewRecord = { el: reviewEntry, path: "2026/20261018.md", chip: null };
  assert.equal(plugin.renderPomodoroHomeReadingRecord(reviewRecord), true);
  const reviewContext = plugin.pomodoroHomeReadingEntry(reviewEntry, "2026/20261018.md");
  assert.equal(reviewContext.entry.name, "");
  assert.equal(plugin.pomodoroHomeChipModelForEntry(reviewContext.entry, "2026/20261018.md").kind, "work");
  assert.equal(reviewRecord.chip.children[1].textContent, "unfiled");
  assert.equal(plugin.renderPomodoroHomeReadingRecord(reviewRecord), true);
  assert.equal(
    reviewEntry.children.filter((child) => child.getAttribute("class") === "bob-pomodoro-home-chip").length,
    1,
  );

  const namedReviewEntry = makeEntry(" (1410-1420) — PLAN", "2026/20261018#^gtd");
  const namedReviewRecord = { el: namedReviewEntry, path: "2026/20261018.md", chip: null };
  assert.equal(plugin.renderPomodoroHomeReadingRecord(namedReviewRecord), true);
  const namedReviewContext = plugin.pomodoroHomeReadingEntry(namedReviewEntry, "2026/20261018.md");
  const namedReviewModel = plugin.pomodoroHomeChipModelForEntry(namedReviewContext.entry, "2026/20261018.md");
  assert.equal(namedReviewContext.entry.name, "PLAN");
  assert.equal(namedReviewModel.kind, "work");
  assert.equal(namedReviewModel.chip, "unfiled");
  assert.ok(namedReviewRecord.chip);

  const css = fs.readFileSync(
    path.join(__dirname, "../plugins/bob-ledger-tools/styles.css"),
    "utf8",
  );
  assert.match(css, /\.theme-light\s*\{[^}]*--bob-area-blue:\s*#2a78d6/s);
  assert.match(css, /\.theme-dark\s*\{[^}]*--bob-area-blue:\s*#3987e5/s);
  assert.match(css, /data-home-state="forecast"/);
});

test("Live Preview places a chip widget at the end of the Pomodoro line", () => {
  const { metadataCache, vault } = fakeVault(fixture.notes);
  const plugin = new LedgerToolsPlugin({ metadataCache, vault }, {});
  plugin.pomodoroHomeChipsEnabled = true;
  const content =
    "## Pomodoros\n- [ ] (1350-1405) — BLOG\n  - [[sase_blog#^home-chip]]\n";
  const lines = content.split("\n");
  const state = {
    field(field) {
      return field === EDITOR_INFO_FIELD
        ? { file: { path: "2026/20261018.md" } }
        : true;
    },
    doc: {
      toString: () => content,
      line(number) {
        const text = lines[number - 1];
        const from = lines.slice(0, number - 1).join("\n").length + (number > 1 ? 1 : 0);
        return { from, to: from + text.length };
      },
    },
  };
  const decorations = plugin.buildPomodoroHomeChipDecorations({ state });
  assert.equal(decorations.length, 1);
  assert.equal(decorations[0].from, lines[0].length + 1 + lines[1].length);
  assert.equal(decorations[0].value.widget.model.chip, "sase_blog");
  assert.equal(decorations[0].value.widget.model.state, "forecast");
});

test("Live Preview skips chips in Source mode", () => {
  const { metadataCache, vault } = fakeVault(fixture.notes);
  const plugin = new LedgerToolsPlugin({ metadataCache, vault }, {});
  plugin.pomodoroHomeChipsEnabled = true;
  const content =
    "## Pomodoros\n- [ ] (1350-1405) — BLOG\n  - [[sase_blog#^home-chip]]\n";
  const lines = content.split("\n");
  const state = {
    field(field) {
      if (field === EDITOR_INFO_FIELD) {
        return { file: { path: "2026/20261018.md" } };
      }
      if (field === LIVE_PREVIEW_FIELD) {
        return false;
      }
      return true;
    },
    doc: {
      toString: () => content,
      line(number) {
        const text = lines[number - 1];
        const from = lines.slice(0, number - 1).join("\n").length + (number > 1 ? 1 : 0);
        return { from, to: from + text.length };
      },
    },
  };
  const decorations = plugin.buildPomodoroHomeChipDecorations({ state });
  assert.equal(Array.isArray(decorations) ? decorations.length : 0, 0);
});

test("Reading view finds embedded Task Links via src", () => {
  class Node {
    // Hidden back-references bound assert diffs; this descriptor keeps inspect and reporter output short.
    [require("node:util").inspect.custom]() {
      const cls = this.attributes ? this.attributes.class : null;
      const kids = Array.isArray(this.childNodes) ? this.childNodes.length : 0;
      const raw = typeof this._text === "string" ? this._text : "";
      const flat = raw.replace(/\s+/g, " ");
      const text = flat.length > 40 ? flat.slice(0, 40) + "…" : flat;
      const dot = cls ? "." + String(cls).split(/\s+/).filter(Boolean).join(".") : "";
      return `Node(${this.tagName}${dot} children=${kids} text=${JSON.stringify(text)})`;
    }

    constructor(tagName, nodeType = 1, text = "") {
      this.tagName = tagName;
      this.nodeName = tagName;
      this.nodeType = nodeType;
      this.childNodes = [];
      this.attributes = {};
      this.dataset = {};
      this.parentNode = null;
      this.previousSibling = null;
      this.nextSibling = null;
      this.ownerDocument = doc;
      this.isConnected = true;
      this._text = text;
      this.nodeValue = nodeType === 3 ? text : null;
      hideNodeFields(this, ["parentNode", "ownerDocument", "previousSibling", "nextSibling"]);
    }

    get children() {
      return this.childNodes.filter((node) => node.nodeType === 1);
    }

    get textContent() {
      return this._text + this.childNodes.map((node) => node.textContent || "").join("");
    }

    set textContent(value) {
      this._text = String(value);
      this.childNodes = [];
    }

    appendChild(node) {
      node.parentNode = this;
      this.childNodes.push(node);
      this.relink();
      return node;
    }

    insertBefore(node, before) {
      const index = this.childNodes.indexOf(before);
      node.parentNode = this;
      this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
      this.relink();
      return node;
    }

    removeChild(node) {
      const index = this.childNodes.indexOf(node);
      if (index >= 0) {
        this.childNodes.splice(index, 1);
        node.parentNode = null;
        this.relink();
      }
      return node;
    }

    relink() {
      this.childNodes.forEach((node, index) => {
        node.previousSibling = this.childNodes[index - 1] || null;
        node.nextSibling = this.childNodes[index + 1] || null;
      });
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name.startsWith("data-")) {
        const key = name
          .slice(5)
          .replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        this.dataset[key] = String(value);
      }
    }

    getAttribute(name) {
      return this.attributes[name] || null;
    }

    querySelectorAll(selector) {
      const result = [];
      const matches = (node) => {
        if (selector === "li") {
          return node.tagName === "LI";
        }
        return (
          (node.tagName === "A" && String(node.attributes.class || "").split(/\s+/).includes("internal-link")) ||
          String(node.attributes.class || "").split(/\s+/).includes("internal-embed")
        );
      };
      const visit = (node) => {
        for (const child of node.childNodes || []) {
          if (child.nodeType === 1 && matches(child)) {
            result.push(child);
          }
          if (child.nodeType === 1) {
            visit(child);
          }
        }
      };
      visit(this);
      return result;
    }
  }
  const doc = {
    createElement: (tagName) => new Node(String(tagName).toUpperCase()),
    createTextNode: (text) => new Node("#text", 3, String(text)),
  };
  const task = doc.createElement("LI");
  const embed = doc.createElement("DIV");
  embed.setAttribute("class", "internal-embed");
  embed.setAttribute("src", "sase_blog#^home-chip");
  task.appendChild(embed);
  const { metadataCache, vault } = fakeVault(fixture.notes);
  const plugin = new LedgerToolsPlugin({ metadataCache, vault }, {});
  assert.deepEqual(plugin.pomodoroHomeReadingLinkFromRow(task), {
    target: "sase_blog",
    blockId: "home-chip",
  });
});

test("Obsidian frontmatter shapes unwrap nested wikilink arrays", () => {
  const values = parseFrontmatter("---\ntype: [[project]]\nparent: [[dev]]\nrollup: subprojects\n---\n");
  assert.deepEqual(values.type, [["project"]]);
  assert.deepEqual(values.parent, [["dev"]]);
  assert.equal(values.rollup, "subprojects");
  assert.equal(LedgerToolsPlugin.helpers.pomodoroHomeType(values), "project");
  assert.equal(LedgerToolsPlugin.helpers.pomodoroHomeParentTarget(values.parent), "dev");
  assert.equal(LedgerToolsPlugin.helpers.pomodoroHomeParentTarget("[[dev]]"), "dev");
  assert.equal(LedgerToolsPlugin.helpers.pomodoroHomeParentTarget(["[[dev]]"]), "");
  assert.equal(LedgerToolsPlugin.helpers.pomodoroHomeParentTarget("dev"), "");
  assert.deepEqual(LedgerToolsPlugin.helpers.pomodoroHomePercentages([1, 1, 1]), [34, 33, 33]);
});
