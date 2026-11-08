// Status-bar chip and line rail for Highlights page jumps (hints).
const HIGHLIGHTS_HINTS_DEBOUNCE_MS = 120;
const HIGHLIGHTS_HINTS_CACHE_LIMIT = 128;
const HIGHLIGHTS_OPEN_COMMAND_ID =
  "bob-navigation-hotkeys:open-reference-pdf-in-highlights";
const HIGHLIGHTS_INK =
  "color-mix(in srgb, var(--color-yellow) 65%, var(--color-orange))";

const bobHighlightsRailEffect =
  StateEffect && typeof StateEffect.define === "function"
    ? StateEffect.define()
    : null;
const bobHighlightsRailMark =
  Decoration && typeof Decoration.line === "function"
    ? Decoration.line({ class: "bob-highlights-rail" })
    : null;
const bobHighlightsRailField =
  StateField &&
  typeof StateField.define === "function" &&
  EditorView &&
  EditorView.decorations &&
  typeof EditorView.decorations.from === "function" &&
  Decoration &&
  Decoration.none &&
  typeof Decoration.set === "function" &&
  bobHighlightsRailEffect &&
  bobHighlightsRailMark
    ? StateField.define({
        create: () => Decoration.none,
        update: (decorations, transaction) => {
          let next =
            transaction.docChanged &&
            decorations &&
            typeof decorations.map === "function"
              ? decorations.map(transaction.changes)
              : decorations;

          for (const effect of transaction.effects || []) {
            if (
              !effect ||
              typeof effect.is !== "function" ||
              !effect.is(bobHighlightsRailEffect)
            ) {
              continue;
            }
            if (effect.value && effect.value.clear) {
              next = Decoration.none;
              continue;
            }
            const document = transaction.state && transaction.state.doc;
            const fromLine = Number(effect.value && effect.value.from);
            const toLine = Number(effect.value && effect.value.to);
            if (
              !document ||
              !Number.isInteger(fromLine) ||
              !Number.isInteger(toLine) ||
              fromLine < 0 ||
              toLine < fromLine ||
              typeof document.line !== "function" ||
              !bobHighlightsRailMark
            ) {
              next = Decoration.none;
              continue;
            }
            try {
              const lastLine = Math.max(0, Number(document.lines) - 1);
              const end = Math.min(toLine, lastLine);
              const ranges = [];
              for (let line = fromLine; line <= end; line += 1) {
                const info = document.line(line + 1);
                if (info && typeof info.from === "number") {
                  ranges.push(bobHighlightsRailMark.range(info.from));
                }
              }
              next = Decoration.set(ranges);
            } catch (_error) {
              next = Decoration.none;
            }
          }
          return next;
        },
        provide: (field) => EditorView.decorations.from(field),
      })
    : null;

function highlightsHintHash(text) {
  const value = String(text || "");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function firstHighlightsHotkey(value) {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return firstHighlightsHotkey(value[0]);
  }
  if (typeof value !== "object") {
    return null;
  }
  const key = value.key == null ? "" : String(value.key);
  if (!key && !Array.isArray(value.modifiers)) {
    return null;
  }
  return {
    modifiers: Array.isArray(value.modifiers) ? value.modifiers.map(String) : [],
    key,
  };
}

function getHighlightsCommandHotkey(app) {
  try {
    const manager = app && app.hotkeyManager;
    if (!manager) return null;
    const custom =
      (typeof manager.getHotkeys === "function" &&
        manager.getHotkeys(HIGHLIGHTS_OPEN_COMMAND_ID)) ||
      (manager.customKeys && manager.customKeys[HIGHLIGHTS_OPEN_COMMAND_ID]);
    const customHotkey = firstHighlightsHotkey(custom);
    if (customHotkey) return customHotkey;
    const defaults =
      (typeof manager.getDefaultHotkeys === "function" &&
        manager.getDefaultHotkeys(HIGHLIGHTS_OPEN_COMMAND_ID)) ||
      (manager.defaultKeys && manager.defaultKeys[HIGHLIGHTS_OPEN_COMMAND_ID]);
    return firstHighlightsHotkey(defaults);
  } catch (_error) {
    return null;
  }
}

function formatHighlightsHotkey(hotkey) {
  const parsed = firstHighlightsHotkey(hotkey);
  if (!parsed) {
    return "";
  }
  const glyphs = [];
  const seen = new Set();
  const modifierGlyph = {
    Mod: "\u2318",
    Meta: "\u2318",
    Ctrl: "\u2303",
    Control: "\u2303",
    Alt: "\u2325",
    Shift: "\u21e7",
  };
  const order = ["Mod", "Meta", "Ctrl", "Control", "Alt", "Shift"];
  for (const name of order) {
    if (!parsed.modifiers.includes(name)) {
      continue;
    }
    const glyph = modifierGlyph[name];
    if (!glyph || seen.has(glyph)) {
      continue;
    }
    seen.add(glyph);
    glyphs.push(glyph);
  }
  for (const name of parsed.modifiers) {
    const glyph = modifierGlyph[name];
    if (!glyph || seen.has(glyph)) {
      continue;
    }
    seen.add(glyph);
    glyphs.push(glyph);
  }
  const key = parsed.key;
  if (key === "Enter" || key === "Return") {
    glyphs.push("\u21b5");
  } else if (key) {
    glyphs.push(key.length === 1 ? key.toUpperCase() : key);
  }
  return glyphs.join("");
}

function isHighlightsMissingPdf(target) {
  return Boolean(
    target &&
      target.kind === "error" &&
      typeof target.message === "string" &&
      target.message.startsWith("Reference PDF not found:"),
  );
}

function highlightsHintAction(target) {
  if (!target || target.kind === "none") {
    return Object.freeze({ type: "delegate", page: null, message: null });
  }
  if (
    target.kind === "removed" ||
    target.kind === "missing-highlight" ||
    target.kind === "error"
  ) {
    return Object.freeze({
      type: "explain",
      page: null,
      message: target.message || null,
    });
  }
  if (target.kind === "reading") {
    return Object.freeze({ type: "open", page: null, message: null });
  }
  if (target.kind === "page") {
    return Object.freeze({
      type: "open",
      page: normalizeHighlightsPageOption(target.page),
      message: null,
    });
  }
  return Object.freeze({ type: "delegate", page: null, message: null });
}

function highlightsHintTargetKey(target) {
  if (!target) {
    return "none";
  }
  const rail = target.railLines
    ? `${target.railLines.from}:${target.railLines.to}`
    : "";
  return [
    target.kind || "none",
    target.pdfPath || "",
    target.page == null ? "" : String(target.page),
    target.title || "",
    rail,
  ].join("\0");
}

function freezeHighlightsChipModel(model) {
  return Object.freeze({
    visible: model.visible === true,
    muted: model.muted === true,
    label: model.label || "",
    pageText: model.pageText || "",
    keycap: model.keycap || "",
    tooltip: model.tooltip || "",
    ariaLabel: model.ariaLabel || model.tooltip || "",
    action: model.action || highlightsHintAction(null),
  });
}

function mutedHighlightsChip(label, tooltip, action) {
  const text = tooltip || label;
  return freezeHighlightsChipModel({
    visible: true,
    muted: true,
    label,
    tooltip: text,
    ariaLabel: text,
    action,
  });
}

function highlightsHintChipModel(target, options = {}) {
  const enabled = options.enabled !== false;
  const isMacOS = options.isMacOS === true;
  const mode = options.mode || "source";
  const hasEditor = options.hasEditor !== false;
  const keycap = options.keycap ? String(options.keycap) : "";
  const hidden = freezeHighlightsChipModel({
    visible: false,
    muted: false,
    action: highlightsHintAction(target),
  });
  if (!enabled || !isMacOS || mode !== "source" || !hasEditor) {
    return hidden;
  }
  if (!target || target.kind === "none") {
    return hidden;
  }
  const action = highlightsHintAction(target);
  if (target.kind === "removed") {
    return mutedHighlightsChip("Highlight removed", target.message, action);
  }
  if (target.kind === "missing-highlight") {
    return mutedHighlightsChip("Highlight not found", target.message, action);
  }
  if (isHighlightsMissingPdf(target)) {
    return mutedHighlightsChip("PDF missing", target.message, action);
  }
  if (target.kind === "error") {
    return mutedHighlightsChip("Can't open", target.message, action);
  }
  const title =
    target.title && String(target.title).trim()
      ? String(target.title).trim()
      : "Untitled";
  const page = normalizeHighlightsPageOption(target.page);
  const pageText = page !== null ? ` \u00b7 p. ${page}` : "";
  let tooltip;
  if (target.kind === "reading") {
    tooltip = `Open \u201c${title}\u201d in Highlights \u2014 resumes where you left off`;
  } else if (page !== null) {
    tooltip = `Open \u201c${title}\u201d at page ${page} in Highlights`;
  } else {
    tooltip = `Open \u201c${title}\u201d in Highlights`;
  }
  if (keycap) {
    tooltip += ` (${keycap})`;
  }
  return freezeHighlightsChipModel({
    visible: true,
    muted: false,
    label: "Highlights",
    pageText,
    keycap,
    tooltip,
    ariaLabel: tooltip,
    action,
  });
}

function highlightsHintCacheSet(cache, key, value) {
  if (!cache || typeof cache.set !== "function") {
    return;
  }
  if (cache.has(key) && typeof cache.delete === "function") {
    cache.delete(key);
  }
  cache.set(key, value);
  while (cache.size > HIGHLIGHTS_HINTS_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest && oldest.value !== undefined) {
      cache.delete(oldest.value);
    } else {
      break;
    }
  }
}

function highlightsHintsPrefersReducedMotion() {
  try {
    if (
      typeof window !== "undefined" &&
      window &&
      typeof window.matchMedia === "function"
    ) {
      return Boolean(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
  } catch (_error) {
    return false;
  }
  return false;
}

function highlightsHintSetText(node, text) {
  if (!node) {
    return;
  }
  const value = text == null ? "" : String(text);
  try {
    if (typeof node.setText === "function") {
      node.setText(value);
    } else if ("textContent" in node) {
      node.textContent = value;
    }
  } catch (_error) {
    // Cosmetic.
  }
}

function highlightsHintSetAttr(node, name, value) {
  if (!node || !name) {
    return;
  }
  try {
    if (typeof node.setAttribute === "function") {
      node.setAttribute(name, value);
    } else if (name === "title") {
      node.title = value;
    }
  } catch (_error) {
    // Cosmetic.
  }
}

function highlightsHintToggleClass(node, name, on) {
  if (!node || !name) {
    return;
  }
  try {
    if (node.classList && typeof node.classList.add === "function") {
      if (on) {
        node.classList.add(name);
      } else if (typeof node.classList.remove === "function") {
        node.classList.remove(name);
      }
      return;
    }
    if (typeof node.addClass === "function" && on) {
      node.addClass(name);
      return;
    }
    if (typeof node.removeClass === "function" && !on) {
      node.removeClass(name);
    }
  } catch (_error) {
    // Cosmetic.
  }
}

function highlightsHintCreateChild(parent, tag, className) {
  if (!parent) return null;
  const options = className ? { cls: className } : {};
  try {
    if (tag === "span" && typeof parent.createSpan === "function") {
      return parent.createSpan(options);
    }
    if (typeof parent.createEl === "function") {
      return parent.createEl(tag, options);
    }
  } catch (_error) {
    // Fall through to DOM.
  }
  try {
    const doc =
      parent.ownerDocument ||
      (typeof document !== "undefined" ? document : null);
    if (!doc || typeof doc.createElement !== "function") return null;
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (typeof parent.appendChild === "function") parent.appendChild(node);
    return node;
  } catch (_error) {
    return null;
  }
}

function ensureHighlightsChipDom(el) {
  if (!el) {
    return null;
  }
  try {
    if (
      el._bobHighlightsChipParts &&
      el._bobHighlightsChipParts.icon &&
      el._bobHighlightsChipParts.label
    ) {
      return el._bobHighlightsChipParts;
    }
  } catch (_error) {
    // Rebuild below.
  }
  try {
    if (typeof el.empty === "function") {
      el.empty();
    } else if ("textContent" in el) {
      el.textContent = "";
    }
  } catch (_error) {
    // Rebuild below.
  }
  const icon = highlightsHintCreateChild(el, "span", "bob-highlights-chip-icon");
  const label = highlightsHintCreateChild(
    el,
    "span",
    "bob-highlights-chip-label",
  );
  const page = highlightsHintCreateChild(el, "span", "bob-highlights-chip-page");
  const key = highlightsHintCreateChild(el, "span", "bob-highlights-chip-key");
  if (!icon || !label) {
    return null;
  }
  try {
    applyIcon(icon, "highlighter");
  } catch (_error) {
    // Icon is best-effort.
  }
  highlightsHintSetAttr(icon, "aria-hidden", "true");
  const parts = { icon, label, page, key };
  try {
    el._bobHighlightsChipParts = parts;
  } catch (_error) {
    // Cache is best-effort.
  }
  return parts;
}

function paintHighlightsChip(el, model, previousVisible) {
  if (!el || !model) {
    return null;
  }
  const parts = ensureHighlightsChipDom(el);
  if (!parts) {
    return null;
  }
  highlightsHintToggleClass(el, "is-muted", model.muted === true);
  highlightsHintToggleClass(el, "is-visible", model.visible === true);
  highlightsHintSetAttr(el, "aria-label", model.ariaLabel || "");
  if (model.tooltip) {
    highlightsHintSetAttr(el, "title", model.tooltip);
  } else {
    try {
      if (typeof el.removeAttribute === "function") {
        el.removeAttribute("title");
      }
    } catch (_error) {
      // Cosmetic.
    }
  }
  highlightsHintSetAttr(
    el,
    "role",
    model.visible ? (model.muted ? "status" : "button") : "presentation",
  );
  highlightsHintSetText(parts.label, model.label);
  highlightsHintSetText(parts.page, model.pageText);
  highlightsHintSetText(parts.key, model.keycap);
  highlightsHintToggleClass(parts.page, "is-empty", !model.pageText);
  highlightsHintToggleClass(parts.key, "is-empty", !model.keycap);
  if (model.visible && previousVisible !== true) {
    if (highlightsHintsPrefersReducedMotion()) {
      try {
        if (el.style) {
          el.style.opacity = "1";
        }
      } catch (_error) {
        // Cosmetic.
      }
    } else {
      try {
        if (el.style) {
          el.style.opacity = "0";
        }
      } catch (_error) {
        // Cosmetic.
      }
      const reveal = () => {
        try {
          if (el.style) {
            el.style.opacity = "1";
          }
        } catch (_error) {
          // Cosmetic.
        }
      };
      try {
        if (typeof requestAnimationFrame === "function") {
          return { parts, frame: requestAnimationFrame(reveal) };
        }
      } catch (_error) {
        reveal();
        return parts;
      }
      reveal();
    }
  } else if (!model.visible) {
    try {
      if (el.style) {
        el.style.opacity = "0";
      }
    } catch (_error) {
      // Cosmetic.
    }
  }
  return parts;
}

function highlightsHintFileMtime(file) {
  try {
    if (file && file.stat && typeof file.stat.mtime === "number") {
      return file.stat.mtime;
    }
  } catch (_error) {
    return 0;
  }
  return 0;
}

function highlightsIsMacOS() {
  try {
    if (obsidian && obsidian.Platform && obsidian.Platform.isMacOS === true) {
      return true;
    }
  } catch (_error) {
    // Fall through.
  }
  try {
    if (typeof Platform !== "undefined" && Platform && Platform.isMacOS === true) {
      return true;
    }
  } catch (_error) {
    return false;
  }
  return false;
}

class BobNavigationHotkeysHighlightsHintsMixin {
  setupHighlightsHints() {
    try {
      if (this.highlightsChipEl) {
        return;
      }
      this.highlightsHintsEnabled =
        this.highlightsHintsEnabled === undefined
          ? true
          : this.highlightsHintsEnabled !== false;
      this._highlightsHintTarget = null;
      this._highlightsHintsToken = 0;
      this._highlightsHintsTimer = null;
      this._highlightsHintLocalCache = new Map();
      this._highlightsHintHopCache = new Map();
      this._highlightsRailView = null;
      this._highlightsChipFadeFrame = null;
      this.highlightsChipPaintKey = null;
      if (!highlightsIsMacOS()) {
        return;
      }
      if (typeof this.addStatusBarItem !== "function") {
        return;
      }
      let el = null;
      try {
        el = this.addStatusBarItem();
      } catch (_error) {
        return;
      }
      if (!el) {
        return;
      }
      this.highlightsChipEl = el;
      try {
        if (typeof el.addClass === "function") {
          el.addClass("bob-highlights-chip");
        } else if (el.classList && typeof el.classList.add === "function") {
          el.classList.add("bob-highlights-chip");
        }
      } catch (_error) {
        // Cosmetic.
      }
      try {
        if (el.style && typeof el.style.setProperty === "function") {
          el.style.setProperty("--bob-highlights-ink", HIGHLIGHTS_INK);
        }
      } catch (_error) {
        // Cosmetic.
      }
      this.highlightsChipParts = ensureHighlightsChipDom(el);
      const onClick = () => {
        try {
          const target = this._highlightsHintTarget;
          if (!target) {
            return;
          }
          return this.openHighlightsTarget(target, { fromHint: true });
        } catch (_error) {
          // Clicks never throw.
        }
      };
      try {
        if (typeof this.registerDomEvent === "function") {
          this.registerDomEvent(el, "click", onClick);
        } else if (typeof el.addEventListener === "function") {
          el.addEventListener("click", onClick);
        } else {
          el._bobHighlightsChipClick = onClick;
        }
      } catch (_error) {
        // Listeners are best-effort.
      }
      try {
        this.refreshHighlightsHints();
      } catch (_error) {
        // Paint never blocks the mount.
      }
    } catch (_error) {
      // The chip never blocks startup.
    }
  }

  toggleHighlightsHints() {
    this.highlightsHintsEnabled = this.highlightsHintsEnabled === false;
    this._highlightsHintsToken = (this._highlightsHintsToken || 0) + 1;
    if (this.highlightsHintsEnabled === false) {
      this.clearHighlightsHints();
      return;
    }
    void this.refreshHighlightsHints();
  }

  scheduleHighlightsHintsFromUpdate(update) {
    if (!update || (!update.selectionSet && !update.docChanged)) {
      return;
    }
    this.scheduleHighlightsHints();
  }

  scheduleHighlightsHints() {
    try {
      if (this._highlightsHintsTimer) {
        clearTimeout(this._highlightsHintsTimer);
        this._highlightsHintsTimer = null;
      }
    } catch (_error) {
      this._highlightsHintsTimer = null;
    }
    try {
      this._highlightsHintsTimer = setTimeout(() => {
        this._highlightsHintsTimer = null;
        void this.refreshHighlightsHints();
      }, HIGHLIGHTS_HINTS_DEBOUNCE_MS);
    } catch (_error) {
      void this.refreshHighlightsHints();
    }
  }

  async refreshHighlightsHints() {
    const token = (this._highlightsHintsToken || 0) + 1;
    this._highlightsHintsToken = token;
    try {
      if (this.highlightsHintsEnabled === false || !highlightsIsMacOS()) {
        this.clearHighlightsHints();
        return;
      }
      const context = this.getRefPdfEditorContext();
      if (!context) {
        this.clearHighlightsHints();
        return;
      }
      const target = await this._resolveHighlightsHintTarget(context);
      if (token !== this._highlightsHintsToken) {
        return;
      }
      this._paintHighlightsHints(target, context);
    } catch (_error) {
      if (token === this._highlightsHintsToken) {
        this.clearHighlightsHints();
      }
    }
  }

  async _resolveHighlightsHintTarget(context) {
    const editor = context && context.editor;
    const file = context && context.file;
    const filePath = normalizeVaultRelativePath(file && file.path) || "";
    const content =
      editor && typeof editor.getValue === "function" ? editor.getValue() : "";
    const cursor =
      editor && typeof editor.getCursor === "function"
        ? editor.getCursor()
        : null;
    const lineIndex =
      cursor && Number.isInteger(cursor.line) ? cursor.line : -1;
    const version = `${filePath}\0${content.length}\0${highlightsHintHash(content)}`;
    const localKey = `${version}\0${lineIndex}`;
    const localCache = this._highlightsHintLocalCache || new Map();
    this._highlightsHintLocalCache = localCache;
    if (localCache.has(localKey)) {
      return localCache.get(localKey);
    }

    const lineText = String(String(content).split(/\r?\n/)[lineIndex] || "");
    const bookmark = parseRefBookmarkLink(lineText);
    const hopCache = this._highlightsHintHopCache || new Map();
    this._highlightsHintHopCache = hopCache;
    if (bookmark) {
      let hopPath = filePath;
      if (bookmark.target) {
        try {
          const targetFile = this.resolveLinkTargetFile(
            bookmark.target,
            filePath,
          );
          hopPath = normalizeVaultRelativePath(targetFile && targetFile.path) || "";
        } catch (_error) {
          hopPath = bookmark.target;
        }
      }
      const hopFile =
        this.app &&
        this.app.vault &&
        typeof this.app.vault.getAbstractFileByPath === "function"
          ? this.app.vault.getAbstractFileByPath(hopPath)
          : null;
      const hopKey = `${hopPath}\0${highlightsHintFileMtime(hopFile)}\0${bookmark.blockId}`;
      if (hopCache.has(hopKey)) {
        const cached = hopCache.get(hopKey);
        highlightsHintCacheSet(localCache, localKey, cached);
        return cached;
      }
      const resolved = await this.resolveHighlightsTargetAtCursor(editor, file, {
        dry: true,
      });
      highlightsHintCacheSet(hopCache, hopKey, resolved);
      highlightsHintCacheSet(localCache, localKey, resolved);
      return resolved;
    }

    const resolved = await this.resolveHighlightsTargetAtCursor(editor, file, {
      dry: true,
    });
    highlightsHintCacheSet(localCache, localKey, resolved);
    return resolved;
  }

  _paintHighlightsHints(target, context) {
    const keycap = formatHighlightsHotkey(
      getHighlightsCommandHotkey(this.app),
    );
    const mode =
      context &&
      context.editor &&
      this.app &&
      this.app.workspace &&
      this.app.workspace.getActiveViewOfType
        ? (() => {
            try {
              const view = this.app.workspace.getActiveViewOfType(MarkdownView);
              return view && typeof view.getMode === "function"
                ? view.getMode()
                : "source";
            } catch (_error) {
              return "source";
            }
          })()
        : "source";
    const model = highlightsHintChipModel(target, {
      enabled: this.highlightsHintsEnabled !== false,
      isMacOS: highlightsIsMacOS(),
      mode,
      hasEditor: Boolean(context && context.editor),
      keycap,
    });
    const paintKey = `${highlightsHintTargetKey(target)}\0${model.visible}\0${model.muted}\0${model.keycap}\0${model.pageText}`;
    if (paintKey === this.highlightsChipPaintKey) {
      this._highlightsHintTarget = target || null;
      return;
    }
    this.highlightsChipPaintKey = paintKey;
    this._highlightsHintTarget = model.visible ? target || null : null;
    const previousVisible = this.highlightsChipEl
      ? this.highlightsChipEl.classList &&
        typeof this.highlightsChipEl.classList.contains === "function"
        ? this.highlightsChipEl.classList.contains("is-visible")
        : Boolean(this._highlightsChipWasVisible)
      : false;
    this._highlightsChipWasVisible = model.visible;
    if (this.highlightsChipEl) {
      if (this._highlightsChipFadeFrame != null) {
        try {
          cancelAnimationFrame(this._highlightsChipFadeFrame);
        } catch (_error) {
          // Best-effort.
        }
        this._highlightsChipFadeFrame = null;
      }
      const painted = paintHighlightsChip(
        this.highlightsChipEl,
        model,
        previousVisible,
      );
      if (painted && painted.frame != null) {
        this._highlightsChipFadeFrame = painted.frame;
        this.highlightsChipParts = painted.parts;
      } else if (painted && painted.parts) {
        this.highlightsChipParts = painted.parts;
      } else {
        this.highlightsChipParts = painted;
      }
    }
    if (model.visible && target && target.railLines && context && context.editor) {
      this._setHighlightsRail(context.editor, target.railLines);
    } else {
      this._setHighlightsRail(context && context.editor, null);
    }
  }

  _setHighlightsRail(editor, railLines) {
    const editorView = getEditorViewFromEditor(editor);
    if (
      this._highlightsRailView &&
      this._highlightsRailView !== editorView
    ) {
      this._dispatchHighlightsRail(this._highlightsRailView, null);
    }
    this._highlightsRailView = editorView || null;
    this._dispatchHighlightsRail(editorView, railLines);
  }

  _dispatchHighlightsRail(editorView, railLines) {
    if (
      !editorView ||
      !bobHighlightsRailEffect ||
      typeof editorView.dispatch !== "function"
    ) {
      return;
    }
    try {
      if (!railLines) {
        editorView.dispatch({
          effects: bobHighlightsRailEffect.of({ clear: true }),
        });
        return;
      }
      const from = Number(railLines.from);
      const to = Number(railLines.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
        editorView.dispatch({
          effects: bobHighlightsRailEffect.of({ clear: true }),
        });
        return;
      }
      editorView.dispatch({
        effects: bobHighlightsRailEffect.of({ from, to, clear: false }),
      });
    } catch (_error) {
      // The rail is cosmetic.
    }
  }

  clearHighlightsHints() {
    this._highlightsHintTarget = null;
    this.highlightsChipPaintKey = null;
    this._highlightsChipWasVisible = false;
    if (this.highlightsChipEl) {
      const hidden = highlightsHintChipModel(null, {
        enabled: false,
        isMacOS: true,
        hasEditor: true,
      });
      paintHighlightsChip(this.highlightsChipEl, hidden, true);
    }
    this._setHighlightsRail(null, null);
    if (this._highlightsRailView) {
      this._dispatchHighlightsRail(this._highlightsRailView, null);
      this._highlightsRailView = null;
    }
  }

  teardownHighlightsHints() {
    try {
      if (this._highlightsHintsTimer) {
        clearTimeout(this._highlightsHintsTimer);
        this._highlightsHintsTimer = null;
      }
    } catch (_error) {
      this._highlightsHintsTimer = null;
    }
    try {
      if (this._highlightsChipFadeFrame != null) {
        cancelAnimationFrame(this._highlightsChipFadeFrame);
      }
    } catch (_error) {
      // Best-effort.
    }
    this._highlightsChipFadeFrame = null;
    this._highlightsHintsToken = (this._highlightsHintsToken || 0) + 1;
    try {
      this.clearHighlightsHints();
    } catch (_error) {
      // Best-effort during unload.
    }
    try {
      if (this.highlightsChipEl && typeof this.highlightsChipEl.empty === "function") {
        this.highlightsChipEl.empty();
      }
    } catch (_error) {
      // Best-effort.
    }
    this.highlightsChipEl = null;
    this.highlightsChipParts = null;
    this._highlightsHintLocalCache = null;
    this._highlightsHintHopCache = null;
  }
}
