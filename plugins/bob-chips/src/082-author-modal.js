// Make-or-edit chip modal for both kinds. Theme-variable card; payloads are
// never assigned to HTML strings or DOM attributes. The Kind row switches
// Copy | Run without touching Label or Text; Run adds live per-step
// validation from Command Mode's pure `resolve` and the Add bob fix.
const COPY_CHIP_AUTHOR_FOOTER = "⏎ save · ⇧⏎ newline · Tab next field · Esc cancel";
const RUN_CHIP_AUTHOR_FOOTER = "⏎ save · ⇧⏎ new step · Tab next field · Esc cancel";
const COPY_CHIP_AUTHOR_LABEL_PLACEHOLDER = "optional — shown instead of the text";
const RUN_CHIP_AUTHOR_COMMAND_PLACEHOLDER = "bob task reconcile";
const COPY_CHIP_AUTHOR_KIND_TITLES = copyChipFreeze({ copy: "COPY CHIP", run: "COMMAND CHIP" });
const COPY_CHIP_AUTHOR_KIND_GLYPHS = copyChipFreeze({ copy: "copy", run: "play" });
const COPY_CHIP_AUTHOR_STEP_MARKS = copyChipFreeze({ ok: "✓", invalid: "✗", warn: "⚠", unchecked: "·" });
const COPY_CHIP_AUTHOR_SUBTITLES = copyChipFreeze({
  edit: "Editing the chip at the cursor",
  select: "From the selection",
  convert: "From the code span",
  insert: "At the cursor",
});

function copyChipAuthorOwnerDoc(modal) {
  try {
    if (modal && modal.contentEl && modal.contentEl.ownerDocument) return modal.contentEl.ownerDocument;
    if (modal && modal.modalEl && modal.modalEl.ownerDocument) return modal.modalEl.ownerDocument;
    if (modal && modal.app && modal.app.workspace && modal.app.workspace.containerEl) {
      const host = modal.app.workspace.containerEl;
      if (host && host.ownerDocument) return host.ownerDocument;
    }
    if (typeof document !== "undefined") return document;
  } catch (error) {
    // Fall through.
  }
  return null;
}

function copyChipAuthorMakeEl(doc, tag, className) {
  try {
    if (!doc || typeof doc.createElement !== "function") return null;
    const el = doc.createElement(tag);
    try {
      if (className) el.setAttribute("class", className);
    } catch (error) {
      // Class setup is best-effort.
    }
    return el;
  } catch (error) {
    return null;
  }
}

function copyChipAuthorSetText(el, text) {
  try {
    if (el) el.textContent = text == null ? "" : String(text);
  } catch (error) {
    // Text assignment is best-effort.
  }
}

function copyChipAuthorToggleClass(el, name, on) {
  try {
    if (!el || !el.classList) return;
    if (on) el.classList.add(name);
    else el.classList.remove(name);
  } catch (error) {
    // Class changes are best-effort.
  }
}

function copyChipAuthorAttr(el, name, value) {
  try {
    if (el && typeof el.setAttribute === "function") el.setAttribute(name, String(value));
  } catch (error) {
    // Attributes are best-effort.
  }
}

// What one Run step row says after its mark: catalog title (or the step
// text), then effect and policy note, or the reason it fails.
function copyChipAuthorStepMeta(row) {
  try {
    if (!row) return "";
    if (row.mark === "ok") return [row.effect, row.note].filter(Boolean).join(" · ");
    if (row.mark === "invalid" && row.fixable) return (row.reason || "") + " · Add bob fixes it";
    return row.reason || "";
  } catch (error) {
    return "";
  }
}

function copyChipAuthorGrowTextarea(el) {
  try {
    if (!el) return;
    el.style.height = "auto";
    const scroll = Number(el.scrollHeight) || 0;
    if (scroll > 0) el.style.height = String(scroll) + "px";
  } catch (error) {
    // Auto-grow is best-effort.
  }
}

class CopyChipAuthorModal extends CopyChipsModal {
  constructor(app, options) {
    super(app);
    const opts = options && typeof options === "object" ? options : {};
    this.copyChipPlugin = opts.plugin || null;
    this.copyChipSnapshot = opts.snapshot || null;
    this.copyChipIdentity = opts.identity || null;
    this.copyChipClipboardPromise = opts.clipboardPromise || null;
    this.copyChipOnSave = typeof opts.onSave === "function" ? opts.onSave : null;
    // `engine()` returns `{ resolve, reason }`; injected by tests, otherwise
    // Command Mode is looked up fresh on every refresh.
    const plugin = this.copyChipPlugin;
    this.copyChipEngineSource = typeof opts.engine === "function" ? opts.engine : () => runChipAuthorEngine(plugin);
    this.copyChipKind = copyChipAuthorKind(this.copyChipSnapshot && this.copyChipSnapshot.kind);
    this.copyChipKindTouched = false;
    this.copyChipClosed = false;
    this.copyChipSaving = false;
    this.copyChipTypedText = false;
    this.copyChipClipboardGen = 0;
    this.copyChipScopeRefs = [];
    this.copyChipKeyHandler = null;
    this.copyChipCatalogOff = null;
    this.copyChipLastDraft = null;
    this.iconEl = null;
    this.titleEl = null;
    this.subtitleEl = null;
    this.kindEl = null;
    this.kindButtons = null;
    this.labelEl = null;
    this.textEl = null;
    this.textNameEl = null;
    this.stepsRow = null;
    this.stepsEl = null;
    this.addBobEl = null;
    this.previewHost = null;
    this.captionEl = null;
    this.markdownEl = null;
    this.statusEl = null;
    this.footerEl = null;
    this.previewChip = null;
  }

  onOpen() {
    try {
      this.copyChipClosed = false;
      this.copyChipSaving = false;
      const doc = copyChipAuthorOwnerDoc(this);
      const content = this.contentEl;
      if (content && typeof content.empty === "function") {
        try {
          content.empty();
        } catch (error) {
          try {
            content.textContent = "";
          } catch (ignore) {
            // Emptying is best-effort.
          }
        }
      }
      try {
        if (this.modalEl && typeof this.modalEl.addClass === "function") {
          this.modalEl.addClass("bob-copy-author-modal");
        } else if (this.modalEl && this.modalEl.classList) {
          this.modalEl.classList.add("bob-copy-author-modal");
        }
      } catch (error) {
        // Class setup is best-effort.
      }
      copyChipAuthorAttr(this.modalEl, "role", "dialog");
      copyChipAuthorAttr(this.modalEl, "aria-modal", "true");
      copyChipAuthorToggleClass(content, "bob-copy-author", true);
      this.copyChipRender(doc, content);
      this.copyChipWireKeys();
      try {
        this.copyChipCatalogOff = commandChipOnCatalogChanged(this.copyChipPlugin, () => this.copyChipRefresh());
      } catch (error) {
        this.copyChipCatalogOff = null;
      }
      this.copyChipStartClipboard();
      this.copyChipFocusInitial();
    } catch (error) {
      // Opening never throws.
    }
  }

  copyChipRenderKind(doc, fields) {
    const row = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-row bob-copy-author-row-kind");
    const name = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-field-name");
    copyChipAuthorSetText(name, "Kind");
    this.kindEl = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-kind");
    copyChipAuthorAttr(this.kindEl, "role", "radiogroup");
    copyChipAuthorAttr(this.kindEl, "aria-label", "Kind");
    this.kindButtons = {};
    for (const [kind, text] of [["copy", "Copy"], ["run", "Run"]]) {
      const button = copyChipAuthorMakeEl(doc, "button", "bob-copy-author-kind-option");
      if (!button) continue;
      copyChipAuthorAttr(button, "type", "button");
      copyChipAuthorAttr(button, "role", "radio");
      const glyph = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-kind-glyph");
      if (glyph) {
        copyChipAuthorAttr(glyph, "aria-hidden", "true");
        try {
          copyChipPaintGlyph(glyph, COPY_CHIP_AUTHOR_KIND_GLYPHS[kind]);
        } catch (error) {
          // Glyph is best-effort.
        }
        button.appendChild(glyph);
      }
      const label = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-kind-text");
      copyChipAuthorSetText(label, text);
      if (label) button.appendChild(label);
      try {
        button.addEventListener("click", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") event.preventDefault();
          } catch (ignore) {
            // Default suppression is best-effort.
          }
          this.copyChipSetKind(kind, { user: true, focus: true });
        });
      } catch (error) {
        // Listener setup is best-effort.
      }
      this.kindButtons[kind] = button;
      if (this.kindEl) this.kindEl.appendChild(button);
    }
    if (row && name) row.appendChild(name);
    if (row && this.kindEl) row.appendChild(this.kindEl);
    if (fields && row) fields.appendChild(row);
  }

  copyChipRenderSteps(doc, fields) {
    this.stepsRow = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-row bob-copy-author-row-steps");
    const name = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-field-name");
    copyChipAuthorSetText(name, "Steps");
    const column = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-steps-column");
    this.stepsEl = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-steps");
    copyChipAuthorAttr(this.stepsEl, "role", "list");
    copyChipAuthorAttr(this.stepsEl, "aria-live", "polite");
    this.addBobEl = copyChipAuthorMakeEl(doc, "button", "bob-copy-author-add-bob is-hidden");
    copyChipAuthorAttr(this.addBobEl, "type", "button");
    copyChipAuthorSetText(this.addBobEl, "Add bob");
    try {
      if (this.addBobEl) {
        this.addBobEl.addEventListener("click", (event) => {
          try {
            if (event && typeof event.preventDefault === "function") event.preventDefault();
          } catch (ignore) {
            // Default suppression is best-effort.
          }
          this.copyChipAddBob();
        });
      }
    } catch (error) {
      // Listener setup is best-effort.
    }
    if (column && this.stepsEl) column.appendChild(this.stepsEl);
    if (column && this.addBobEl) column.appendChild(this.addBobEl);
    if (this.stepsRow && name) this.stepsRow.appendChild(name);
    if (this.stepsRow && column) this.stepsRow.appendChild(column);
    if (fields && this.stepsRow) fields.appendChild(this.stepsRow);
  }

  copyChipRender(doc, content) {
    try {
      if (!doc || !content) return;
      const snap = this.copyChipSnapshot || copyChipAuthorSnapshot({});
      const header = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-header");
      this.iconEl = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-icon");
      if (header && this.iconEl) header.appendChild(this.iconEl);
      const headerText = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-header-text");
      this.titleEl = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-title");
      this.subtitleEl = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-subtitle");
      copyChipAuthorSetText(this.subtitleEl, COPY_CHIP_AUTHOR_SUBTITLES[snap.mode] || "");
      if (headerText && this.titleEl) headerText.appendChild(this.titleEl);
      if (headerText && this.subtitleEl) headerText.appendChild(this.subtitleEl);
      if (header && headerText) header.appendChild(headerText);
      if (header) content.appendChild(header);

      const fields = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-fields");
      this.copyChipRenderKind(doc, fields);
      const labelRow = copyChipAuthorMakeEl(doc, "label", "bob-copy-author-row");
      const labelName = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-field-name");
      copyChipAuthorSetText(labelName, "Label");
      this.labelEl = copyChipAuthorMakeEl(doc, "input", "bob-copy-author-label");
      try {
        if (this.labelEl) {
          this.labelEl.setAttribute("type", "text");
          this.labelEl.setAttribute("spellcheck", "false");
          this.labelEl.setAttribute("placeholder", COPY_CHIP_AUTHOR_LABEL_PLACEHOLDER);
          this.labelEl.value = snap.label || "";
        }
      } catch (error) {
        // Input setup is best-effort.
      }
      if (labelRow && labelName) labelRow.appendChild(labelName);
      if (labelRow && this.labelEl) labelRow.appendChild(this.labelEl);
      if (fields && labelRow) fields.appendChild(labelRow);

      const textRow = copyChipAuthorMakeEl(doc, "label", "bob-copy-author-row bob-copy-author-row-text");
      this.textNameEl = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-field-name");
      this.textEl = copyChipAuthorMakeEl(doc, "textarea", "bob-copy-author-text");
      try {
        if (this.textEl) {
          this.textEl.setAttribute("spellcheck", "false");
          this.textEl.setAttribute("wrap", "off");
          this.textEl.value = snap.text || "";
        }
      } catch (error) {
        // Textarea setup is best-effort.
      }
      if (textRow && this.textNameEl) textRow.appendChild(this.textNameEl);
      if (textRow && this.textEl) textRow.appendChild(this.textEl);
      if (fields && textRow) fields.appendChild(textRow);
      this.copyChipRenderSteps(doc, fields);
      if (fields) content.appendChild(fields);

      const previewRow = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-preview-row");
      const previewLabel = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-field-name");
      copyChipAuthorSetText(previewLabel, "Preview");
      this.previewHost = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-preview");
      this.captionEl = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-caption");
      if (previewRow && previewLabel) previewRow.appendChild(previewLabel);
      if (previewRow && this.previewHost) previewRow.appendChild(this.previewHost);
      if (previewRow && this.captionEl) previewRow.appendChild(this.captionEl);
      if (previewRow) content.appendChild(previewRow);

      const mdRow = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-markdown-row");
      const mdLabel = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-field-name");
      copyChipAuthorSetText(mdLabel, "Markdown");
      this.markdownEl = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-markdown");
      if (mdRow && mdLabel) mdRow.appendChild(mdLabel);
      if (mdRow && this.markdownEl) mdRow.appendChild(this.markdownEl);
      if (mdRow) content.appendChild(mdRow);

      this.statusEl = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-status");
      copyChipAuthorAttr(this.statusEl, "aria-live", "polite");
      if (this.statusEl) content.appendChild(this.statusEl);

      this.footerEl = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-footer");
      if (this.footerEl) content.appendChild(this.footerEl);

      const self = this;
      const onInput = (kind) => () => {
        try {
          if (kind === "text") self.copyChipTypedText = true;
          self.copyChipRefresh();
        } catch (error) {
          // Input handling never throws.
        }
      };
      try {
        if (this.labelEl && typeof this.labelEl.addEventListener === "function") {
          this.labelEl.addEventListener("input", onInput("label"));
        }
        if (this.textEl && typeof this.textEl.addEventListener === "function") {
          this.textEl.addEventListener("input", onInput("text"));
        }
      } catch (error) {
        // Listener setup is best-effort.
      }
      this.copyChipRefresh();
    } catch (error) {
      // Rendering never throws.
    }
  }

  copyChipEngine() {
    try {
      const engine = this.copyChipEngineSource();
      if (engine && typeof engine === "object") return engine;
    } catch (error) {
      // A broken lookup reads as no Command Mode.
    }
    return { resolve: null, reason: RUN_CHIP_AUTHOR_UNCHECKED };
  }

  copyChipDraft() {
    try {
      const label = this.labelEl ? String(this.labelEl.value || "") : "";
      const text = this.textEl ? String(this.textEl.value || "") : "";
      const options = { kind: this.copyChipKind };
      if (this.copyChipKind === "run") {
        const engine = this.copyChipEngine();
        options.resolve = engine.resolve;
        options.uncheckedReason = engine.reason;
      }
      return copyChipAuthorDraftState(this.copyChipSnapshot, label, text, options);
    } catch (error) {
      return copyChipAuthorDraftState(this.copyChipSnapshot, "", "", { kind: this.copyChipKind });
    }
  }

  // Everything that depends on the kind: title, glyph, aria label, the Kind
  // control's roving tab stop, the Text field's name, the Steps row, and
  // the footer.
  copyChipPaintKind() {
    const kind = this.copyChipKind;
    const run = kind === "run";
    const snap = this.copyChipSnapshot || {};
    copyChipAuthorSetText(this.titleEl, COPY_CHIP_AUTHOR_KIND_TITLES[kind]);
    try {
      if (this.iconEl) copyChipPaintGlyph(this.iconEl, COPY_CHIP_AUTHOR_KIND_GLYPHS[kind]);
    } catch (error) {
      // Glyph is best-effort.
    }
    copyChipAuthorAttr(this.modalEl, "aria-label", copyChipAuthorTitle(snap.mode, kind));
    copyChipAuthorToggleClass(this.modalEl, "is-run", run);
    for (const [name, button] of Object.entries(this.kindButtons || {})) {
      const active = name === kind;
      copyChipAuthorAttr(button, "aria-checked", active ? "true" : "false");
      copyChipAuthorAttr(button, "tabindex", active ? "0" : "-1");
      copyChipAuthorToggleClass(button, "is-active", active);
    }
    copyChipAuthorSetText(this.textNameEl, run ? "Command" : "Text");
    try {
      if (this.textEl) {
        if (run) this.textEl.setAttribute("placeholder", RUN_CHIP_AUTHOR_COMMAND_PLACEHOLDER);
        else if (typeof this.textEl.removeAttribute === "function") this.textEl.removeAttribute("placeholder");
        else this.textEl.setAttribute("placeholder", "");
      }
    } catch (error) {
      // Placeholder is best-effort.
    }
    copyChipAuthorToggleClass(this.stepsRow, "is-hidden", !run);
    copyChipAuthorSetText(this.footerEl, run ? RUN_CHIP_AUTHOR_FOOTER : COPY_CHIP_AUTHOR_FOOTER);
  }

  copyChipPaintSteps(draft) {
    const list = this.stepsEl;
    if (!list) return;
    const run = draft && draft.run;
    copyChipAuthorSetText(list, "");
    const doc = copyChipAuthorOwnerDoc(this);
    const rows = run && Array.isArray(run.steps) ? run.steps : [];
    for (const row of rows) {
      const el = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-step is-" + row.mark);
      if (!el) continue;
      copyChipAuthorAttr(el, "role", "listitem");
      const mark = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-step-mark");
      copyChipAuthorAttr(mark, "aria-hidden", "true");
      copyChipAuthorSetText(mark, COPY_CHIP_AUTHOR_STEP_MARKS[row.mark] || "·");
      const main = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-step-title" + (row.title ? "" : " is-command"));
      copyChipAuthorSetText(main, row.title || row.text);
      const meta = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-step-meta");
      copyChipAuthorSetText(meta, copyChipAuthorStepMeta(row));
      for (const child of [mark, main, meta]) {
        if (child) el.appendChild(child);
      }
      list.appendChild(el);
    }
    copyChipAuthorToggleClass(list, "is-empty", rows.length === 0);
    copyChipAuthorToggleClass(this.addBobEl, "is-hidden", !(draft && draft.addBob));
  }

  copyChipRefresh() {
    try {
      const draft = this.copyChipDraft();
      this.copyChipLastDraft = draft;
      this.copyChipPaintKind();
      this.copyChipPaintSteps(draft);
      copyChipAuthorGrowTextarea(this.textEl);
      copyChipAuthorSetText(this.captionEl, draft.caption || "");
      copyChipAuthorSetText(this.markdownEl, draft.markdown || "");
      const message = draft.valid ? (draft.warning || "") : (draft.reason || "");
      copyChipAuthorSetText(this.statusEl, message);
      copyChipAuthorToggleClass(this.statusEl, "is-invalid", !draft.valid);
      copyChipAuthorToggleClass(this.statusEl, "is-warning", Boolean(draft.valid && draft.warning));
      this.copyChipPaintPreview(draft);
    } catch (error) {
      // Refresh never throws.
    }
  }

  // The inert preview paint for a Run draft: the verdict the finished chip
  // would get on this host, never a run state.
  copyChipRunPreviewPaint(chip) {
    try {
      const engine = this.copyChipEngine();
      if (typeof engine.resolve !== "function") return null;
      const verdict = runChipAuthorResolveOne(engine.resolve, chip.text);
      let face = "loading";
      if (verdict.state === "ready") face = "ready";
      else if (verdict.state === "invalid" || verdict.state === "unavailable") face = "unavailable";
      return copyChipFreeze({
        face,
        mode: "run",
        reason: face === "unavailable" ? verdict.reason : null,
        verdict,
        key: null,
        snapshot: null,
        armed: false,
        sourcePath: null,
      });
    } catch (error) {
      return null;
    }
  }

  copyChipPaintPreview(draft) {
    try {
      const host = this.previewHost;
      if (!host) return;
      try {
        host.textContent = "";
      } catch (error) {
        // Clearing is best-effort.
      }
      this.previewChip = null;
      const doc = copyChipAuthorOwnerDoc(this);
      if (!doc || !draft || !draft.markdown) return;
      const chip = {
        label: draft.label && String(draft.label).trim() !== "" ? String(draft.label).trim() : null,
        text: copyChipNormalizeNewlines(draft.text),
      };
      let el = null;
      try {
        if (draft.kind === "run") {
          const paint = this.copyChipRunPreviewPaint(chip);
          if (draft.previewKind === "block") {
            el = commandFenceBuild(doc, chip, { interactive: false });
            if (el) commandFencePaint(el, paint, { chip });
          } else {
            el = commandChipBuildInline(doc, chip, { interactive: false });
            if (el) commandChipPaint(el, paint, { chip, plugin: this.copyChipPlugin });
          }
          if (el) copyChipAuthorAttr(el, "tabindex", "-1");
        } else if (draft.previewKind === "block") {
          el = copyChipBuildFence(doc, chip, { interactive: false });
        } else {
          el = copyChipBuildInline(doc, chip, { interactive: false });
        }
      } catch (error) {
        el = null;
      }
      if (el) {
        try {
          host.appendChild(el);
        } catch (error) {
          // Preview mount is best-effort.
        }
        this.previewChip = el;
      }
    } catch (error) {
      // Preview painting never throws.
    }
  }

  // Switch kinds, keeping Label and Text. `user` marks a deliberate choice
  // (a late clipboard default never overrides it); `focus` keeps keyboard
  // focus on the newly active option.
  copyChipSetKind(kind, options) {
    try {
      const next = copyChipAuthorKind(kind);
      const opts = options && typeof options === "object" ? options : {};
      if (opts.user === true) this.copyChipKindTouched = true;
      if (next !== this.copyChipKind) {
        this.copyChipKind = next;
        this.copyChipRefresh();
      }
      if (opts.focus === true) {
        const button = this.kindButtons && this.kindButtons[next];
        if (button && typeof button.focus === "function") button.focus();
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  copyChipAddBob() {
    try {
      const draft = this.copyChipDraft();
      if (!draft || !draft.addBob || !this.textEl) return false;
      this.textEl.value = draft.addBob.text;
      this.copyChipTypedText = true;
      this.copyChipRefresh();
      try {
        if (typeof this.textEl.focus === "function") this.textEl.focus();
        const end = String(this.textEl.value || "").length;
        if (typeof this.textEl.setSelectionRange === "function") this.textEl.setSelectionRange(end, end);
      } catch (error) {
        // Focus is best-effort.
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  copyChipWireKeys() {
    try {
      const modal = this;
      if (!modal.scope || typeof modal.scope.register !== "function") return;
      const handler = (event) => modal.copyChipOnKey(event);
      this.copyChipKeyHandler = handler;
      try {
        const ref = modal.scope.register(null, null, handler);
        this.copyChipScopeRefs.push(ref);
      } catch (error) {
        // Catch-all scope is best-effort.
      }
    } catch (error) {
      // Key wiring never throws.
    }
  }

  copyChipUnwireKeys() {
    try {
      if (this.scope && typeof this.scope.unregister === "function") {
        for (const ref of this.copyChipScopeRefs) {
          try {
            this.scope.unregister(ref);
          } catch (error) {
            // Unregister is best-effort.
          }
        }
      }
      this.copyChipScopeRefs = [];
      this.copyChipKeyHandler = null;
    } catch (error) {
      // Unwiring never throws.
    }
  }

  copyChipTargetIsKind(target) {
    try {
      if (!target) return false;
      if (target === this.kindEl) return true;
      for (const button of Object.values(this.kindButtons || {})) {
        if (button === target) return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  copyChipOnKey(event) {
    try {
      if (!event) return true;
      const target = event.target || null;
      const inField = copyChipAuthorTargetIsField(target);
      const inText = Boolean(this.textEl && (target === this.textEl));
      const onKind = this.copyChipTargetIsKind(target);
      const onButton = Boolean(this.addBobEl && target === this.addBobEl);
      const action = copyChipAuthorKeyAction(event, { inField, inText, onKind, onButton });
      if (!action || action.type === "ignore" || action.type === "type") return true;
      try {
        if (typeof event.preventDefault === "function") event.preventDefault();
      } catch (error) {
        // Consumption is best-effort.
      }
      try {
        if (typeof event.stopPropagation === "function") event.stopPropagation();
      } catch (error) {
        // Consumption is best-effort.
      }
      if (action.type === "save") {
        this.copyChipSave();
        return false;
      }
      if (action.type === "cancel") {
        this.copyChipCancel();
        return false;
      }
      if (action.type === "newline") {
        this.copyChipInsertNewline();
        return false;
      }
      if (action.type === "next-field" || action.type === "prev-field") {
        this.copyChipCycleField(action.type === "prev-field");
        return false;
      }
      if (action.type === "kind-prev" || action.type === "kind-next" || action.type === "kind-toggle") {
        let kind = this.copyChipKind === "run" ? "copy" : "run";
        if (action.type === "kind-prev") kind = "copy";
        if (action.type === "kind-next") kind = "run";
        this.copyChipSetKind(kind, { user: true, focus: true });
        return false;
      }
      if (action.type === "press") {
        this.copyChipAddBob();
        return false;
      }
      return false;
    } catch (error) {
      return true;
    }
  }

  copyChipInsertNewline() {
    try {
      const el = this.textEl;
      if (!el) return;
      const value = String(el.value || "");
      let start = 0;
      let end = 0;
      try {
        start = Number.isInteger(el.selectionStart) ? el.selectionStart : value.length;
        end = Number.isInteger(el.selectionEnd) ? el.selectionEnd : start;
      } catch (error) {
        start = value.length;
        end = start;
      }
      el.value = value.slice(0, start) + "\n" + value.slice(end);
      try {
        const pos = start + 1;
        if (typeof el.setSelectionRange === "function") el.setSelectionRange(pos, pos);
      } catch (error) {
        // Caret restore is best-effort.
      }
      this.copyChipTypedText = true;
      this.copyChipRefresh();
    } catch (error) {
      // Newline insertion never throws.
    }
  }

  // The Tab cycle: Kind (its active option), Label, Text, and Add bob while
  // it shows. Focus outside the cycle enters at Label.
  copyChipFocusables() {
    const out = [];
    try {
      const kindButton = this.kindButtons && this.kindButtons[this.copyChipKind];
      if (kindButton) out.push(kindButton);
      if (this.labelEl) out.push(this.labelEl);
      if (this.textEl) out.push(this.textEl);
      const addBob = this.addBobEl;
      const hidden = !addBob || (addBob.classList && addBob.classList.contains("is-hidden"));
      if (!hidden) out.push(addBob);
    } catch (error) {
      // A partial list still cycles.
    }
    return out;
  }

  copyChipCycleField(backward) {
    try {
      const doc = copyChipAuthorOwnerDoc(this);
      const active = doc && doc.activeElement;
      const list = this.copyChipFocusables();
      if (!list.length) return;
      let at = list.indexOf(active);
      if (at < 0 && this.copyChipTargetIsKind(active)) at = 0;
      let next;
      if (at < 0) next = this.labelEl || list[0];
      else next = list[(at + (backward ? list.length - 1 : 1)) % list.length];
      if (next && typeof next.focus === "function") next.focus();
    } catch (error) {
      // Field cycling never throws.
    }
  }

  copyChipFocusInitial() {
    try {
      const snap = this.copyChipSnapshot || {};
      const target = snap.focus === "text" ? this.textEl : this.labelEl;
      const select = snap.selectText === true && target === this.textEl;
      const apply = () => {
        try {
          if (target && typeof target.focus === "function") target.focus();
          if (select && target && typeof target.select === "function") target.select();
        } catch (error) {
          // Focus is best-effort.
        }
      };
      apply();
      try {
        const doc = copyChipAuthorOwnerDoc(this);
        const view = (doc && doc.defaultView) || (typeof window !== "undefined" ? window : null);
        if (view && typeof view.setTimeout === "function") view.setTimeout(apply, 0);
      } catch (error) {
        // Deferred focus is best-effort.
      }
    } catch (error) {
      // Initial focus never throws.
    }
  }

  copyChipStartClipboard() {
    try {
      const snap = this.copyChipSnapshot;
      if (!snap || snap.mode !== "insert") return;
      if (snap.text) return;
      const promise = this.copyChipClipboardPromise;
      if (!promise || typeof promise.then !== "function") return;
      this.copyChipClipboardGen += 1;
      const gen = this.copyChipClipboardGen;
      const modal = this;
      promise.then((text) => {
        try {
          if (modal.copyChipClosed) return;
          if (modal.copyChipClipboardGen !== gen) return;
          if (modal.copyChipTypedText) return;
          const current = modal.textEl ? String(modal.textEl.value || "") : "";
          if (current !== "") return;
          const next = text == null ? "" : String(text);
          if (next === "") return;
          if (modal.textEl) modal.textEl.value = next;
          try {
            if (modal.textEl && typeof modal.textEl.select === "function") modal.textEl.select();
          } catch (error) {
            // Selection is best-effort.
          }
          if (!modal.copyChipKindTouched) {
            // The prefill decides the starting kind once; a choice the
            // user already made always wins.
            const engine = modal.copyChipEngine();
            modal.copyChipKind = runChipAuthorDefaultKind(engine.resolve, next).kind;
          }
          modal.copyChipRefresh();
        } catch (error) {
          // Late clipboard application never throws.
        }
      }, () => {
        // Unavailable clipboard reads leave the field empty.
      });
    } catch (error) {
      // Clipboard start never throws.
    }
  }

  copyChipSave() {
    try {
      if (this.copyChipSaving || this.copyChipClosed) return false;
      const draft = this.copyChipDraft();
      if (!draft || !draft.valid) return false;
      this.copyChipSaving = true;
      let ok = false;
      try {
        if (typeof this.copyChipOnSave === "function") {
          ok = this.copyChipOnSave(draft, this.copyChipSnapshot, this.copyChipIdentity) === true;
        }
      } catch (error) {
        ok = false;
      }
      this.copyChipSaving = false;
      if (ok) {
        this.copyChipClosed = true;
        try {
          this.close();
        } catch (error) {
          // Close is best-effort.
        }
      }
      return ok;
    } catch (error) {
      this.copyChipSaving = false;
      return false;
    }
  }

  copyChipCancel() {
    try {
      this.copyChipClosed = true;
      this.copyChipClipboardGen += 1;
      try {
        this.close();
      } catch (error) {
        // Close is best-effort.
      }
    } catch (error) {
      // Cancel never throws.
    }
  }

  onClose() {
    try {
      this.copyChipClosed = true;
      this.copyChipClipboardGen += 1;
      this.copyChipUnwireKeys();
      try {
        if (typeof this.copyChipCatalogOff === "function") this.copyChipCatalogOff();
      } catch (error) {
        // Unsubscribe is best-effort.
      }
      this.copyChipCatalogOff = null;
      this.iconEl = null;
      this.titleEl = null;
      this.subtitleEl = null;
      this.kindEl = null;
      this.kindButtons = null;
      this.labelEl = null;
      this.textEl = null;
      this.textNameEl = null;
      this.stepsRow = null;
      this.stepsEl = null;
      this.addBobEl = null;
      this.previewHost = null;
      this.captionEl = null;
      this.markdownEl = null;
      this.statusEl = null;
      this.footerEl = null;
      this.previewChip = null;
      try {
        if (this.copyChipPlugin && this.copyChipPlugin.copyChipAuthorModal === this) {
          this.copyChipPlugin.copyChipAuthorModal = null;
        }
      } catch (error) {
        // Plugin bookkeeping is best-effort.
      }
    } catch (error) {
      // Close cleanup never throws.
    }
  }
}
