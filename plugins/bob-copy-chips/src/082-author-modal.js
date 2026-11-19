// Make-or-edit copy chip modal. Theme-variable card; payloads are never
// assigned to HTML strings or DOM attributes.
const COPY_CHIP_AUTHOR_FOOTER = "⏎ save · ⇧⏎ newline · Tab next field · Esc cancel";
const COPY_CHIP_AUTHOR_LABEL_PLACEHOLDER = "optional — shown instead of the text";

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
    this.copyChipClosed = false;
    this.copyChipSaving = false;
    this.copyChipTypedText = false;
    this.copyChipClipboardGen = 0;
    this.copyChipScopeRefs = [];
    this.copyChipKeyHandler = null;
    this.labelEl = null;
    this.textEl = null;
    this.previewHost = null;
    this.captionEl = null;
    this.markdownEl = null;
    this.statusEl = null;
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
      try {
        if (this.modalEl && typeof this.modalEl.setAttribute === "function") {
          this.modalEl.setAttribute("role", "dialog");
          this.modalEl.setAttribute("aria-modal", "true");
          const title = this.copyChipSnapshot && this.copyChipSnapshot.title
            ? this.copyChipSnapshot.title
            : "Make copy chip";
          this.modalEl.setAttribute("aria-label", title);
        }
      } catch (error) {
        // Accessibility is best-effort.
      }
      if (content && content.classList) {
        try {
          content.classList.add("bob-copy-author");
        } catch (error) {
          // Class setup is best-effort.
        }
      }
      this.copyChipRender(doc, content);
      this.copyChipWireKeys();
      this.copyChipStartClipboard();
      this.copyChipFocusInitial();
    } catch (error) {
      // Opening never throws.
    }
  }

  copyChipRender(doc, content) {
    try {
      if (!doc || !content) return;
      const snap = this.copyChipSnapshot || copyChipAuthorSnapshot({});
      const header = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-header");
      const icon = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-icon");
      if (icon) {
        try {
          copyChipPaintGlyph(icon, "copy");
        } catch (error) {
          // Glyph is best-effort.
        }
        if (header) header.appendChild(icon);
      }
      const headerText = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-header-text");
      const title = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-title");
      copyChipAuthorSetText(title, snap.title || "Make copy chip");
      if (headerText && title) headerText.appendChild(title);
      if (header && headerText) header.appendChild(headerText);
      if (header) content.appendChild(header);

      const fields = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-fields");
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
      const textName = copyChipAuthorMakeEl(doc, "span", "bob-copy-author-field-name");
      copyChipAuthorSetText(textName, "Text");
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
      if (textRow && textName) textRow.appendChild(textName);
      if (textRow && this.textEl) textRow.appendChild(this.textEl);
      if (fields && textRow) fields.appendChild(textRow);
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
      if (this.statusEl) content.appendChild(this.statusEl);

      const footer = copyChipAuthorMakeEl(doc, "div", "bob-copy-author-footer");
      copyChipAuthorSetText(footer, COPY_CHIP_AUTHOR_FOOTER);
      if (footer) content.appendChild(footer);

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

  copyChipDraft() {
    try {
      const label = this.labelEl ? String(this.labelEl.value || "") : "";
      const text = this.textEl ? String(this.textEl.value || "") : "";
      return copyChipAuthorDraftState(this.copyChipSnapshot, label, text);
    } catch (error) {
      return copyChipAuthorDraftState(this.copyChipSnapshot, "", "");
    }
  }

  copyChipRefresh() {
    try {
      const draft = this.copyChipDraft();
      copyChipAuthorGrowTextarea(this.textEl);
      copyChipAuthorSetText(this.captionEl, draft.caption || "");
      copyChipAuthorSetText(this.markdownEl, draft.markdown || "");
      copyChipAuthorSetText(this.statusEl, draft.valid ? "" : (draft.reason || ""));
      try {
        if (this.statusEl && this.statusEl.classList) {
          if (draft.valid) this.statusEl.classList.remove("is-invalid");
          else this.statusEl.classList.add("is-invalid");
        }
      } catch (error) {
        // Status class is best-effort.
      }
      this.copyChipPaintPreview(draft);
    } catch (error) {
      // Refresh never throws.
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
      if (!doc || !draft || !draft.valid) return;
      const chip = {
        label: draft.label && String(draft.label).trim() !== "" ? String(draft.label).trim() : null,
        text: draft.text,
      };
      let el = null;
      try {
        if (draft.previewKind === "block") {
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

  copyChipOnKey(event) {
    try {
      if (!event) return true;
      const target = event.target || null;
      const inField = copyChipAuthorTargetIsField(target);
      const inText = Boolean(this.textEl && (target === this.textEl));
      const action = copyChipAuthorKeyAction(event, { inField, inText });
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

  copyChipCycleField(backward) {
    try {
      const doc = copyChipAuthorOwnerDoc(this);
      const active = doc && doc.activeElement;
      const target = backward
        ? (active === this.textEl ? this.labelEl : this.textEl)
        : (active === this.labelEl ? this.textEl : this.labelEl);
      if (target && typeof target.focus === "function") target.focus();
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
      this.labelEl = null;
      this.textEl = null;
      this.previewHost = null;
      this.captionEl = null;
      this.markdownEl = null;
      this.statusEl = null;
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
