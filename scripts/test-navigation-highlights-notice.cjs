const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const notices = [];
function node(spec = {}) {
  const result = { attrs: {}, classes: [], children: [], text: "", style: "" };
  if (spec.cls) result.classes = spec.cls.split(/\s+/);
  if (spec.text !== undefined) result.text = String(spec.text);
  if (spec.attr) result.attrs = { ...spec.attr };
  result.createDiv = (child = {}) => { const n = node(child); result.children.push(n); return n; };
  result.createSpan = result.createDiv;
  result.setAttribute = (key, value) => { result.attrs[key] = String(value); };
  result.setAttributeNS = () => {};
  return result;
}
class Notice {
  constructor(message, duration) { this.message = message; this.duration = duration; this.hidden = false; this.noticeEl = { querySelector: () => null }; notices.push(this); }
  setMessage(message) { this.message = message; }
  hide() { this.hidden = true; }
}
const context = {
  Notice,
  applyIcon: (el, icon) => { el.icon = icon; },
  normalizeHighlightsPageOption: (value) => Number.isInteger(value) && value > 0 ? value : null,
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../plugins/bob-navigation-hotkeys/src/677c-highlights-notice.js"), "utf8"), context);
const { highlightsNoticeModel, renderHighlightsNoticeFragment, showHighlightsNotice } = context;
function rendered(target, status, message) {
  const model = highlightsNoticeModel(target, status, message);
  const root = node();
  renderHighlightsNoticeFragment(model, root);
  return { model, root, nodes: flatten(root) };
}
function flatten(root) { return [root, ...root.children.flatMap(flatten)]; }

test("Highlights notice covers the card copy and outcome states", () => {
  const quote = rendered({ kind: "page", title: "The paper", page: 4, detail: "quote", snippet: "A short passage" });
  assert.equal(quote.model.duration, 4000);
  assert.equal(quote.model.detail, "“A short passage”");
  assert.ok(quote.nodes.some((item) => item.text === "p. 4"));
  assert.ok(quote.nodes.some((item) => item.text === "Opening"));
  assert.equal(quote.root.children[0].attrs["aria-label"], "Opening The paper in Highlights at p. 4");
  assert.ok(quote.root.children[0].classes.includes("bob-nh-highlights"));

  assert.equal(highlightsNoticeModel({ kind: "reading", title: "Read" }).detail, "Resumes where you left off");
  assert.equal(highlightsNoticeModel({ kind: "page", page: null }).detail, "No page number on this highlight — opens where you left off");
  assert.equal(highlightsNoticeModel({ kind: "page", detail: "image" }).detail, "Image highlight");
  assert.equal(highlightsNoticeModel({ kind: "caption", captionCount: 1, page: 3 }).detail, "1 highlight on this page");
  const archived = rendered({ kind: "page", title: "Archive", page: 2, archived: { replaced: "2026-10-28" } });
  assert.ok(archived.nodes.some((item) => item.text === "Archived copy · replaced 2026-10-28"));

  const unavailable = highlightsNoticeModel({ kind: "page", title: "Paper", page: 4 }, "unavailable");
  assert.equal(unavailable.level, "warn");
  assert.equal(unavailable.duration, 8000);
  assert.equal(unavailable.detail, "Jumping to p. 4 needs Hammerspoon");
  const failed = highlightsNoticeModel({ kind: "error" }, "failed", "PDF missing");
  assert.equal(failed.level, "error");
  assert.equal(failed.duration, 8000);
  assert.equal(failed.detail, "PDF missing");
  const removed = highlightsNoticeModel({ kind: "removed", message: "Removed in Highlights" }, "failed", "Removed in Highlights");
  assert.equal(removed.state, "Removed");
  assert.equal(removed.level, "muted");
});

test("Highlights card updates in place, replaces for longer duration, and falls back without DOM", () => {
  const oldDocument = context.document;
  context.document = { createDocumentFragment: node };
  const plugin = {};
  const initial = showHighlightsNotice(plugin, highlightsNoticeModel({ kind: "page", title: "A", page: 4 }));
  assert.equal(plugin.highlightsNotice, initial);
  const updated = showHighlightsNotice(plugin, highlightsNoticeModel({ kind: "page", title: "A", page: 4 }, "opening", "updated"), initial);
  assert.equal(updated, initial);
  assert.equal(initial.message.children[0].attrs["aria-label"], "updated");
  const failed = showHighlightsNotice(plugin, highlightsNoticeModel({ kind: "error", title: "A" }, "failed", "failure"), initial);
  assert.notEqual(failed, initial);
  assert.equal(initial.hidden, true);
  assert.equal(failed.duration, 8000);
  assert.equal(plugin.highlightsNotice, failed);

  delete context.document;
  const fallback = showHighlightsNotice({}, highlightsNoticeModel({ kind: "reading", title: "No DOM" }));
  assert.equal(fallback, null);
  assert.equal(notices.at(-1).message, "Opening No DOM in Highlights — resumes where you left off");
  context.document = oldDocument;
});
