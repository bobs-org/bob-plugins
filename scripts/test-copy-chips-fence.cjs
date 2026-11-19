const assert = require("node:assert/strict");
const test = require("node:test");
const {
  helpers,
  FakeDocument,
  FakeNotice,
  installClipboardStub,
} = require("./copy-chips-test-helpers.cjs");

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

function allAttrs(node, out) {
  out = out || [];
  if (node.attrs) {
    for (const [name, value] of node.attrs) out.push([node.tagName + "." + name, String(value)]);
  }
  for (const child of node.children || []) allAttrs(child, out);
  return out;
}

test("fence source payload is verbatim with CRLF normalized", () => {
  assert.equal(helpers.copyChipFencePayloadFromSource("hello"), "hello");
  assert.equal(helpers.copyChipFencePayloadFromSource("hello\n"), "hello\n");
  assert.equal(helpers.copyChipFencePayloadFromSource("a\n\nb"), "a\n\nb");
  assert.equal(helpers.copyChipFencePayloadFromSource("hello\n\n"), "hello\n\n");
  assert.equal(helpers.copyChipFencePayloadFromSource("a\r\n\r\nb\r\n"), "a\n\nb\n");
  assert.equal(helpers.copyChipFencePayloadFromSource("a\rb"), "a\nb");
  // Never trimmed: spaces and tabs survive on both edges.
  assert.equal(helpers.copyChipFencePayloadFromSource("  padded  "), "  padded  ");
  assert.equal(helpers.copyChipFencePayloadFromSource("\ttab\t"), "\ttab\t");
  assert.equal(helpers.copyChipFencePayloadFromSource(""), "");
  assert.equal(helpers.copyChipFencePayloadFromSource(null), "");
  assert.equal(helpers.copyChipFencePayloadFromSource(undefined), "");
});

test("fence opening parses marker, indent, and info", () => {
  assert.deepEqual(
    helpers.copyChipFenceOpeningFromLine("```bob-copy Weekly"),
    { indent: 0, markerChar: "`", markerLength: 3, info: "bob-copy Weekly" },
  );
  assert.deepEqual(
    helpers.copyChipFenceOpeningFromLine("  ````bob-copy"),
    { indent: 2, markerChar: "`", markerLength: 4, info: "bob-copy" },
  );
  assert.deepEqual(
    helpers.copyChipFenceOpeningFromLine("~~~bob-copy T"),
    { indent: 0, markerChar: "~", markerLength: 3, info: "bob-copy T" },
  );
  // A backtick fence whose info holds a backtick can never close.
  assert.equal(helpers.copyChipFenceOpeningFromLine("```js `x`"), null);
  assert.equal(helpers.copyChipFenceOpeningFromLine("plain line"), null);
  assert.equal(helpers.copyChipFenceOpeningFromLine(""), null);
  assert.equal(helpers.copyChipFenceOpeningFromLine(null), null);
});

test("fence label comes from the section opening line", () => {
  assert.equal(
    helpers.copyChipFenceLabelFromSectionText("```bob-copy Weekly status\nhello\n```"),
    "Weekly status",
  );
  assert.equal(
    helpers.copyChipFenceLabelFromSectionText("```bob-copy [Q report]\nhello\n```"),
    "Q report",
  );
  assert.equal(helpers.copyChipFenceLabelFromSectionText("```bob-copy\nhello\n```"), null);
  assert.equal(
    helpers.copyChipFenceLabelFromSectionText("- item\n  ```bob-copy Nested\n  hi\n  ```"),
    "Nested",
  );
  assert.equal(
    helpers.copyChipFenceLabelFromSectionText("~~~bob-copy Tilde\nx\n~~~"),
    "Tilde",
  );
  // Callouts never match an opening: generic title.
  assert.equal(helpers.copyChipFenceLabelFromSectionText("> ```bob-copy\n> hi\n> ```"), null);
  assert.equal(helpers.copyChipFenceLabelFromSectionText("```js\nx\n```"), null);
  assert.equal(helpers.copyChipFenceLabelFromSectionText(""), null);
  assert.equal(helpers.copyChipFenceLabelFromSectionText(null), null);
});

test("fence counts, meta, and title", () => {
  assert.deepEqual(helpers.copyChipFenceCounts(""), { lines: 0, chars: 0 });
  assert.deepEqual(helpers.copyChipFenceCounts("hello"), { lines: 1, chars: 5 });
  assert.deepEqual(helpers.copyChipFenceCounts("hello\n"), { lines: 1, chars: 6 });
  assert.deepEqual(helpers.copyChipFenceCounts("a\n\nb"), { lines: 3, chars: 4 });
  assert.ok(Object.isFrozen(helpers.copyChipFenceCounts("x")));
  assert.equal(helpers.copyChipFenceMetaText("Hi team —\nHere is where things stand:"), "2 lines · 37 chars");
  assert.equal(helpers.copyChipFenceMetaText("hello\n"), "1 line · 6 chars · ends with ⏎");
  assert.equal(helpers.copyChipFenceMetaText("solo"), "1 line · 4 chars");
  assert.equal(helpers.copyChipFenceTitleText("Weekly status", "a"), "Weekly status");
  assert.equal(helpers.copyChipFenceTitleText(null, "a\nb"), "Copy · 2 lines");
  assert.equal(helpers.copyChipFenceTitleText("  ", "a"), "Copy · 1 line");
  assert.equal(helpers.copyChipFenceTitleText(null, ""), "Copy · 0 lines");
});

test("fence card renders title, meta, and byte-exact body", () => {
  const doc = new FakeDocument();
  const payload = "Hi team —\n\nHere is where things stand:\n";
  const card = helpers.copyChipBuildFence(doc, { label: "Weekly status", text: payload });
  assert.ok(card);
  assert.equal(card.tagName, "DIV");
  assert.ok((card.getAttribute("class") || "").indexOf("bob-copy-fence") !== -1);
  const title = card.querySelector(".bob-copy-fence-title");
  assert.equal(title.textContent, "Weekly status");
  const meta = card.querySelector(".bob-copy-fence-meta");
  assert.equal(meta.textContent, "3 lines · " + payload.length + " chars · ends with ⏎");
  const body = card.querySelector(".bob-copy-fence-body");
  assert.equal(body.textContent, payload);
  const button = card.querySelector(".bob-copy-fence-copy");
  assert.ok(button);
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.textContent, "Copy");
  const glyph = card.querySelector(".bob-copy-chip-glyph");
  assert.ok(glyph);
  // Generic title when the label is missing.
  const generic = helpers.copyChipBuildFence(doc, { label: null, text: "x" });
  assert.equal(generic.querySelector(".bob-copy-fence-title").textContent, "Copy · 1 line");
  // Short bodies never fold.
  assert.equal(generic.querySelector(".bob-copy-fence-toggle"), null);
  assert.equal(generic.querySelector(".bob-copy-fence-body").classList.contains("is-folded"), false);
  // Garbage never throws.
  assert.equal(helpers.copyChipBuildFence(null, { label: null, text: "x" }), null);
  assert.equal(helpers.copyChipBuildFence(doc, null), null);
  assert.equal(helpers.copyChipBuildFence(doc, { label: null, text: 42 }), null);
  assert.equal(helpers.copyChipBuildFence(doc, { label: 42, text: "x" }), null);
});

test("fence payload never reaches attributes", () => {
  const doc = new FakeDocument();
  const payload = "secret-payload-xyz :: `copy: x` <b>&amp;</b>";
  const card = helpers.copyChipBuildFence(doc, { label: "L", text: payload });
  for (const [where, value] of allAttrs(card)) {
    assert.equal(value.indexOf("secret-payload-xyz"), -1, "payload leaked into " + where);
  }
  assert.equal(helpers.copyChipFencePayloadOf(card), payload);
  assert.equal(helpers.copyChipFencePayloadOf(null), null);
});

test("fence card folds after eight lines behind a toggle", () => {
  const doc = new FakeDocument();
  const lines = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9"];
  const card = helpers.copyChipBuildFence(doc, { label: "L", text: lines.join("\n") });
  const body = card.querySelector(".bob-copy-fence-body");
  assert.equal(body.classList.contains("is-folded"), true);
  // Folded state keeps the full text; CSS clamps the visible lines.
  assert.equal(body.textContent, lines.join("\n"));
  const toggle = card.querySelector(".bob-copy-fence-toggle");
  assert.ok(toggle);
  assert.equal(toggle.textContent, "Show all 9 lines");
  toggle.dispatch("click", {});
  assert.equal(body.classList.contains("is-folded"), false);
  assert.equal(toggle.textContent, "Show less");
  toggle.dispatch("click", {});
  assert.equal(body.classList.contains("is-folded"), true);
  assert.equal(toggle.textContent, "Show all 9 lines");
  // Exactly eight lines stays unfolded with no toggle.
  const eight = helpers.copyChipBuildFence(doc, { label: "L", text: lines.slice(0, 8).join("\n") });
  assert.equal(eight.querySelector(".bob-copy-fence-body").classList.contains("is-folded"), false);
  assert.equal(eight.querySelector(".bob-copy-fence-toggle"), null);
});

function renderFenceCard(doc, payload, sectionText) {
  const el = new FakeElementShim(doc);
  const plugin = { registered: [], register(fn) { this.registered.push(fn); } };
  const ctx = {
    getSectionInfo() {
      return typeof sectionText === "string" ? { text: sectionText } : null;
    },
    addChild() {},
  };
  helpers.copyChipRenderFence(plugin, payload, el, ctx);
  assert.equal(el.children.length, 1);
  return el.children[0];
}

test("fence copy button copies byte-exact; body clicks never copy", async () => {
  FakeNotice.messages = [];
  const doc = new FakeDocument();
  const payload = "line one\n\nline three\n";
  const card = renderFenceCard(doc, payload, "```bob-copy L\n" + payload + "```");
  const button = card.querySelector(".bob-copy-fence-copy");
  const body = card.querySelector(".bob-copy-fence-body");
  const clip = installClipboardStub();
  try {
    body.dispatch("click", {});
    await tick();
    assert.deepEqual(clip.writes, []);
    button.dispatch("click", {});
    await tick();
    assert.deepEqual(clip.writes, [payload]);
    assert.equal(button.textContent, "Copied ✓");
    assert.equal(card.classList.contains("is-copied"), true);
    doc.runTimers();
    assert.equal(button.textContent, "Copy");
    assert.equal(card.classList.contains("is-copied"), false);
  } finally {
    clip.restore();
  }
  assert.deepEqual(FakeNotice.messages, []);
});

test("fence copy failure shows the failure state with one Notice", async () => {
  FakeNotice.messages = [];
  const doc = new FakeDocument();
  const card = renderFenceCard(doc, "payload", "```bob-copy L\npayload\n```");
  const button = card.querySelector(".bob-copy-fence-copy");
  const clip = installClipboardStub(new Error("denied"));
  try {
    button.dispatch("click", {});
    await tick();
    assert.equal(clip.writes.length, 1);
    assert.equal(button.textContent, "Copy failed");
    assert.equal(card.classList.contains("is-failed"), true);
    assert.equal(FakeNotice.messages.length, 1);
    assert.match(FakeNotice.messages[0], /Couldn't copy: denied/);
    doc.runTimers();
    assert.equal(button.textContent, "Copy");
    assert.equal(card.classList.contains("is-failed"), false);
  } finally {
    clip.restore();
  }
});

test("fence processor renders the card with section label", () => {
  const doc = new FakeDocument();
  const el = new FakeElementShim(doc);
  const plugin = {
    processors: [],
    registered: [],
    registerMarkdownCodeBlockProcessor(lang, fn) {
      this.processors.push({ lang, fn });
    },
    register(fn) {
      this.registered.push(fn);
    },
  };
  assert.equal(helpers.copyChipSetupFence(plugin), true);
  assert.equal(helpers.copyChipSetupFence(plugin), true);
  assert.equal(plugin.processors.length, 1);
  assert.equal(plugin.processors[0].lang, "bob-copy");
  const ctx = {
    getSectionInfo() {
      return { text: "```bob-copy Weekly status\nHi team —\n```" };
    },
    addChild() {},
  };
  plugin.processors[0].fn("Hi team —", el, ctx);
  assert.equal(el.children.length, 1);
  const card = el.children[0];
  assert.ok((card.getAttribute("class") || "").indexOf("bob-copy-fence") !== -1);
  assert.equal(card.querySelector(".bob-copy-fence-title").textContent, "Weekly status");
  assert.equal(card.querySelector(".bob-copy-fence-body").textContent, "Hi team —");
  assert.equal(helpers.copyChipFencePayloadOf(card), "Hi team —");
  // Missing section info falls back to the generic title; payload stays exact.
  const el2 = new FakeElementShim(doc);
  plugin.processors[0].fn("a\n\nb\n", el2, { getSectionInfo() { return null; } });
  const card2 = el2.children[0];
  assert.equal(card2.querySelector(".bob-copy-fence-title").textContent, "Copy · 3 lines");
  assert.equal(card2.querySelector(".bob-copy-fence-body").textContent, "a\n\nb\n");
  // Setup refuses hosts without the processor API.
  assert.equal(helpers.copyChipSetupFence(null), false);
  assert.equal(helpers.copyChipSetupFence({}), false);
});

// Minimal stand-in for an Obsidian render container: ownerDocument plus
// empty()/appendChild/textContent like the real host.
function FakeElementShim(doc) {
  this.ownerDocument = doc;
  this.children = [];
  this.textContent = "";
}
FakeElementShim.prototype.empty = function () {
  this.children = [];
};
FakeElementShim.prototype.appendChild = function (child) {
  this.children.push(child);
  return child;
};

const FENCE_LINES = [
  "```bob-copy Weekly status",
  "Hi team —",
  "Here is where things stand:",
  "```",
];

test("chipAt resolves opening, body, and closing lines as one block", () => {
  for (let line = 0; line < FENCE_LINES.length; line += 1) {
    const resolved = helpers.copyChipAt({ lines: FENCE_LINES, line, ch: 1 });
    assert.equal(resolved.state, "ready", "line " + line);
    assert.equal(resolved.count, 1, "line " + line);
    assert.ok(Object.isFrozen(resolved), "line " + line);
    assert.ok(Object.isFrozen(resolved.chip), "line " + line);
    assert.deepEqual(resolved.chip, {
      form: "block",
      label: "Weekly status",
      text: "Hi team —\nHere is where things stand:",
      line,
      from: 0,
      to: FENCE_LINES[line].length,
    });
  }
});

test("chipAt block payload keeps blank lines and the trailing newline rule", () => {
  const lines = ["```bob-copy", "a", "", "b", "", "```"];
  const resolved = helpers.copyChipAt({ lines, line: 2, ch: 0 });
  assert.equal(resolved.state, "ready");
  assert.equal(resolved.chip.text, "a\n\nb\n");
  assert.equal(resolved.chip.label, null);
  // Tilde fences, bracket labels, and longer closers resolve too.
  const tilde = ["~~~bob-copy [Q report]", "x", "~~~~"];
  const tildeResolved = helpers.copyChipAt({ lines: tilde, line: 1, ch: 0 });
  assert.equal(tildeResolved.state, "ready");
  assert.equal(tildeResolved.chip.label, "Q report");
  assert.equal(tildeResolved.chip.text, "x");
});

test("chipAt dedents list-nested fences under the opening", () => {
  const lines = ["- item", "  ```bob-copy Nested", "  hello", "  world", "  ```", "after"];
  for (const line of [1, 2, 3, 4]) {
    const resolved = helpers.copyChipAt({ lines, line, ch: 2 });
    assert.equal(resolved.state, "ready", "line " + line);
    assert.equal(resolved.chip.form, "block", "line " + line);
    assert.equal(resolved.chip.label, "Nested", "line " + line);
    assert.equal(resolved.chip.text, "hello\nworld", "line " + line);
  }
  assert.equal(helpers.copyChipAt({ lines, line: 0, ch: 2 }).state, "none");
  assert.equal(helpers.copyChipAt({ lines, line: 5, ch: 0 }).state, "none");
});

test("body spans never win as inline chips inside a bob-copy fence", () => {
  const lines = ["```bob-copy", "`copy: ssh` is an example here", "```"];
  for (let line = 0; line < lines.length; line += 1) {
    const resolved = helpers.copyChipAt({ lines, line, ch: 1 });
    assert.equal(resolved.state, "ready", "line " + line);
    assert.equal(resolved.chip.form, "block", "line " + line);
  }
  // Other languages stay inert.
  const js = ["```js", "`copy: ssh`", "```"];
  for (let line = 0; line < js.length; line += 1) {
    assert.equal(helpers.copyChipAt({ lines: js, line, ch: 1 }).state, "none", "js " + line);
  }
});

test("chipAt fence edge cases: unclosed, nested, and wrong-char closers", () => {
  // An unclosed fence runs to the end of the note.
  const unclosed = ["```bob-copy Open", "tail one", "tail two"];
  assert.equal(helpers.copyChipAt({ lines: unclosed, line: 2, ch: 0 }).chip.text, "tail one\ntail two");
  // A nested different-char fence is body content, not a closer.
  const nested = ["```bob-copy", "~~~", "inner", "~~~", "tail", "```"];
  const nestedResolved = helpers.copyChipAt({ lines: nested, line: 4, ch: 0 });
  assert.equal(nestedResolved.state, "ready");
  assert.equal(nestedResolved.chip.text, "~~~\ninner\n~~~\ntail");
  // A shorter same-char run never closes.
  const longer = ["````bob-copy", "body", "```", "more", "````"];
  assert.equal(helpers.copyChipAt({ lines: longer, line: 2, ch: 0 }).chip.text, "body\n```\nmore");
  // An inner bob-copy-looking fence inside another language is inert.
  const outer = ["```markdown", "```bob-copy", "hello", "```", "```"];
  assert.equal(helpers.copyChipAt({ lines: outer, line: 2, ch: 0 }).state, "none");
  // The cursor line range covers the cursor line for source flashes.
  const resolved = helpers.copyChipAt({ lines: FENCE_LINES, line: 1, ch: 0 });
  assert.equal(resolved.chip.line, 1);
  assert.equal(resolved.chip.from, 0);
  assert.equal(resolved.chip.to, FENCE_LINES[1].length);
});

test("block chips copy through the shared path and flash the fence card", async () => {
  const doc = new FakeDocument();
  const viewDom = doc.createElement("div");
  const payload = "shared payload text";
  const inline = helpers.copyChipBuildInline(doc, { label: null, text: payload }, { interactive: true });
  const card = helpers.copyChipBuildFence(doc, { label: "Card", text: payload });
  viewDom.appendChild(inline);
  viewDom.appendChild(card);
  const view = { dom: viewDom };
  const clip = installClipboardStub();
  try {
    const blockChip = { form: "block", label: "Card", text: payload, line: 1, from: 0, to: 5 };
    const result = await helpers.copyChipCopyChip(blockChip, { view });
    assert.equal(result.ok, true);
    assert.deepEqual(clip.writes, [payload]);
    // The fence card answers; the same-payload inline chip stays quiet.
    assert.equal(card.classList.contains("is-copied"), true);
    assert.equal(inline.classList.contains("is-copied"), false);
  } finally {
    clip.restore();
  }
});

test("inert fence preview is a noninteractive span without a fold toggle", () => {
  const doc = new FakeDocument();
  const payload = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9"].join("\n");
  const live = helpers.copyChipBuildFence(doc, { label: "L", text: payload });
  assert.equal(live.querySelector(".bob-copy-fence-copy").tagName, "BUTTON");
  assert.ok(live.querySelector(".bob-copy-fence-toggle"));
  const inert = helpers.copyChipBuildFence(doc, { label: "L", text: payload }, { interactive: false });
  const copy = inert.querySelector(".bob-copy-fence-copy");
  assert.equal(copy.tagName, "SPAN");
  assert.equal(copy.getAttribute("type"), null);
  assert.equal(copy.getAttribute("aria-hidden"), "true");
  assert.equal(inert.querySelector(".bob-copy-fence-toggle"), null);
  assert.equal(inert.querySelector("button"), null);
  assert.equal(inert.querySelector(".bob-copy-fence-body").textContent, payload);
});

test("payload-unique fence labels win over a stale section info", () => {
  const markdown = [
    "```bob-copy Weekly status",
    "Hi team —",
    "```",
    "",
    "```bob-copy Trailing",
    "hello",
    "",
    "```",
    "",
    "- item",
    "  ```bob-copy Nested",
    "  nested body",
    "  ```",
    "",
  ].join("\n");
  assert.equal(helpers.copyChipFenceLabelForPayload(markdown, "Hi team —"), "Weekly status");
  assert.equal(helpers.copyChipFenceLabelForPayload(markdown, "hello\n"), "Trailing");
  assert.equal(helpers.copyChipFenceLabelForPayload(markdown, "nested body"), "Nested");
  assert.equal(helpers.copyChipFenceLabelForPayload(markdown, "  nested body"), "Nested");
  const withCallout = markdown + "> [!note] Callout card\n> ```bob-copy\n> callout body\n> ```\n";
  const plugin = {
    app: {
      workspace: {
        activeLeaf: {
          view: {
            file: { path: "note.md" },
            editor: { getValue: () => withCallout },
          },
        },
      },
    },
  };
  const ctx = {
    sourcePath: "note.md",
    getSectionInfo() {
      return { text: "```bob-copy Weekly status\nHi team —\n```" };
    },
  };
  assert.equal(helpers.copyChipFenceLabelForRender(plugin, ctx, {}, "hello\n"), "Trailing");
  assert.equal(helpers.copyChipFenceLabelForRender(plugin, ctx, {}, "Hi team —"), "Weekly status");
  assert.equal(helpers.copyChipFenceLabelForRender(plugin, ctx, {}, "callout body"), null);
});

test("api exposes the fence source helper and block resolution", async () => {
  const { BobCopyChipsPlugin } = require("./copy-chips-test-helpers.cjs");
  const plugin = new BobCopyChipsPlugin({});
  await plugin.onload();
  const api = plugin.api.copyChips;
  assert.equal(api.fencePayloadFromSource("a\n\nb\n"), "a\n\nb\n");
  assert.equal(api.fencePayloadFromSource(null), "");
  const resolved = api.chipAt({ lines: FENCE_LINES, line: 1, ch: 0 });
  assert.equal(resolved.state, "ready");
  assert.equal(resolved.chip.form, "block");
  assert.equal(resolved.chip.text, "Hi team —\nHere is where things stand:");
});
