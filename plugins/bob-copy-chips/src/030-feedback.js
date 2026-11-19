// Shared clipboard and feedback path for copy chips.
// Never trims, interpolates, decodes, or otherwise changes a valid payload.
const COPY_CHIP_SUCCESS_MS = 1200;
const COPY_CHIP_FAILURE_MS = 2000;

const copyChipLiveRegions = new WeakMap();
const copyChipFeedbackTimers = new WeakMap();
let copyChipFeedbackSeq = 0;

function copyChipTimerHost(doc) {
  try {
    const view =
      (doc && doc.defaultView) ||
      (typeof window !== "undefined" ? window : null);
    if (view && typeof view.setTimeout === "function") {
      return {
        set: (fn, ms) => view.setTimeout(fn, ms),
        clear: (handle) => view.clearTimeout(handle),
      };
    }
  } catch (error) {
    // Fall through to the global timers.
  }
  return {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle),
  };
}

function copyChipClipboard() {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      return navigator.clipboard;
    }
  } catch (error) {
    return null;
  }
  return null;
}

function copyChipFailureReason(error) {
  try {
    if (error && typeof error.message === "string" && error.message.trim() !== "") {
      return error.message.trim();
    }
    const text = String(error === undefined ? "" : error).trim();
    if (text !== "" && text !== "[object Object]") return text;
  } catch (ignore) {
    // Fall through to the generic reason.
  }
  return "copy failed";
}

// Awaited inside the activating gesture. Empty input never touches the
// clipboard. Never throws: every failure resolves to {ok:false, reason}.
async function copyChipWrite(text) {
  try {
    if (typeof text !== "string" || !/\S/.test(text)) {
      return copyChipFreeze({ ok: false, reason: "nothing to copy" });
    }
    const clipboard = copyChipClipboard();
    if (!clipboard) {
      return copyChipFreeze({ ok: false, reason: "clipboard unavailable" });
    }
    try {
      await clipboard.writeText(text);
    } catch (error) {
      return copyChipFreeze({ ok: false, reason: copyChipFailureReason(error) });
    }
    return copyChipFreeze({ ok: true });
  } catch (error) {
    return copyChipFreeze({ ok: false, reason: copyChipFailureReason(error) });
  }
}

function copyChipEnsureLiveRegion(doc) {
  try {
    if (!doc || typeof doc.createElement !== "function") return null;
    const existing = copyChipLiveRegions.get(doc);
    if (
      existing &&
      existing.isConnected !== false &&
      typeof existing.remove !== "function"
    ) {
      return existing;
    }
    if (existing && existing.ownerDocument === doc) {
      try {
        if (existing.isConnected === false) {
          copyChipLiveRegions.delete(doc);
        } else {
          return existing;
        }
      } catch (error) {
        return existing;
      }
    }
    const region = doc.createElement("div");
    region.setAttribute("class", "bob-copy-chip-live");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("role", "status");
    try {
      region.textContent = "";
    } catch (error) {
      // Text setup is best-effort on fake nodes.
    }
    const host =
      (doc && doc.body) ||
      (doc && doc.documentElement) ||
      null;
    if (host && typeof host.appendChild === "function") {
      try {
        host.appendChild(region);
      } catch (error) {
        return region;
      }
    }
    copyChipLiveRegions.set(doc, region);
    return region;
  } catch (error) {
    return null;
  }
}

function copyChipAnnounce(doc, message) {
  try {
    const region = copyChipEnsureLiveRegion(doc);
    if (!region) return;
    try {
      region.textContent = "";
    } catch (error) {
      // Reset is best-effort.
    }
    try {
      region.textContent = String(message || "");
    } catch (error) {
      // Announce is best-effort.
    }
  } catch (error) {
    // Announcements never throw.
  }
}

function copyChipGlyphFor(el) {
  try {
    if (!el || typeof el.querySelector !== "function") return null;
    return el.querySelector(".bob-copy-chip-glyph");
  } catch (error) {
    return null;
  }
}

function copyChipPaintGlyph(glyphEl, name) {
  try {
    if (!glyphEl) return;
    if (CopyChipsSetIcon && typeof CopyChipsSetIcon === "function") {
      try {
        CopyChipsSetIcon(glyphEl, name);
        return;
      } catch (error) {
        // Fall through to the text fallback.
      }
    }
    try {
      glyphEl.setAttribute("data-copy-chip-icon", String(name || ""));
    } catch (error) {
      // Attribute fallback is best-effort.
    }
  } catch (error) {
    // Glyph painting never throws.
  }
}

function copyChipClearFeedback(el) {
  try {
    if (!el || !el.classList) return;
    const record = copyChipFeedbackTimers.get(el);
    if (record && record.handle) {
      try {
        const doc = (el && el.ownerDocument) || null;
        copyChipTimerHost(doc).clear(record.handle);
      } catch (error) {
        // Timer cancellation is best-effort.
      }
    }
    copyChipFeedbackTimers.delete(el);
    try {
      el.classList.remove("is-copied");
      el.classList.remove("is-failed");
    } catch (error) {
      // Class cleanup is best-effort.
    }
    const glyph = copyChipGlyphFor(el);
    copyChipPaintGlyph(glyph, "copy");
  } catch (error) {
    // Clearing never throws.
  }
}

function copyChipShowFeedback(el, kind) {
  try {
    if (!el || !el.classList) return false;
    const doc = (el && el.ownerDocument) || (typeof document !== "undefined" ? document : null);
    copyChipFeedbackSeq += 1;
    const token = copyChipFeedbackSeq;
    const previous = copyChipFeedbackTimers.get(el);
    if (previous && previous.handle) {
      try {
        copyChipTimerHost(doc).clear(previous.handle);
      } catch (error) {
        // Old timer cleanup is best-effort.
      }
    }
    let glyphName = "copy";
    let doneClass = null;
    let dwell = 0;
    if (kind === "success") {
      glyphName = "check";
      doneClass = "is-copied";
      dwell = COPY_CHIP_SUCCESS_MS;
    } else if (kind === "failure") {
      glyphName = "alert-triangle";
      doneClass = "is-failed";
      dwell = COPY_CHIP_FAILURE_MS;
    } else {
      copyChipFeedbackTimers.delete(el);
      return false;
    }
    try {
      el.classList.remove("is-copied");
      el.classList.remove("is-failed");
    } catch (error) {
      // Reset is best-effort.
    }
    try {
      el.classList.add(doneClass);
    } catch (error) {
      return false;
    }
    copyChipPaintGlyph(copyChipGlyphFor(el), glyphName);
    if (kind === "success") {
      copyChipAnnounce(doc, "Copied");
    }
    let handle = null;
    try {
      handle = copyChipTimerHost(doc).set(() => {
        try {
          const current = copyChipFeedbackTimers.get(el);
          if (!current || current.token !== token) return;
          copyChipFeedbackTimers.delete(el);
          try {
            el.classList.remove("is-copied");
            el.classList.remove("is-failed");
          } catch (error) {
            // Expiry cleanup is best-effort.
          }
          copyChipPaintGlyph(copyChipGlyphFor(el), "copy");
        } catch (error) {
          // Expiry never throws.
        }
      }, dwell);
    } catch (error) {
      handle = null;
    }
    copyChipFeedbackTimers.set(el, { token, handle });
    return true;
  } catch (error) {
    return false;
  }
}

function copyChipFail(el, reason) {
  try {
    const message = "Couldn't copy: " + String(reason || "copy failed");
    copyChipShowFeedback(el, "failure");
    try {
      if (CopyChipsNotice && typeof CopyChipsNotice === "function") {
        // Exactly one Notice per failure.
        // eslint-disable-next-line no-new
        new CopyChipsNotice(message);
      }
    } catch (error) {
      // Notice display is best-effort.
    }
    return copyChipFreeze({ ok: false, reason: String(reason || "copy failed") });
  } catch (error) {
    return copyChipFreeze({ ok: false, reason: "copy failed" });
  }
}

function copyChipDisposeFeedback(doc) {
  try {
    if (doc) {
      const region = copyChipLiveRegions.get(doc);
      if (region) {
        try {
          if (typeof region.remove === "function") region.remove();
        } catch (error) {
          // Removal is best-effort.
        }
        copyChipLiveRegions.delete(doc);
      }
    }
  } catch (error) {
    // Disposal never throws.
  }
}
