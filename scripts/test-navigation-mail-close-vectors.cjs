const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const vectorsPath = path.join(__dirname, "../plugins/bob-navigation-hotkeys/scripts/fixtures/mail_close/vectors.json");
const vectors = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));
const {
  mailCloseVectorPredicate,
  buildMailCloseCopy,
  mailCloseDigest,
  MailCloseCardModal,
  createMailCloseGuardApi,
  successorJumpApplySelection,
} = helpers;

test("Mail Close Card vectors remain a byte-for-byte bob-cli copy", (t) => {
  const canonical = path.join(__dirname, "../../../../../tests/fixtures/mail_close/vectors.json");
  if (!fs.existsSync(canonical)) {
    t.skip("bob-cli canonical fixture is not beside this checkout");
    return;
  }
  assert.ok(fs.readFileSync(vectorsPath).equals(fs.readFileSync(canonical)));
});

for (const vector of vectors.vectors.filter((entry) => entry.kind === "predicate")) {
  test(`${vector.id}: Gmail Task predicate`, () => {
    const actual = mailCloseVectorPredicate(vector);
    assert.equal(actual.gmail_task, vector.expect_gmail_task);
    assert.deepEqual(actual.notes, vector.expect_notes);
  });
}

for (const vector of vectors.vectors.filter((entry) => entry.kind === "copy")) {
  test(`${vector.id}: shared copy, tone, and digest`, () => {
    const actual = buildMailCloseCopy(vector.targets, {
      now: vector.now,
      other_open_linkers: vector.other_open_linkers,
      archive: vector.archive,
    });
    assert.deepEqual(actual, { ...vector.expect });
  });
}

test("Mail Close Card confirms only y and treats q as keep", () => {
  const model = { title: "Complete this email task?", rows: [{ label: "Lease renewal" }], verb: "complete" };
  let confirmed = 0;
  let kept = 0;
  const yCard = new MailCloseCardModal({}, { model, onConfirm: () => { confirmed += 1; } });
  yCard.close = () => {};
  const yEvent = { key: "y", preventDefault() {}, stopPropagation() {} };
  yCard.handleKey(yEvent);
  assert.equal(confirmed, 1);

  const qCard = new MailCloseCardModal({}, { model, onKeep: () => { kept += 1; } });
  qCard.close = () => {};
  const qEvent = { key: "q", preventDefault() {}, stopPropagation() {} };
  qCard.handleKey(qEvent);
  assert.equal(kept, 1);});

test("Mail Close Card keeps on Enter, Ctrl+Enter, Esc, and Ctrl+[", () => {
  const model = { title: "Cancel this email task?", rows: [{ label: "Lease" }], verb: "cancel" };
  for (const event of [
    { key: "Enter", preventDefault() {}, stopPropagation() {} },
    { key: "Enter", ctrlKey: true, preventDefault() {}, stopPropagation() {} },
    { key: "Escape", preventDefault() {}, stopPropagation() {} },
    { key: "[", ctrlKey: true, preventDefault() {}, stopPropagation() {} },
  ]) {
    let kept = 0;
    let confirmed = 0;
    const card = new MailCloseCardModal({}, { model, onKeep: () => { kept += 1; }, onConfirm: () => { confirmed += 1; } });
    card.close = () => {};
    card.handleKey(event);
    assert.equal(kept, 1);
    assert.equal(confirmed, 0);
  }
});

test("Mail Close Card ignores event.repeat", () => {
  const model = { title: "Complete this email task?", rows: [{ label: "Lease" }], verb: "complete" };
  let confirmed = 0;
  let kept = 0;
  const card = new MailCloseCardModal({}, { model, onKeep: () => { kept += 1; }, onConfirm: () => { confirmed += 1; } });
  card.close = () => {};
  card.handleKey({ key: "y", repeat: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(confirmed, 0);
  assert.equal(kept, 0);
});

test("Mail Close Card swallows the opening chord until keyup", () => {
  const model = { title: "Complete this email task?", rows: [{ label: "Lease" }], verb: "complete" };
  let confirmed = 0;
  let kept = 0;
  const card = new MailCloseCardModal({}, { model, openingKeys: ["Control", "Enter"], onKeep: () => { kept += 1; }, onConfirm: () => { confirmed += 1; } });
  card.close = () => {};
  card.contentEl = { querySelector: () => null };
  card.containerEl = { ownerDocument: { defaultView: { addEventListener() {}, removeEventListener() {}, setTimeout(fn) { fn(); } } } };
  card.onOpen = card.onOpen.bind(card);
  // Simulate open wiring without DOM: directly test swallow
  assert.equal(card.awaitingOpeningChordRelease(), true);
  card.handleKey({ key: "y", preventDefault() {}, stopPropagation() {} });
  assert.equal(confirmed, 0);
  assert.equal(kept, 0);
  card.releaseOpeningChordKey({ key: "Control" });
  assert.equal(card.awaitingOpeningChordRelease(), true);
  card.releaseOpeningChordKey({ key: "Enter" });
  assert.equal(card.awaitingOpeningChordRelease(), false);
  card.handleKey({ key: "y", preventDefault() {}, stopPropagation() {} });
  assert.equal(confirmed, 1);
});

test("Mail Close Card Ctrl+Enter opens the URL and keeps", () => {
  const model = { title: "Complete this email task?", rows: [{ label: "Lease", gmail_url: "https://mail.google.com/x" }], verb: "complete" };
  let kept = 0;
  let confirmed = 0;
  let opened = 0;
  const card = new MailCloseCardModal({}, { model, onKeep: () => { kept += 1; }, onConfirm: () => { confirmed += 1; } });
  card.close = () => {};
  card.contentEl = { querySelector: () => ({ click() { opened += 1; } }) };
  card.handleKey({ key: "Enter", ctrlKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(opened, 1);
  assert.equal(confirmed, 0);
});

test("mailCloseGuard carries an exact identity token without prompting twice", async () => {
  const source = { path: "job.md", basename: "job" };
  const mail = { path: "mail/2026/lease.md", basename: "lease" };
  const files = [source, mail];
  const content = new Map([
    [source.path, "- [ ] #task Reply [[mail/2026/lease]]"],
    [mail.path, "---\ntype: [[mail]]\ntitle: Lease renewal\nwho: Ada\nturn: yours\nturn_since: 2026-11-07T14:00:00\n---\n"],
  ]);
  const app = {
    vault: {
      getAbstractFileByPath(path) { return files.find((file) => file.path === path) || null; },
      getMarkdownFiles() { return files; },
      async cachedRead(file) { return content.get(file.path) || ""; },
    },
    metadataCache: {
      resolvedLinks: { [source.path]: { [mail.path]: 1 } },
      getFirstLinkpathDest(target) { return target.startsWith("mail/") ? mail : null; },
      getFileCache() { return null; },
    },
  };
  const plugin = { app };
  const api = createMailCloseGuardApi(plugin);
  const targets = [{ path: source.path, line: 1, lineText: content.get(source.path), before: " ", after: "x" }];
  const classified = await api.classify(targets);
  assert.equal(classified.length, 1);
  const token = mailCloseDigest(classified);
  const result = await api.confirm(targets, { context: { mailCloseConfirmed: token } });
  assert.deepEqual(result, { confirmed: true, guarded: true, token });
});

test("keeping a successor close leaves its staged verdict in the picker", async () => {
  const row = {
    key: "offer",
    group: "successors",
    selectable: true,
    notePath: "job.md",
    task: {
      path: "job.md",
      line: 1,
      text: "- [ ] #task Reply [[mail/2026/lease]]",
      displayText: "Reply",
      status: "Ready",
      preimage: "- [ ] #task Reply [[mail/2026/lease]]",
    },
    close: { complete: true, cancel: true },
  };
  const app = {
    plugins: {
      plugins: {
        "bob-navigation-hotkeys": {
          reviewGestureSeq: 3,
          reviewLandingEpoch: 2,
          reviewLanding: { key: "landing" },
          releasedWalk: false,
          settleReviewWalkLock(wrote) { this.releasedWalk = wrote === false; },
          api: {
            mailCloseGuard: { version: 1, async confirm() { return { confirmed: false, guarded: true, token: null }; } },
          },
        },
      },
    },
  };
  let settled = null;
  const modal = {
    app,
    model: { groups: [{ group: "successors", rows: [row] }] },
    markedKeys: new Set(),
    verdicts: new Map([[row.key, { outcome: "done" }]]),
    visibleItems: [],
    selectedIndex: 0,
    settle(value) { settled = value; },
    renderAll() {},
  };
  assert.equal(successorJumpApplySelection(modal), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, null);
  assert.equal(modal.verdicts.get(row.key).outcome, "done");
  assert.match(modal.statusLine.text, /staged choices remain/);
  assert.equal(app.plugins.plugins["bob-navigation-hotkeys"].releasedWalk, true);
});

test("a confirmed successor close returns its token as downstream context", async () => {
  const row = {
    key: "offer",
    group: "successors",
    selectable: true,
    notePath: "job.md",
    task: {
      path: "job.md",
      line: 1,
      text: "- [ ] #task Reply [[mail/2026/lease]]",
      displayText: "Reply",
      status: "Ready",
      preimage: "- [ ] #task Reply [[mail/2026/lease]]",
    },
    close: { complete: true, cancel: true },
  };
  let receivedTargets = null;
  let settled = null;
  const app = {
    plugins: {
      plugins: {
        "bob-navigation-hotkeys": {
          api: {
            mailCloseGuard: {
              version: 1,
              async confirm(targets) {
                receivedTargets = targets;
                return { confirmed: true, guarded: true, token: "abc123def456" };
              },
            },
          },
        },
      },
    },
  };
  const modal = {
    app,
    model: { groups: [{ group: "successors", rows: [row] }] },
    markedKeys: new Set(),
    verdicts: new Map([[row.key, { outcome: "done" }]]),
    visibleItems: [],
    selectedIndex: 0,
    settle(value) { settled = value; },
  };
  assert.equal(successorJumpApplySelection(modal), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(receivedTargets, [{
    path: "job.md",
    line: 1,
    lineText: row.task.preimage,
    before: " ",
    after: "x",
  }]);
  assert.equal(settled.context.mailCloseConfirmed, "abc123def456");
  assert.deepEqual(settled.closes, [{ key: "offer", outcome: "done" }]);
});
