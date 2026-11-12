class BobEmojiPlugin extends EmojiPluginBase {
  async onload() {
    try {
      if (!EmojiEditorSuggestAvailable || typeof this.registerEditorSuggest !== "function") return;
      this.emojiIndex = emojiBuildIndex(BOB_EMOJI_CATALOG);
      let stored = null;
      try {
        stored = typeof this.loadData === "function" ? await this.loadData() : null;
      } catch (error) {
        stored = null;
      }
      this.emojiRecents = emojiNormalizeRecents(stored && stored.recents, this.emojiIndex);
      this.emojiSuggest = new BobEmojiSuggest(this.app, this);
      this.registerEditorSuggest(this.emojiSuggest);
    } catch (error) {
      this.emojiSuggest = null;
      this.emojiIndex = [];
      this.emojiRecents = [];
      console.warn("Bob Emoji could not initialize its suggestions", error);
    }
  }

  emojiRememberRecent(suggestion) {
    try {
      this.emojiRecents = emojiRecordRecent(this.emojiRecents, suggestion, this.emojiIndex);
      this.emojiSaveRecents();
    } catch (error) {
      // Recent history is optional and never affects insertion.
    }
  }

  emojiSaveRecents() {
    try {
      if (typeof this.saveData !== "function") return;
      const result = this.saveData({ recents: this.emojiRecents });
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          // Persistence is best-effort; the current session keeps its recent list.
        });
      }
    } catch (error) {
      // Persistence is best-effort; the current session keeps its recent list.
    }
  }
}
