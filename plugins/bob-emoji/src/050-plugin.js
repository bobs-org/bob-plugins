class BobEmojiPlugin extends EmojiPluginBase {
  async onload() {
    try {
      this.emojiIndex = emojiBuildIndex(typeof BOB_EMOJI_CATALOG !== "undefined" ? BOB_EMOJI_CATALOG : []);
      let stored = null;
      try {
        stored = typeof this.loadData === "function" ? await this.loadData() : null;
      } catch (error) {
        stored = null;
      }
      this.emojiRecents = emojiNormalizeRecents(stored && stored.recents, this.emojiIndex);
      this.emojiBuildApi();
      if (!EmojiEditorSuggestAvailable || typeof this.registerEditorSuggest !== "function") return;
      this.emojiSuggest = new BobEmojiSuggest(this.app, this);
      this.registerEditorSuggest(this.emojiSuggest);
    } catch (error) {
      this.emojiSuggest = null;
      this.emojiIndex = Array.isArray(this.emojiIndex) ? this.emojiIndex : [];
      this.emojiRecents = Array.isArray(this.emojiRecents) ? this.emojiRecents : [];
      try {
        this.emojiBuildApi();
      } catch (apiError) {
        // Api is best-effort; the index still exists for direct reads.
      }
      console.warn("Bob Emoji could not initialize its suggestions", error);
    }
  }

  emojiBuildApi() {
    try {
      const plugin = this;
      const api = {
        version: BOB_EMOJI_API_VERSION,
        search(query, options = {}) {
          try {
            const opts = options && typeof options === "object" ? options : {};
            const limit = Number.isFinite(opts.limit) ? opts.limit : BOB_EMOJI_SUGGESTION_LIMIT;
            const boost = Array.isArray(opts.boost) ? opts.boost : [];
            return emojiSearch(plugin.emojiIndex, query, plugin.emojiRecents, limit, BOB_EMOJI_POPULAR, boost);
          } catch (error) {
            return [];
          }
        },
        suggestForLabel(label, options = {}) {
          try {
            const opts = options && typeof options === "object" ? options : {};
            return emojiSuggestForLabel(label, plugin.emojiIndex, {
              limit: Number.isFinite(opts.limit) ? opts.limit : BOB_EMOJI_SUGGESTION_LIMIT,
              exclude: Array.isArray(opts.exclude) ? opts.exclude : [],
            });
          } catch (error) {
            return [];
          }
        },
        categories() {
          try {
            return emojiCategories(plugin.emojiIndex);
          } catch (error) {
            return [];
          }
        },
        browse(categoryId, options = {}) {
          try {
            const opts = options && typeof options === "object" ? options : {};
            return emojiBrowse(plugin.emojiIndex, categoryId, {
              limit: Number.isFinite(opts.limit) ? opts.limit : 100,
              offset: Number.isFinite(opts.offset) ? opts.offset : 0,
            });
          } catch (error) {
            return [];
          }
        },
        info(glyph) {
          try {
            return emojiInfo(plugin.emojiIndex, glyph);
          } catch (error) {
            return null;
          }
        },
        recents(options = {}) {
          try {
            const opts = options && typeof options === "object" ? options : {};
            const limit = Number.isFinite(opts.limit) ? opts.limit : BOB_EMOJI_RECENTS_LIMIT;
            return emojiRecentRows(plugin.emojiIndex, plugin.emojiRecents, limit);
          } catch (error) {
            return [];
          }
        },
        remember(glyphOrRow) {
          try {
            let suggestion = null;
            if (typeof glyphOrRow === "string") {
              const info = emojiInfo(plugin.emojiIndex, glyphOrRow);
              if (!info) return false;
              suggestion = { alias: info.alias, emoji: info.emoji };
            } else if (glyphOrRow && typeof glyphOrRow.emoji === "string") {
              const info = emojiInfo(plugin.emojiIndex, glyphOrRow.emoji);
              const alias = typeof glyphOrRow.alias === "string" && glyphOrRow.alias
                ? glyphOrRow.alias
                : (info ? info.alias : "");
              if (!alias) return false;
              suggestion = { alias, emoji: info ? info.emoji : glyphOrRow.emoji };
            } else {
              return false;
            }
            plugin.emojiRememberRecent(suggestion);
            return true;
          } catch (error) {
            return false;
          }
        },
      };
      this.api = Object.freeze(api);
    } catch (error) {
      this.api = Object.freeze({
        version: BOB_EMOJI_API_VERSION,
        search: () => [],
        suggestForLabel: () => [],
        categories: () => [],
        browse: () => [],
        info: () => null,
        recents: () => [],
        remember: () => false,
      });
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
