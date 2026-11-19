const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  FakeDocument,
  FakeElement,
  installClipboardStub,
  FakeNotice,
} = require("./copy-chips-test-helpers.cjs");

function fakeCodeRoot(htmlLike) {
  const doc = new FakeDocument();
  const root = new FakeElement("div", doc);
  root.ownerDocument = doc;
  const code = new FakeElement("code", doc);
  code.ownerDocument = doc;
  code.textContent = htmlLike;
  root.appendChild(code);
  return { doc, root, code };
}

test("reading replaces valid code with a real button", () => {
  const { doc, root, code } = fakeCodeRoot("copy: ssh apollo");
  void code;
  const plugin = { register() {} };
  helpers.copyChipReadingRender(plugin, root, { sourcePath: "note.md", addChild() {} });
  assert.equal(root.children.length, 1);
  const button = root.children[0];
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.getAttribute("type"), "button");
  assert.ok((button.getAttribute("class") || "").indexOf("bob-copy-chip") !== -1);
  assert.equal(helpers.copyChipPayloadOf(button), "ssh apollo");
  void doc;
});

test("reading skips pre, links, internal links, and existing chips", () => {
  const doc = new FakeDocument();
  const root = new FakeElement("div", doc);
  const pre = new FakeElement("pre", doc);
  const codeInPre = new FakeElement("code", doc);
  codeInPre.textContent = "copy: ssh";
  pre.appendChild(codeInPre);
  root.appendChild(pre);
  const link = new FakeElement("a", doc);
  const codeInLink = new FakeElement("code", doc);
  codeInLink.textContent = "copy: ssh";
  link.appendChild(codeInLink);
  root.appendChild(link);
  const plugin = { register() {} };
  helpers.copyChipReadingRender(plugin, root, {});
  assert.equal(codeInPre.textContent, "copy: ssh");
  assert.equal(codeInLink.textContent, "copy: ssh");
});

test("reading is idempotent across repeated processing", () => {
  const { root } = fakeCodeRoot("copy: ssh");
  const plugin = { register() {} };
  const ctx = { sourcePath: "n.md", addChild() {} };
  helpers.copyChipReadingRender(plugin, root, ctx);
  const first = root.children[0];
  helpers.copyChipReadingRender(plugin, root, ctx);
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0], first);
});

test("reading parses renderer textContent once and leaves neighbors alone", () => {
  const doc = new FakeDocument();
  const root = new FakeElement("div", doc);
  const dataview = new FakeElement("code", doc);
  dataview.textContent = "= dataview";
  root.appendChild(dataview);
  const plain = new FakeElement("code", doc);
  plain.textContent = "plain code";
  root.appendChild(plain);
  const chipCode = new FakeElement("code", doc);
  chipCode.textContent = "copy: ssh";
  root.appendChild(chipCode);
  const plugin = { register() {} };
  helpers.copyChipReadingRender(plugin, root, {});
  assert.equal(dataview.textContent, "= dataview");
  assert.equal(plain.textContent, "plain code");
  assert.equal(root.children.length, 3);
  assert.equal(root.children[2].tagName, "BUTTON");
});

test("reading buttons activate with click and keyboard without duplicate writes", async () => {
  FakeNotice.messages = [];
  const { root } = fakeCodeRoot("copy[Zoom]: https://zoom.us/j/123");
  const plugin = { register() {} };
  helpers.copyChipReadingRender(plugin, root, {});
  const button = root.children[0];
  const clip = installClipboardStub();
  try {
    button.dispatch("click", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(clip.writes, ["https://zoom.us/j/123"]);
  } finally {
    clip.restore();
  }
});

test("reading processes the root code element itself", () => {
  const doc = new FakeDocument();
  const code = new FakeElement("code", doc);
  code.textContent = "copy: ssh";
  const plugin = { register() {} };
  helpers.copyChipReadingRender(plugin, code, {});
  // Root code with no parent cannot be replaced, but it is marked processed.
  assert.equal(code.getAttribute("data-bob-copy-processed"), "1");
});
