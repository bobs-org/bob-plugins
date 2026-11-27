// In-card past-note completion. This layer owns suggestion paint and keys;
// the 248n stage keeps the row-write lifecycle and the input node stable.

function bankNoteSuggestOptionId(key) {
  const encoded = Array.from(String(key || ""))
    .map((char) => char.codePointAt(0).toString(16))
    .join("-");
  return `bob-bank-category-note-option-${encoded || "empty"}`;
}

function bankNoteSuggestAppendHighlighted(parent, text, highlight) {
  const value = String(text || "");
  if (!highlight || !Number.isInteger(highlight.start) || !Number.isInteger(highlight.end) ||
      highlight.start < 0 || highlight.end <= highlight.start || highlight.end > value.length) {
    bankCategoryUiAppend(parent, "span", "bob-bank-category-note-option-text", value);
    return;
  }
  const span = bankCategoryUiAppend(parent, "span", "bob-bank-category-note-option-text");
  if (!span) return;
  if (highlight.start) bankCategoryUiAppend(span, "span", "bob-bank-category-note-option-text-before", value.slice(0, highlight.start));
  bankCategoryUiAppend(span, "span", "bob-bank-category-note-match", value.slice(highlight.start, highlight.end));
  if (highlight.end < value.length) bankCategoryUiAppend(span, "span", "bob-bank-category-note-option-text-after", value.slice(highlight.end));
}

(function installBankNoteSuggestStage() {
  if (typeof BankCategoryCardModal !== "function") return;
  const proto = BankCategoryCardModal.prototype;

  proto.noteSuggestLibrary = function noteSuggestLibrary() {
    try {
      return typeof this.pluginRef?.bankNoteLibrary === "function"
        ? this.pluginRef.bankNoteLibrary()
        : Object.freeze({ available: false, entries: Object.freeze([]) });
    } catch (_) {
      return Object.freeze({ available: false, entries: Object.freeze([]) });
    }
  };

  proto.noteSuggestGhost = function noteSuggestGhost() {
    const stage = this.noteStage;
    const input = this.noteStageInput;
    if (!stage || !input) return null;
    return bankNoteSuggestGhost({
      rows: stage.suggestions,
      value: typeof input.value === "string" ? input.value : stage.draft,
      selectedKey: stage.selectedKey,
      selectionStart: typeof input.selectionStart === "number" ? input.selectionStart : undefined,
      selectionEnd: typeof input.selectionEnd === "number" ? input.selectionEnd : undefined,
      scrollWidth: typeof input.scrollWidth === "number" ? input.scrollWidth : undefined,
      clientWidth: typeof input.clientWidth === "number" ? input.clientWidth : undefined,
    });
  };

  proto.refreshNoteSuggestions = function refreshNoteSuggestions() {
    const stage = this.noteStage;
    if (!stage) return;
    const library = this.noteSuggestLibrary();
    const query = String(stage.query === null || stage.query === undefined ? "" : stage.query);
    if (stage.suggestionQuery !== query || stage.suggestionLibrary !== library) {
      const previousKey = stage.selectedKey;
      stage.suggestions = bankNoteSuggest({ library, query, row: this.cardRow() });
      stage.suggestionQuery = query;
      stage.suggestionLibrary = library;
      if (previousKey && !stage.suggestions.some((row) => row.key === previousKey)) {
        stage.selectedKey = null;
        stage.draft = query;
        if (this.noteStageInput && this.noteStageInput.value !== query) this.noteStageInput.value = query;
      }
    }
    const input = this.noteStageInput;
    const ghostNode = this.noteStageGhost;
    const list = this.noteStageList;
    const rows = Array.isArray(stage.suggestions) ? stage.suggestions : [];
    const selected = rows.find((row) => row.key === stage.selectedKey) || null;
    if (input) {
      try { input.setAttribute("aria-expanded", rows.length ? "true" : "false"); } catch (_) {}
      if (selected) {
        try { input.setAttribute("aria-activedescendant", bankNoteSuggestOptionId(selected.key)); } catch (_) {}
      } else {
        try { input.removeAttribute?.("aria-activedescendant"); } catch (_) {}
      }
    }
    if (list) {
      try { list.replaceChildren?.(); } catch (_) { list.textContent = ""; }
      for (const suggestion of rows) {
        const id = bankNoteSuggestOptionId(suggestion.key);
        const isSelected = suggestion.key === stage.selectedKey;
        const isTabTarget = !selected && rows[0] === suggestion;
        const option = bankCategoryUiAppend(list, "div",
          `bob-bank-category-note-option${isSelected ? " is-selected" : ""}`,
          null,
          {
            id,
            role: "option",
            "aria-selected": isSelected ? "true" : "false",
            title: suggestion.text,
            "data-bank-note-key": suggestion.key,
          });
        if (!option) continue;
        const marker = bankCategoryUiAppend(option, "span", "bob-bank-category-note-option-marker",
          isSelected ? "↵" : (isTabTarget ? "⇥" : ""), { "aria-hidden": "true" });
        void marker;
        bankNoteSuggestAppendHighlighted(option, suggestion.text, suggestion.highlight);
        const meta = bankCategoryUiAppend(option, "span", "bob-bank-category-note-option-meta", null, {
          "aria-label": suggestion.meta || "",
        });
        if (meta && suggestion.metaMerchant) {
          bankCategoryUiAppend(meta, "span", "bob-bank-category-note-option-merchant", suggestion.metaMerchant, {
            title: suggestion.metaMerchant,
          });
        }
        if (meta && suggestion.metaSuffix) {
          bankCategoryUiAppend(meta, "span", "bob-bank-category-note-option-meta-suffix", suggestion.metaSuffix);
        } else if (meta && !suggestion.metaMerchant) {
          meta.textContent = suggestion.meta;
        }
        option.addEventListener?.("mousedown", (event) => {
          try { event?.preventDefault?.(); } catch (_) {}
        });
        option.addEventListener?.("click", (event) => {
          bankCategoryUiConsume(event);
          this.completeNoteSuggestion(suggestion.key);
        });
      }
    }
    const ghost = this.noteSuggestGhost();
    stage.ghostText = ghost ? ghost.text : "";
    if (ghostNode) {
      try { ghostNode.replaceChildren?.(); } catch (_) { ghostNode.textContent = ""; }
      if (ghost) {
        const inputValue = String(input && input.value || "");
        bankCategoryUiAppend(ghostNode, "span", "bob-bank-category-note-ghost-typed", inputValue);
        bankCategoryUiAppend(ghostNode, "span", "bob-bank-category-note-ghost-tail", ghost.text);
      }
    }
    if (this.noteStageField) {
      this.noteStageField.className = `bob-bank-category-note-field${ghost ? " is-ghosting" : ""}`;
    }
    if (input) {
      try { input.setAttribute?.("placeholder", ghost ? "" : BANK_NOTE_STAGE_PLACEHOLDER); } catch (_) {}
    }
  };

  proto.setNoteSuggestionSelection = function setNoteSuggestionSelection(key) {
    const stage = this.noteStage;
    if (!stage || stage.saving) return false;
    const selected = key === null ? null : (stage.suggestions || []).find((row) => row.key === key) || null;
    stage.selectedKey = selected ? selected.key : null;
    stage.draft = selected ? selected.text : String(stage.query || "");
    if (this.noteStageInput && this.noteStageInput.value !== stage.draft) {
      this.noteStageInput.value = stage.draft;
    }
    try {
      const end = stage.draft.length;
      this.noteStageInput?.setSelectionRange?.(end, end);
    } catch (_) {}
    this.refreshNoteStage();
    this.focusNoteInput();
    return true;
  };

  proto.completeNoteSuggestion = function completeNoteSuggestion(key) {
    const stage = this.noteStage;
    if (!stage || stage.saving) return false;
    const suggestion = (stage.suggestions || []).find((row) => row.key === key);
    if (!suggestion) return false;
    stage.query = suggestion.text;
    stage.draft = suggestion.text;
    stage.selectedKey = null;
    stage.suggestionQuery = null;
    if (this.noteStageInput) {
      this.noteStageInput.value = suggestion.text;
      try { this.noteStageInput.setSelectionRange?.(suggestion.text.length, suggestion.text.length); } catch (_) {}
    }
    this.announce(`Completed: ${suggestion.text}`);
    this.refreshNoteStage();
    this.focusNoteInput();
    return true;
  };

  proto.routeNoteSuggestKey = function routeNoteSuggestKey(event, key, inInput) {
    const stage = this.noteStage;
    if (!stage || !event || stage.saving || event.isComposing || event.keyCode === 229) return false;
    const rows = Array.isArray(stage.suggestions) ? stage.suggestions : [];
    if (key === "Tab") {
      bankCategoryUiConsume(event);
      if (event.shiftKey) return true;
      const target = rows.find((row) => row.key === stage.selectedKey) || rows[0];
      if (target) this.completeNoteSuggestion(target.key);
      return true;
    }
    if (key === "ArrowRight" && inInput) {
      const ghost = this.noteSuggestGhost();
      if (!ghost) return false;
      bankCategoryUiConsume(event);
      this.completeNoteSuggestion(ghost.key);
      return true;
    }
    const direction = key === "ArrowDown" || key === "Ctrl+N" ? 1
      : (key === "ArrowUp" || key === "Ctrl+P" ? -1 : 0);
    if (!direction) return false;
    bankCategoryUiConsume(event);
    const selectedKey = bankNoteSuggestStep(rows, stage.selectedKey, direction);
    this.setNoteSuggestionSelection(selectedKey);
    return true;
  };

  const shouldPass = proto.shouldPassNoteStageKey;
  proto.shouldPassNoteStageKey = function shouldPassNoteStageKey(event) {
    if (!event || !this.noteStage || !bankNoteStageInInput(event)) return shouldPass.call(this, event);
    const key = typeof event.key === "string" ? event.key : "";
    if (key === "Tab" || key === "ArrowUp" || key === "ArrowDown" ||
        (event.ctrlKey && (key === "n" || key === "N" || key === "p" || key === "P"))) return false;
    if (key === "ArrowRight" && this.noteSuggestGhost()) return false;
    return shouldPass.call(this, event);
  };
})();
