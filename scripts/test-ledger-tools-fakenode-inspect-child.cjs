// Capped-heap probe for bob-cli-c7 (run by
// test-ledger-tools-fakenode-inspect.cjs, never by npm test directly).
//
// Builds the 85-node cyclic FakeNode tree (depth 3, fan-out 4, one click
// listener per node, live inserted/removed bookkeeping like the real
// suites) and deliberately fails a node-identity assert in the safe
// `assert.ok(left === right, message)` form. Prints the failure message and
// exits 0. Under `--max-old-space-size=1024` the equivalent `assert.equal`
// on the same tree aborts with a heap OOM (exit 134); this form must report
// in milliseconds.
const assert = require("node:assert/strict");
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

function nodeNote(message, ...nodes) {
  return `${message} [${nodes.map((node) => util.inspect(node)).join(" vs ")}]`;
}

const doc = {};
const root = new FakeNode("div", doc);
root.appendChild(buildTree(doc, 3, 4, "alpha"));
root.appendChild(buildTree(doc, 3, 4, "beta"));
const left = root.children[0];
const right = root.children[1];
try {
  assert.ok(left === right, nodeNote("child reports under the cap", left, right));
  process.exitCode = 1;
} catch (error) {
  console.log(error.message);
}
