// Shared inline chip face for Live Preview, Reading view, and the inert
// author preview. Payloads live in a WeakMap and DOM text only.
const COPY_CHIP_AUTHOR_EDIT_HINT = " · Alt+Click to edit";
const copyChipPayloads = new WeakMap();
let copyChipDomSeq = 0;

function copyChipPreviewText(text) {
  try {
    const flat = String(text === undefined || text === null ? "" : text).replace(/\r\n|\r|\n/g, "⏎");
    return flat.length > 120 ? flat.slice(0, 120) : flat;
  } catch (error) {
    return "";
  }
}

function copyChipFaceFor(chip) {
  try {
    if (chip && chip.label !== null && chip.label !== undefined) {
      return String(chip.label);
    }
    if (chip) return String(chip.text === undefined || chip.text === null ? "" : chip.text);
  } catch (error) {
    return "";
  }
  return "";
}

function copyChipPayloadOf(el) {
  try {
    if (!el) return null;
    return copyChipPayloads.get(el) || null;
  } catch (error) {
    return null;
  }
}

function copyChipMakeEl(doc, tag, className) {
  try {
    if (!doc || typeof doc.createElement !== "function") return null;
    const el = doc.createElement(tag);
    try {
      if (className) el.setAttribute("class", className);
    } catch (error) {
      // Class setup is best-effort on fake nodes.
    }
    return el;
  } catch (error) {
    return null;
  }
}

// Builds the shared face. `chip` is {label, text}. `options.interactive`
// selects a real <button> (Reading) or an inert <span> (preview). Never
// registers clipboard gestures and never writes. Never throws: bad input
// yields null.
function copyChipBuildInline(doc, chip, options) {
  try {
    if (!doc || typeof doc.createElement !== "function") return null;
    if (!chip || typeof chip !== "object") return null;
    const text = chip.text;
    if (typeof text !== "string" || !/\S/.test(text)) return null;
    const opts = options && typeof options === "object" ? options : {};
    const interactive = Boolean(opts.interactive);
    const labeled = chip.label !== null && chip.label !== undefined;
    const face = copyChipFaceFor(chip);

    const host = copyChipMakeEl(
      doc,
      interactive ? "button" : "span",
      "bob-copy-chip" + (labeled ? " is-labeled" : " is-literal"),
    );
    if (!host) return null;
    if (interactive && host.setAttribute) {
      try {
        host.setAttribute("type", "button");
      } catch (error) {
        // Type setup is best-effort.
      }
    }

    copyChipDomSeq += 1;
    const seq = copyChipDomSeq;

    let glyph = null;
    let faceEl = null;
    let prefixEl = null;
    try {
      glyph = doc.createElement("span");
      glyph.setAttribute("class", "bob-copy-chip-glyph");
      copyChipPaintGlyph(glyph, "copy");
      host.appendChild(glyph);
    } catch (error) {
      glyph = null;
    }
    try {
      faceEl = doc.createElement("span");
      faceEl.setAttribute("class", "bob-copy-chip-face");
      try {
        faceEl.textContent = face;
      } catch (error) {
        // Text setup is best-effort.
      }
      try {
        faceEl.setAttribute("id", "bob-copy-chip-face-" + seq);
      } catch (error) {
        // Id setup is best-effort.
      }
      host.appendChild(faceEl);
    } catch (error) {
      faceEl = null;
    }
    try {
      prefixEl = doc.createElement("span");
      prefixEl.setAttribute("class", "bob-copy-chip-copy-prefix");
      try {
        prefixEl.textContent = "Copy";
      } catch (error) {
        // Text setup is best-effort.
      }
      try {
        prefixEl.setAttribute("id", "bob-copy-chip-copy-" + seq);
      } catch (error) {
        // Id setup is best-effort.
      }
      host.appendChild(prefixEl);
    } catch (error) {
      prefixEl = null;
    }
    let tipEl = null;
    try {
      tipEl = doc.createElement("span");
      tipEl.setAttribute("class", "bob-copy-chip-tip");
      try {
        let tipText = labeled
          ? "Copy: " + copyChipPreviewText(text)
          : "Click to copy";
        if (opts.editHint === true) tipText += COPY_CHIP_AUTHOR_EDIT_HINT;
        tipEl.textContent = tipText;
      } catch (error) {
        // Tooltip text is best-effort.
      }
      try {
        tipEl.setAttribute("id", "bob-copy-chip-tip-" + seq);
        tipEl.setAttribute("role", "tooltip");
      } catch (error) {
        // Tooltip identity is best-effort.
      }
      host.appendChild(tipEl);
    } catch (error) {
      tipEl = null;
    }

    // Accessible name is Copy + face via labelledby, never a payload
    // duplicated into aria-label.
    try {
      if (interactive && host.setAttribute && faceEl && prefixEl) {
        const faceId = "bob-copy-chip-face-" + seq;
        const prefixId = "bob-copy-chip-copy-" + seq;
        host.setAttribute("aria-labelledby", prefixId + " " + faceId);
      }
    } catch (error) {
      // Labelling is best-effort.
    }
    // The hover/focus tooltip describes the chip; an id, never a payload.
    try {
      if (host.setAttribute && tipEl) {
        host.setAttribute("aria-describedby", "bob-copy-chip-tip-" + seq);
      }
    } catch (error) {
      // Description is best-effort.
    }

    try {
      copyChipPayloads.set(host, String(text));
    } catch (error) {
      // Payload retention is best-effort.
    }
    return host;
  } catch (error) {
    return null;
  }
}
