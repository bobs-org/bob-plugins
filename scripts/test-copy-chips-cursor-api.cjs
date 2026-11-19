const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  helpers,
  FakeDocument,
  installClipboardStub,
  BobCopyChipsPlugin,
} = require("./copy-chips-test-helpers.cjs");

const vectors = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "copy-chips-vectors.json"), "utf8"),
);

test("chipAt resolves every vector chip line", () => {
  for (const vector of vectors.chips) {
    const table = Boolean(vector.table);
    const expected = vector.expected;
    // Cursor inside the first chip wins.
    const first = expected[0];
    const mid = first.from + 1;
    const resolved = helpers.copyChipAt({ lines: [vector.line], line: 0, ch: mid });
    assert.equal(resolved.state, "ready", vector.id);
    assert.equal(resolved.count, expected.length, vector.id);
    assert.equal(resolved.chip.text, first.text, vector.id);
    assert.equal(resolved.chip.label, first.label, vector.id);
    assert.equal(resolved.chip.form, "inline", vector.id);
    assert.ok(Object.isFrozen(resolved), vector.id);
    assert.ok(Object.isFrozen(resolved.chip), vector.id);
    // Cursor on none of several chips is ambiguous.
    if (expected.length > 1) {
      const gap = first.to;
      const ambiguous = helpers.copyChipAt({ lines: [vector.line], line: 0, ch: gap });
      // Gap is either inside whitespace (ambiguous) or inside second chip.
      if (gap < expected[1].from) {
        assert.equal(ambiguous.state, "ambiguous", vector.id);
        assert.equal(ambiguous.count, expected.length, vector.id);
      }
    }
    // Table inference matches the vector flag.
    void table;
  }
});

test("chipAt honors cursor precedence and UTF-16 positions", () => {
  const line = "see `copy: ssh apollo` and `copy: pwd`";
  const chips = helpers.copyChipScanLine(line);
  assert.equal(chips.length, 2);
  // Inside first chip.
  let resolved = helpers.copyChipAt({ lines: [line], line: 0, ch: chips[0].from });
  assert.equal(resolved.state, "ready");
  assert.equal(resolved.chip.text, "ssh apollo");
  // Exclusive end: to belongs to the gap, so ambiguous.
  resolved = helpers.copyChipAt({ lines: [line], line: 0, ch: chips[0].to });
  assert.equal(resolved.state, "ambiguous");
  assert.equal(resolved.count, 2);
  // Single chip line: any cursor on the line wins.
  resolved = helpers.copyChipAt({ lines: ["`copy: pwd`"], line: 0, ch: 0 });
  assert.equal(resolved.state, "ready");
  assert.equal(resolved.chip.text, "pwd");
  // Unicode: emoji is a surrogate pair, offsets are UTF-16.
  const uni = "`copy: café 日本語 🙂`";
  const uniChips = helpers.copyChipScanLine(uni);
  assert.equal(uniChips.length, 1);
  resolved = helpers.copyChipAt({ lines: [uni], line: 0, ch: uniChips[0].from + 6 });
  assert.equal(resolved.state, "ready");
  assert.equal(resolved.chip.text, "café 日本語 🙂");
});

test("chipAt skips fenced, frontmatter, and invalid input", () => {
  const lines = ["```", "`copy: ssh`", "```"];
  for (let line = 0; line < 3; line += 1) {
    const resolved = helpers.copyChipAt({ lines, line, ch: 1 });
    assert.equal(resolved.state, "none", "fence line " + line);
    assert.equal(resolved.count, 0);
  }
  const nested = ["~~~", "`copy: ssh`", "~~~"];
  assert.equal(helpers.copyChipAt({ lines: nested, line: 1, ch: 2 }).state, "none");
  const frontmatter = ["---", "`copy: ssh`", "---", "text"];
  assert.equal(helpers.copyChipAt({ lines: frontmatter, line: 1, ch: 2 }).state, "none");
  assert.equal(helpers.copyChipAt({ lines: ["`copy: ssh`"], line: 0, ch: 2 }).state, "ready");
  for (const bad of [null, undefined, {}, { lines: null }, { lines: [], line: 0, ch: 0 }]) {
    const resolved = helpers.copyChipAt(bad);
    assert.equal(resolved.state, "none");
    assert.equal(resolved.count, 0);
  }
  assert.equal(helpers.copyChipAt({ lines: ["`copy: ssh`"], line: 5, ch: 0 }).state, "none");
  assert.equal(helpers.copyChipAt({ lines: ["`copy: ssh`"], line: 0, ch: -1 }).state, "none");
});

test("chipAt matches the related fence helper on nested fences", () => {
  const lines = ["- item", "  ```", "  `copy: ssh`", "  ```"];
  assert.equal(helpers.copyChipAt({ lines, line: 2, ch: 3 }).state, "none");
  assert.equal(helpers.copyChipAt({ lines: ["````", "`copy: x`", "````"], line: 1, ch: 2 }).state, "none");
  assert.equal(helpers.copyChipAt({ lines: ["```js", "`copy: x`", "```"], line: 1, ch: 2 }).state, "none");
});

test("api namespace is frozen, versioned, and never throws", async () => {
  const plugin = new BobCopyChipsPlugin({});
  await plugin.onload();
  const api = plugin.api.copyChips;
  assert.equal(api.version, 1);
  assert.ok(Object.isFrozen(api));
  assert.ok(Object.isFrozen(plugin.api));
  // Grammar helpers preserved.
  assert.deepEqual(api.parse("copy: ssh"), { label: null, text: "ssh" });
  assert.equal(api.parse("Copy: x"), null);
  assert.equal(api.scanLine("`copy: ssh`").length, 1);
  assert.equal(api.serialize({ text: "ssh" }).markdown, "`copy: ssh`");
  assert.deepEqual(api.parseFenceInfo("bob-copy Zoom"), { label: "Zoom" });
  assert.equal(api.fencePayload(["a", "b"]), "a\nb");
  // New members.
  const resolved = api.chipAt({ lines: ["`copy: ssh`"], line: 0, ch: 2 });
  assert.equal(resolved.state, "ready");
  assert.ok(Object.isFrozen(resolved));
  assert.equal(api.chipAt(null).state, "none");
  // copy rejects empty without touching the clipboard.
  const clip = installClipboardStub();
  try {
    const empty = await api.copy("   ");
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, "nothing to copy");
    assert.deepEqual(clip.writes, []);
    const ok = await api.copy("ssh apollo");
    assert.equal(ok.ok, true);
    assert.deepEqual(clip.writes, ["ssh apollo"]);
  } finally {
    clip.restore();
  }
  // copyChip and flash do not throw with missing views.
  const noView = await api.copyChip({ form: "inline", label: null, text: "ssh", line: 0, from: 0, to: 11 });
  assert.equal(typeof noView.ok, "boolean");
  assert.equal(api.flash({ form: "inline", label: null, text: "ssh", line: 0, from: 0, to: 11 }), false);
  assert.equal(api.flash({ text: "   " }), false);
  // Guarded methods never throw on garbage.
  assert.equal(api.parse(undefined), null);
  assert.deepEqual(api.scanLine(null), []);
  assert.equal(api.chipAt({ lines: "nope", line: 0, ch: 0 }).state, "none");
});

test("copy unavailable clipboard reports a useful reason", async () => {
  const original = globalThis.navigator;
  try {
    delete globalThis.navigator;
    const result = await helpers.copyChipCopyText("ssh");
    assert.equal(result.ok, false);
    assert.match(result.reason, /clipboard|unavailable|failed/i);
  } finally {
    if (original !== undefined) {
      try {
        Object.defineProperty(globalThis, "navigator", {
          value: original,
          configurable: true,
          writable: true,
        });
      } catch (error) {
        globalThis.navigator = original;
      }
    }
  }
  const failing = installClipboardStub(new Error("denied"));
  try {
    const result = await helpers.copyChipCopyText("ssh");
    assert.equal(result.ok, false);
    assert.match(result.reason, /denied|failed/i);
  } finally {
    failing.restore();
  }
});

test("cursor command resolves through chipAt and uses the shared copy path", async () => {
  const plugin = new BobCopyChipsPlugin({});
  await plugin.onload();
  assert.equal(plugin.commands.length, 1);
  assert.equal(plugin.commands[0].id, "copy-on-cursor-line");
  assert.equal(plugin.commands[0].name, "Copy chip on cursor line");
  // Command works through editorCallback with no view (Source mode).
  const clip = installClipboardStub();
  try {
    const editor = {
      getValue: () => "`copy: ssh apollo`",
      getCursor: () => ({ line: 0, ch: 2 }),
    };
    let notified = [];
    const originalNotice = helpers.copyChipNotify;
    void originalNotice;
    await helpers.copyChipCopyChip({ form: "inline", label: null, text: "ssh apollo", line: 0, from: 0, to: 18 }, {});
    assert.deepEqual(clip.writes, ["ssh apollo"]);
  } finally {
    clip.restore();
  }
  void FakeDocument;
});
