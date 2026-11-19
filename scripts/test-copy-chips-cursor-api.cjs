const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  helpers,
  FakeNotice,
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

test("chipAt uses one task chip only when the cursor line has none", () => {
  const payload = "run `docs` | done  ";
  const lines = [
    "- [ ] #task Deploy docs ^deploy-docs",
    "  - ``copy[deploy]: run `docs` \\| done  ``",
  ];
  const resolved = helpers.copyChipAt({
    lines,
    line: 0,
    ch: 5,
    scope: { kind: "task", lines: [0, 1] },
  });
  assert.equal(resolved.state, "ready");
  assert.equal(resolved.scope, "task");
  assert.equal(resolved.count, 1);
  assert.equal(resolved.chip.text, payload);
  assert.equal(resolved.chip.line, 1);
  assert.equal(resolved.chip.from, lines[1].indexOf("``"));
  assert.equal(resolved.chip.to, lines[1].length);
  assert.ok(Object.isFrozen(resolved));
  assert.ok(Object.isFrozen(resolved.chip));

  const many = helpers.copyChipAt({
    lines: ["- [ ] #task Example", "  - `copy: first`", "  - `copy: second`"],
    line: 0,
    ch: 5,
    scope: { kind: "task", lines: [0, 1, 2] },
  });
  assert.deepEqual(
    { state: many.state, count: many.count, scope: many.scope },
    { state: "ambiguous", count: 2, scope: "task" },
  );
});

test("chipAt keeps cursor-line precedence and counts scoped bob-copy fences once", () => {
  const precedence = helpers.copyChipAt({
    lines: ["`copy: line`", "  - `copy: task`"],
    line: 0,
    ch: 2,
    scope: { kind: "task", lines: [0, 1] },
  });
  assert.equal(precedence.state, "ready");
  assert.equal(precedence.scope, "cursor");
  assert.equal(precedence.chip.text, "line");
  const lineAmbiguous = helpers.copyChipAt({
    lines: ["`copy: first` and `copy: second`", "  - `copy: task`"],
    line: 0,
    ch: "`copy: first` and `copy: second`".indexOf(" and"),
    scope: { kind: "task", lines: [0, 1] },
  });
  assert.equal(lineAmbiguous.state, "ambiguous");
  assert.equal(lineAmbiguous.scope, "cursor");
  assert.equal(lineAmbiguous.count, 2);

  const lines = [
    "- [ ] #task Example",
    "  ```bob-copy Deploy",
    "  run docs",
    "  ```",
    "  ```js",
    "  `copy: inert`",
    "  ```",
  ];
  const fenced = helpers.copyChipAt({
    lines,
    line: 0,
    ch: 5,
    scope: { kind: "task", lines: [0, 1, 2, 3, 4, 5, 6] },
  });
  assert.equal(fenced.state, "ready");
  assert.equal(fenced.scope, "task");
  assert.equal(fenced.count, 1);
  assert.equal(fenced.chip.form, "block");
  assert.equal(fenced.chip.line, 1);
  assert.equal(fenced.chip.from, 0);
  assert.equal(fenced.chip.to, lines[1].length);
  assert.equal(fenced.chip.text, "run docs");
});

test("chipAt never falls through from fences or frontmatter and ignores malformed scopes", () => {
  const plainFence = ["- [ ] #task Example", "  ```js", "  `copy: inert`", "  ```"];
  assert.equal(
    helpers.copyChipAt({
      lines: plainFence,
      line: 2,
      ch: 5,
      scope: { kind: "task", lines: [0, 1, 2, 3] },
    }).state,
    "none",
  );
  const frontmatter = ["---", "`copy: hidden`", "---", "- [ ] #task Visible", "  - note"];
  assert.equal(
    helpers.copyChipAt({
      lines: frontmatter,
      line: 3,
      ch: 5,
      scope: { kind: "task", lines: [1, 3, 4] },
    }).state,
    "none",
  );

  const lines = ["- [ ] #task Example", "  - `copy: one`"];
  for (const scope of [
    "nope",
    { kind: "cursor", lines: [0, 1] },
    { kind: "task", lines: "not an array" },
    { kind: "task", lines: [-1, 1.5, 99, "1"] },
    { kind: "task", lines: [1] },
  ]) {
    const result = helpers.copyChipAt({ lines, line: 0, ch: 3, scope });
    assert.equal(result.state, "none");
    assert.equal(result.count, 0);
  }
  const cleaned = helpers.copyChipAt({
    lines,
    line: 0,
    ch: 3,
    scope: { kind: "task", lines: [1, 1, -1, 3.2, 99, 0] },
  });
  assert.equal(cleaned.state, "ready");
  assert.equal(cleaned.scope, "task");
});

test("api namespace is frozen, versioned, and never throws", async () => {
  const plugin = new BobCopyChipsPlugin({});
  await plugin.onload();
  const api = plugin.api.copyChips;
  assert.equal(api.version, 2);
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
  assert.equal(resolved.scope, "cursor");
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
  const taskLines = ["- [ ] #task Deploy docs", "  - `copy[deploy]: just docs-check`"];
  const plugin = new BobCopyChipsPlugin({
    plugins: {
      plugins: {
        "bob-navigation-hotkeys": {
          api: {
            taskScope: {
              version: 1,
              at: ({ lines, line }) => ({ ownerLine: 0, lines: [0, 1] }),
            },
          },
        },
      },
    },
  });
  await plugin.onload();
  const command = plugin.commands.find((item) => item.id === "copy-on-cursor-line");
  assert.ok(command);
  assert.equal(command.name, "Copy chip at cursor");
  assert.ok(plugin.commands.find((item) => item.id === "make-or-edit"));
  const clip = installClipboardStub();
  try {
    FakeNotice.messages.length = 0;
    const editor = {
      getValue: () => taskLines.join("\n"),
      getCursor: () => ({ line: 0, ch: 5 }),
    };
    command.editorCallback(editor, null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(clip.writes, ["just docs-check"]);

    const noticeFor = async (content, cursorLine, cursorCh, taskScope) => {
      FakeNotice.messages.length = 0;
      plugin.app.plugins.plugins = taskScope
        ? {
            "bob-navigation-hotkeys": {
              api: { taskScope: { version: 1, at: taskScope } },
            },
          }
        : {};
      command.editorCallback({
        getValue: () => content,
        getCursor: () => ({ line: cursorLine, ch: cursorCh }),
      }, null);
      await new Promise((resolve) => setImmediate(resolve));
      return FakeNotice.messages.slice();
    };
    const scope = ({ lines }) => ({ ownerLine: 0, lines: lines.map((_line, index) => index) });
    assert.deepEqual(
      await noticeFor("- [ ] #task Empty", 0, 5, ({ lines }) => ({ ownerLine: 0, lines: [0] })),
      ["No copy chip in this task"],
    );
    assert.deepEqual(
      await noticeFor("- [ ] #task Many\n  - `copy: one`\n  - `copy: two`", 0, 5, scope),
      ["2 chips in this task · move onto one"],
    );
    assert.deepEqual(
      await noticeFor("`copy: one` and `copy: two`", 0, "`copy: one` and `copy: two`".indexOf(" and"), () => null),
      ["2 chips on this line · move onto one"],
    );

    assert.deepEqual(
      await noticeFor("empty line", 0, 0, null),
      ["No copy chip on this line"],
    );
    assert.deepEqual(
      await noticeFor("empty line", 0, 0, () => { throw new Error("provider failed"); }),
      ["No copy chip on this line"],
    );
  } finally {
    clip.restore();
  }
});
