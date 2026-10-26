// Regression for bob-cli-c7: a failing node-identity assert on two live
// FakeNodes must report instead of exhausting the heap.
//
// Two findings shape this suite (verified on Node v22 under
// `--max-old-space-size=1024` with the verbatim plan-host FakeNode):
//
// 1. `assert.equal` / `assert.deepEqual` on two live nodes abort with a heap
//    OOM (exit 134 after ~8 s) because assert's structural differ walks the
//    whole cyclic graph. A `util.inspect.custom` descriptor does not change
//    that: assert's differ ignores it, and even a custom assert message does
//    not stop the diff. Node-identity checks must therefore stay in the
//    `assert.ok(left === right, message)` form, which never diffs.
// 2. The failure message must still name both nodes. Each ledger-tools suite
//    gives its FakeNode-style fake a short `util.inspect.custom` descriptor
//    (tag, classes, child count, short text prefix); `util.inspect` in a
//    message uses it, so the message stays a one-liner per node.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const util = require("node:util");

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
    this.isConnected = true;
    this.removed = [];
    this.inserted = [];
  }

  // Mirrors the descriptor each ledger-tools suite carries (bob-cli-c7).
  [require("node:util").inspect.custom]() {
    const cls = this.getAttribute("class");
    const kids = Array.isArray(this.children) ? this.children.length : 0;
    const raw = typeof this._text === "string" ? this._text : "";
    const flat = raw.replace(/\s+/g, " ");
    const text = flat.length > 40 ? flat.slice(0, 40) + "…" : flat;
    const dot = cls ? "." + String(cls).split(/\s+/).filter(Boolean).join(".") : "";
    return `FakeNode(${this.tagName}${dot} children=${kids} text=${JSON.stringify(text)})`;
  }

  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }

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

function buildTree(doc, depth, fanout, label) {
  const node = new FakeNode("div", doc);
  node.setAttribute("class", label);
  node._text = `${label}-text`;
  node.addEventListener("click", () => {});
  if (depth > 0) {
    for (let i = 0; i < fanout; i += 1) {
      node.appendChild(buildTree(doc, depth - 1, fanout, `${label}-${i}`));
    }
  }
  return node;
}

// Depth 3, fan-out 4 per side with one click listener per node, matching the
// bob-cli-c7 reproduction shape.
function build85NodeTree() {
  const doc = {};
  const root = new FakeNode("div", doc);
  root.appendChild(buildTree(doc, 3, 4, "alpha"));
  root.appendChild(buildTree(doc, 3, 4, "beta"));
  return root;
}

function nodeNote(message, ...nodes) {
  return `${message} [${nodes.map((node) => util.inspect(node)).join(" vs ")}]`;
}

test("failing node-identity assert names both descriptors within seconds", () => {
  const root = build85NodeTree();
  const left = root.children[0];
  const right = root.children[1];
  const started = Date.now();
  let thrown = null;
  try {
    assert.ok(left === right, nodeNote(".bob-plan sits directly after the host", left, right));
  } catch (error) {
    thrown = error;
  }
  const elapsed = Date.now() - started;
  assert.ok(thrown, "the failing comparison throws");
  assert.equal(thrown.name, "AssertionError");
  assert.match(thrown.message, /FakeNode\(DIV\.alpha\b/);
  assert.match(thrown.message, /FakeNode\(DIV\.beta\b/);
  assert.ok(elapsed < 10000, `reports in ${elapsed}ms, well under the OOM horizon`);
});

test("failing node-identity assert stays bounded under a 1024MB heap cap", () => {
  const helperPath = path.join(__dirname, "test-ledger-tools-fakenode-inspect-child.cjs");
  const started = Date.now();
  const output = execFileSync(
    process.execPath,
    ["--max-old-space-size=1024", helperPath],
    { encoding: "utf8", timeout: 90000 },
  );
  const elapsed = Date.now() - started;
  assert.match(output, /FakeNode\(DIV\.alpha\b/);
  assert.match(output, /FakeNode\(DIV\.beta\b/);
  assert.ok(elapsed < 90000, `child reports in ${elapsed}ms under the heap cap`);
});

test("every ledger-tools FakeNode-style fake carries a short descriptor", () => {
  const expected = {
    "test-ledger-tools-day-strip.cjs": 1,
    "test-ledger-tools-day-strip-hosts.cjs": 1,
    "test-ledger-tools-day-strip-plan-host.cjs": 1,
    "test-ledger-tools-reading-board-block.cjs": 1,
    "test-ledger-tools-stats-block.cjs": 1,
    "test-ledger-tools-stats-charts.cjs": 1,
    "test-ledger-tools-stats-panels.cjs": 1,
    "test-ledger-tools-blocks-chips.cjs": 1,
    "test-ledger-tools-relation-chips.cjs": 1,
    "test-ledger-tools-pomodoro-home-chips.cjs": 2,
    "test-ledger-tools-fakenode-inspect.cjs": 1,
    "test-ledger-tools-fakenode-inspect-child.cjs": 1,
  };
  for (const [file, count] of Object.entries(expected)) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    const found = source.split("inspect.custom" + "](").length - 1;
    assert.equal(found, count, `${file} carries its descriptor(s)`);
  }
});
