// Keyboard-first, editable album Schema Card. It stages one gesture at a
// time, asks bob for a dry-run consequence, and applies only that preview.
function albumSchemaCardModalBase() {
  if (typeof Modal === "function") return Modal;
  return class AlbumSchemaCardFallback {
    constructor(app) {
      this.app = app;
      const doc = app?.document || (typeof document !== "undefined" ? document : null);
      this.contentEl = {
        ownerDocument: doc,
        children: [],
        listeners: new Map(),
        empty() { this.children = []; },
        addClass() {},
        setAttribute() {},
        get textContent() {
          return (this.children || []).map((child) => (child && child.textContent) || "").join("");
        },
        appendChild(node) { node.parentNode = this; this.children.push(node); return node; },
        addEventListener(type, callback) {
          const listeners = this.listeners.get(type) || [];
          listeners.push(callback);
          this.listeners.set(type, listeners);
        },
        dispatchEvent(event) {
          const payload = event || {};
          if (!payload.target) payload.target = this;
          for (const callback of this.listeners.get(payload.type) || []) callback(payload);
          return true;
        },
        querySelector(sel) {
          const walk = (nodes) => {
            for (const node of nodes || []) {
              if (node.matches?.(sel)) return node;
              const found = walk(node.children);
              if (found) return found;
            }
            return null;
          };
          return walk(this.children);
        },
        querySelectorAll(sel) {
          const found = [];
          const walk = (nodes) => {
            for (const node of nodes || []) {
              if (node.matches?.(sel)) found.push(node);
              walk(node.children);
            }
          };
          walk(this.children);
          return found;
        },
      };
      this.modalEl = this.contentEl;
      this.containerEl = this.contentEl;
    }
    open() { this.onOpen?.(); }
    close() { this.onClose?.(); }
  };
}

function albumSchemaCardTitle(model) {
  const label = model?.schemaLabel || model?.title || "Album";
  const emoji = String(model?.emoji || "").trim();
  return emoji ? `${emoji} ${label}` : label;
}

// The editor header's h2 text when the identity badge's stack tile carries
// the album emoji: the label alone. albumSchemaCardTitle keeps the emoji for
// the badge-less fallback.
function albumSchemaCardHeadingText(model) {
  return model?.schemaLabel || model?.title || "Album";
}

// The album card editor's species badge: the stack tile (album emoji, else
// the library icon) and the word Album. Null when the kit is unavailable.
function albumSchemaCardIdentityBadge(model, doc) {
  if (typeof propertyCardBuildIdentityBadge !== "function") return null;
  return propertyCardBuildIdentityBadge(doc, { kind: "album", emoji: String(model?.emoji || "").trim() });
}

function albumSchemaCardButton(doc, host, text, options = {}) {
  const baseClass = options.action ? "bob-album-schema-action" : "bob-album-schema-target";
  const button = notebookCreateEl(doc, "button", `${baseClass} ${options.className || ""}`.trim());
  button.setAttribute("type", "button");
  if (options.targetKey) button.setAttribute("data-target-key", options.targetKey);
  if (options.action) button.setAttribute("data-schema-action", options.action);
  button.setAttribute("aria-label", options.ariaLabel || text);
  if (options.current) {
    const cls = `${button.getAttribute("class") || ""} is-selected`.trim();
    button.setAttribute("class", cls);
    button.setAttribute("aria-current", "true");
  }
  if (options.disabled) button.disabled = true;
  notebookSetText(button, text);
  host.appendChild(button);
  return button;
}

function albumSchemaCardFieldAriaLabel(field, fieldNumber, fieldCount) {
  const numbered = Number.isInteger(fieldNumber) && fieldNumber >= 1
    && Number.isInteger(fieldCount) && fieldCount > 0;
  const parts = [numbered ? `Field ${fieldNumber} of ${fieldCount}` : "Field"];
  const label = String(field?.label || "").trim();
  if (label) parts.push(label);
  if (field?.required) parts.push("required");
  if (field?.kindText) parts.push(field.kindText);
  return parts.join(", ");
}

function albumSchemaCardFieldRowOptions(options, index, total) {
  return Object.assign({}, options, { fieldNumber: index + 1, fieldCount: total });
}

function albumSchemaCardPaintFieldKeycap(doc, host, fieldNumber) {
  if (!doc || !host || !Number.isInteger(fieldNumber) || fieldNumber < 1) return null;
  const numbered = fieldNumber <= 9;
  const keycap = notebookCreateEl(doc, "span", numbered
    ? "bob-album-schema-field-key"
    : "bob-album-schema-field-key is-unnumbered");
  if (!keycap) return null;
  keycap.setAttribute("aria-hidden", "true");
  if (numbered) notebookSetText(keycap, String(fieldNumber));
  try {
    const main = host.querySelector?.(".bob-album-schema-field-main");
    if (main && typeof host.insertBefore === "function") host.insertBefore(keycap, main);
    else host.appendChild(keycap);
  } catch (_) {
    try { host.appendChild(keycap); } catch (_) {}
  }
  return keycap;
}

function albumSchemaSaveOpenEditors(plugin, paths) {
  const wanted = new Set((Array.isArray(paths) ? paths : []).map(albumReportPath));
  const workspace = plugin?.app?.workspace;
  if (!workspace || typeof workspace.getLeavesOfType !== "function") {
    return Promise.resolve({
      ok: false, code: "save-unsupported",
      message: "Obsidian could not confirm whether the album is open in Markdown panes.",
    });
  }
  let leaves;
  try { leaves = workspace.getLeavesOfType("markdown") || []; }
  catch (_) { leaves = null; }
  if (!Array.isArray(leaves)) {
    return Promise.resolve({ ok: false, code: "save-unsupported", message: "Obsidian could not list open Markdown panes." });
  }
  const views = leaves.map((leaf) => leaf?.view).filter((view) => wanted.has(albumReportPath(view?.file?.path)));
  if (views.some((view) => typeof view.save !== "function")) {
    return Promise.resolve({
      ok: false, code: "save-unsupported",
      message: "An open Markdown pane for this album has no supported save method.",
    });
  }
  return (async () => {
    try {
      for (const view of views) await view.save();
      return { ok: true };
    } catch (error) {
      return {
        ok: false, code: "save-failed",
        message: error && error.message ? String(error.message) : "Saving an open album pane failed.",
      };
    }
  })();
}

