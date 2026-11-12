const test = require("node:test");
const assert = require("node:assert/strict");
const { BobEmojiPlugin, helpers, ElementStub } = require("./bob-emoji-test-helpers.cjs");

test("renderSuggestion builds styled glyph, shortcode, hint, and match nodes", () => {
  const plugin = { emojiIndex: helpers.emojiBuildIndex(helpers.BOB_EMOJI_CATALOG), emojiRecents: [] };
  const suggest = new helpers.BobEmojiSuggest({}, plugin);
  const value = helpers.emojiSearch(plugin.emojiIndex, "fire")[0];
  const root = new ElementStub();
  suggest.renderSuggestion(value, root);
  const all = root.all();
  assert.ok(root.classes.has("bob-emoji-suggestion"));
  assert.ok(all.some((node) => node.classes.has("bob-emoji-glyph") && node.text === "🔥"));
  assert.ok(all.some((node) => node.classes.has("bob-emoji-shortcode")));
  assert.ok(all.some((node) => node.classes.has("bob-emoji-match") && node.text === "fire"));
  assert.ok(all.some((node) => node.classes.has("bob-emoji-aliases")));
});

test("selection replaces the stored range with the emoji, saves recents, and closes", () => {
  const index = helpers.emojiBuildIndex(helpers.BOB_EMOJI_CATALOG);
  const writes = [];
  const plugin = {
    emojiIndex: index,
    emojiRecents: [],
    emojiRememberRecent(value) { this.emojiRecents = helpers.emojiRecordRecent(this.emojiRecents, value, index); writes.push(value); },
  };
  const suggest = new helpers.BobEmojiSuggest({}, plugin);
  const replacements = [];
  let closed = false;
  suggest.context = {
    editor: { replaceRange(value, start, end) { replacements.push({ value, start, end }); } },
    start: { line: 2, ch: 4 },
    end: { line: 2, ch: 8 },
  };
  suggest.close = () => { closed = true; };
  const value = helpers.emojiSearch(index, "fire")[0];
  suggest.selectSuggestion(value);
  assert.deepEqual(replacements, [{
    value: "🔥",
    start: { line: 2, ch: 4 },
    end: { line: 2, ch: 8 },
  }]);
  assert.equal(writes.length, 1);
  assert.equal(plugin.emojiRecents[0].emoji, "🔥");
  assert.equal(closed, true);
});

test("missing and corrupt plugin data reset recents safely; valid recents persist", async () => {
  const stored = { recents: [{ alias: "fire", emoji: "🔥" }, { alias: 7, emoji: "?" }] };
  const plugin = new BobEmojiPlugin({});
  let saved = null;
  plugin.loadData = async () => stored;
  plugin.saveData = async (value) => { saved = value; };
  plugin.registerEditorSuggest = (suggest) => { plugin.registeredSuggest = suggest; };
  await plugin.onload();
  assert.equal(plugin.emojiRecents.length, 1);
  assert.equal(plugin.registeredSuggest, plugin.emojiSuggest);
  plugin.emojiRememberRecent(helpers.emojiSearch(plugin.emojiIndex, "rocket")[0]);
  await Promise.resolve();
  assert.equal(saved.recents[0].emoji, "🚀");

  const corrupt = new BobEmojiPlugin({});
  corrupt.loadData = async () => ({ recents: "not an array" });
  corrupt.registerEditorSuggest = () => {};
  await corrupt.onload();
  assert.deepEqual(corrupt.emojiRecents, []);
});
