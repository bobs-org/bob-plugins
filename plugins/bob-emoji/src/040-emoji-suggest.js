class BobEmojiSuggest extends EmojiEditorSuggestBase {
  constructor(app, plugin) {
    super(app, plugin);
    this.pluginRef = plugin;
    this.limit = BOB_EMOJI_SUGGESTION_LIMIT;
  }

  onTrigger(cursor, editor) {
    try {
      return emojiFindTrigger(cursor, editor);
    } catch (error) {
      return null;
    }
  }

  getSuggestions(context) {
    try {
      if (!context || !this.pluginRef) return [];
      return emojiSearch(
        this.pluginRef.emojiIndex,
        context.query,
        this.pluginRef.emojiRecents,
        this.limit,
      );
    } catch (error) {
      return [];
    }
  }

  renderSuggestion(value, el) {
    try {
      if (!value || !el || typeof el.createSpan !== "function") return;
      el.addClass("bob-emoji-suggestion");
      if (value.isRecent) el.addClass("bob-emoji-recent");
      el.createSpan({ cls: "bob-emoji-glyph", text: value.emoji });
      const text = el.createDiv({ cls: "bob-emoji-text" });
      const shortcode = text.createDiv({ cls: "bob-emoji-shortcode" });
      const alias = String(value.alias || value.primaryAlias || "");
      const query = emojiNormalizeQuery(value.query);
      const needle = query ? alias.toLowerCase().indexOf(query) : -1;
      shortcode.appendText(":");
      if (needle >= 0 && typeof shortcode.createSpan === "function") {
        shortcode.appendText(alias.slice(0, needle));
        shortcode.createSpan({
          cls: "bob-emoji-match",
          text: alias.slice(needle, needle + query.length),
        });
        shortcode.appendText(alias.slice(needle + query.length));
      } else {
        shortcode.appendText(alias);
      }
      shortcode.appendText(":");
      const hints = [];
      for (const alternate of value.aliases || []) {
        if (alternate !== alias) hints.push(":" + alternate + ":");
        if (hints.length >= 2) break;
      }
      if (hints.length < 2) {
        for (const tag of value.tags || []) {
          if (!hints.includes(tag)) hints.push(tag);
          if (hints.length >= 2) break;
        }
      }
      if (hints.length) text.createSpan({ cls: "bob-emoji-aliases", text: hints.join(" · ") });
    } catch (error) {
      // A rendering failure should leave the editor and the selected emoji usable.
    }
  }

  selectSuggestion(value) {
    try {
      const context = this.context || {};
      const editor = context.editor;
      if (editor && context.start && context.end && value && value.emoji) {
        editor.replaceRange(value.emoji, context.start, context.end);
        if (this.pluginRef && typeof this.pluginRef.emojiRememberRecent === "function") {
          this.pluginRef.emojiRememberRecent(value);
        }
      }
    } catch (error) {
      // Selection is best-effort; never let a failed insertion break editor input.
    } finally {
      try {
        this.close();
      } catch (error) {
        // Close is best-effort.
      }
    }
  }
}
