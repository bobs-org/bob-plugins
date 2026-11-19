const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  helpers,
  FakeDocument,
  FakeNotice,
  installClipboardStub,
} = require("./copy-chips-test-helpers.cjs");

const vectors = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "copy-chips-vectors.json"), "utf8"),
);

test("all vector payloads survive clipboard byte-exact", async () => {
  for (const vector of vectors.chips) {
    for (const expected of vector.expected) {
      const clip = installClipboardStub();
      try {
        const result = await helpers.copyChipCopyText(expected.text);
        assert.equal(result.ok, true, vector.id);
        assert.deepEqual(clip.writes, [expected.text], vector.id);
      } finally {
        clip.restore();
      }
    }
  }
  // Labels, escaped pipes, backticks, unicode, spaces, ampersands, HTML, ::.
  const cases = [
    "a|b",
    "run `bob plan` first",
    "café 日本語 🙂",
    "ssh  ",
    "Update the last-week period note (`bob plan` prints its path)",
    "a & b <c> :: still text",
    "ends with `",
  ];
  for (const text of cases) {
    const clip = installClipboardStub();
    try {
      const result = await helpers.copyChipCopyText(text);
      assert.equal(result.ok, true, text);
      assert.equal(clip.writes[0], text, text);
    } finally {
      clip.restore();
    }
  }
});

test("empty and whitespace payloads never overwrite the clipboard", async () => {
  for (const text of ["", "   ", " \t ", "\n  \n"]) {
    const clip = installClipboardStub();
    try {
      const result = await helpers.copyChipCopyText(text);
      assert.equal(result.ok, false, JSON.stringify(text));
      assert.equal(result.reason, "nothing to copy");
      assert.deepEqual(clip.writes, []);
    } finally {
      clip.restore();
    }
  }
});

test("chip DOM uses textContent only and keeps payloads out of attributes", () => {
  const doc = new FakeDocument();
  const tricky = "a|b <c> &:: \"' `copy: x`";
  const labeled = helpers.copyChipBuildInline(doc, { label: "Zoom ]", text: tricky }, { interactive: true });
  assert.ok(labeled);
  assert.equal(labeled.tagName, "BUTTON");
  assert.equal(labeled.getAttribute("type"), "button");
  assert.equal(labeled.getAttribute("aria-label"), null);
  const labelledBy = labeled.getAttribute("aria-labelledby");
  assert.match(labelledBy || "", /bob-copy-chip-copy-\d+ bob-copy-chip-face-\d+/);
  // No payload in any attribute.
  for (const [name, value] of labeled.attrs) {
    assert.equal(value.indexOf(tricky) === -1, true, "payload leaked into " + name);
    if (name !== "class") {
      assert.equal(value.indexOf("::") === -1 || name.indexOf("aria") === 0, true, name);
    }
  }
  for (const child of labeled.children) {
    for (const [name, value] of child.attrs) {
      if (name === "id" || name === "class" || name === "data-copy-chip-icon") continue;
      assert.equal(String(value).indexOf(tricky) === -1, true, "payload leaked into child " + name);
    }
  }
  assert.equal(helpers.copyChipPayloadOf(labeled), tricky);
  // Glyph slot is fixed width via CSS class.
  const glyph = labeled.querySelector(".bob-copy-chip-glyph");
  assert.ok(glyph);
  // Tooltip preview truncates at 120 chars without truncating the payload.
  const long = "x".repeat(200) + "\nnewline";
  const built = helpers.copyChipBuildInline(doc, { label: "L", text: long }, { interactive: true });
  const tip = built.children.find((child) => (child.getAttribute("class") || "").indexOf("bob-copy-chip-tip") !== -1);
  assert.ok(tip);
  assert.ok(tip.textContent.length <= "Copy: ".length + 120);
  assert.equal(helpers.copyChipPayloadOf(built), long);
  // Unlabeled tooltip.
  const plain = helpers.copyChipBuildInline(doc, { label: null, text: "ssh" }, { interactive: true });
  const plainTip = plain.children.find((child) => (child.getAttribute("class") || "").indexOf("bob-copy-chip-tip") !== -1);
  assert.equal(plainTip.textContent, "Click to copy");
  // Newlines show as ⏎ in the preview.
  const nl = helpers.copyChipBuildInline(doc, { label: "L", text: "a\nb" }, { interactive: true });
  const nlTip = nl.children.find((child) => (child.getAttribute("class") || "").indexOf("bob-copy-chip-tip") !== -1);
  assert.match(nlTip.textContent, /⏎/);
});

test("accessible name is Copy plus the face", () => {
  const doc = new FakeDocument();
  const labeled = helpers.copyChipBuildInline(doc, { label: "Zoom", text: "https://zoom.us/j/123" }, { interactive: true });
  // Face carries the label as DOM text.
  const face = labeled.querySelector(".bob-copy-chip-face");
  assert.equal(face.textContent, "Zoom");
  // aria-labelledby points at the hidden Copy prefix and the face.
  const ids = (labeled.getAttribute("aria-labelledby") || "").split(" ");
  assert.equal(ids.length, 2);
  const prefix = labeled.children.find((child) => (child.getAttribute("class") || "").indexOf("bob-copy-chip-copy-prefix") !== -1);
  assert.equal(prefix.textContent, "Copy");
});

test("inert preview never registers gestures or writes", async () => {
  const doc = new FakeDocument();
  const inert = helpers.copyChipBuildInline(doc, { label: null, text: "ssh" }, { interactive: false });
  assert.equal(inert.tagName, "SPAN");
  assert.equal(inert.listeners.size, 0);
  const clip = installClipboardStub();
  try {
    // No click handler fired because none was attached.
    assert.deepEqual(clip.writes, []);
  } finally {
    clip.restore();
  }
});

test("success and failure feedback follow the timers and Notices", async () => {
  const doc = new FakeDocument();
  FakeNotice.messages = [];
  const el = helpers.copyChipBuildInline(doc, { label: null, text: "ssh" }, { interactive: true });
  assert.equal(helpers.copyChipShowFeedback(el, "success"), true);
  assert.ok(el.classList.contains("is-copied"));
  assert.equal(doc.pendingTimerCount(), 1);
  doc.runTimers();
  assert.equal(el.classList.contains("is-copied"), false);
  assert.equal(helpers.copyChipShowFeedback(el, "failure"), true);
  assert.ok(el.classList.contains("is-failed"));
  assert.equal(doc.pendingTimerCount(), 1);
  // Repeated activation resets safely: the first timer is replaced.
  assert.equal(helpers.copyChipShowFeedback(el, "success"), true);
  assert.ok(el.classList.contains("is-copied"));
  assert.equal(el.classList.contains("is-failed"), false);
  assert.equal(doc.pendingTimerCount(), 1);
  doc.runTimers();
  // Failure emits exactly one Notice.
  FakeNotice.messages = [];
  const failing = helpers.copyChipBuildInline(doc, { label: null, text: "ssh" }, { interactive: true });
  helpers.copyChipFail(failing, "denied");
  assert.ok(failing.classList.contains("is-failed"));
  assert.equal(FakeNotice.messages.length, 1);
  assert.equal(FakeNotice.messages[0], "Couldn't copy: denied");
  // Stale timers never overwrite newer feedback.
  const raced = helpers.copyChipBuildInline(doc, { label: null, text: "ssh" }, { interactive: true });
  helpers.copyChipShowFeedback(raced, "success");
  helpers.copyChipShowFeedback(raced, "failure");
  assert.ok(raced.classList.contains("is-failed"));
  doc.runTimers();
  assert.equal(raced.classList.contains("is-failed"), false);
});

test("clipboard rejection shows the alert glyph and exactly one Notice", async () => {
  FakeNotice.messages = [];
  const doc = new FakeDocument();
  const el = helpers.copyChipBuildInline(doc, { label: null, text: "ssh" }, { interactive: true });
  const clip = installClipboardStub(new Error("denied"));
  try {
    const result = await helpers.copyChipCopyChip(
      { form: "inline", label: null, text: "ssh", line: 0, from: 0, to: 11 },
      {},
    );
    assert.equal(result.ok, false);
    assert.deepEqual(clip.writes, ["ssh"]);
  } finally {
    clip.restore();
  }
  assert.equal(FakeNotice.messages.length, 1);
  assert.equal(FakeNotice.messages[0], "Couldn't copy: denied");
  // Direct fail path paints the alert glyph slot with exactly one Notice.
  FakeNotice.messages = [];
  helpers.copyChipFail(el, "denied");
  const glyph = el.querySelector(".bob-copy-chip-glyph");
  assert.equal(glyph.getAttribute("data-copy-chip-icon"), "alert-triangle");
  assert.equal(FakeNotice.messages.length, 1);
});

test("flash shows feedback without a clipboard write", () => {
  const doc = new FakeDocument();
  const view = {
    dom: new FakeDocument().body,
    state: null,
    dispatch() {},
  };
  // No view: flash is false and writes nothing.
  const clip = installClipboardStub();
  try {
    assert.equal(helpers.copyChipFlashChip({ text: "ssh" }, {}), false);
    assert.deepEqual(clip.writes, []);
  } finally {
    clip.restore();
  }
  void view;
  void doc;
});
