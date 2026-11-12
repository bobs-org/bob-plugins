const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers } = require("./bob-emoji-test-helpers.cjs");

const index = helpers.emojiBuildIndex(helpers.BOB_EMOJI_CATALOG);

test("catalog integrity and popular aliases", () => {
  assert.ok(helpers.BOB_EMOJI_CATALOG.length >= 1500);
  const primary = new Set();
  for (const entry of helpers.BOB_EMOJI_CATALOG) {
    assert.equal(typeof entry.emoji, "string");
    assert.ok(entry.emoji.length > 0);
    assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 1);
    assert.ok(!primary.has(entry.aliases[0]), "duplicate primary alias: " + entry.aliases[0]);
    primary.add(entry.aliases[0]);
  }
  const aliases = new Set(helpers.BOB_EMOJI_CATALOG.flatMap((entry) => entry.aliases));
  for (const alias of helpers.BOB_EMOJI_POPULAR) assert.ok(aliases.has(alias), "missing popular alias " + alias);
});

test("query normalization, alias ranking, tags, descriptions, and recents", () => {
  assert.equal(helpers.emojiNormalizeQuery("  FiRe  "), "fire");
  assert.equal(helpers.emojiSearch(index, "fire")[0].emoji, "🔥");
  assert.equal(helpers.emojiSearch(index, "+1")[0].emoji, "👍");

  const fixture = helpers.emojiBuildIndex([
    { emoji: "P", aliases: ["happy"], tags: [], description: "" },
    { emoji: "S", aliases: ["unhappy"], tags: [], description: "" },
    { emoji: "T", aliases: ["glad"], tags: ["happy"], description: "" },
    { emoji: "D", aliases: ["smile"], tags: [], description: "a happy face" },
  ]);
  assert.deepEqual(
    helpers.emojiSearch(fixture, "happy", [], 10, []).map((row) => [row.emoji, row.matchTier]),
    [["P", 0], ["S", 1], ["T", 2], ["D", 3]],
  );

  const recentFixture = helpers.emojiBuildIndex([
    { emoji: "A", aliases: ["happy"], tags: [], description: "" },
    { emoji: "B", aliases: ["happen"], tags: [], description: "" },
  ]);
  const recentRows = [{ alias: "happen", emoji: "B" }];
  assert.equal(helpers.emojiSearch(recentFixture, "ha", recentRows, 10, [])[0].emoji, "B");
});

test("empty query puts newest recents before popular entries and deduplicates", () => {
  const fixture = helpers.emojiBuildIndex([
    { emoji: "A", aliases: ["popular"], tags: [], description: "" },
    { emoji: "B", aliases: ["second"], tags: [], description: "" },
    { emoji: "C", aliases: ["third"], tags: [], description: "" },
  ]);
  const rows = helpers.emojiSearch(
    fixture,
    "",
    [{ alias: "second", emoji: "B" }, { alias: "popular", emoji: "A" }],
    30,
    ["popular", "third"],
  );
  assert.deepEqual(rows.map((row) => row.emoji), ["B", "A", "C"]);
  assert.deepEqual(rows.map((row) => row.isRecent), [true, true, false]);
});

test("recent history deduplicates by alias and caps at thirty", () => {
  const recents = index.slice(0, 35).map((entry) => ({
    alias: entry.aliases[0],
    emoji: entry.emoji,
  }));
  recents.push(recents[0]);
  const normalized = helpers.emojiNormalizeRecents(recents, index);
  assert.equal(normalized.length, 30);
  assert.equal(new Set(normalized.map((row) => row.alias)).size, 30);
  const newest = helpers.emojiRecordRecent(normalized, normalized[10], index);
  assert.equal(newest[0].alias, normalized[10].alias);
  assert.equal(newest.length, 30);
});
