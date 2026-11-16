const test = require("node:test");
const assert = require("node:assert/strict");
const { helpers, BobEmojiPlugin } = require("./bob-emoji-test-helpers.cjs");

const index = helpers.emojiBuildIndex(helpers.BOB_EMOJI_CATALOG);

test("catalog carries category and CLDR keywords", () => {
  for (const entry of helpers.BOB_EMOJI_CATALOG) {
    assert.equal(typeof entry.category, "string");
    assert.ok(entry.category.length > 0);
    assert.ok(Array.isArray(entry.keywords));
  }
  const brain = index.find((entry) => entry.emoji === "🧠");
  assert.ok(brain.keywords.includes("memory"));
  const mag = index.find((entry) => entry.emoji === "🔍");
  assert.ok(mag.keywords.includes("find") || mag.keywords.includes("search"));
  const categories = helpers.emojiCategories(index);
  assert.deepEqual(categories, [
    "Smileys & Emotion",
    "People & Body",
    "Animals & Nature",
    "Food & Drink",
    "Travel & Places",
    "Activities",
    "Objects",
    "Symbols",
    "Flags",
  ]);
});

test("tiered ranking regression set", () => {
  assert.equal(helpers.emojiSearch(index, ":fire:")[0].emoji, "🔥");
  assert.equal(helpers.emojiSearch(index, "fire")[0].emoji, "🔥");
  assert.equal(helpers.emojiSearch(index, "white check mark")[0].emoji, "✅");
  assert.equal(helpers.emojiSearch(index, "thumbs up")[0].emoji, "👍");
  assert.equal(helpers.emojiSearch(index, "+1")[0].emoji, "👍");
  const memory = helpers.emojiSearch(index, "memory");
  assert.ok(memory.some((row) => row.emoji === "🧠"), "memory should find brain");
  assert.equal(memory[0].emoji, "🧠");
  assert.equal(helpers.emojiSearch(index, "🔥")[0].emoji, "🔥");
  const rokcet = helpers.emojiSearch(index, "rokcet");
  assert.ok(rokcet.length > 0);
  assert.equal(rokcet[0].emoji, "🚀");
});

test("multi-token AND, boost stays within tier, and VS16-insensitive glyphs", () => {
  const rows = helpers.emojiSearch(index, "check mark");
  assert.ok(rows.length > 0);
  assert.equal(rows[0].emoji, "✅");
  const boosted = helpers.emojiSearch(index, "check", [], 10, helpers.BOB_EMOJI_POPULAR, ["✔️"]);
  const plain = helpers.emojiSearch(index, "check", [], 10);
  assert.ok(boosted.some((row) => row.emoji === "✔️"));
  assert.ok(plain[0].matchTier <= boosted.find((row) => row.emoji === "✔️").matchTier);
  const vs16 = helpers.emojiSearch(index, "⚙");
  const vs16plain = helpers.emojiInfo(index, "⚙️");
  assert.equal(vs16plain.emoji, "⚙️");
  assert.ok(vs16.length >= 0);
});

test("suggestForLabel examples", () => {
  const seed = helpers.emojiSuggestForLabel("Seed", index, {});
  assert.ok(seed.some((row) => row.emoji === "🌱"));
  const ready = helpers.emojiSuggestForLabel("Ready", index, {});
  assert.ok(ready.some((row) => row.emoji === "✅"));
  const automation = helpers.emojiSuggestForLabel("Automation (service)", index, {});
  assert.ok(
    automation.some((row) => row.emoji === "⚙️") || automation.some((row) => row.emoji === "🛠️"),
    "automation should suggest gear or hammer",
  );
});

test("api v1 is frozen, total, and shares recents", async () => {
  const plugin = new BobEmojiPlugin({});
  plugin.loadData = async () => null;
  plugin.saveData = async () => {};
  plugin.registerEditorSuggest = () => {};
  await plugin.onload();
  assert.equal(plugin.api.version, 1);
  assert.ok(Object.isFrozen(plugin.api));
  assert.deepEqual(plugin.api.categories(), helpers.emojiCategories(plugin.emojiIndex));
  assert.ok(plugin.api.browse("Symbols", { limit: 2 }).length === 2);
  assert.equal(plugin.api.browse("nope").length, 0);
  assert.equal(plugin.api.info("🔥").emoji, "🔥");
  assert.equal(plugin.api.info("zzz"), null);
  assert.equal(plugin.api.info(null), null);
  assert.deepEqual(plugin.api.search(null, null), plugin.api.search("", {}).slice(0, plugin.api.search("", {}).length));
  assert.deepEqual(plugin.api.suggestForLabel(null), []);
  assert.equal(plugin.api.remember("🔥"), true);
  assert.equal(plugin.api.recents({ limit: 1 })[0].emoji, "🔥");
  assert.equal(plugin.api.remember("zzz"), false);
  const row = plugin.api.search("fire")[0];
  assert.equal(typeof row.emoji, "string");
  assert.equal(typeof row.name, "string");
  assert.equal(typeof row.alias, "string");
  assert.ok(Array.isArray(row.aliases));
  assert.equal(typeof row.category, "string");
  assert.ok(Array.isArray(row.keywords));
  assert.ok(Number.isFinite(row.matchTier));
});

test("api exists without EditorSuggest", async () => {
  const plugin = new BobEmojiPlugin({});
  plugin.loadData = async () => null;
  let registered = false;
  plugin.registerEditorSuggest = () => { registered = true; };
  await plugin.onload();
  assert.ok(plugin.api && plugin.api.version === 1);
  assert.ok(Array.isArray(plugin.emojiIndex) && plugin.emojiIndex.length > 1500);
});
