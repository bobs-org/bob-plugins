// Bob Mail archived banner: trusted spans, receipt cache, undo argv, and
// both rendering hosts. Display-only until the button is pressed: rendering
// never spawns a process or writes the vault.
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
class TestMarkdownView {}
class TestMarkdownRenderChild {
  constructor(el) { this.el = el; }
}
class TestNotice {
  constructor(message) { notices.push(String(message)); }
}
class FakePlugin {
  constructor(app) { this.app = app; this.commands = []; }
  async loadData() { return {}; }
  async saveData() {}
  addCommand(command) { this.commands.push(command); }
  addSettingTab() {}
  registerEvent(event) { (this.registeredEvents ||= []).push(event); return event; }
  registerEditorExtension(extension) { (this.editorExtensions ||= []).push(extension); }
  registerMarkdownPostProcessor(handler, sortOrder) {
    (this.postProcessors ||= []).push({ handler, sortOrder });
  }
  register(callback) { (this.cleanups ||= []).push(callback); }
}

const editorInfoField = { _archiveField: "info" };
const editorLivePreviewField = { _archiveField: "live" };
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
const StubPrec = { highest: (value) => value };

const originalLoad = Module._load;
Module._load = function loadArchiveBannerStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: TestMarkdownView,
      MarkdownRenderChild: TestMarkdownRenderChild,
      Modal: class {},
      Notice: TestNotice,
      Plugin: FakePlugin,
      PluginSettingTab: class {},
      Setting: class {},
      openExternal: () => {},
      editorInfoField,
      editorLivePreviewField,
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: StubPrec, StateEffect: StubStateEffect, RangeSetBuilder: StubRangeSetBuilder };
  }
  if (request === "@codemirror/view") {
    return { ViewPlugin: StubViewPlugin, Decoration: StubDecoration, WidgetType: StubWidgetType };
  }
  if (request === "@codemirror/language") {
    return { syntaxTree: () => null };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const BobMailPlugin = require("../plugins/bob-mail/main.js");
const mail = BobMailPlugin.helpers;
Module._load = originalLoad;

const BANNER = (date) => `> \uD83D\uDDC4\uFE0F Archived by Bob on ${date} — to move it back, use Move to Inbox in Gmail.`;
const BEGIN = "<!-- bob:gmail:receipt:begin v1 -->";
const END = "<!-- bob:gmail:receipt:end -->";
const NOTE = "mail/2026/lease.md";

function mailNote(frontmatter) {
  return {
    path: NOTE,
    basename: "lease",
    frontmatter: frontmatter === undefined
      ? { type: "[[mail]]", gmail_thread_id: "aabbcc", gmail_account: "me@example.com" }
      : frontmatter,
  };
}

function receipt(eventId, archivedAt, count, labelName, labelId) {
  return {
    archive_event_id: eventId,
    archived_at: archivedAt,
    message_count: count,
    label: { name: labelName, id: labelId },
  };
}

function listDocument(threads) {
  return { schema_version: 1, ok: true, threads };
}

function threadRow(notePath, receipts) {
  return {
    account: "me@example.com",
    thread_id: "aabbcc",
    path: notePath,
    archive_receipts: receipts,
  };
}

// --- trusted-span recognition ------------------------------------------------

test("banner date accepts the saved line and the rendered text", () => {
  assert.equal(mail.mailArchiveBannerDate(BANNER("2026-11-13")), "2026-11-13");
  assert.equal(
    mail.mailArchiveBannerDate("\uD83D\uDDC4\uFE0F Archived by Bob on 2026-11-13 — to move it back, use Move to Inbox in Gmail."),
    "2026-11-13",
  );
});

test("banner date rejects hostile subjects and malformed dates", () => {
  assert.equal(mail.mailArchiveBannerDate("> Archived by Bob on 2026-11-13 — to move it back"), null);
  assert.equal(mail.mailArchiveBannerDate(BANNER("2026-13-40").replace("2026-13-40", "2026-13-40")), null);
  assert.equal(mail.mailArchiveBannerDate(BANNER("2026-11-13") + " <script>alert(1)</script>"), null);
  assert.equal(mail.mailArchiveBannerDate("> \uD83D\uDDC4\uFE0F Archived by Bob on yesterday — to move it back, use Move to Inbox in Gmail."), null);
  assert.equal(mail.mailArchiveBannerDate("not a banner"), null);
  assert.equal(mail.mailArchiveBannerDate(null), null);
});

test("trusted spans need the exact markers in order", () => {
  const lines = ["# Subject", BEGIN, BANNER("2026-11-13"), END, "body"];
  const found = mail.mailArchiveTrustedBannerDates(lines);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], { line: 2, date: "2026-11-13" });
  assert.equal(mail.mailArchiveHasTrustedBanner(lines.join("\n")), true);
});

test("fake banners without markers and damaged spans stay untrusted", () => {
  assert.deepEqual(mail.mailArchiveTrustedBannerDates(["# S", BANNER("2026-11-13"), "body"]), []);
  assert.deepEqual(
    mail.mailArchiveTrustedBannerDates([BEGIN, BEGIN, BANNER("2026-11-13"), END, END]),
    [],
  );
  assert.deepEqual(
    mail.mailArchiveTrustedBannerDates([BEGIN, END, BANNER("2026-11-13")]),
    [],
  );
  assert.deepEqual(mail.mailArchiveTrustedBannerDates([END, BANNER("2026-11-13"), BEGIN]), []);
  assert.equal(mail.mailArchiveHasTrustedBanner(BANNER("2026-11-13")), false);
});

// --- undo argv ----------------------------------------------------------------

test("unarchive argv pins the exact note behind -- with JSON output", () => {
  assert.deepEqual(mail.mailArchiveUnarchiveArgs(NOTE), ["gmail", "unarchive", "--", NOTE, "-f", "json"]);
  assert.deepEqual(mail.mailArchiveUnarchiveArgs("--evil.md")[3], "--evil.md");
});

// --- receipt snapshot decoding -------------------------------------------------

test("list decoding maps receipts per note and confirms empty arrays", () => {
  const decoded = mail.mailArchiveDecodeList(listDocument([
    threadRow(NOTE, [receipt("e1", "2026-11-13T08:15:00-05:00", 3, "bob/closed", "L1")]),
    threadRow("mail/2026/other.md", []),
    threadRow("mail/2026/unknown.md", null),
  ]));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.byNote.get(NOTE).length, 1);
  assert.deepEqual(decoded.byNote.get("mail/2026/other.md"), []);
  assert.ok(decoded.unavailable.has("mail/2026/unknown.md"));
});

test("list decoding never fabricates ownership from malformed rows", () => {
  assert.deepEqual(mail.mailArchiveDecodeList({}).ok, false);
  assert.deepEqual(mail.mailArchiveDecodeList({ schema_version: 1, ok: true }).ok, false);
  assert.deepEqual(mail.mailArchiveDecodeList({ schema_version: 2, ok: true, threads: [] }).ok, false);
  const badEntry = mail.mailArchiveDecodeList(listDocument([
    threadRow(NOTE, [{ archive_event_id: "e1", archived_at: "x", message_count: -1, label: { name: "", id: 7 } }]),
  ]));
  assert.equal(badEntry.ok, true);
  assert.ok(badEntry.unavailable.has(NOTE));
  assert.ok(!badEntry.byNote.has(NOTE));
  const badShape = mail.mailArchiveDecodeList(listDocument([threadRow(NOTE, "nope")]));
  assert.ok(badShape.unavailable.has(NOTE));
});

// --- cache states ----------------------------------------------------------------

test("per-note state distinguishes receipts, none, and unavailable", () => {
  const cache = mail.mailArchiveCreateCache();
  assert.deepEqual(mail.mailArchiveStateForNote(cache, NOTE), { kind: "unavailable", status: "unloaded" });
  cache.status = "old-bob";
  assert.deepEqual(mail.mailArchiveStateForNote(cache, NOTE).status, "old-bob");
  cache.status = "ready";
  cache.byNote.set(NOTE, [receipt("e1", "2026-11-13T08:15:00-05:00", 2, "bob/closed", "L1")]);
  cache.byNote.set("mail/2026/other.md", []);
  assert.equal(mail.mailArchiveStateForNote(cache, NOTE).kind, "receipts");
  assert.equal(mail.mailArchiveStateForNote(cache, "mail/2026/other.md").kind, "none");
  assert.equal(mail.mailArchiveStateForNote(cache, "mail/2026/missing.md").status, "unknown-note");
  cache.unavailable.add("mail/2026/shady.md");
  assert.deepEqual(mail.mailArchiveStateForNote(cache, "mail/2026/shady.md"), { kind: "unavailable", status: "unavailable" });
});

test("cache refresh coalesces concurrent callers into one list call", async () => {
  const cache = mail.mailArchiveCreateCache();
  let calls = 0;
  const runList = async () => {
    calls += 1;
    return { ok: true, document: listDocument([threadRow(NOTE, [])]) };
  };
  const [first, second] = await Promise.all([
    mail.mailArchiveRefreshCache(cache, runList),
    mail.mailArchiveRefreshCache(cache, runList),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.status, "ready");
  assert.equal(second.status, "ready");
  assert.equal(cache.byNote.has(NOTE), true);
});

test("cache refresh settles old-bob and failures without throwing", async () => {
  const oldBob = mail.mailArchiveCreateCache();
  await mail.mailArchiveRefreshCache(oldBob, async () => ({ ok: false, oldBob: true }));
  assert.equal(oldBob.status, "old-bob");
  assert.equal(oldBob.byNote.size, 0);

  const failed = mail.mailArchiveCreateCache();
  await mail.mailArchiveRefreshCache(failed, async () => ({ ok: false, error: "boom" }));
  assert.equal(failed.status, "unavailable");

  const throwing = mail.mailArchiveCreateCache();
  await mail.mailArchiveRefreshCache(throwing, async () => { throw new Error("spawn down"); });
  assert.equal(throwing.status, "unavailable");

  const missing = mail.mailArchiveCreateCache();
  await mail.mailArchiveRefreshCache(missing, null);
  assert.equal(missing.status, "unavailable");
});

// --- tooltips ----------------------------------------------------------------------

test("tooltip names the exact count and label, never guesses", () => {
  const withOne = mail.mailArchiveTooltipFor("2026-11-13", {
    kind: "receipts",
    receipts: [receipt("e1", "2026-11-13T08:15:00-05:00", 1, "bob/closed", "L1")],
  });
  assert.ok(withOne.includes("2026-11-13"));
  assert.ok(withOne.includes("1 message under bob/closed"));

  const withTwo = mail.mailArchiveTooltipFor("2026-11-13", {
    kind: "receipts",
    receipts: [
      receipt("e1", "2026-11-13T08:15:00-05:00", 2, "bob/closed", "L1"),
      receipt("e2", "2026-11-14T08:15:00-05:00", 1, "other", "L2"),
    ],
  });
  assert.ok(withTwo.includes("3 messages"));
  assert.ok(withTwo.includes("2 labels"));

  assert.ok(mail.mailArchiveTooltipFor("2026-11-13", { kind: "none" }).includes("details unavailable"));
  assert.ok(mail.mailArchiveTooltipFor("2026-11-13", { kind: "unavailable", status: "old-bob" }).includes("details unavailable"));
});

// --- undo outcomes --------------------------------------------------------------------

test("undo outcomes match the exact note, then input, then a single row", () => {
  const restored = { schema_version: 1, ok: true, results: [{ input: "x", thread_id: "t1", note: NOTE, action: "restored", message_ids: ["m1"], label: { name: "l", id: "i" } }] };
  assert.deepEqual(mail.mailArchiveUndoOutcome(restored, NOTE), { kind: "restored", note: NOTE, threadId: "t1" });
  assert.equal(mail.mailArchiveUndoNotice({ kind: "restored", threadId: "t1" }), "Moved back to Inbox · t1");

  const unchanged = { schema_version: 1, ok: true, results: [{ input: NOTE, thread_id: "", note: "", action: "unchanged", message_ids: [], label: { name: null, id: null }, reason: "no-receipt" }] };
  const parsed = mail.mailArchiveUndoOutcome(unchanged, NOTE);
  assert.equal(parsed.kind, "unchanged");
  assert.equal(parsed.message, "no-receipt");
  assert.ok(mail.mailArchiveUndoNotice(parsed).startsWith("Nothing to move back"));

  const failed = { schema_version: 1, ok: false, results: [{ input: NOTE, thread_id: "t1", note: NOTE, action: "failed", message_ids: [], label: { name: "l", id: "i" }, error: { kind: "note_projection", message: "receipt released but projection needs repair", hint: "run sync" } }] };
  const parsedFailed = mail.mailArchiveUndoOutcome(failed, NOTE);
  assert.equal(parsedFailed.kind, "failed");
  assert.equal(parsedFailed.hint, "run sync");
  assert.ok(mail.mailArchiveUndoNotice(parsedFailed).includes("receipt released"));

  assert.equal(mail.mailArchiveUndoOutcome({ results: [] }, NOTE).kind, "unknown");
  assert.equal(mail.mailArchiveUndoOutcome(null, NOTE).kind, "unknown");
});

// --- DOM builder --------------------------------------------------------------------------

function fakeDoc() {
  const doc = { created: [], createElement(tag) { return fakeEl(tag, doc); } };
  return doc;
}

function fakeEl(tag, doc) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attrs: {},
    listeners: {},
    parentNode: null,
    textContent: "",
    ownerDocument: doc || null,
    setAttribute(name, value) { el.attrs[String(name)] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
    },
    removeAttribute(name) { delete el.attrs[name]; },
    addEventListener(type, fn) { ((el.listeners[type] ||= [])).push(fn); },
    click() { for (const fn of el.listeners.click || []) fn({ preventDefault() {} }); },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    removeChild(child) {
      const at = el.children.indexOf(child);
      if (at !== -1) el.children.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    querySelector(sel) { const all = el.querySelectorAll(sel); return all[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      const walk = (node) => {
        for (const child of node.children || []) {
          if (fakeMatches(child, sel)) out.push(child);
          walk(child);
        }
      };
      walk(el);
      return out;
    },
  };
  return el;
}

function fakeMatches(el, sel) {
  if (sel.startsWith(".")) return String(el.attrs.class || "").split(/\s+/).includes(sel.slice(1));
  if (sel === "button") return el.tagName === "BUTTON";
  if (sel === "blockquote") return el.tagName === "BLOCKQUOTE";
  return false;
}

test("banner element uses text APIs and reports clicks once", () => {
  const doc = fakeDoc();
  let clicks = 0;
  const host = mail.buildMailArchiveBannerElement(doc, {
    label: "<img src=x>",
    tooltip: "tip <b>bold</b>",
    pending: false,
    onClick: () => { clicks += 1; },
  });
  assert.ok(host);
  assert.equal(host.attrs.class, mail.MAIL_ARCHIVE_HOST_CLASS);
  const button = host.querySelector("button");
  assert.equal(button.textContent, "<img src=x>");
  assert.equal(button.attrs["aria-label"], "tip <b>bold</b>");
  assert.equal(button.attrs.disabled, undefined);
  button.click();
  assert.equal(clicks, 1);

  const pendingHost = mail.buildMailArchiveBannerElement(doc, { label: "x", tooltip: "t", pending: true });
  assert.equal(pendingHost.querySelector("button").attrs.disabled, "true");
  assert.equal(mail.buildMailArchiveBannerElement(null, {}), null);
});

// --- Reading-view host ---------------------------------------------------------------------

function makeArchiveApp(entries) {
  const files = new Map(Object.entries(entries));
  return {
    metadataCache: {
      getFileCache(file) {
        const hit = files.get(file && file.path);
        return hit ? { frontmatter: hit.frontmatter } : {};
      },
      getFirstLinkpathDest() { return null; },
    },
    vault: {
      adapter: { basePath: "/vault" },
      getAbstractFileByPath(path) {
        return files.has(path) ? { path, basename: String(path).split("/").pop() } : null;
      },
      async cachedRead(file) {
        const hit = files.get(file && file.path);
        return hit ? hit.markdown : "";
      },
    },
    workspace: {
      getActiveViewOfType() { return null; },
      on() { return {}; },
      getLeavesOfType() { return []; },
    },
  };
}

function bannerMarkdown(date) {
  return ["# Subject", "", BEGIN, BANNER(date), END, "", "body"].join("\n");
}

function makeReadingRoot(doc, bannerTexts) {
  const root = fakeEl("div", doc);
  root.ownerDocument = doc;
  for (const text of bannerTexts) {
    const quote = fakeEl("blockquote", doc);
    quote.textContent = text;
    root.appendChild(quote);
  }
  return root;
}

function readingCtx(sourcePath) {
  return { sourcePath, addChild() {}, getSectionInfo: () => null };
}

async function flushArchiveAsync(ms = 20) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function archivePlugin(entries, mailCalls) {
  const plugin = new BobMailPlugin(makeArchiveApp(entries));
  plugin.mailCalls = mailCalls;
  plugin.mailCall = async (args) => {
    mailCalls.push([...args]);
    return { ok: true, document: { schema_version: 1, ok: true, threads: [] } };
  };
  await plugin.onload();
  return plugin;
}

test("reading view enhances the trusted banner with one undo button", async () => {
  const calls = [];
  const plugin = await archivePlugin({ [NOTE]: { frontmatter: mailNote().frontmatter, markdown: bannerMarkdown("2026-11-13") } }, calls);
  plugin.mailArchiveCache.status = "ready";
  plugin.mailArchiveCache.byNote.set(
    NOTE,
    [receipt("e1", "2026-11-13T08:15:00-05:00", 3, "bob/closed", "L1")],
  );
  const doc = fakeDoc();
  const root = makeReadingRoot(doc, [BANNER("2026-11-13").replace(/^>\s*/, "")]);
  plugin.renderMailArchiveBannerIn(root, readingCtx(NOTE));
  await flushArchiveAsync();
  const hosts = root.querySelectorAll(`.${mail.MAIL_ARCHIVE_HOST_CLASS}`);
  assert.equal(hosts.length, 1);
  const button = hosts[0].querySelector("button");
  assert.equal(button.textContent, mail.MAIL_ARCHIVE_UNDO_LABEL);
  assert.ok(button.attrs["aria-label"].includes("3 messages under bob/closed"));
  assert.equal(calls.length, 0);
});

test("reading view leaves fakes, damage, and non-mail notes inert", async () => {
  const calls = [];
  const hostile = "> \uD83D\uDDC4\uFE0F Archived by Bob on 2026-11-13 — to move it back, use Move to Inbox in Gmail. <img src=x>";
  const plugin = await archivePlugin({
    [NOTE]: { frontmatter: mailNote().frontmatter, markdown: `# S\n\n${hostile}\n` },
    "notes/plain.md": {
      frontmatter: { title: "plain" },
      markdown: bannerMarkdown("2026-11-13"),
    },
    "mail/2026/damaged.md": {
      frontmatter: mailNote().frontmatter,
      markdown: ["# S", BEGIN, BEGIN, BANNER("2026-11-13"), END, END].join("\n"),
    },
  }, calls);
  plugin.mailArchiveCache.status = "ready";

  const fakeRoot = makeReadingRoot(fakeDoc(), [hostile]);
  plugin.renderMailArchiveBannerIn(fakeRoot, readingCtx(NOTE));
  const plainRoot = makeReadingRoot(fakeDoc(), [BANNER("2026-11-13").replace(/^>\s*/, "")]);
  plugin.renderMailArchiveBannerIn(plainRoot, readingCtx("notes/plain.md"));
  const damagedRoot = makeReadingRoot(fakeDoc(), [BANNER("2026-11-13").replace(/^>\s*/, "")]);
  plugin.renderMailArchiveBannerIn(damagedRoot, readingCtx("mail/2026/damaged.md"));
  await flushArchiveAsync();
  assert.equal(fakeRoot.querySelectorAll(`.${mail.MAIL_ARCHIVE_HOST_CLASS}`).length, 0);
  assert.equal(plainRoot.querySelectorAll(`.${mail.MAIL_ARCHIVE_HOST_CLASS}`).length, 0);
  assert.equal(damagedRoot.querySelectorAll(`.${mail.MAIL_ARCHIVE_HOST_CLASS}`).length, 0);
  assert.equal(calls.length, 0);
});

test("reading sweep removes the button once the banner is gone", async () => {
  const calls = [];
  const markdown = bannerMarkdown("2026-11-13");
  const app = makeArchiveApp({ [NOTE]: { frontmatter: mailNote().frontmatter, markdown } });
  const plugin = new BobMailPlugin(app);
  plugin.mailCall = async () => ({ ok: true, document: { schema_version: 1, ok: true, threads: [] } });
  await plugin.onload();
  plugin.mailArchiveCache.status = "ready";
  plugin.mailArchiveCache.byNote.set(NOTE, []);
  const doc = fakeDoc();
  const root = makeReadingRoot(doc, [BANNER("2026-11-13").replace(/^>\s*/, "")]);
  plugin.renderMailArchiveBannerIn(root, readingCtx(NOTE));
  await flushArchiveAsync();
  assert.equal(root.querySelectorAll(`.${mail.MAIL_ARCHIVE_HOST_CLASS}`).length, 1);
  app.vault.cachedRead = async () => "# Subject\n\nbody\n";
  await plugin.sweepMailArchiveReadingView({ el: root, sourcePath: NOTE, ctx: readingCtx(NOTE), sweepId: 0 });
  assert.equal(root.querySelectorAll(`.${mail.MAIL_ARCHIVE_HOST_CLASS}`).length, 0);
});

test("banner click runs one exact unarchive, ignores doubles, then reloads state", async () => {
  const calls = [];
  const plugin = await archivePlugin({ [NOTE]: { frontmatter: mailNote().frontmatter, markdown: bannerMarkdown("2026-11-13") } }, calls);
  const restoredDoc = {
    schema_version: 1,
    ok: true,
    results: [{ input: NOTE, thread_id: "t1", note: NOTE, action: "restored", message_ids: ["m1"], label: { name: "bob/closed", id: "L1" } }],
  };
  plugin.mailCall = async (args) => {
    calls.push([...args]);
    if (args[1] === "unarchive") return { ok: true, document: restoredDoc };
    return { ok: true, document: listDocument([threadRow(NOTE, [])]) };
  };
  plugin.mailArchiveCache.status = "ready";
  const before = notices.length;
  const first = plugin.mailArchiveUnarchiveFromBanner(NOTE);
  const second = plugin.mailArchiveUnarchiveFromBanner(NOTE);
  assert.equal(await second, false);
  assert.equal(await first, true);
  assert.deepEqual(calls[0], ["gmail", "unarchive", "--", NOTE, "-f", "json"]);
  assert.deepEqual(calls[1], ["gmail", "list", "-a", "-f", "json"]);
  assert.ok(notices.slice(before).some((message) => message.includes("Moved back to Inbox · t1")));
  assert.equal(plugin.mailArchiveCache.byNote.has(NOTE), true);
});

test("banner click surfaces unchanged and failed outcomes without guessing", async () => {
  const plugin = await archivePlugin({ [NOTE]: { frontmatter: mailNote().frontmatter, markdown: bannerMarkdown("2026-11-13") } }, []);
  plugin.mailArchiveCache.status = "ready";
  plugin.mailCall = async () => ({
    ok: true,
    document: { schema_version: 1, ok: true, results: [{ input: NOTE, thread_id: "", note: NOTE, action: "unchanged", message_ids: [], label: { name: null, id: null }, reason: "no-receipt" }] },
  });
  const before = notices.length;
  assert.equal(await plugin.mailArchiveUnarchiveFromBanner(NOTE), false);
  assert.ok(notices.slice(before).some((message) => message.includes("Nothing to move back")));

  plugin.mailCall = async () => ({
    ok: true,
    document: { schema_version: 1, ok: false, results: [{ input: NOTE, thread_id: "t1", note: NOTE, action: "failed", message_ids: [], label: { name: "l", id: "i" }, error: { kind: "note_projection", message: "receipt released but projection needs repair" } }] },
  });
  const beforeFailed = notices.length;
  assert.equal(await plugin.mailArchiveUnarchiveFromBanner(NOTE), false);
  assert.ok(notices.slice(beforeFailed).some((message) => message.includes("needs repair")));

  plugin.mailCall = async () => ({ ok: false, oldBob: true, error: "unknown command" });
  const beforeOld = notices.length;
  assert.equal(await plugin.mailArchiveUnarchiveFromBanner(NOTE), false);
  assert.ok(notices.slice(beforeOld).some((message) => message.includes("Update bob")));
});

test("reading sweep on an unloaded cache fires one coalesced snapshot", async () => {
  const calls = [];
  const plugin = await archivePlugin({ [NOTE]: { frontmatter: mailNote().frontmatter, markdown: bannerMarkdown("2026-11-13") } }, calls);
  plugin.mailCall = async (args) => {
    calls.push([...args]);
    return { ok: true, document: listDocument([threadRow(NOTE, [])]) };
  };
  const doc = fakeDoc();
  const first = makeReadingRoot(doc, [BANNER("2026-11-13").replace(/^>\s*/, "")]);
  const second = makeReadingRoot(doc, [BANNER("2026-11-13").replace(/^>\s*/, "")]);
  plugin.renderMailArchiveBannerIn(first, readingCtx(NOTE));
  plugin.renderMailArchiveBannerIn(second, readingCtx(NOTE));
  await flushArchiveAsync(40);
  assert.equal(calls.filter((args) => args[1] === "list").length, 1);
  assert.equal(plugin.mailArchiveCache.status, "ready");
});

// --- Live Preview host -----------------------------------------------------------------------

function liveDoc(text) {
  const lines = text.split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return {
    length: text.length,
    toString() { return text; },
    line(n) {
      const index = n - 1;
      const from = starts[index];
      return { from, to: from + lines[index].length, text: lines[index], number: n };
    },
  };
}

function liveView(text, filePath, live = true) {
  const doc = liveDoc(text);
  return {
    visibleRanges: [{ from: 0, to: text.length }],
    state: {
      doc,
      field(field) {
        if (field === editorLivePreviewField) return live;
        if (field === editorInfoField) return { file: { path: filePath } };
        return null;
      },
    },
  };
}

test("live preview decorates the trusted banner line and nothing else", async () => {
  const calls = [];
  const plugin = await archivePlugin({ [NOTE]: { frontmatter: mailNote().frontmatter, markdown: bannerMarkdown("2026-11-13") } }, calls);
  plugin.mailArchiveCache.status = "ready";
  plugin.mailArchiveCache.byNote.set(
    NOTE,
    [receipt("e1", "2026-11-13T08:15:00-05:00", 2, "bob/closed", "L1")],
  );
  const decorations = plugin.buildMailArchiveLiveDecorations(liveView(bannerMarkdown("2026-11-13"), NOTE));
  assert.equal(decorations.adds.length, 1);
  const widget = decorations.adds[0].value.widget;
  assert.ok(widget);
  assert.ok(widget.key.includes(NOTE));
  assert.ok(widget.key.includes("2026-11-13"));
  assert.equal(calls.length, 0);

  const plain = plugin.buildMailArchiveLiveDecorations(
    liveView(bannerMarkdown("2026-11-13"), "notes/plain.md"),
  );
  assert.equal(plain.adds ? plain.adds.length : 0, 0);

  const fake = plugin.buildMailArchiveLiveDecorations(
    liveView(`# S\n\n${BANNER("2026-11-13")}`, NOTE),
  );
  assert.equal(fake.adds ? fake.adds.length : 0, 0);

  const sourceOnly = plugin.buildMailArchiveLiveDecorations(liveView("# S\n\nbody", NOTE));
  assert.equal(sourceOnly.adds ? sourceOnly.adds.length : 0, 0);
});

test("live extension registers once and refreshes on the shared effect", async () => {
  const calls = [];
  const plugin = await archivePlugin({ [NOTE]: { frontmatter: mailNote().frontmatter, markdown: bannerMarkdown("2026-11-13") } }, calls);
  assert.equal(plugin.editorExtensions.length, 1);
  assert.equal(plugin.postProcessors.length, 1);
  assert.equal(plugin.postProcessors[0].sortOrder, mail.MAIL_ARCHIVE_POSTPROCESSOR_ORDER);
  const extension = plugin.createMailArchiveLiveExtension();
  assert.ok(extension);
  const update = { docChanged: false, viewportChanged: true, transactions: [] };
  assert.equal(plugin.mailArchiveLiveShouldRebuild(update), true);
  assert.equal(plugin.mailArchiveLiveShouldRebuild({}), false);
});

// --- shared API and lifecycle ------------------------------------------------------------------

test("shared cache api serves plain JSON for ledger tools", async () => {
  const calls = [];
  const plugin = await archivePlugin({ [NOTE]: { frontmatter: mailNote().frontmatter, markdown: bannerMarkdown("2026-11-13") } }, calls);
  assert.equal(plugin.api.mailArchive.version, 1);
  plugin.mailArchiveCache.status = "ready";
  plugin.mailArchiveCache.byNote.set(
    NOTE,
    [receipt("e1", "2026-11-13T08:15:00-05:00", 1, "bob/closed", "L1")],
  );
  const state = plugin.api.mailArchive.stateForNote(NOTE);
  assert.equal(state.kind, "receipts");
  assert.equal(state.receipts[0].label.name, "bob/closed");
  assert.equal(plugin.api.mailArchive.stateForNote("mail/2026/missing.md").status, "unknown-note");
});

test("shared cache api notifies Ledger Tools after a completed snapshot refresh", async () => {
  const plugin = await archivePlugin({}, []);
  let changes = 0;
  const dispose = plugin.api.mailArchive.onChange(() => { changes += 1; });
  assert.equal(typeof dispose, "function");
  plugin.mailArchiveNotifyChanged();
  assert.equal(changes, 1);
  dispose();
  plugin.mailArchiveNotifyChanged();
  assert.equal(changes, 1);
});

test("unload clears banner hosts, views, and pending bits", async () => {
  const calls = [];
  const plugin = await archivePlugin({ [NOTE]: { frontmatter: mailNote().frontmatter, markdown: bannerMarkdown("2026-11-13") } }, calls);
  plugin.mailArchiveCache.status = "ready";
  const doc = fakeDoc();
  const root = makeReadingRoot(doc, [BANNER("2026-11-13").replace(/^>\s*/, "")]);
  plugin.renderMailArchiveBannerIn(root, readingCtx(NOTE));
  await flushArchiveAsync();
  assert.equal(root.querySelectorAll(`.${mail.MAIL_ARCHIVE_HOST_CLASS}`).length, 1);
  plugin.mailArchivePending.add(NOTE);
  plugin.onunload();
  assert.equal(root.querySelectorAll(`.${mail.MAIL_ARCHIVE_HOST_CLASS}`).length, 0);
  assert.equal(plugin.mailArchiveReadingViews.size, 0);
  assert.equal(plugin.mailArchivePending.size, 0);
});
