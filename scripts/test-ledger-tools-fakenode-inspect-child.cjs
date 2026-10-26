// Capped-heap probe for bob-cli-c7, run by
// test-ledger-tools-fakenode-inspect.cjs and never directly by npm test.
//
// Builds an 85-node plan-host FakeNode tree: a root plus two 42-node subtrees,
// with depth 3, at most four children per node, and one click listener per
// node. Deliberately failing assert.equal and assert.deepEqual calls must each
// report both subtree labels under a 1024MB heap cap.
const assert = require("node:assert/strict");

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

const doc = {};
const root = new FakeNode("div", doc);
root.appendChild(build42NodeSubtree(doc, "alpha"));
root.appendChild(build42NodeSubtree(doc, "beta"));
const [alpha, beta] = root.children;

for (const [name, compare] of [
  ["assert.equal", (left, right) => assert.equal(left, right)],
  ["assert.deepEqual", (left, right) => assert.deepEqual(left, right)],
]) {
  const started = Date.now();
  let thrown = null;
  try {
    compare(alpha, beta);
  } catch (error) {
    thrown = error;
  }
  const elapsed = Date.now() - started;
  if (!thrown) throw new Error(`${name} unexpectedly accepted different subtrees`);
  if (thrown.name !== "AssertionError") throw thrown;
  if (!/alpha/i.test(thrown.message) || !/beta/i.test(thrown.message)) {
    throw new Error(`${name} did not distinguish alpha and beta in its AssertionError`);
  }
  console.log(`${name}: AssertionError in ${elapsed}ms; alpha and beta both appear in the message`);
}
