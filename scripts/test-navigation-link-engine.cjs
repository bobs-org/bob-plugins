// Prose `[[` link-engine vector replay test.
//
// Fixture: scripts/fixtures/wikilink_complete/vectors.json, a verbatim
// copy of bob-cli's tests/fixtures/wikilink_complete/vectors.json
// (sha256 4feff46c5b445e28f94522d696b17867783bfb9c771661051bde12dbf0875173).
// The hash assertion below fails loudly on local edits: refresh the copy
// from bob-cli and update EXPECTED_FIXTURE_SHA together, never hand-edit
// the mirror.
//
// For every vector this runs the pure JS field model plus the pure JS
// ranking over vector-built note entries and asserts the same context,
// scope, query, replaced range, accept insert, and caret that bob
// produces, so the Obsidian engine replays bob's vectors exactly.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const { helpers } = require("./navigation-hotkeys-harness.cjs");

const FIXTURE_PATH = join(
  __dirname,
  "fixtures",
  "wikilink_complete",
  "vectors.json",
);
const EXPECTED_FIXTURE_SHA =
  "4feff46c5b445e28f94522d696b17867783bfb9c771661051bde12dbf0875173";

function fixtureSha() {
  return createHash("sha256").update(readFileSync(FIXTURE_PATH)).digest("hex");
}

const vectors = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

test("wikilink fixture mirror matches bob-cli", () => {
  assert.equal(vectors.version, 1);
  assert.equal(
    vectors.source,
    "tests/fixtures/wikilink_complete/vectors.json",
  );
  assert.equal(fixtureSha(), EXPECTED_FIXTURE_SHA);
});

function vectorNoteEntries(notes) {
  return notes.map((note, noteIndex) => {
    void noteIndex;
    const stem = note.path.split("/").pop().replace(/\.md$/, "");
    return {
      path: note.path,
      tier: helpers.classifyLinkTier(note.path, {
        libraryRoots: ["lib", "xlib"],
        hasPdfSibling: () => false,
      }),
      insertTarget: note.path.replace(/\.md$/, ""),
      stem,
      aliases: note.aliases || [],
      headings: (note.headings || []).map((heading, ordinal) => ({
        title: heading.title,
        level: heading.level || 1,
        ordinal,
      })),
      blocks: (note.blocks || []).map((id, ordinal) => ({ id, ordinal })),
      inbound: note.inbound || 0,
    };
  });
}

function vectorCandidates(field, entries) {
  if (field.context === "wikilink_note") {
    return helpers.rankLinkNoteCandidates(field, entries);
  }
  if (field.context === "wikilink_heading") {
    return helpers.rankLinkHeadingCandidates(field, entries);
  }
  if (field.context === "wikilink_block") {
    return helpers.rankLinkBlockCandidates(field, entries);
  }
  return [];
}

function fieldForVector(vector) {
  const before = vector.before;
  const after = vector.after;
  const raw = `${before}${after}`;
  const currentNote = vector.current_note || "Current.md";
  return {
    raw,
    field: helpers.linkFieldAt(raw, before.length, currentNote),
  };
}

for (const vector of vectors.fields) {
  test(`field vector: ${vector.name}`, () => {
    const { raw, field } = fieldForVector(vector);
    if (vector.expect == null) {
      assert.equal(field, null);
      return;
    }
    assert.ok(field, "expected a field");
    assert.equal(field.context, vector.expect.context);
    assert.equal(field.scope, vector.expect.scope);
    if (vector.expect.target == null) {
      assert.equal(field.target, null);
    } else {
      assert.equal(field.target, vector.expect.target);
    }
    assert.equal(field.query, vector.expect.query);
    assert.equal(
      raw.slice(field.replacement[0], field.replacement[1]),
      vector.expect.replaced,
    );
    if (vector.expect.accept != null) {
      const entries = vectorNoteEntries(vectors.rank.notes);
      const candidates = vectorCandidates(field, entries);
      assert.ok(candidates.length > 0, "expected a candidate");
      const first = candidates[0];
      assert.equal(first.replacement, vector.expect.accept.insert);
      const accepted =
        raw.slice(0, field.replacement[0]) +
        first.replacement +
        raw.slice(field.replacement[1]);
      const caretText =
        accepted.slice(0, first.cursorAfter) +
        "▏" +
        accepted.slice(first.cursorAfter);
      assert.equal(caretText, vector.expect.accept.result);
    }
  });
}

for (const vector of vectors.rank.cases) {
  test(`rank vector: ${vector.name}`, () => {
    const { field } = fieldForVector(vector);
    assert.ok(field, "expected a field");
    const entries = vectorNoteEntries(vectors.rank.notes);
    const actual = vectorCandidates(field, entries).map(
      (candidate) => candidate.replacement,
    );
    assert.deepEqual(actual, vector.expected);
  });
}

for (const vector of vectors.tiers) {
  test(`tier vector: ${vector.path}`, () => {
    const siblings = new Set(vector.pdf_siblings || []);
    const actual = helpers.classifyLinkTier(vector.path, {
      libraryRoots: ["lib", "xlib"],
      hasPdfSibling: (sibling) => siblings.has(sibling),
    });
    assert.equal(actual, vector.expect);
  });
}

test("link engine helpers are exported", () => {
  for (const name of [
    "linkFieldAt",
    "linkReplacementText",
    "linkCursorAfter",
    "rankLinkNoteCandidates",
    "rankLinkHeadingCandidates",
    "rankLinkBlockCandidates",
    "resolveLinkTarget",
    "classifyLinkTier",
    "linkCompareNormalized",
    "rankLinkNearbyNotes",
    "createLinkIndex",
  ]) {
    assert.equal(
      typeof helpers[name],
      "function",
      `${name} is exported`,
    );
  }
  assert.equal(helpers.LINK_RESULT_LIMIT, 20);
  assert.equal(helpers.LINK_NEARBY_LIMIT, 8);
});

test("link index builds lazily from the metadata cache", () => {
  const registered = [];
  const files = [
    { path: "Plans.md", basename: "Plans" },
    { path: "chat/sase_chat.md", basename: "sase_chat" },
    { path: "done/Old.md", basename: "Old" },
    { path: ".obsidian/Hidden.md", basename: "Hidden" },
    { path: "papers/Sidecar.md", basename: "Sidecar" },
    { path: "papers/Sidecar.pdf", basename: "Sidecar" },
  ];
  const caches = {
    "Plans.md": {
      frontmatter: { aliases: ["AI"] },
      headings: [{ heading: "Section Plans", level: 2 }],
      blocks: { "vector-plans": {} },
    },
    "chat/sase_chat.md": {
      headings: [{ heading: "Section Chat", level: 2 }],
      blocks: {},
    },
  };
  const app = {
    vault: {
      getMarkdownFiles: () =>
        files.filter((file) => file.path.endsWith(".md")),
      getFiles: () => files,
      on: () => ({}),
    },
    metadataCache: {
      getFileCache: (file) => caches[file.path] || null,
      resolvedLinks: {
        "chat/sase_chat.md": { "Plans.md": 1 },
        "done/Old.md": { "Plans.md": 2 },
        "Plans.md": { "Plans.md": 1 },
      },
      on: () => ({}),
    },
  };
  const plugin = {
    registerEvent: (event) => registered.push(event),
  };
  const index = helpers.createLinkIndex(app, plugin);
  assert.equal(registered.length, 0);
  const notes = index.ensure();
  assert.ok(registered.length > 0);
  assert.deepEqual(
    notes.map((note) => note.path),
    ["chat/sase_chat.md", "done/Old.md", "papers/Sidecar.md", "Plans.md"],
  );
  assert.equal(
    notes.find((note) => note.path === "papers/Sidecar.md").tier,
    "hidden",
  );
  assert.equal(
    notes.find((note) => note.path === "done/Old.md").tier,
    "archive",
  );
  assert.deepEqual(
    notes.find((note) => note.path === "Plans.md").aliases,
    ["AI"],
  );
  assert.deepEqual(
    notes.find((note) => note.path === "Plans.md").headings,
    [{ title: "Section Plans", level: 2, ordinal: 0 }],
  );
  assert.deepEqual(
    notes.find((note) => note.path === "Plans.md").blocks,
    [{ id: "vector-plans", ordinal: 0 }],
  );
  // Two distinct other notes link to Plans.md; the self-link is ignored.
  assert.equal(index.getInbound("Plans.md"), 2);
  const field = helpers.linkFieldAt("Discuss [[pla", 13, "Current.md");
  const rows = helpers.rankLinkNoteCandidates(field, notes);
  assert.equal(rows[0].path, "Plans.md");
  assert.equal(rows[0].replacement, "Plans]]");
});

test("nearby rows follow parent, linked, recent order with tier filter", () => {
  const entries = vectorNoteEntries(vectors.rank.notes);
  const index = new Map(entries.map((note) => [note.path, note]));
  const rows = helpers.rankLinkNearbyNotes(
    { byPath: index },
    {
      sourcePath: "Plans.md",
      parentPaths: ["plans/sase_plan.md", "Plans.md"],
      linkedPaths: ["plans/sase_plan.md", "chat/sase_chat.md", "New.md"],
      recentPaths: ["done/SaseArchive.md", "New.md", "Current.md", "b.md"],
    },
  );
  assert.deepEqual(
    rows.map((row) => [row.path, row.reason]),
    [
      ["plans/sase_plan.md", "parent"],
      ["chat/sase_chat.md", "linked"],
      ["New.md", "linked"],
      ["Current.md", "recent"],
      ["b.md", "recent"],
    ],
  );
});
