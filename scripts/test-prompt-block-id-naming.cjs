// Prompt block-ID naming vectors for both prompt-owning plugins.
// Plan 202610/task_block_id_prefill.md: one shared fixture table, same inputs
// same default in both implementations. Also pins legacy-ID handling,
// project conversion's existing helper, and the unchanged successor SB vectors.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const notices = [];
const originalLoad = Module._load;
Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "obsidian") {
    class EmptyClass {}
    class TestNotice {
      constructor(message) {
        notices.push(String(message));
      }
    }
    return {
      MarkdownView: EmptyClass,
      Modal: EmptyClass,
      Notice: TestNotice,
      normalizePath: (value) => String(value || ""),
      Plugin: EmptyClass,
      Setting: EmptyClass,
      TFile: EmptyClass,
      setIcon: () => {},
      parseYaml: () => ({}),
    };
  }
  if (request === "@codemirror/view") {
    return { EditorView: class {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const BidPlugin = require("../plugins/block-id-prompt/main.js");
const NavPlugin = require("../plugins/bob-navigation-hotkeys/main.js");
const CyclerPlugin = require("../plugins/task-status-cycler/main.js");
Module._load = originalLoad;

const bid = BidPlugin.helpers;
const nav = NavPlugin.helpers;
const { PROMPT_BLOCK_ID_FIXTURES } = require("./prompt-block-id-fixtures.cjs");

test("both prompt copies pass the shared fixture table identically", () => {
  for (const fixture of PROMPT_BLOCK_ID_FIXTURES) {
    const reserved = new Set(fixture.reservedIds || []);
    const fromBid = bid.suggestPromptBlockId(
      fixture.rawLine,
      fixture.content || "",
      { reservedIds: reserved },
    );
    const fromNav = nav.suggestPromptBlockId(
      fixture.rawLine,
      fixture.content || "",
      { reservedIds: new Set(fixture.reservedIds || []) },
    );
    assert.equal(
      fromBid,
      fixture.expected,
      `block-id-prompt ${fixture.name}`,
    );
    assert.equal(fromNav, fixture.expected, `navigation ${fixture.name}`);
    assert.equal(fromBid, fromNav, `same default ${fixture.name}`);
  }
});

test("suggestion is valid, compact, and collision-aware", () => {
  for (const fixture of PROMPT_BLOCK_ID_FIXTURES) {
    if (fixture.expected === null) {
      continue;
    }
    assert.match(
      fixture.expected,
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      `grammar ${fixture.name}`,
    );
    assert.ok(
      fixture.expected.length <= 32,
      `length ${fixture.name}: ${fixture.expected}`,
    );
  }
  // Unlimited suffixes: stem-2..stem-11 all taken still finds stem-12.
  const occupied = ["book-flights"];
  for (let suffix = 2; suffix <= 11; suffix += 1) {
    occupied.push(`book-flights-${suffix}`);
  }
  const content = occupied
    .map((id) => `- [ ] #task x ^${id}`)
    .join("\n");
  const next = bid.suggestPromptBlockId(
    "- [ ] #task Book flights",
    content,
    {},
  );
  assert.equal(next, "book-flights-12");
  assert.equal(
    nav.suggestPromptBlockId("- [ ] #task Book flights", content, {}),
    "book-flights-12",
  );
});

test("rename excludes exactly one old-ID occurrence", () => {
  const rawLine = "- [ ] #task Book flights ^book-flights";
  // One occurrence: the old ID itself is reusable for the suggestion stem.
  const single = bid.suggestPromptBlockId(rawLine, rawLine, {
    excludeId: "book-flights",
  });
  assert.equal(single, "book-flights");
  // Duplicates remain taken: excluding one of two still collides.
  const doubled = `${rawLine}\n- [ ] #task Other ^book-flights`;
  const colliding = bid.suggestPromptBlockId(rawLine, doubled, {
    excludeId: "book-flights",
  });
  assert.equal(colliding, "book-flights-2");
  assert.equal(
    nav.suggestPromptBlockId(rawLine, doubled, { excludeId: "book-flights" }),
    "book-flights-2",
  );
});

test("dependency legacy [id::] reuses only valid free IDs", () => {
  const content = "- [ ] #task Other ^other\n";
  const free = nav.validateBlockIdCandidate("flights", content, {
    reservedIds: new Set(),
  });
  assert.equal(free.valid, true);
  const taken = nav.validateBlockIdCandidate(
    "flights",
    `${content}- [ ] #task y ^flights\n`,
    {
      reservedIds: new Set(),
    },
  );
  assert.equal(taken.valid, false);
  const invalid = nav.validateBlockIdCandidate("Tasks__target", content, {
    reservedIds: new Set(),
  });
  assert.equal(invalid.valid, false);
  const reserved = nav.validateBlockIdCandidate("flights", content, {
    reservedIds: new Set(["flights"]),
  });
  assert.equal(reserved.valid, false);
});

test("project conversion keeps the existing suggestBlockIdFromTask", () => {
  const first = nav.suggestBlockIdFromTask("Hello World", "", {});
  assert.equal(typeof first, "string");
  // The legacy helper keeps its -9 cutoff behavior (pinned by existing
  // project tests); the prompt helper walks past nine.
  const occupied = ["task"];
  for (let suffix = 2; suffix <= 9; suffix += 1) {
    occupied.push(`task-${suffix}`);
  }
  const legacyContent = occupied
    .map((id) => `para ^${id}`)
    .join("\n");
  assert.equal(nav.suggestBlockIdFromTask("!!!", legacyContent, {}), "task-10");
  assert.equal(
    nav.suggestPromptBlockId("- [ ] #task !!!", legacyContent, {}),
    "task-10",
  );
});

test("successor SB vectors are unchanged", () => {
  const vectors = [
    ["- [?] #task Renew the library books", [], "renew-library-books"],
    ["- [?] #task Fix apollo machine", [], "fix-apollo-machine"],
    ["- [?] #task Add support for new `%hold` directive", [], "hold"],
    [
      "- [?] #task Review [[sase#^fix-apollo|apollo fix]] notes",
      [],
      "apollo-fix",
    ],
    ["- [?] #task Book flights [scheduled:: 2026-10-13] #task", [], "book-flights"],
  ];
  for (const [line, used, want] of vectors) {
    const body = line.slice(line.indexOf("] ") + 2);
    const cleaned = CyclerPlugin.helpers.cleanDescription(body, "#task", null);
    const minted = CyclerPlugin.helpers.mintBlockId(
      cleaned,
      new Set(used),
    );
    assert.equal(minted, want, line);
  }
});
