const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { helpers } = require("./navigation-hotkeys-harness.cjs");

const {
  parseRefPageLabel,
  locateRefAnnotation,
  findRefAnnotationBlockLine,
  parseRefBookmarkLink,
  parseRefArchivePdfLink,
} = helpers;

const FIXTURES = path.join(__dirname, "fixtures", "ref-annotations");
function loadFixture(name) {
  return fs
    .readFileSync(path.join(FIXTURES, name), "utf8")
    .split(/\r?\n/);
}

function assertFrozenTarget(result) {
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.rail));
}

test("parseRefPageLabel accepts the generated caption grammar", () => {
  assert.deepEqual(parseRefPageLabel("Page 12"), {
    label: "Page 12",
    page: 12,
  });
  assert.deepEqual(parseRefPageLabel("Pages 11–12"), {
    label: "Pages 11–12",
    page: 11,
  });
  assert.deepEqual(parseRefPageLabel("Pages 11-12"), {
    label: "Pages 11-12",
    page: 11,
  });
  assert.deepEqual(parseRefPageLabel("Pages 11, 14"), {
    label: "Pages 11, 14",
    page: 11,
  });
  assert.deepEqual(parseRefPageLabel("Pages 11–12, 14"), {
    label: "Pages 11–12, 14",
    page: 11,
  });
  assert.deepEqual(parseRefPageLabel("p. 4"), { label: "p. 4", page: 4 });
  assert.deepEqual(parseRefPageLabel("pp. 6–8"), {
    label: "pp. 6–8",
    page: 6,
  });
  assert.deepEqual(parseRefPageLabel("  Page 12  "), {
    label: "Page 12",
    page: 12,
  });
});

test("parseRefPageLabel reports non-numeric labels and rejects the rest", () => {
  assert.deepEqual(parseRefPageLabel("Page xii"), {
    label: "Page xii",
    page: null,
  });
  assert.equal(parseRefPageLabel("Memory"), null);
  assert.equal(parseRefPageLabel("Other highlights"), null);
  assert.equal(parseRefPageLabel("Removed highlights"), null);
  assert.equal(parseRefPageLabel("Page"), null);
  assert.equal(parseRefPageLabel(""), null);
  assert.equal(parseRefPageLabel(null), null);
});

test("locateRefAnnotation maps every line kind of a quote block", () => {
  const lines = loadFixture("unsectioned.md");
  for (const line of [10, 11, 12, 14]) {
    const result = locateRefAnnotation(lines, line);
    assertFrozenTarget(result);
    assert.deepEqual(result, {
      kind: "annotation",
      blockId: "h-2b91f0a4c7de",
      page: 12,
      pageLabel: "Page 12",
      snippet: "Latency is not throughput.",
      annotationKind: "quote",
      stubTarget: null,
      rail: { from: 10, to: 14 },
      count: null,
    });
  }
});

test("locateRefAnnotation resolves captions and standalone notes", () => {
  const lines = loadFixture("unsectioned.md");
  const caption = locateRefAnnotation(lines, 8);
  assertFrozenTarget(caption);
  assert.deepEqual(caption, {
    kind: "caption",
    blockId: null,
    page: 12,
    pageLabel: "Page 12",
    snippet: null,
    annotationKind: null,
    stubTarget: null,
    rail: { from: 8, to: 8 },
    count: 2,
  });
  const note = locateRefAnnotation(lines, 17);
  assertFrozenTarget(note);
  assert.deepEqual(note, {
    kind: "annotation",
    blockId: "h-8f42a61a90cc",
    page: 12,
    pageLabel: "Page 12",
    snippet: "Keep this standalone observation.",
    annotationKind: "note",
    stubTarget: null,
    rail: { from: 16, to: 18 },
    count: null,
  });
});

test("locateRefAnnotation rejects gaps and lines after the last block", () => {
  const lines = loadFixture("unsectioned.md");
  assert.equal(locateRefAnnotation(lines, 15), null);
  assert.equal(locateRefAnnotation(lines, 19), null);
  assert.equal(locateRefAnnotation(lines, -1), null);
  assert.equal(locateRefAnnotation(lines, lines.length), null);
  assert.equal(locateRefAnnotation(lines, 0), null);
  assert.equal(locateRefAnnotation(null, 10), null);
});

test("locateRefAnnotation walks continuation pieces by depth", () => {
  const lines = loadFixture("group-pages-11-12.md");
  const caption = locateRefAnnotation(lines, 8);
  assert.deepEqual(caption.page, 11);
  assert.deepEqual(caption.pageLabel, "Pages 11–12");
  assert.deepEqual(caption.count, 1);
  for (const line of [10, 11]) {
    const head = locateRefAnnotation(lines, line);
    assertFrozenTarget(head);
    assert.deepEqual(head, {
      kind: "annotation",
      blockId: "h-ba93bec527bb",
      page: 11,
      pageLabel: "Page 11",
      snippet: "PR Sheriff Standing Orders. On every",
      annotationKind: "quote",
      stubTarget: null,
      rail: { from: 10, to: 11 },
      count: null,
    });
  }
  for (const line of [12, 14]) {
    const follower = locateRefAnnotation(lines, line);
    assertFrozenTarget(follower);
    assert.deepEqual(follower, {
      kind: "annotation",
      blockId: "h-ba93bec527bb",
      page: 12,
      pageLabel: "Page 12",
      snippet: "session startup, the sheriff checks open PRs",
      annotationKind: "quote",
      stubTarget: null,
      rail: { from: 12, to: 14 },
      count: null,
    });
  }
  for (const line of [15, 16]) {
    const idZone = locateRefAnnotation(lines, line);
    assertFrozenTarget(idZone);
    assert.deepEqual(idZone, {
      kind: "annotation",
      blockId: "h-ba93bec527bb",
      page: 11,
      pageLabel: "Page 11",
      snippet: "PR Sheriff Standing Orders. On every",
      annotationKind: "quote",
      stubTarget: null,
      rail: { from: 10, to: 16 },
      count: null,
    });
  }
});

test("locateRefAnnotation strips emphasis and embeds from long snippets", () => {
  const lines = loadFixture("group-three-piece.md");
  const caption = locateRefAnnotation(lines, 8);
  assert.deepEqual(caption, {
    kind: "caption",
    blockId: null,
    page: 6,
    pageLabel: "Pages 6–8",
    snippet: null,
    annotationKind: null,
    stubTarget: null,
    rail: { from: 8, to: 8 },
    count: 1,
  });
  const head = locateRefAnnotation(lines, 10);
  assert.deepEqual(head.page, 6);
  assert.deepEqual(head.pageLabel, "Page 6");
  assert.deepEqual(head.rail, { from: 10, to: 14 });
  assert.deepEqual(
    head.snippet,
    "In Scion, the unit of work is a “changeset,” an entry in a write-ahead…",
  );
  const imagePiece = locateRefAnnotation(lines, 15);
  assert.deepEqual(imagePiece.page, 7);
  assert.deepEqual(imagePiece.pageLabel, "Page 7");
  assert.deepEqual(imagePiece.rail, { from: 15, to: 19 });
  assert.deepEqual(
    imagePiece.snippet,
    "content-addressed pointers to the compressed file contents in blob…",
  );
  const tail = locateRefAnnotation(lines, 23);
  assert.deepEqual(tail.page, 8);
  assert.deepEqual(tail.pageLabel, "Page 8");
  assert.deepEqual(tail.rail, { from: 20, to: 23 });
  assert.deepEqual(
    tail.snippet,
    "support refs, but since neither creating nor fetching commits involves…",
  );
  for (const result of [head, imagePiece, tail]) {
    assert.ok(!result.snippet.includes("**"));
    assert.ok(!result.snippet.includes("![["));
    assert.ok(!/\s{2,}/.test(result.snippet));
  }
});

test("locateRefAnnotation classifies sectioned notes and their stubs", () => {
  const lines = loadFixture("sectioned.md");
  assert.equal(locateRefAnnotation(lines, 8), null);
  assert.equal(locateRefAnnotation(lines, 10), null);
  assert.equal(locateRefAnnotation(lines, 13), null);
  assert.equal(locateRefAnnotation(lines, 14), null);
  assert.equal(locateRefAnnotation(lines, 21), null);
  assert.equal(locateRefAnnotation(lines, 29), null);
  assert.equal(locateRefAnnotation(lines, 34), null);
  assert.equal(locateRefAnnotation(lines, 40), null);

  const h4 = locateRefAnnotation(lines, 15);
  assert.deepEqual(h4, {
    kind: "caption",
    blockId: null,
    page: 4,
    pageLabel: "Page 4",
    snippet: null,
    annotationKind: null,
    stubTarget: null,
    rail: { from: 15, to: 15 },
    count: 1,
  });
  const quote = locateRefAnnotation(lines, 17);
  assert.deepEqual(quote.page, 4);
  assert.deepEqual(quote.pageLabel, "Page 4");
  assert.deepEqual(quote.snippet, "A useful passage.");
  assert.deepEqual(quote.rail, { from: 17, to: 19 });

  const other = locateRefAnnotation(lines, 23);
  assert.deepEqual(other.page, 2);
  assert.deepEqual(other.count, 1);

  for (const line of [31, 33]) {
    const tombstone = locateRefAnnotation(lines, line);
    assertFrozenTarget(tombstone);
    assert.deepEqual(tombstone, {
      kind: "tombstone",
      blockId: "h-aaaaaaaaaaaaaaaa",
      page: null,
      pageLabel: null,
      snippet: null,
      annotationKind: null,
      stubTarget: null,
      rail: { from: 31, to: 33 },
      count: null,
    });
  }
  for (const line of [35, 37, 39]) {
    const stub = locateRefAnnotation(lines, line);
    assertFrozenTarget(stub);
    assert.deepEqual(stub, {
      kind: "stub",
      blockId: "h-bbbbbbbbbbbb",
      page: null,
      pageLabel: null,
      snippet: null,
      annotationKind: null,
      stubTarget: "h-ba93bec527bb",
      rail: { from: 35, to: 39 },
      count: null,
    });
  }
  const emphasis = locateRefAnnotation(lines, 43);
  assert.deepEqual(emphasis.kind, "stub");
  assert.deepEqual(emphasis.blockId, "h-cccccccccccc");
  assert.deepEqual(emphasis.stubTarget, "h-ba93bec527bb");
  assert.deepEqual(emphasis.rail, { from: 41, to: 45 });
});

test("locateRefAnnotation leaves preamble pages unknown and images snippetless", () => {
  const lines = loadFixture("preamble-and-image.md");
  for (const line of [2, 4]) {
    const preamble = locateRefAnnotation(lines, line);
    assertFrozenTarget(preamble);
    assert.deepEqual(preamble, {
      kind: "annotation",
      blockId: "h-eeeeeeeeeeee",
      page: null,
      pageLabel: null,
      snippet: "A preamble passage before any caption.",
      annotationKind: "quote",
      stubTarget: null,
      rail: { from: 2, to: 4 },
      count: null,
    });
  }
  for (const line of [8, 10, 12]) {
    const image = locateRefAnnotation(lines, line);
    assertFrozenTarget(image);
    assert.deepEqual(image, {
      kind: "annotation",
      blockId: "h-2b91f0a4c7de",
      page: 12,
      pageLabel: "Page 12",
      snippet: null,
      annotationKind: "image",
      stubTarget: null,
      rail: { from: 8, to: 12 },
      count: null,
    });
  }
});

test("locateRefAnnotation keeps non-numeric captions pageless", () => {
  const lines = loadFixture("page-xii.md");
  assert.deepEqual(locateRefAnnotation(lines, 2), {
    kind: "caption",
    blockId: null,
    page: null,
    pageLabel: "Page xii",
    snippet: null,
    annotationKind: null,
    stubTarget: null,
    rail: { from: 2, to: 2 },
    count: 1,
  });
  const block = locateRefAnnotation(lines, 4);
  assert.deepEqual(block.page, null);
  assert.deepEqual(block.pageLabel, "Page xii");
  assert.deepEqual(block.snippet, "A front-matter passage.");
});

test("locateRefAnnotation ignores fences and lines outside the region", () => {
  const lines = loadFixture("fence-and-outside.md");
  assert.equal(locateRefAnnotation(lines, 2), null);
  assert.equal(locateRefAnnotation(lines, 4), null);
  assert.equal(locateRefAnnotation(lines, 6), null);
  assert.equal(locateRefAnnotation(lines, 19), null);
  assert.equal(locateRefAnnotation(lines, 21), null);
  assert.equal(locateRefAnnotation(lines, 23), null);
  const caption = locateRefAnnotation(lines, 10);
  assert.deepEqual(caption.page, 3);
  assert.deepEqual(caption.count, 1);
  const note = locateRefAnnotation(lines, 12);
  assert.deepEqual(note, {
    kind: "annotation",
    blockId: "h-111111111111",
    page: 3,
    pageLabel: "Page 3",
    snippet: "A real standalone note.",
    annotationKind: "note",
    stubTarget: null,
    rail: { from: 12, to: 14 },
    count: null,
  });
});

test("findRefAnnotationBlockLine finds IDs only inside the managed region", () => {
  const lines = loadFixture("fence-and-outside.md");
  assert.equal(findRefAnnotationBlockLine(lines, "h-111111111111"), 14);
  assert.equal(findRefAnnotationBlockLine(lines, "h-ffffffffffff"), -1);
  assert.equal(findRefAnnotationBlockLine(lines, "h-000000000099"), -1);
  assert.equal(findRefAnnotationBlockLine(lines, "h-missing"), -1);
  assert.equal(findRefAnnotationBlockLine(lines, null), -1);
  assert.equal(findRefAnnotationBlockLine(null, "h-111111111111"), -1);
  const group = loadFixture("group-pages-11-12.md");
  assert.equal(findRefAnnotationBlockLine(group, "h-ba93bec527bb"), 16);
});

test("parseRefBookmarkLink accepts only h- IDs with the bookmark alias", () => {
  assert.deepEqual(
    parseRefBookmarkLink("- [ ] #task Compare [[#^h-ba93bec527bb|🔖]]"),
    { target: "", blockId: "h-ba93bec527bb" },
  );
  assert.deepEqual(
    parseRefBookmarkLink(
      "- [ ] #task Compare [[ref/papers/gas#^h-ba93bec527bb|🔖]]",
    ),
    { target: "ref/papers/gas", blockId: "h-ba93bec527bb" },
  );
  assert.deepEqual(
    parseRefBookmarkLink("- [ ] #task Old [[done/2026-01-01#^h-x1|🔖]]"),
    { target: "done/2026-01-01", blockId: "h-x1" },
  );
  assert.deepEqual(
    parseRefBookmarkLink(
      "[[#^h-first|🔖]] then [[ref/a#^h-second|🔖]]",
    ),
    { target: "", blockId: "h-first" },
  );
  assert.equal(parseRefBookmarkLink("- [ ] #task [[#^h-x|other]]"), null);
  assert.equal(parseRefBookmarkLink("- [ ] #task [[#^s-x|🔖]]"), null);
  assert.equal(parseRefBookmarkLink("no links here"), null);
  assert.equal(parseRefBookmarkLink(null), null);
});

test("parseRefArchivePdfLink unwraps annotated_pdf wikilinks", () => {
  assert.equal(
    parseRefArchivePdfLink(
      "[[ref_history/papers/example__2026-10-26__annotated.pdf]]",
    ),
    "ref_history/papers/example__2026-10-26__annotated.pdf",
  );
  assert.equal(
    parseRefArchivePdfLink(
      "[[ref_history/papers/example__annotated.pdf|Archive]]",
    ),
    "ref_history/papers/example__annotated.pdf",
  );
  assert.equal(
    parseRefArchivePdfLink("'[[ref_history/papers/example__annotated.pdf]]'"),
    "ref_history/papers/example__annotated.pdf",
  );
  assert.equal(parseRefArchivePdfLink("lib/papers/x.pdf"), null);
  assert.equal(parseRefArchivePdfLink(""), null);
  assert.equal(parseRefArchivePdfLink(null), null);
});
