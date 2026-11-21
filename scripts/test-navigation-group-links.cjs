// `]n` / `[n` on period notes (`‹ W44` · `W46 ›`) and bob-owned creation of
// missing week, quarter, year, and all-time notes (bob-cli docs/periods.md).
const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const notices = [];
global.Notice = class {
  constructor(message) {
    notices.push(String(message));
  }
};

const originalLoad = Module._load;
Module._load = function loadWithObsidianStubs(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      MarkdownView: class {},
      Modal: class {},
      Notice: global.Notice,
      Platform: { isDesktopApp: true },
      Plugin: class {},
      normalizePath: (value) => value,
      parseYaml: (text) => JSON.parse(text),
    };
  }
  if (request === "@codemirror/state") {
    return { Prec: { highest: (value) => value } };
  }
  if (request === "@codemirror/view") {
    class TestEditorView {}
    TestEditorView.updateListener = { of: (listener) => ({ listener }) };
    return { EditorView: TestEditorView, keymap: { of: (value) => value } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const NavigationHotkeysPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
Module._load = originalLoad;

const { createWalkModeApi, renderedLinkMatchesNavLabel, planBracketRepeat } = NavigationHotkeysPlugin.helpers;

function harness(content = "", provider = null, path = "plain.md") {
  const nav = Object.create(NavigationHotkeysPlugin.prototype);
  const files = new Map([path, "before.md", "after.md"].map(path => [path, { path, extension: "md", basename: path.replace(/\.md$/, "") }]));
  const opened = [];
  nav.app = {
    vault: { getAbstractFileByPath: path => files.get(path) || null },
    metadataCache: { getFirstLinkpathDest: target => files.get(target.replace(/\.md$/, "") + ".md") || null },
    plugins: { plugins: { "bob-ledger-tools": { api: { navGroups: provider } } } },
  };
  nav.getActiveMarkdownContext = async () => ({ file: files.get(path), content });
  nav.openOrCreateLinkTarget = async (...args) => { opened.push(args); return true; };
  return { nav, files, opened, snapshot: () => createWalkModeApi(nav).links({ path, content }) };
}

for (const label of ["<< X", "X >>", ">> X", "« X", "X »", "» X", "<< X ›", "‹ X >>"]) {
  test(`double label never steps: ${label}`, () => {
    for (const direction of ["prev", "next"]) assert.equal(renderedLinkMatchesNavLabel(label, direction), false);
  });
}
for (const [text, role] of [["‹ X", "prev"], ["< X", "prev"], ["prev", "prev"], ["X ›", "next"], ["X >", "next"], ["> X", "next"], ["next", "next"]]) {
  test(`single label still steps: ${text}`, () => assert.equal(renderedLinkMatchesNavLabel(text, role), true));
}
for (const separator of [" ", " · ", " • ", " | ", " / ", ", ", " – ", " — ", " - "]) {
  test(`wiki and Markdown links form a nav line with ${separator}`, () => {
    const { snapshot } = harness(`[[before|<< Before]]${separator}[After >>](after)`);
    assert.equal(snapshot().prevGroup.target, "before");
    assert.equal(snapshot().nextGroup.target, "after");
    assert.equal(snapshot().prev, null);
    assert.equal(snapshot().next, null);
  });
}
for (const content of ["Read [[after|more »]]", "[[after|more »]] prose", "`[[after|» X]]`", "![[after|» X]]", "---\nnav: '[[after|» X]]'\n---", "```md\n[[after|» X]]\n```", "~~~md\n[[after|» X]]\n~~~"]) {
  test(`group links ignore non-nav content: ${JSON.stringify(content)}`, () => assert.equal(harness(content).snapshot().nextGroup, null));
}

test("duplicate resolved destinations deduplicate but distinct targets refuse only their role", async () => {
  const duplicate = harness("[[after|» A]] · [[after.md|A >>]]");
  assert.equal(duplicate.snapshot().groupConflict, null);
  assert.equal(duplicate.snapshot().nextGroup.path, "after.md");
  const conflict = harness("[[before|« B]] · [[after|» A]]\n[[other|» O]]");
  assert.equal(conflict.snapshot().groupConflict, "next");
  assert.equal(conflict.snapshot().prevGroup.target, "before");
  assert.equal(conflict.snapshot().nextGroup, null);
  notices.length = 0;
  assert.equal(await conflict.nav.openGroupLink("next"), false);
  assert.deepEqual(notices, ["Two » links on nav lines — keep one"]);
  assert.equal(conflict.opened.length, 0);
});

function stop(target, state) {
  return { target, path: target + ".md", state, source: "calendar", groupLabel: "Next week", landingLabel: "Monday", shortLabel: "Mon", wraps: false, ghostReason: state === "ghost" ? "Before adoption" : null };
}
function provider(next, prev = null) {
  return { version: 1, resolve: () => ({ ok: true, group: { noun: "week" }, nextGroup: next, prevGroup: prev, step: { next, prev }, none: null }) };
}

test("authored stops win per role; absent steps and groups use the provider", () => {
  const { snapshot } = harness("[[before|« B]] · [[before|next]]", provider(stop("after", "exists"), stop("missing", "creatable")));
  const result = snapshot();
  assert.equal(result.prevGroup.source, "authored");
  assert.equal(result.nextGroup.source, "calendar");
  assert.equal(result.next.source, "authored");
  assert.equal(result.prev.source, "calendar");
  assert.equal(result.prev.state, "creatable");
  assert.equal(result.next.exists, true);
  assert.equal(Object.isFrozen(result), true);
});

for (const state of ["exists", "creatable", "ghost"]) {
  for (const viaRepeat of [false, true]) {
    test(`group activation ${state}, repeat=${viaRepeat} uses the shared stop and guard`, async () => {
      const target = state === "exists" ? "after" : "missing";
      const { nav, snapshot, opened } = harness("", provider(stop(target, state)));
      assert.equal(snapshot().nextGroup.state, state);
      assert.equal(snapshot().nextGroup.exists, state === "exists");
      assert.equal(snapshot().nextGroup.createEligible, state === "creatable");
      if (viaRepeat) nav.rememberBracketRepeatType("n");
      notices.length = 0;
      const permitted = state === "exists" || (state === "creatable" && !viaRepeat);
      assert.equal(await nav.openGroupLink("next", { viaRepeat }), permitted);
      assert.equal(opened.length, permitted ? 1 : 0);
      assert.equal(nav.readBracketRepeatType(), "n");
      if (permitted) assert.equal(opened[0][0], snapshot().nextGroup.target);
      if (state === "creatable" && viaRepeat) assert.match(notices[0], /press \]N to create/);
      if (state === "ghost") assert.equal(notices[0], "Before adoption");
    });
  }
}

test("live existence refreshes both provider and authored stops", () => {
  const { files, snapshot } = harness("[[missing|» Missing]]", provider(stop("other", "creatable")));
  assert.equal(snapshot().nextGroup.state, "creatable");
  files.set("missing.md", { path: "missing.md", extension: "md" });
  assert.equal(snapshot().nextGroup.state, "exists");
  files.delete("missing.md");
  assert.equal(snapshot().nextGroup.state, "creatable");
});

test("missing record targets remain ghosts", () => {
  const { nav, snapshot } = harness("[[missing|» Missing]]");
  nav.isAlbumFolderCreationTarget = () => true;
  assert.equal(snapshot().nextGroup.state, "ghost");
  assert.match(snapshot().nextGroup.ghostReason, /syncing/);
});

test("missing and throwing providers preserve authored links and explain calendar unavailability", async () => {
  for (const api of [null, { version: 0, resolve() { throw Error("old"); } }, { version: 1, resolve() { throw Error("offline"); } }]) {
    const { nav, snapshot, opened } = harness("[[after|» After]]", api, "2026/20261121.md");
    assert.equal(createWalkModeApi(nav).version, 7);
    assert.match(snapshot().groupNone.message, /need Bob Ledger Tools/);
    assert.equal(snapshot().nextGroup.target, "after");
    assert.equal(await nav.openGroupLink("next"), true);
    assert.equal(opened.length, 1);
  }
});

test("legacy no-nav-line notes get derived step destinations with creation guards", async () => {
  for (const state of ["exists", "creatable", "ghost"]) {
    const { nav, opened } = harness("legacy", provider(stop(state === "exists" ? "after" : "missing", state)));
    assert.equal(await nav.openLabeledBodyLink("next"), state !== "ghost");
    assert.equal(opened.length, state === "ghost" ? 0 : 1);
  }
});

test("n uppercase repeats call one guarded group jump and counts do not multiply it", async () => {
  const { nav, opened } = harness("[[after|» After]]");
  nav.rememberBracketRepeatType("n");
  nav.consumeVimCount = () => { throw Error("n ignores counts"); };
  assert.deepEqual(planBracketRepeat("n", 1, { uppercase: true }), { method: "openGroupLink", args: ["next", { viaRepeat: true }] });
  assert.equal(await nav.repeatBracketWalk(1, { uppercase: true }), true);
  assert.equal(opened.length, 1);
});

test("successful group opens record one jump to the resolved destination", async () => {
  const { nav } = harness("[[after|» After]]");
  const jump = { origin: { path: "plain.md", line: 9, ch: 3 } };
  const recorded = [];
  nav.beginVimLinkJump = () => jump;
  nav.finishVimLinkJump = async (...args) => recorded.push(args);
  assert.equal(await nav.openGroupLink("next"), true);
  assert.deepEqual(recorded, [[jump, "after.md"]]);
});

test("lowercase link repeats also refuse note creation", async () => {
  const { nav, opened } = harness("[[missing|next]]");
  nav.rememberBracketRepeatType("n");
  notices.length = 0;
  assert.equal(await nav.repeatBracketWalk(1), false);
  assert.equal(opened.length, 0);
  assert.match(notices[0], /press \]n to create/);
});

test("step snapshots retain the v2 fields alongside live creation eligibility", () => {
  const { snapshot } = harness("[[before|prev]] · [[missing|next]]");
  const result = snapshot();
  assert.deepEqual(
    [result.prev.text, result.prev.target, result.prev.path, result.prev.exists],
    ["prev", "before", "before.md", true],
  );
  assert.equal(result.prev.createEligible, false);
  assert.deepEqual(
    [result.next.text, result.next.target, result.next.path, result.next.exists],
    ["next", "missing", "missing.md", false],
  );
  assert.equal(result.next.createEligible, true);
});

test("period creation surfaces the pre-adoption refusal without opening", async () => {
  const { nav } = harness();
  nav.app.plugins.plugins["bob-ledger-tools"].api.periodNotes = {
    version: 2,
    ensureNote: async () => ({ ok: false, code: "pre-adoption", message: "Before Bob's period notes — navigation never creates it" }),
  };
  nav.openMarkdownFileWithLeafReuse = () => { assert.fail("refused periods never open"); };
  notices.length = 0;
  assert.equal(await nav.openPeriodNoteThroughBob({ path: "2025/2025-W40.md", basename: "2025-W40" }), false);
  assert.deepEqual(notices, ["Before Bob's period notes — navigation never creates it"]);
});
