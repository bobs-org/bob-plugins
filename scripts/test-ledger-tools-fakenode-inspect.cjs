// Regression for bob-cli-c7: failing strict asserts on live FakeNodes should
// produce a bounded diff. Hidden back-references keep assert's structural diff
// small; inspect.custom keeps util.inspect and node:test reporter output short.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
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

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.style = {};
    this._text = "";
    this._closest = null;
    this.isConnected = true;
    this.removed = [];
    this.inserted = [];
    this._classSet = new Set();
    this.classList = {
      add: (name) => { this._classSet.add(name); this._syncClass(); },
      remove: (name) => { this._classSet.delete(name); this._syncClass(); },
      contains: (name) => this._classSet.has(name),
    };
    hideNodeFields(this, ["ownerDocument", "parentNode", "_closest", "removed", "inserted"]);
  }

  // Hidden back-references bound assert diffs; this descriptor keeps inspect and reporter output short.
  [require("node:util").inspect.custom]() {
    const cls = this.getAttribute("class");
    const kids = Array.isArray(this.children) ? this.children.length : 0;
    const raw = typeof this._text === "string" ? this._text : "";
    const flat = raw.replace(/\s+/g, " ");
    const text = flat.length > 40 ? flat.slice(0, 40) + "…" : flat;
    const dot = cls ? "." + String(cls).split(/\s+/).filter(Boolean).join(".") : "";
    return `FakeNode(${this.tagName}${dot} children=${kids} text=${JSON.stringify(text)})`;
  }

  _syncClass() {
    if (this._classSet.size) this.attrs.set("class", Array.from(this._classSet).join(" "));
    else this.attrs.delete("class");
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "class") this._classSet = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  getAttribute(name) {
    if (name === "class" && this._classSet.size && !this.attrs.has("class")) {
      return Array.from(this._classSet).join(" ");
    }
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    this.inserted.push(child);
    return child;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
}

function build42NodeSubtree(doc, label) {
  const root = new FakeNode("div", doc);
  root.setAttribute("class", label);
  root._text = `${label}-text`;
  root.addEventListener("click", () => {});

  let level = [root];
  let created = 1;
  for (let depth = 0; depth < 3; depth += 1) {
    const next = [];
    for (const parent of level) {
      for (let childIndex = 0; childIndex < 4 && created < 42; childIndex += 1) {
        const child = new FakeNode("div", doc);
        const childLabel = `${label}-${depth}-${next.length}`;
        child.setAttribute("class", childLabel);
        child._text = `${childLabel}-text`;
        child.addEventListener("click", () => {});
        parent.appendChild(child);
        next.push(child);
        created += 1;
      }
      if (created === 42) break;
    }
    level = next;
  }
  assert.equal(created, 42, `${label} subtree has 42 nodes`);
  return root;
}

test("regression FakeNode hides the plan-host cycles and builds 85 nodes", () => {
  const doc = {};
  const root = new FakeNode("div", doc);
  root.appendChild(build42NodeSubtree(doc, "alpha"));
  root.appendChild(build42NodeSubtree(doc, "beta"));
  const pending = [root];
  let count = 0;
  while (pending.length) {
    const node = pending.pop();
    count += 1;
    pending.push(...node.children);
    for (const field of ["ownerDocument", "parentNode", "_closest", "removed", "inserted"]) {
      assert.equal(Object.keys(node).includes(field), false, `${field} stays hidden`);
    }
  }
  assert.equal(count, 85);
});

test("failing assert.equal and assert.deepEqual report under a 1024MB cap", () => {
  const helperPath = path.join(__dirname, "test-ledger-tools-fakenode-inspect-child.cjs");
  const started = Date.now();
  const output = execFileSync(
    process.execPath,
    ["--max-old-space-size=1024", helperPath],
    { encoding: "utf8", timeout: 15000 },
  );
  const elapsed = Date.now() - started;
  const reports = [...output.matchAll(/(assert\.(?:equal|deepEqual)): AssertionError in (\d+)ms; alpha and beta both appear in the message/g)];
  assert.equal(reports.length, 2, output);
  assert.deepEqual(reports.map(([, assertion]) => assertion), ["assert.equal", "assert.deepEqual"]);
  for (const [, , milliseconds] of reports) {
    assert.ok(Number(milliseconds) < 5000, `each failure reports within a few seconds: ${output}`);
  }
  assert.ok(elapsed < 15000, `child completes in ${elapsed}ms under the heap cap`);
});

test("every ledger-tools FakeNode-style fake has a descriptor and hides its cyclic fields", () => {
  const expected = {
    "test-ledger-tools-day-strip.cjs": {
      descriptors: 1,
      hidden: [["ownerDocument", "parentNode"]],
    },
    "test-ledger-tools-day-strip-hosts.cjs": {
      descriptors: 1,
      hidden: [["ownerDocument", "parentNode", "_closest"]],
    },
    "test-ledger-tools-day-strip-plan-host.cjs": {
      descriptors: 1,
      hidden: [["ownerDocument", "parentNode", "_closest", "removed", "inserted"]],
    },
    "test-ledger-tools-reading-board-block.cjs": {
      descriptors: 1,
      hidden: [["doc", "parentNode"]],
    },
    "test-ledger-tools-stats-block.cjs": {
      descriptors: 1,
      hidden: [["doc"]],
    },
    "test-ledger-tools-stats-charts.cjs": {
      descriptors: 1,
      hidden: [["ownerDocument", "parentNode"]],
    },
    "test-ledger-tools-stats-panels.cjs": {
      descriptors: 1,
      hidden: [["ownerDocument", "parentNode"]],
    },
    "test-ledger-tools-blocks-chips.cjs": {
      descriptors: 1,
      hidden: [["parentNode", "ownerDocument"]],
    },
    "test-ledger-tools-relation-chips.cjs": {
      descriptors: 1,
      hidden: [["parentNode", "ownerDocument"]],
    },
    "test-ledger-tools-pomodoro-home-chips.cjs": {
      descriptors: 2,
      hidden: [
        ["parentNode", "ownerDocument", "previousSibling", "nextSibling"],
        ["parentNode", "ownerDocument", "previousSibling", "nextSibling"],
      ],
    },
    "test-ledger-tools-fakenode-inspect.cjs": {
      descriptors: 1,
      hidden: [["ownerDocument", "parentNode", "_closest", "removed", "inserted"]],
    },
    "test-ledger-tools-fakenode-inspect-child.cjs": {
      descriptors: 1,
      hidden: [["ownerDocument", "parentNode", "_closest", "removed", "inserted"]],
    },
  };
  for (const [file, { descriptors, hidden }] of Object.entries(expected)) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    const found = source.split("inspect.custom" + "](").length - 1;
    assert.equal(found, descriptors, `${file} carries its descriptor(s)`);
    const calls = [...source.matchAll(/hideNodeFields\(this,\s*\[([^\]]*)\]\)/g)].map(([, fields]) =>
      [...fields.matchAll(/"([^"]+)"/g)].map(([, field]) => field),
    );
    assert.deepEqual(calls, hidden, `${file} hides each expected back-reference and bookkeeping field`);
  }
});
