// In-card Emoji Slot shared by the album Schema Card and bank setup card.
// Focus stays in the search input while results repaint; the card owns the
// selected glyph through its existing staged input contract.
let ALBUM_EMOJI_SLOT_ID = 0;

function albumEmojiSlotCreateEl(doc, tag, className = "", text = "") {
  const element = notebookCreateEl(doc, tag, className);
  if (text) notebookSetText(element, text);
  return element;
}

function albumEmojiSlotEmpty(host) {
  if (!host) return;
  try { host.empty?.(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }
}

function albumEmojiSlotFusedToken(label, emoji) {
  const glyph = String(emoji || "").trim();
  const text = String(label || "").trim();
  return glyph ? (text ? `${glyph} ${text}` : glyph) : text;
}

function albumEmojiSlotUpdateHint(slot) {
  if (!slot || slot.fallback || !slot.hint) return;
  const disabled = slot.well?.disabled === true;
  const show = !disabled && !slot.glyph && !slot.isOpen;
  if (show) slot.hint.removeAttribute?.("hidden");
  else slot.hint.setAttribute?.("hidden", "");
}

function albumEmojiSlotUpdatePreview(slot) {
  if (!slot) return;
  const value = albumEmojiSlotFusedToken(slot.labelInput?.value, slot.glyph);
  notebookSetText(slot.preview, value ? `Preview · ${value}` : "Preview · —");
  slot.preview?.setAttribute?.("aria-label", value ? `Preview: ${value}` : "Empty emoji preview");
  notebookSetText(slot.note, albumEmojiSlotIsDigitKeycap(slot.glyph)
    ? "bob stores a leading digit keycap as label text"
    : "");
  if (slot.well) {
    notebookSetText(slot.well, slot.glyph || "☻");
    slot.well.setAttribute("aria-label", slot.glyph ? `Emoji ${slot.glyph}; choose another` : "Choose an emoji");
    if (slot.glyph) slot.well.classList?.remove?.("is-empty");
    else slot.well.classList?.add?.("is-empty");
  }
  albumEmojiSlotUpdateHint(slot);
}

function albumEmojiSlotResolveSiblings(slot) {
  try {
    const value = typeof slot?.config?.getSiblings === "function" ? slot.config.getSiblings() : slot?.config?.siblings;
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

function albumEmojiSlotRowLabel(row) {
  return String(row?.name || row?.description || row?.label || row?.alias || row?.emoji || "emoji");
}

function albumEmojiSlotRenderResults(slot) {
  const api = slot.api;
  if (!api) return;
  const model = albumEmojiSlotResultModel(api, {
    query: slot.search.value,
    category: slot.category,
    label: slot.labelInput?.value || "",
    vocabulary: typeof slot.config.getVocabulary === "function" ? slot.config.getVocabulary() : slot.config.vocabulary,
    vocabularyTitle: slot.config.vocabularyTitle,
  });
  slot.model = model;
  const results = slot.results;
  albumEmojiSlotEmpty(results);
  slot.optionRows = model.rows.map((row) => ({
    row,
    duplicateLabels: albumEmojiSlotDuplicateLabels(row.emoji, albumEmojiSlotResolveSiblings(slot)),
  }));

  let index = 0;
  for (const section of model.sections) {
    const sectionHost = albumEmojiSlotCreateEl(slot.doc, "section", "bob-emoji-slot-section");
    const heading = albumEmojiSlotCreateEl(slot.doc, "h4", "bob-emoji-slot-section-title", section.title);
    sectionHost.appendChild(heading);
    const grid = albumEmojiSlotCreateEl(slot.doc, "div", "bob-emoji-slot-grid");
    for (const row of section.rows) {
      const optionIndex = index++;
      const option = albumEmojiSlotCreateEl(slot.doc, "div", "bob-emoji-slot-option");
      const id = `bob-emoji-slot-${slot.id}-option-${optionIndex}`;
      const duplicateLabels = albumEmojiSlotDuplicateLabels(row.emoji, albumEmojiSlotResolveSiblings(slot));
      option.setAttribute("id", id);
      option.setAttribute("role", "option");
      option.setAttribute("data-emoji-option-index", String(optionIndex));
      option.setAttribute("aria-selected", optionIndex === slot.activeIndex ? "true" : "false");
      const duplicateText = duplicateLabels.length ? `; also used by ${duplicateLabels.join(", ")}` : "";
      option.setAttribute("aria-label", `${row.emoji} ${albumEmojiSlotRowLabel(row)}${duplicateText}`);
      const glyph = albumEmojiSlotCreateEl(slot.doc, "span", "bob-emoji-slot-option-glyph", row.emoji);
      const name = albumEmojiSlotCreateEl(slot.doc, "span", "bob-emoji-slot-option-name", albumEmojiSlotRowLabel(row));
      option.appendChild(glyph);
      option.appendChild(name);
      if (duplicateLabels.length) {
        const dot = albumEmojiSlotCreateEl(slot.doc, "span", "bob-emoji-slot-duplicate-dot");
        dot.setAttribute("aria-hidden", "true");
        dot.setAttribute("title", `Also used by ${duplicateLabels.join(", ")}`);
        option.appendChild(dot);
      }
      grid.appendChild(option);
    }
    sectionHost.appendChild(grid);
    results.appendChild(sectionHost);
  }

  const active = slot.optionRows[slot.activeIndex];
  if (active) slot.search.setAttribute("aria-activedescendant", `bob-emoji-slot-${slot.id}-option-${slot.activeIndex}`);
  else slot.search.removeAttribute("aria-activedescendant");
  const duplicateLabels = active?.duplicateLabels || [];
  const alias = active?.row?.alias ? `:${active.row.alias}: ` : "";
  const name = active ? `${active.row.emoji} ${alias}${albumEmojiSlotRowLabel(active.row)}` : "No emoji found";
  const duplicate = duplicateLabels.length ? ` · also used by ${duplicateLabels.join(", ")}` : "";
  const note = albumEmojiSlotIsDigitKeycap(slot.glyph) ? " · bob stores a leading digit keycap as label text" : "";
  notebookSetText(slot.footer, `${name}${duplicate}${note} · ⏎ pick`);
}

function albumEmojiSlotRevealActive(slot) {
  try {
    const option = slot?.results?.querySelector?.(
      `#bob-emoji-slot-${slot.id}-option-${slot.activeIndex}`
    ) || slot?.results?.querySelector?.(
      `[data-emoji-option-index="${slot.activeIndex}"]`
    ) || null;
    option?.scrollIntoView?.({ block: "nearest" });
  } catch (_) {}
}

function albumEmojiSlotRenderCategories(slot) {
  const categories = slot.model?.categories || [];
  albumEmojiSlotEmpty(slot.tabs);
  for (const category of categories) {
    const tab = albumEmojiSlotCreateEl(slot.doc, "button", "bob-emoji-slot-category", category);
    tab.setAttribute("type", "button");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", slot.category === category ? "true" : "false");
    tab.setAttribute("data-emoji-category", category);
    tab.addEventListener("click", () => {
      slot.category = category;
      slot.search.value = "";
      slot.activeIndex = 0;
      albumEmojiSlotRenderResults(slot);
      albumEmojiSlotRenderCategories(slot);
      try { slot.search.focus?.({ preventScroll: true }); } catch (_) {}
    });
    slot.tabs.appendChild(tab);
  }
}

function albumEmojiSlotClose(slot, options = {}) {
  if (!slot?.isOpen) return false;
  slot.isOpen = false;
  slot.panel.setAttribute("hidden", "");
  albumEmojiSlotUpdateHint(slot);
  slot.well?.setAttribute?.("aria-expanded", "false");
  slot.search.setAttribute("aria-expanded", "false");
  slot.search.removeAttribute("aria-activedescendant");
  if (slot.config.onClose) {
    try { slot.config.onClose(slot); } catch (_) {}
  }
  if (options.focusWell !== false) {
    try { slot.well?.focus?.({ preventScroll: true }); } catch (_) {}
  }
  return true;
}

function albumEmojiSlotPick(slot, glyph, row = null) {
  const value = String(glyph || "");
  slot.glyph = value;
  if (value) {
    try {
      const api = albumEmojiSlotResolveApi(slot.config.app);
      api?.remember?.(value);
    } catch (_) {}
  }
  if (typeof slot.config.onPick === "function") {
    try { slot.config.onPick(slot.config.inputName, value, row); } catch (_) {}
  }
  albumEmojiSlotUpdatePreview(slot);
  albumEmojiSlotClose(slot, { focusWell: true });
}

function albumEmojiSlotOpen(slot, initialQuery = "") {
  if (!slot || slot.fallback) return false;
  const api = albumEmojiSlotResolveApi(slot.config.app);
  if (!api) {
    notebookSetText(slot.footer, "Enable Bob Emoji for search.");
    return false;
  }
  if (slot.isOpen) return true;
  slot.api = api;
  slot.category = "";
  slot.search.value = String(initialQuery || "");
  slot.activeIndex = 0;
  slot.isOpen = true;
  slot.panel.removeAttribute("hidden");
  albumEmojiSlotUpdateHint(slot);
  slot.well?.setAttribute?.("aria-expanded", "true");
  slot.search.setAttribute("aria-expanded", "true");
  slot.model = albumEmojiSlotResultModel(api, {
    query: slot.search.value,
    label: slot.labelInput?.value || "",
    vocabulary: typeof slot.config.getVocabulary === "function" ? slot.config.getVocabulary() : slot.config.vocabulary,
    vocabularyTitle: slot.config.vocabularyTitle,
  });
  albumEmojiSlotRenderCategories(slot);
  albumEmojiSlotRenderResults(slot);
  if (slot.config.onOpen) {
    try { slot.config.onOpen(slot); } catch (_) {}
  }
  try { slot.search.focus?.({ preventScroll: true }); } catch (_) {}
  return true;
}

function albumEmojiSlotHandleKeydown(slot, event) {
  if (!event || event.isComposing || event.keyCode === 229) return;
  const stop = () => {
    event.preventDefault?.();
    event.stopPropagation?.();
  };
  if (event.key === "Escape") {
    stop();
    albumEmojiSlotClose(slot, { focusWell: true });
    return;
  }
  try {
    if (typeof bobCardCloseKey === "function" && bobCardCloseKey(event) === "ctrl-bracket") {
      stop();
      albumEmojiSlotClose(slot, { focusWell: true });
      return;
    } else if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
        (event.code === "BracketLeft" || event.key === "[")) {
      stop();
      albumEmojiSlotClose(slot, { focusWell: true });
      return;
    }
  } catch (_) {}
  if (event.key === "Tab") {
    albumEmojiSlotClose(slot, { focusWell: true });
    return;
  }
  if (event.key === "Backspace" && !slot.search.value) {
    stop();
    albumEmojiSlotPick(slot, "");
    return;
  }
  if (event.key === "Enter") {
    stop();
    const active = slot.optionRows[slot.activeIndex];
    if (active) albumEmojiSlotPick(slot, active.row.emoji, active.row);
    return;
  }
  const move = albumEmojiSlotMoveKey(event);
  if (move && slot.optionRows.length) {
    stop();
    slot.activeIndex = albumEmojiSlotMoveHighlight(slot.activeIndex, move, slot.optionRows.length);
    albumEmojiSlotRenderResults(slot);
    albumEmojiSlotRevealActive(slot);
  }
}

function albumEmojiSlotControl(doc, host, labelText, inputName, value, labelInput, config = {}, options = {}) {
  const fused = options.fused === true;
  const row = fused ? host : albumEmojiSlotCreateEl(doc, "div", "bob-album-schema-emoji-control");
  if (!fused) row.classList?.add?.("bob-album-schema-emoji-control");
  const label = fused ? null : albumEmojiSlotCreateEl(doc, "span", "bob-album-schema-emoji-label", labelText);
  const content = fused ? host : albumEmojiSlotCreateEl(doc, "div", "bob-emoji-slot-content");
  const preview = albumEmojiSlotCreateEl(doc, "span", "bob-emoji-slot-preview");
  const note = albumEmojiSlotCreateEl(doc, "span", "bob-emoji-slot-note");
  // bob-text: none hidden emoji value storage
  const hidden = albumEmojiSlotCreateEl(doc, "input", "bob-emoji-slot-value");
  hidden.setAttribute("type", "hidden");
  hidden.setAttribute("data-schema-input", inputName);
  hidden.value = String(value || "");
  const slotConfig = {
    ...config,
    inputName,
    label: String(labelInput?.value || ""),
    vocabulary: typeof config.getVocabulary === "function" ? config.getVocabulary() : (config.vocabulary || []),
    siblings: typeof config.getSiblings === "function" ? config.getSiblings() : (config.siblings || []),
  };
  const api = albumEmojiSlotResolveApi(slotConfig.app);
  let well = null;
  let fallbackInput = null;
  let panel = null;
  let slot = null;

  if (api) {
    well = albumEmojiSlotCreateEl(doc, "button", "bob-emoji-slot-well", value || "☻");
    well.setAttribute("type", "button");
    well.setAttribute("data-emoji-well", "");
    well.setAttribute("aria-haspopup", "listbox");
    well.setAttribute("aria-expanded", "false");
    well.setAttribute("aria-label", value ? `Emoji ${value}; choose another` : "Choose an emoji");
    well.setAttribute("title", "Choose an emoji: click, or Tab here and type to search");
    if (options.disabled) well.disabled = true;
    const hint = albumEmojiSlotCreateEl(doc, "span", "bob-emoji-slot-hint",
      "Emoji: click \u263B or press Tab, then type to search");
    hint.setAttribute("hidden", "");

    panel = albumEmojiSlotCreateEl(doc, "section", "bob-emoji-slot-panel");
    panel.setAttribute("hidden", "");
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Emoji picker");
    const searchLabel = albumEmojiSlotCreateEl(doc, "label", "bob-emoji-slot-search-label", "Search emoji");
    // bob-text: literal emoji picker filter
    const search = albumEmojiSlotCreateEl(doc, "input", "bob-emoji-slot-search");
    const results = albumEmojiSlotCreateEl(doc, "div", "bob-emoji-slot-results");
    search.setAttribute("type", "search");
    search.setAttribute("aria-label", "Search emoji");
    search.setAttribute("role", "combobox");
    search.setAttribute("aria-autocomplete", "list");
    search.setAttribute("aria-expanded", "true");
    const resultsId = `bob-emoji-slot-${ALBUM_EMOJI_SLOT_ID + 1}-results`;
    results.setAttribute("id", resultsId);
    search.setAttribute("aria-controls", resultsId);
    search.setAttribute("autocomplete", "off");
    search.setAttribute("spellcheck", "false");
    const tabs = albumEmojiSlotCreateEl(doc, "div", "bob-emoji-slot-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Emoji categories");
    results.setAttribute("role", "listbox");
    const footer = albumEmojiSlotCreateEl(doc, "div", "bob-emoji-slot-footer");
    footer.setAttribute("role", "status");
    footer.setAttribute("aria-live", "polite");
    panel.appendChild(searchLabel);
    panel.appendChild(search);
    panel.appendChild(tabs);
    panel.appendChild(results);
    panel.appendChild(footer);
    slot = {
      id: ++ALBUM_EMOJI_SLOT_ID,
      doc,
      config: slotConfig,
      glyph: String(value || ""),
      labelInput,
      hidden,
      well,
      panel,
      search,
      tabs,
      results,
      footer,
      category: "",
      activeIndex: 0,
      optionRows: [],
      isOpen: false,
      api,
      model: null,
      composing: false,
      fallback: false,
      preview,
      note,
      hint,
    };
    well.addEventListener("click", () => {
      if (slot.isOpen) albumEmojiSlotClose(slot, { focusWell: true });
      else albumEmojiSlotOpen(slot);
    });
    well.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault?.();
        event.stopPropagation?.();
        albumEmojiSlotOpen(slot);
        return;
      }
      if (!event.altKey && !event.ctrlKey && !event.metaKey && albumEmojiSlotGraphemes(event.key || "").length === 1 && event.key.length > 0) {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (albumEmojiSlotIsEmojiGrapheme(event.key)) albumEmojiSlotPick(slot, event.key);
        else albumEmojiSlotOpen(slot, event.key);
      }
    });
    search.addEventListener("compositionstart", () => { slot.composing = true; });
    search.addEventListener("compositionend", () => {
      slot.composing = false;
      albumEmojiSlotSearchInput(slot);
    });
    search.addEventListener("input", (event) => {
      if (slot.composing || event?.isComposing) return;
      albumEmojiSlotSearchInput(slot);
    });
    search.addEventListener("keydown", (event) => albumEmojiSlotHandleKeydown(slot, event));
    panel.addEventListener("click", (event) => {
      const option = event?.target?.closest?.("[data-emoji-option-index]");
      const index = Number(option?.getAttribute?.("data-emoji-option-index"));
      if (Number.isInteger(index) && slot.optionRows[index]) albumEmojiSlotPick(slot, slot.optionRows[index].row.emoji, slot.optionRows[index].row);
    });
    content.appendChild(hidden);
    content.appendChild(well);
    content.appendChild(preview);
    content.appendChild(hint);
    content.appendChild(note);
    content.appendChild(panel);
  } else {
    // bob-text: literal emoji glyph fallback
    fallbackInput = albumEmojiSlotCreateEl(doc, "input", "bob-album-schema-input bob-emoji-slot-fallback");
    fallbackInput.setAttribute("type", "text");
    fallbackInput.setAttribute("data-schema-input", inputName);
    fallbackInput.setAttribute("aria-label", labelText);
    fallbackInput.setAttribute("placeholder", "Enable Bob Emoji for search");
    fallbackInput.setAttribute("title", "Enable Bob Emoji for search");
    fallbackInput.value = String(value || "");
    if (options.disabled) fallbackInput.disabled = true;
    slot = {
      id: ++ALBUM_EMOJI_SLOT_ID,
      doc,
      config: slotConfig,
      glyph: String(value || ""),
      labelInput,
      well: fallbackInput,
      preview,
      note,
      fallback: true,
      isOpen: false,
    };
    fallbackInput.addEventListener("input", () => {
      slot.glyph = String(fallbackInput.value || "");
      slot.config.onPick?.(inputName, slot.glyph, null);
      albumEmojiSlotUpdatePreview(slot);
    });
    content.appendChild(fallbackInput);
    content.appendChild(preview);
    content.appendChild(note);
    albumEmojiSlotUpdatePreview(slot);
  }

  if (!fused) {
    row.appendChild(label);
    row.appendChild(content);
    host.appendChild(row);
  }
  const updatePreview = () => albumEmojiSlotUpdatePreview(slot);
  labelInput?.addEventListener?.("input", updatePreview);
  labelInput?.addEventListener?.("change", updatePreview);
  if (api) albumEmojiSlotUpdatePreview(slot);
  return slot;
}

function albumEmojiSlotSearchInput(slot) {
  const query = String(slot.search.value || "");
  if (albumEmojiSlotIsEmojiGrapheme(query)) {
    albumEmojiSlotPick(slot, query, null);
    return;
  }
  slot.category = "";
  slot.activeIndex = 0;
  albumEmojiSlotRenderCategories(slot);
  albumEmojiSlotRenderResults(slot);
}

function albumSchemaEmojiSlotControl(doc, host, labelText, inputName, value, labelInput, config, options = {}) {
  return albumEmojiSlotControl(doc, host, labelText, inputName, value, labelInput, config, options);
}

// Modal integration is intentionally late-bound. The schema card can be open
// while Bob Emoji is disabled, reloaded, or upgraded; each picker opening
// checks the live plugin registry again.
{
  const prototype = AlbumSchemaCardModal.prototype;
  const originalPaintOptions = prototype.schemaPaintOptions;
  const originalEscape = prototype.schemaHandleEscape;
  const originalCancelStage = prototype.schemaCancelStage;
  const originalQueueOp = prototype.schemaQueueOp;
  const originalClose = prototype.onClose;

  prototype.schemaEmojiVocabulary = function schemaEmojiVocabulary() {
    const report = this.schemaPlugin?.albumReportState?.()?.report;
    const albums = Array.isArray(report?.albums) ? report.albums : [];
    const rows = [];
    const seen = new Set();
    for (const album of albums) {
      for (const field of Array.isArray(album?.fields) ? album.fields : []) {
        for (const choice of Array.isArray(field?.choices) ? field.choices : []) {
          const parts = albumSchemaChoiceParts(choice?.label);
          const key = albumEmojiSlotGlyphKey(parts.emoji);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          rows.push({ emoji: parts.emoji, label: parts.label });
        }
      }
    }
    return rows;
  };

  prototype.schemaEmojiSlotHostOptions = function schemaEmojiSlotHostOptions() {
    return {
      app: this.app,
      getVocabulary: () => this.schemaEmojiVocabulary(),
      getInitialChoiceSiblings: (index) => (Array.isArray(this.stageDraft?.initialChoices) ? this.stageDraft.initialChoices : [])
        .filter((_, siblingIndex) => siblingIndex !== index)
        .map((choice) => ({ emoji: String(choice?.emoji || ""), label: String(choice?.label || "") })),
      onPick: (name, glyph) => {
        const input = this.schemaInput(name);
        if (!input) return;
        input.value = glyph;
        this.schemaStageInput({ target: input });
      },
      onOpen: (slot) => {
        if (this.schemaEmojiSlotActive && this.schemaEmojiSlotActive !== slot) {
          albumEmojiSlotClose(this.schemaEmojiSlotActive, { focusWell: false });
        }
        this.schemaEmojiSlotActive = slot;
      },
      onClose: (slot) => {
        if (this.schemaEmojiSlotActive === slot) this.schemaEmojiSlotActive = null;
      },
    };
  };

  prototype.schemaPaintOptions = function schemaPaintOptionsWithEmojiSlot(...args) {
    const options = originalPaintOptions.apply(this, args);
    return { ...options, emojiSlot: this.schemaEmojiSlotHostOptions() };
  };

  prototype.schemaHandleEscape = function schemaHandleEscapeEmojiSlot(...args) {
    if (this.sessionState?.status !== "applying" && this.schemaEmojiSlotActive?.isOpen) {
      albumEmojiSlotClose(this.schemaEmojiSlotActive, { focusWell: true });
      return "stay";
    }
    return originalEscape.apply(this, args);
  };

  prototype.schemaCancelStage = function schemaCancelStageEmojiSlot(...args) {
    if (this.schemaEmojiSlotActive?.isOpen) albumEmojiSlotClose(this.schemaEmojiSlotActive, { focusWell: false });
    return originalCancelStage.apply(this, args);
  };

  prototype.schemaQueueOp = function schemaQueueOpEmojiSlot(...args) {
    if (this.schemaEmojiSlotActive?.isOpen) albumEmojiSlotClose(this.schemaEmojiSlotActive, { focusWell: false });
    return originalQueueOp.apply(this, args);
  };

  prototype.onClose = function onCloseEmojiSlot(...args) {
    if (this.schemaEmojiSlotActive?.isOpen) albumEmojiSlotClose(this.schemaEmojiSlotActive, { focusWell: false });
    return originalClose.apply(this, args);
  };
}
