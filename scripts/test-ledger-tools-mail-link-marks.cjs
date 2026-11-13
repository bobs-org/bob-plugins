// Mail link marks: ML vectors from bob-cli `docs/mail-link-marks.md`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const editorInfoField = { _mailField: "info" };
const editorLivePreviewField = { _mailField: "live" };

class StubWidgetType {}
class StubRangeSetBuilder {
  constructor() { this.adds = []; }
  add(from, to, value) { this.adds.push({ from, to, value }); }
  finish() { return { adds: this.adds.slice() }; }
}
const StubDecoration = {
  none: { none: true },
  widget: (spec) => ({ ...spec, widgetDecoration: true }),
};
const StubStateEffect = {
  define() {
    const type = {};
    type.of = (value) => ({ value, is: (other) => other === type });
    return type;
  },
};
const StubViewPlugin = { fromClass: (cls, options) => ({ cls, options }) };
class FakePlugin {
  constructor(app) { this.app = app; }
  addCommand(command) { (this.commands ||= []).push(command); }
  registerEditorExtension(extension) { (this.editorExtensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, sortOrder) { (this.postProcessors ||= []).push({ handler, sortOrder }); }
  registerEvent(event) { (this.registeredEvents ||= []).push(event); }
  register(callback) { (this.cleanups ||= []).push(callback); }
  applyMarkGateClass() {}
  registerMarkGatePopoutSync() {}
}
class TestNotice {
  constructor(message) { TestNotice.messages.push(String(message)); }
}
TestNotice.messages = [];

const originalLoad = Module._load;
Module._load = function loadMailLinkStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownRenderChild: class {},
      Notice: TestNotice,
      Plugin: FakePlugin,
      normalizePath: (value) => value,
      parseYaml: () => ({}),
      editorInfoField,
      editorLivePreviewField,
    };
  }
  if (request === "@codemirror/state") {
    return {
      Prec: { highest: (value) => value },
      StateEffect: StubStateEffect,
      RangeSetBuilder: StubRangeSetBuilder,
    };
  }
  if (request === "@codemirror/view") {
    return {
      EditorView: { updateListener: { of: (listener) => ({ listener }) } },
      keymap: { of: (value) => value },
      ViewPlugin: StubViewPlugin,
      Decoration: StubDecoration,
      WidgetType: StubWidgetType,
    };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => ({ resolveInner: () => null }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const LedgerToolsPlugin = require("../plugins/bob-ledger-tools/main.js");
Module._load = originalLoad;

const h = LedgerToolsPlugin.helpers;
const TODAY = "2026-11-07";
const NOW = new Date(2026, 10, 7, 16, 0, 0);
const LINK = "[[mail/2026/261107_lease_renewal|✉️ Lease renewal · Ada]]";
const ADA = Object.freeze({ who: "Ada", turn: "yours", turnSince: "2026-11-07T14:00:00" });

function fakeEl(tag) {
  const attrs = {};
  return {
    tagName: String(tag).toUpperCase(),
    textContent: "",
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  };
}
function fakeDoc() {
  return { createElement: (tag) => fakeEl(tag) };
}
function docFromText(text) {
  const lines = text.split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return {
    length: text.length,
    lineAt(pos) {
      let index = 0;
      while (index + 1 < starts.length && starts[index + 1] <= pos) index += 1;
      const from = starts[index];
      const lineText = lines[index];
      return { from, to: from + lineText.length, number: index + 1, text: lineText };
    },
    toString() { return text; },
  };
}
function makeView(text, live = true) {
  const doc = docFromText(text);
  return {
    visibleRanges: [{ from: 0, to: text.length }],
    state: {
      doc,
      field(field) {
        if (field === editorLivePreviewField) return live;
        if (field === editorInfoField) return { file: { path: "Projects/Example.md" } };
        return null;
      },
    },
  };
}
function pluginWithMail(facts) {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.mailLinkMarksEnabled = true;
  plugin.dateMarksToday = () => TODAY;
  plugin.mailNoteFacts = () => facts;
  plugin.app = {};
  return plugin;
}

test("ML1–ML6, ML9: reply badge model vectors pass verbatim", () => {
  const line = `- [ ] #task ${LINK}`;
  const ml1 = h.mailReplyBadgeModel(line, ADA, TODAY, NOW);
  assert.equal(ml1 && ml1.text, "↩ Ada · 2h", "ML1");
  assert.equal(
    h.mailReplyBadgeModel(`${line} [fresh:: 2026-11-05]`, ADA, TODAY, NOW).text,
    "↩ Ada · 2h",
    "ML2",
  );
  assert.equal(
    h.mailReplyBadgeModel(
      `${line} [fresh:: 2026-11-07] [unblocked:: 2026-11-07]`,
      ADA,
      TODAY,
      NOW,
    ).text,
    "↩ Ada · 2h",
    "ML3",
  );
  assert.equal(
    h.mailReplyBadgeModel(`${line} [fresh:: 2026-11-07]`, ADA, TODAY, NOW),
    null,
    "ML4",
  );
  assert.equal(
    h.mailReplyBadgeModel(
      `${line} [fresh:: 2026-11-07]`,
      { ...ADA, turnSince: "2026-11-06T18:00:00" },
      TODAY,
      NOW,
    ),
    null,
    "ML5",
  );
  assert.equal(
    h.mailReplyBadgeModel(line, { ...ADA, turn: "theirs" }, TODAY, NOW),
    null,
    "ML6",
  );
  assert.equal(
    h.mailReplyBadgeModel(line, { ...ADA, who: "" }, TODAY, NOW).text,
    "↩ 2h",
    "ML9",
  );
});

test("ML7 and ML10: no mail link and inline-code wikilinks produce no tokens", () => {
  assert.deepEqual(h.mailLinkMarkTokens("- [ ] #task No mail link"), []);
  assert.equal(
    h.mailReplyBadgeModel("- [ ] #task No mail link", { who: "", turn: "", turnSince: "" }, TODAY, NOW),
    null,
    "ML7",
  );
  assert.deepEqual(h.mailLinkMarkTokens("- [ ] #task `[[mail/x]]`"), []);
  assert.equal(h.mailLinkMarkTokens(`- [ ] #task !${LINK}`).length, 0);
  const withMd = h.mailLinkMarkTokens("- [ ] #task [[mail/2026/note.md]]");
  assert.equal(withMd.length, 1);
  assert.equal(withMd[0].pathPart, "mail/2026/note");
});

test("mailNoteFactsFromFrontmatter accepts type:[[mail]] or gmail_thread_id", () => {
  assert.deepEqual(
    h.mailNoteFactsFromFrontmatter({ type: "[[mail]]", who: "Ada", turn: "yours", turn_since: "2026-11-07T14:00:00" }),
    { who: "Ada", turn: "yours", turnSince: "2026-11-07T14:00:00" },
  );
  assert.equal(h.mailNoteFactsFromFrontmatter({ type: "note", who: "Ada" }), null);
  assert.equal(
    h.mailNoteFactsFromFrontmatter({ gmail_thread_id: "abc", who: "Bea", turn: "theirs", turnSince: "2026-11-01" }).who,
    "Bea",
  );
});

test("reply badge host is listener-free with no title", () => {
  const host = h.buildMailReplyBadgeElement(fakeDoc(), { text: "↩ Ada · 2h", tooltip: "Ada replied · 2h" });
  assert.equal(host.getAttribute("class"), "bob-mail-reply-badge");
  assert.equal(host.getAttribute("role"), "img");
  assert.equal(host.getAttribute("aria-label"), "Ada replied · 2h");
  assert.equal(host.getAttribute("data-tooltip-position"), "top");
  assert.equal(host.getAttribute("title"), null);
  assert.equal(host.textContent, "↩ Ada · 2h");
  assert.equal(h.MAIL_REPLY_BADGE_SIDE, 1);
});

test("ML1 Live Preview widget sits after the closing ]]", () => {
  const line = `- [ ] #task ${LINK}`;
  const plugin = pluginWithMail(ADA);
  const decorations = plugin.buildMailLinkMarkDecorations(makeView(line));
  assert.equal(decorations.adds.length, 1);
  assert.equal(decorations.adds[0].from, line.indexOf("]]") + 2);
  assert.equal(decorations.adds[0].to, line.indexOf("]]") + 2);
  assert.equal(decorations.adds[0].value.side, 1);
  assert.equal(decorations.adds[0].value.widgetDecoration, true);
});

test("ML8: toggle off yields no decorations", () => {
  const plugin = pluginWithMail(ADA);
  plugin.mailLinkMarksEnabled = false;
  const decorations = plugin.buildMailLinkMarkDecorations(makeView(`- [ ] #task ${LINK}`));
  assert.equal(decorations, StubDecoration.none);
});

test("toggle-mail-link-marks flips the gate and Notice", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.mailLinkMarksEnabled = true;
  plugin.applyMarkGateClass = (name, on) => { plugin.gate = [name, on]; };
  plugin.refreshMailLinkMarksEditors = () => { plugin.refreshed = true; };
  plugin.refreshMailLinkMarksReadingViews = () => {};
  TestNotice.messages = [];
  assert.equal(plugin.toggleMailLinkMarks(), false);
  assert.deepEqual(plugin.gate, ["bob-mail-link-marks", false]);
  assert.equal(plugin.refreshed, true);
  assert.deepEqual(TestNotice.messages, ["Mail reply badges off"]);
  assert.equal(plugin.toggleMailLinkMarks(), true);
  assert.deepEqual(TestNotice.messages[1], "Mail reply badges on");
});

test("styles.css contract: muted badge, no pill, toggle hide", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "bob-ledger-tools", "styles.css"),
    "utf8",
  );
  assert.ok(css.indexOf("body.bob-mail-link-marks .bob-mail-reply-badge") !== -1);
  assert.ok(css.indexOf("body:not(.bob-mail-link-marks) .bob-mail-reply-badge") !== -1);
  const block = css.slice(css.indexOf("body.bob-mail-link-marks .bob-mail-reply-badge"));
  const rules = block.slice(0, block.indexOf("}") + 1);
  assert.ok(rules.indexOf("font-size: 0.8em") !== -1);
  assert.ok(rules.indexOf("margin-inline-start: 0.35em") !== -1);
  assert.ok(rules.indexOf("user-select: none") !== -1);
  assert.ok(rules.indexOf("cursor: default") !== -1);
  assert.ok(rules.indexOf("background: none") !== -1);
  assert.ok(css.indexOf("color-mix(in srgb, var(--text-muted) 70%, var(--text-normal))") !== -1);
});

const ARCHIVED_AT = "2026-11-13T08:15:00-05:00";
const ARCHIVE_NOTE_PATH = "mail/2026/261113_lease.md";
const ARCHIVE_IDENTITY = {
  account: "bryan@example.com",
  threadId: "AABBCCDD",
  archivedAt: ARCHIVED_AT,
};
const ARCHIVE_RECEIPT = {
  archive_event_id: "archive-event-1",
  archived_at: ARCHIVED_AT,
  message_count: 1,
  label: { name: "bob/closed", id: "Label_42" },
};

function archiveCache(receipts = [ARCHIVE_RECEIPT]) {
  const cache = h.mailArchiveReceiptCacheCreate();
  cache.status = "ready";
  cache.byNote.set(ARCHIVE_NOTE_PATH, {
    account: ARCHIVE_IDENTITY.account,
    threadId: ARCHIVE_IDENTITY.threadId,
    receipts,
  });
  return cache;
}

function archiveMetadataCache() {
  return {
    getFirstLinkpathDest(pathPart) {
      return pathPart.startsWith("mail/2026/") ? { path: ARCHIVE_NOTE_PATH } : null;
    },
    getFileCache(file) {
      return {
        frontmatter: {
          type: "[[mail]]",
          gmail_account: ARCHIVE_IDENTITY.account,
          gmail_thread_id: ARCHIVE_IDENTITY.threadId,
          gmail_archived: ARCHIVE_IDENTITY.archivedAt,
        },
      };
    },
  };
}

test("AR1–AR7, AR10–AR11: archive chip is closed-task and identity gated", () => {
  const line = `- [x] #task ${LINK}`;
  const frontmatter = {
    type: "[[mail]]",
    gmail_account: ARCHIVE_IDENTITY.account,
    gmail_thread_id: ARCHIVE_IDENTITY.threadId,
    gmail_archived: ARCHIVED_AT,
  };
  const state = { kind: "receipts", status: "ready", receipts: [ARCHIVE_RECEIPT] };
  const model = h.mailArchiveReceiptChipModel(line, frontmatter, state, "2026-11-07");
  assert.equal(model.text, "⤓ archived Fri, Nov 13");
  assert.match(model.tooltip, /1 saved message under bob\/closed/);
  assert.match(model.tooltip, /Move it back to Inbox/);
  for (const status of ["X", "-"]) {
    assert.ok(h.mailArchiveReceiptChipModel(`- [${status}] #task ${LINK}`, frontmatter, state, "2026-11-07"));
  }
  for (const lineWithoutChip of [
    `- [ ] #task ${LINK}`,
    `- [?] #task ${LINK}`,
    `- [x] Task without the required tag ${LINK}`,
  ]) {
    assert.equal(h.mailArchiveReceiptChipModel(lineWithoutChip, frontmatter, state, "2026-11-07"), null);
  }
  assert.equal(h.mailArchiveReceiptChipModel(line, { ...frontmatter, gmail_archived: "2026-11-12T08:15:00-05:00" }, state, "2026-11-07"), null);
  assert.equal(h.mailArchiveReceiptChipModel(line, frontmatter, { kind: "none", status: "ready", receipts: [] }, "2026-11-07"), null);
  assert.equal(h.mailArchiveReceiptChipModel(line, frontmatter, { kind: "unavailable", status: "unavailable" }, "2026-11-07"), null);
});

test("AR12–AR15: tooltip preserves receipt counts and treats labels as text", () => {
  const second = {
    archive_event_id: "archive-event-2",
    archived_at: "2026-11-14T08:15:00-05:00",
    message_count: 3,
    label: { name: "<script>bob/closed</script>", id: "Label_43" },
  };
  const model = h.mailArchiveReceiptChipModel(
    `- [x] #task ${LINK}`,
    { type: "[[mail]]", gmail_account: ARCHIVE_IDENTITY.account, gmail_thread_id: ARCHIVE_IDENTITY.threadId, gmail_archived: second.archived_at },
    { kind: "receipts", status: "ready", receipts: [ARCHIVE_RECEIPT, second] },
    "2026-11-07",
  );
  assert.equal(model.text, "⤓ archived Sat, Nov 14");
  assert.match(model.tooltip, /1 saved message under bob\/closed/);
  assert.match(model.tooltip, /3 saved messages under <script>bob\/closed<\/script>/);
  assert.doesNotMatch(model.tooltip, /4 saved messages/);
  const host = h.buildMailArchiveChipElement(fakeDoc(), model);
  assert.equal(host.textContent, "⤓ archived Sat, Nov 14");
  assert.equal(host.getAttribute("aria-label"), model.tooltip);
  assert.equal(host.getAttribute("title"), null);
});

test("archive list cache validates identity, coalesces reads, and invalidates", async () => {
  const document = {
    schema_version: 1,
    ok: true,
    threads: [{
      account: ARCHIVE_IDENTITY.account,
      thread_id: ARCHIVE_IDENTITY.threadId,
      path: ARCHIVE_NOTE_PATH,
      archive_receipts: [ARCHIVE_RECEIPT],
    }],
  };
  const decoded = h.mailArchiveReceiptDecodeList(document);
  assert.equal(decoded.ok, true);
  const cache = h.mailArchiveReceiptCacheCreate();
  let runs = 0;
  const runList = async () => {
    runs += 1;
    return { ok: true, document };
  };
  await Promise.all([
    h.mailArchiveReceiptCacheRefresh(cache, runList),
    h.mailArchiveReceiptCacheRefresh(cache, runList),
  ]);
  assert.equal(runs, 1);
  assert.equal(h.mailArchiveReceiptCacheStateForNote(cache, ARCHIVE_NOTE_PATH, ARCHIVE_IDENTITY.account, ARCHIVE_IDENTITY.threadId).kind, "receipts");
  assert.equal(h.mailArchiveReceiptCacheStateForNote(cache, ARCHIVE_NOTE_PATH, "wrong@example.com", ARCHIVE_IDENTITY.threadId).status, "identity-mismatch");
  h.mailArchiveReceiptCacheInvalidate(cache);
  assert.equal(h.mailArchiveReceiptCacheStateForNote(cache, ARCHIVE_NOTE_PATH, ARCHIVE_IDENTITY.account, ARCHIVE_IDENTITY.threadId).status, "unloaded");
  assert.equal(h.mailArchiveReceiptDecodeList({ schema_version: 1, ok: false, threads: [] }).ok, false);
  assert.equal(h.mailArchiveReceiptDecodeListOutput("{").ok, false);
});

test("closed task targets resolve same-line and direct link-only child mail notes only", () => {
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.app = { metadataCache: archiveMetadataCache() };
  plugin.mailArchiveReceiptSnapshotStale = false;
  plugin.mailArchiveReceiptCache = archiveCache();
  const sameLine = [`- [x] #task ${LINK}`];
  assert.equal(plugin.mailArchiveReceiptTargetsForTask(sameLine, 0, "Projects/Example.md").length, 1);
  const child = ["- [x] #task Pay", "  - [[mail/2026/261113_lease]]"];
  assert.equal(plugin.mailArchiveReceiptTargetsForTask(child, 0, "Projects/Example.md").length, 1);
  const nested = ["- [x] #task Pay", "  - notes", "    - [[mail/2026/261113_lease]]"];
  assert.equal(plugin.mailArchiveReceiptTargetsForTask(nested, 0, "Projects/Example.md").length, 0);
  const open = ["- [ ] #task " + LINK];
  assert.equal(plugin.mailArchiveReceiptTargetsForTask(open, 0, "Projects/Example.md").length, 0);
});

test("AR Live Preview adds one display-only widget after a closed task line", () => {
  const line = "- [x] #task [[mail/2026/261113_lease|Lease]]";
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.mailLinkMarksEnabled = true;
  plugin.dateMarksToday = () => "2026-11-07";
  plugin.mailNoteFacts = () => ({ who: "", turn: "", turnSince: "" });
  plugin.mailArchiveReceiptSnapshotStale = false;
  plugin.mailArchiveReceiptCache = archiveCache();
  plugin.app = { metadataCache: archiveMetadataCache() };
  const decorations = plugin.buildMailLinkMarkDecorations(makeView(line));
  assert.equal(decorations.adds.length, 1);
  assert.equal(decorations.adds[0].from, line.length);
  assert.ok(decorations.adds[0].value.widget instanceof h.MailArchiveChipWidget);
  assert.equal(decorations.adds[0].value.widget.models[0].text, "⤓ archived Fri, Nov 13");
});

test("AR Reading view paints each receipt chip under its closed task row", () => {
  const task = "- [x] #task Track lease";
  const source = `${task}\n  - [[mail/2026/261113_lease]]`;
  function node(tag) {
    const attrs = {};
    const el = {
      tagName: String(tag).toUpperCase(),
      children: [],
      parentNode: null,
      ownerDocument: null,
      textContent: "",
      setAttribute(name, value) { attrs[name] = String(value); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
      appendChild(child) { child.parentNode = this; child.ownerDocument = this.ownerDocument; this.children.push(child); return child; },
      removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; return child; },
      querySelectorAll(selector) {
        const result = [];
        const matches = (candidate) => {
          const cls = String(attrsFor(candidate).class || "").split(/\s+/);
          if (selector.startsWith(".")) return cls.includes(selector.slice(1));
          if (selector === "li.task-list-item") return candidate.tagName === "LI" && cls.includes("task-list-item");
          if (selector === "a.internal-link") return candidate.tagName === "A" && cls.includes("internal-link");
          return false;
        };
        const walk = (parent) => {
          for (const child of parent.children || []) {
            if (matches(child)) result.push(child);
            walk(child);
          }
        };
        walk(this);
        return result;
      },
    };
    el._attrs = attrs;
    return el;
  }
  const attrsFor = (el) => el && el._attrs || {};
  const doc = { createElement: (tag) => node(tag) };
  const root = node("div");
  root.ownerDocument = doc;
  const li = node("li");
  li.ownerDocument = doc;
  li.setAttribute("class", "task-list-item");
  root.appendChild(li);
  const plugin = Object.create(LedgerToolsPlugin.prototype);
  plugin.mailLinkMarksEnabled = true;
  plugin.dateMarksToday = () => "2026-11-07";
  plugin.mailLinkMarksReadingViews = new Map();
  plugin.mailArchiveReceiptSnapshotStale = false;
  plugin.mailArchiveReceiptCache = archiveCache();
  plugin.app = { metadataCache: archiveMetadataCache() };
  plugin.mailNoteFacts = () => ({ who: "", turn: "", turnSince: "" });
  const record = { el: root, sourcePath: "Projects/Example.md", ctx: { getSectionInfo: () => ({ text: source }) } };
  assert.equal(plugin.sweepMailLinkMarksReadingView(record), true);
  const group = li.querySelectorAll(".bob-mail-archive-chip-group")[0];
  assert.ok(group);
  assert.equal(group.querySelectorAll(".bob-mail-archive-chip")[0].textContent, "⤓ archived Fri, Nov 13");
});
