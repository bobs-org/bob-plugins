const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { ElementStub } = require("./modal-harness.cjs");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const { buildWindowPrefixViewModel, createWindowHintHost } = helpers;
const STYLES = fs.readFileSync(
  path.join(__dirname, "../plugins/bob-navigation-hotkeys/styles.css"),
  "utf8",
);

function split(id, x, leaves, options = {}) {
  const width = options.width ?? 100;
  return {
    id,
    rect: { left: x, top: options.top ?? 0, right: x + width, bottom: (options.top ?? 0) + 100 },
    leaves,
    selectedLeafId: options.selected ?? leaves[leaves.length - 1]?.id,
    mostRecentLeafId: options.mostRecent,
    recency: options.recency ?? 0,
  };
}

function leaf(id, options = {}) {
  return { id, label: options.label ?? id, pinned: options.pinned === true };
}

function layout(activeLeafId, splits) {
  return { activeLeafId, splits };
}

function descendants(element) {
  return (element?.children || []).flatMap((child) => [child, ...descendants(child)]);
}

function byAttr(root, name, value) {
  return descendants(root).filter((node) => node.attributes && node.attributes[name] === value);
}

function byClass(root, className) {
  return descendants(root).filter((node) => node.classes && node.classes.includes(className));
}

function flattenText(element) {
  return [element.textContent, ...(element.children || []).map(flattenText)].filter(Boolean).join(" ");
}

function makeDoc(options = {}) {
  const body = new ElementStub({ tag: "body" });
  const doc = {
    body,
    documentElement: { clientHeight: options.viewportHeight ?? 0 },
    createElement(tag) {
      const el = new ElementStub({ tag });
      el.ownerDocument = doc;
      return el;
    },
    defaultView: {
      innerHeight: options.viewportHeight ?? 0,
      matchMedia: (query) => ({
        matches: Boolean(options.reducedMotion) && String(query).includes("prefers-reduced-motion"),
      }),
      navigator: { platform: options.platform === "other" ? "Linux x86_64" : "MacIntel" },
    },
  };
  body.ownerDocument = doc;
  return doc;
}

function screenshotModel() {
  return buildWindowPrefixViewModel(layout("blog", [
    split("left", 0, [
      leaf("day", { label: "20261115" }),
      leaf("dash", { label: "dash" }),
      leaf("blog", { label: "sase_blog" }),
    ], { selected: "blog", width: 280 }),
    split("right", 280, [leaf("contents", { label: "sase_blog_contents" })], { width: 180 }),
  ]));
}

test("styles: window prefix tokens cover ring, card, motion, and underline", () => {
  for (const token of [
    "/* Window prefix */",
    ".bob-wp-ring",
    ".bob-wp-badge",
    ".bob-wp-card",
    ".bob-wp-minimap",
    ".bob-wp-grid",
    ".bob-wp-chip",
    ".bob-wp-receipt",
    "@keyframes bob-wp-card-in",
    "@keyframes bob-wp-pulse",
    "@keyframes bob-wp-nudge",
    "prefers-reduced-motion",
    "bob-wp-multi-split",
    "workspace-tabs.mod-active",
    ".bob-key-card-key",
    "color-mix(in srgb, var(--color-orange) 16%",
    "min(520px",
  ]) {
    assert.ok(STYLES.includes(token), token);
  }
});

test("hint paints available rows, reasons, and the closes-split chip", () => {
  const doc = makeDoc({ platform: "mac" });
  const host = createWindowHintHost(doc, { platform: "mac" });
  const model = screenshotModel();
  host.showArmed(model, model.splits[0].rect, {
    left: 0, top: 0, right: 460, bottom: 100, width: 460, height: 100,
  });
  host.showCard(model);
  const card = byAttr(doc.body, "data-bob-wp", "card")[0];
  assert.equal(card.attributes.role, "status");
  assert.match(card.attributes["aria-label"], /Window/);
  assert.match(flattenText(byAttr(doc.body, "data-bob-wp", "header-key")[0]), /⌃W/);
  assert.match(flattenText(byAttr(doc.body, "data-bob-wp", "split-count")[0]), /2 splits/);

  const rows = byAttr(doc.body, "data-bob-wp", "row");
  assert.equal(rows.length, 6);
  const byKey = Object.fromEntries(rows.map((row) => [row.attributes["data-bob-wp-key"], row]));
  assert.equal(byKey.h.classes.includes("is-unavailable"), true);
  assert.match(flattenText(byKey.h), /left edge/);
  assert.equal(byKey.l.classes.includes("is-unavailable"), false);
  assert.match(flattenText(byKey.l), /sase_blog_contents/);
  assert.doesNotMatch(flattenText(byKey.l), /focus sase_blog_contents/);
  const chips = byAttr(doc.body, "data-bob-wp", "chip");
  assert.equal(chips.length, 0);
  host.destroy();
});

test("hint paints a consequence chip when a move closes a split", () => {
  const doc = makeDoc();
  const host = createWindowHintHost(doc, { platform: "mac" });
  const model = buildWindowPrefixViewModel(layout("a", [
    split("left", 0, [leaf("a", { label: "sase_blog" })]),
    split("right", 100, [leaf("c"), leaf("b", { label: "sase_blog_contents" })], { selected: "b" }),
  ]));
  host.showCard(model);
  const moveL = byAttr(doc.body, "data-bob-wp", "row")
    .find((row) => row.attributes["data-bob-wp-key"] === "L");
  assert.ok(moveL);
  assert.equal(moveL.classes.includes("is-unavailable"), false);
  const chip = byAttr(moveL, "data-bob-wp", "chip")[0];
  assert.equal(flattenText(chip), "closes split");
  host.destroy();
});

test("minimap paints pills, neighbour key caps, and create ghosts", () => {
  const doc = makeDoc();
  const host = createWindowHintHost(doc);
  const threeTabs = buildWindowPrefixViewModel(layout("b", [
    split("only", 0, [
      leaf("a", { label: "20261115" }),
      leaf("dash", { label: "dash" }),
      leaf("b", { label: "sase_blog" }),
    ], { selected: "b", width: 240 }),
  ]));
  host.showCard(threeTabs);
  const pills = byAttr(doc.body, "data-bob-wp", "pill");
  assert.equal(pills.length, 1);
  assert.match(flattenText(pills[0]), /sase_blog/);
  assert.match(flattenText(pills[0]), /3/);
  const ghosts = byAttr(doc.body, "data-bob-wp", "ghost");
  assert.deepEqual(ghosts.map((node) => node.attributes["data-bob-wp-ghost"]), ["H", "L"]);

  const two = screenshotModel();
  host.showCard(two);
  const neighbourKeys = byAttr(doc.body, "data-bob-wp", "pill-key").map((node) => node.textContent);
  assert.deepEqual(neighbourKeys, ["l"]);
  assert.deepEqual(
    byAttr(doc.body, "data-bob-wp", "ghost").map((node) => node.attributes["data-bob-wp-ghost"]),
    ["H"],
  );
  host.destroy();
});

test("minimap overflow counters appear beyond four columns", () => {
  const doc = makeDoc();
  const host = createWindowHintHost(doc);
  const splits = [];
  for (let index = 0; index < 6; index += 1) {
    splits.push(split(`s${index}`, index * 80, [leaf(`t${index}`, { label: `Note ${index}` })], { width: 80 }));
  }
  const model = buildWindowPrefixViewModel(layout("t2", splits));
  host.showCard(model);
  assert.equal(flattenText(byAttr(doc.body, "data-bob-wp", "overflow-left")[0]), "+1");
  assert.equal(flattenText(byAttr(doc.body, "data-bob-wp", "overflow-right")[0]), "+2");
  assert.equal(byAttr(doc.body, "data-bob-wp", "pill").length, 3);
  host.destroy();
});

test("aria live region, idempotent repaint, and destroy cleanup", () => {
  const doc = makeDoc({ platform: "other" });
  const host = createWindowHintHost(doc, { platform: "other" });
  const model = screenshotModel();
  host.showArmed(model, model.splits[0].rect, model.splits[0].rect);
  host.showCard(model);
  assert.match(flattenText(byAttr(doc.body, "data-bob-wp", "header-key")[0]), /Ctrl W/);
  const live = byAttr(doc.body, "data-bob-wp", "message")[0];
  assert.equal(live.attributes["aria-live"], "polite");
  host.message("Already the leftmost split");
  assert.equal(flattenText(live), "Already the leftmost split");
  assert.equal(doc.body.children.length, 1);
  host.showCard(model);
  host.showCard(model);
  assert.equal(doc.body.children.length, 1);
  assert.equal(byAttr(doc.body, "data-bob-wp", "row").length, 6);
  host.destroy();
  assert.equal(doc.body.children.length, 0);
  host.showCard(model);
  assert.equal(doc.body.children.length, 0);
});

test("setIcon fallback glyphs appear when setIcon is absent", () => {
  const doc = makeDoc();
  const host = createWindowHintHost(doc);
  host.showCard(screenshotModel());
  const glyphs = byAttr(doc.body, "data-bob-wp", "glyph").map((node) => node.textContent);
  assert.ok(glyphs.includes("←"));
  assert.ok(glyphs.includes("→"));
  assert.ok(glyphs.includes("⇄"));
  assert.ok(glyphs.includes("◫"));
  host.destroy();
});

test("setIcon names are used when provided", () => {
  const doc = makeDoc();
  const names = [];
  const host = createWindowHintHost(doc, {
    setIcon(el, name) {
      names.push(name);
      el.setAttribute("data-icon", name);
    },
  });
  host.showCard(screenshotModel());
  assert.ok(names.includes("arrow-left"));
  assert.ok(names.includes("arrow-right"));
  assert.ok(names.includes("arrow-left-right"));
  assert.ok(names.includes("columns-2"));
  const glyph = byAttr(doc.body, "data-bob-wp", "glyph")[0];
  assert.equal(glyph.attributes["data-icon"], "arrow-left");
  host.destroy();
});

test("nudge, bump, pulse, receipt, and hide never throw", () => {
  const doc = makeDoc();
  const timers = [];
  const host = createWindowHintHost(doc, {
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
  });
  const model = screenshotModel();
  host.showArmed(model, model.splits[0].rect, {
    left: 10, top: 20, right: 400, bottom: 300, width: 390, height: 280,
  });
  host.showCard(model);
  host.nudge("h", "Already the leftmost split");
  const nudged = byAttr(doc.body, "data-bob-wp", "row")
    .find((row) => row.attributes["data-bob-wp-key"] === "h");
  assert.ok(nudged.classes.includes("is-nudge"));
  assert.match(flattenText(byAttr(doc.body, "data-bob-wp", "message")[0]), /leftmost/);
  host.bump("left");
  assert.ok(byAttr(doc.body, "data-bob-wp", "ring")[0].classes.includes("is-bump-left"));
  host.pulse(model.splits[1].rect);
  assert.ok(byAttr(doc.body, "data-bob-wp", "ring")[0].classes.includes("is-pulse"));
  host.receipt('Moved “sase_blog” → sase_blog_contents · left split closed');
  assert.match(flattenText(byAttr(doc.body, "data-bob-wp", "receipt")[0]), /Moved/);
  host.hide();
  assert.ok(byAttr(doc.body, "data-bob-wp", "host")[0].classes.includes("is-hidden"));
  assert.doesNotThrow(() => host.showArmed(null, null, null));
  assert.doesNotThrow(() => host.nudge(undefined, undefined));
  host.destroy();
});

test("layout API changed rows stay dimmed in place", () => {
  const doc = makeDoc();
  const host = createWindowHintHost(doc);
  const model = screenshotModel();
  for (const key of ["H", "L"]) {
    const row = model.rows.find((item) => item.key === key);
    row.available = false;
    row.reason = "layout-api-changed";
    row.preview = "layout API changed";
    row.plan = { ...row.plan, available: false, reason: "layout-api-changed" };
  }
  host.showCard(model);
  const move = byAttr(doc.body, "data-bob-wp", "row")
    .find((row) => row.attributes["data-bob-wp-key"] === "H");
  assert.ok(move.classes.includes("is-unavailable"));
  assert.match(flattenText(move), /layout API changed/);
  host.destroy();
});

test("reduced motion marks the host and still paints the card", () => {
  const doc = makeDoc({ reducedMotion: true });
  const host = createWindowHintHost(doc);
  host.showArmed(screenshotModel(), { left: 0, top: 0, width: 100, height: 80 }, { left: 0, top: 0, width: 200, height: 80 });
  host.showCard(screenshotModel());
  const root = byAttr(doc.body, "data-bob-wp", "host")[0];
  assert.ok(root.classes.includes("is-reduced"));
  assert.ok(root.classes.includes("is-carded"));
  host.destroy();
});
