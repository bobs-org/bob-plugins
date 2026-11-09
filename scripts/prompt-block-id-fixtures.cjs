// Shared prompt block-ID fixture table (plan 202610/task_block_id_prefill.md).
// Exercised by both prompt-owning plugins; keep in sync with the naming
// contract. `content` is the target note; `reservedIds` are pending batch
// reservations; `excludeId` ignores one rename occurrence.

const PROMPT_BLOCK_ID_FIXTURES = [
  {
    name: "strips priority field",
    rawLine: "- [ ] #task Fix flaky gkeep test [priority:: high]",
    content: "",
    expected: "fix-flaky-gkeep",
  },
  {
    name: "backticked phrase wins",
    rawLine: "- [?] #task Add support for new `%hold` directive",
    content: "",
    expected: "hold",
  },
  {
    name: "wikilink alias wins",
    rawLine: "- [ ] #task Review [[sase#^fix-apollo|apollo fix]] notes",
    content: "",
    expected: "apollo-fix",
  },
  {
    name: "markdown label wins over URL",
    rawLine: "- [ ] #task Read [Response API guide](https://example.test/v1)",
    content: "",
    expected: "response-api-guide",
  },
  {
    name: "drops stopwords",
    rawLine: "- [ ] #task Renew the library books",
    content: "",
    expected: "renew-library-books",
  },
  {
    name: "strips scheduled field and travel tag",
    rawLine: "- [ ] #task Book flights [scheduled:: 2026-10-13] #travel",
    content: "",
    expected: "book-flights",
  },
  {
    name: "collision walks past nine",
    rawLine: "- [ ] #task Book flights [scheduled:: 2026-10-13] #travel",
    content: [
      "- [ ] #task Book flights ^book-flights",
      "- [ ] #task Book flights ^book-flights-2",
      "- [ ] #task Book flights ^book-flights-3",
      "- [ ] #task Book flights ^book-flights-4",
      "- [ ] #task Book flights ^book-flights-5",
      "- [ ] #task Book flights ^book-flights-6",
      "- [ ] #task Book flights ^book-flights-7",
      "- [ ] #task Book flights ^book-flights-8",
      "- [ ] #task Book flights ^book-flights-9",
    ].join("\n"),
    expected: "book-flights-10",
  },
  {
    name: "underscores separate words",
    rawLine: "- [ ] #task Fix `capture_task_id`",
    content: "",
    expected: "capture-task-id",
  },
  {
    name: "accents normalize",
    rawLine: "- [ ] #task Réparer café",
    content: "",
    expected: "reparer-cafe",
  },
  {
    name: "emoji-only falls back with collisions",
    rawLine: "- [ ] #task 🚀",
    content: "para ^task\npara ^task-2",
    expected: "task-3",
  },
  {
    name: "path-qualified legacy id is not sanitized",
    rawLine: "- [ ] #task Book flights [id:: Tasks__target]",
    content: "",
    expected: "book-flights",
  },
  {
    name: "double-quoted phrase wins",
    rawLine: '- [ ] #task Fix "apollo machine" today',
    content: "",
    expected: "apollo-machine",
  },
  {
    name: "parenthetical phrase wins",
    rawLine: "- [ ] #task Deploy (apollo machine) today",
    content: "",
    expected: "apollo-machine",
  },
  {
    name: "bare URL never becomes a name",
    rawLine: "- [ ] #task Read https://example.test/v1 guide today",
    content: "",
    expected: "read-guide-today",
  },
  {
    name: "semantic issue number is kept",
    rawLine: "- [ ] #task Fix issue #123 today",
    content: "",
    expected: "fix-issue-123",
  },
  {
    name: "stopword-only falls back to task",
    rawLine: "- [ ] #task the and of",
    content: "",
    expected: "task",
  },
  {
    name: "empty task falls back to task",
    rawLine: "- [ ] #task",
    content: "",
    expected: "task",
  },
  {
    name: "non-task returns null",
    rawLine: "Just a paragraph ^para",
    content: "",
    expected: null,
  },
  // Plain note bullets (notebook notes, plan 202611/bob_notebooks.md): the
  // same naming path as tasks, with `[created::]` and other inline fields
  // stripped before words are picked.
  {
    name: "note bullet strips the created stamp",
    rawLine: "- Try mergiraf for merge conflicts [created::2026-11-09]",
    content: "",
    expected: "try-mergiraf-merge",
  },
  {
    name: "note bullet keeps its backticked phrase",
    rawLine: "- Use `<C-x><C-e>` to edit the command [created::2026-11-09]",
    content: "",
    expected: "c-x-c-e",
  },
  {
    name: "note bullet drops a trailing block id",
    rawLine: "- Faster with -j when linking ^old-id",
    content: "",
    expected: "faster-j-when",
  },
  {
    name: "note bullet accepts star plus and numbered markers",
    rawLine: "* Check which process owns a port",
    content: "",
    expected: "check-which-process",
  },
  {
    name: "indented note bullet resolves like a top-level one",
    rawLine: "    - Check which process owns a port",
    content: "",
    expected: "check-which-process",
  },
  {
    name: "numbered note bullet resolves",
    rawLine: "1. Check which process owns a port",
    content: "",
    expected: "check-which-process",
  },
  {
    name: "note bullet with no usable words falls back to note",
    rawLine: "- the and of [created::2026-11-09]",
    content: "",
    expected: "note",
  },
  {
    name: "note fallback walks suffixes like any other stem",
    rawLine: "- ???",
    content: "- first ^note\n- second ^note-2",
    expected: "note-3",
  },
  {
    name: "note bullet collides with task ids",
    rawLine: "- Book flights [created::2026-11-09]",
    content: "- [ ] #task Book flights ^book-flights",
    expected: "book-flights-2",
  },
  {
    name: "empty bullet returns null",
    rawLine: "- ",
    content: "",
    expected: null,
  },
  {
    name: "heading returns null",
    rawLine: "## Troubleshooting",
    content: "",
    expected: null,
  },
  {
    name: "star emphasis without a space returns null",
    rawLine: "**bold paragraph** start",
    content: "",
    expected: null,
  },
  {
    name: "reserved ids force a suffix",
    rawLine: "- [ ] #task Book flights",
    content: "",
    reservedIds: ["book-flights"],
    expected: "book-flights-2",
  },
  {
    name: "closed tasks count for collisions",
    rawLine: "- [ ] #task Book flights",
    content: "- [x] #task Old ^book-flights",
    expected: "book-flights-2",
  },
  {
    name: "paragraph ids count for collisions",
    rawLine: "- [ ] #task Book flights",
    content: "Some paragraph ^book-flights",
    expected: "book-flights-2",
  },
  {
    name: "long stem cuts at word boundary",
    rawLine:
      "- [ ] #task Supercalifragilisticexpialidocious extraordinary pneumonoultramicroscopicsilicovolcanoconiosis",
    content: "",
    expected: "supercalifragilisticexpialidocio",
  },
  {
    name: "single over-long token truncates",
    rawLine:
      "- [ ] #task abcdefghijklmnopqrstuvwxyz0123456789extra",
    content: "",
    expected: "abcdefghijklmnopqrstuvwxyz012345",
  },
  {
    name: "suffix reserves room within 32",
    rawLine: "- [ ] #task abcdefghij klmnopqrst uvwxyzabcd efghijkl",
    content: "- [ ] #task Other ^abcdefghij-klmnopqrst-uvwxyzabcd",
    expected: "abcdefghij-klmnopqrst-uvwxyzab-2",
  },
  {
    name: "case-sensitive ids do not collide",
    rawLine: "- [ ] #task Book flights",
    content: "para ^Book-Flights",
    expected: "book-flights",
  },
];

module.exports = { PROMPT_BLOCK_ID_FIXTURES };
