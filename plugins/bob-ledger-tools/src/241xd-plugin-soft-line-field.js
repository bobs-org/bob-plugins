// Shared soft-line field: a one-line value that wraps across as many visual
// lines as it needs. Pasted or dropped line breaks fold to spaces with a
// quiet note; the stored value never holds a break. DOM-free at load: every
// DOM call sits in try/catch and fails open.
function bobSoftLineFold(text) {
  try {
    const raw = String(text === null || text === undefined ? "" : text);
    const value = raw.replace(/(?:[ \t]*(?:\r\n|[\r\n\u2028\u2029]))+[ \t]*/g, " ");
    return { value, folded: value !== raw };
  } catch (_) {
    return { value: String(text === null || text === undefined ? "" : text), folded: false };
  }
}

function bobSoftLinePasteText(text) {
  try {
    const raw = String(text === null || text === undefined ? "" : text);
    if (!/[\r\n\u2028\u2029]/.test(raw)) return { value: raw, folded: false };
    const trimmed = raw.trim();
    const folded = bobSoftLineFold(trimmed);
    return { value: folded.value, folded: true };
  } catch (_) {
    return { value: String(text === null || text === undefined ? "" : text), folded: false };
  }
}

function bobSoftLineHasBreak(text) {
  try {
    return /[\r\n\u2028\u2029]/.test(String(text === null || text === undefined ? "" : text));
  } catch (_) {
    return false;
  }
}

function bobSoftLineInsertFallback(textarea, value) {
  try {
    const current = String(textarea.value === null || textarea.value === undefined ? "" : textarea.value);
    let start = current.length;
    let end = current.length;
    try {
      if (Number.isInteger(textarea.selectionStart)) start = textarea.selectionStart;
      if (Number.isInteger(textarea.selectionEnd)) end = textarea.selectionEnd;
    } catch (_) {}
    start = Math.max(0, Math.min(start, current.length));
    end = Math.max(0, Math.min(end, current.length));
    if (start > end) { const tmp = start; start = end; end = tmp; }
    // Prefer setRangeText so the browser fires the right undo grouping.
    try {
      if (typeof textarea.setRangeText === "function") {
        textarea.setRangeText(value, start, end, "end");
        try { textarea.dispatchEvent?.(new Event("input", { bubbles: true })); } catch (_) {
          try {
            const doc = textarea.ownerDocument;
            const event = doc && typeof doc.createEvent === "function" ? doc.createEvent("Event") : null;
            if (event && typeof event.initEvent === "function") {
              event.initEvent("input", true, true);
              textarea.dispatchEvent?.(event);
            }
          } catch (_) {}
        }
        return true;
      }
    } catch (_) {}
    const next = `${current.slice(0, start)}${value}${current.slice(end)}`;
    const caret = start + String(value).length;
    try { textarea.value = next; } catch (_) { return false; }
    try { if (typeof textarea.setSelectionRange === "function") textarea.setSelectionRange(caret, caret); } catch (_) {}
    try { textarea.dispatchEvent?.({ type: "input", bubbles: true, target: textarea }); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

function bobSoftLineAttach(textarea, options = {}) {
  try {
    if (!textarea || typeof textarea.addEventListener !== "function") return textarea;
    try {
      if (textarea.getAttribute?.("data-soft-line") === "true") return textarea;
    } catch (_) {}
    const skip = options && typeof options.skip === "function" ? options.skip : null;
    const onFold = options && typeof options.onFold === "function" ? options.onFold : null;
    try { textarea.setAttribute?.("data-soft-line", "true"); } catch (_) {}
    try { textarea.classList?.add?.("bob-soft-line"); } catch (_) {
      try {
        const prior = textarea.getAttribute?.("class") || "";
        textarea.setAttribute?.("class", `${prior} bob-soft-line`.trim());
      } catch (_) {}
    }
    try { textarea.setAttribute?.("rows", "1"); } catch (_) {}
    try { textarea.rows = 1; } catch (_) {}
    try { textarea.setAttribute?.("wrap", "soft"); } catch (_) {}
    try { textarea.setAttribute?.("enterkeyhint", "done"); } catch (_) {}
    // Do not set aria-multiline: the field is one line that wraps.
    try {
      textarea.addEventListener("beforeinput", (event) => {
        try {
          if (skip && skip() === true) return;
          const kind = event && event.inputType;
          if (kind === "insertLineBreak" || kind === "insertParagraph") event.preventDefault?.();
        } catch (_) {}
      });
    } catch (_) {}
    try {
      textarea.addEventListener("paste", (event) => {
        try {
          if (skip && skip() === true) return;
          let text = "";
          try {
            text = event.clipboardData?.getData?.("text/plain")
              || event.clipboardData?.getData?.("text")
              || "";
          } catch (_) {}
          if (!bobSoftLineHasBreak(text)) return;
          try { event.preventDefault?.(); } catch (_) {}
          const folded = bobSoftLinePasteText(text);
          let done = false;
          try {
            const doc = textarea.ownerDocument;
            if (doc && typeof doc.execCommand === "function" && doc.execCommand("insertText", false, folded.value) === true) done = true;
          } catch (_) {}
          if (!done) {
            try {
              const view = textarea.ownerDocument && textarea.ownerDocument.defaultView;
              if (view && typeof view.execCommand === "function" && view.execCommand("insertText", false, folded.value) === true) done = true;
            } catch (_) {}
          }
          try {
            if (!done && typeof document !== "undefined" && typeof document.execCommand === "function"
              && document.execCommand("insertText", false, folded.value) === true) done = true;
          } catch (_) {}
          if (!done) done = bobSoftLineInsertFallback(textarea, folded.value);
          try { if (onFold) onFold("paste"); } catch (_) {}
        } catch (_) {}
      });
    } catch (_) {}
    try {
      textarea.addEventListener("input", () => {
        try {
          if (skip && skip() === true) { try { bobSoftLineAutosize(textarea); } catch (_) {} return; }
          const current = String(textarea.value === null || textarea.value === undefined ? "" : textarea.value);
          if (!bobSoftLineHasBreak(current)) {
            try { bobSoftLineAutosize(textarea); } catch (_) {}
            return;
          }
          let caret = null;
          try { if (Number.isInteger(textarea.selectionStart)) caret = textarea.selectionStart; } catch (_) {}
          const folded = bobSoftLineFold(current);
          let nextCaret = folded.value.length;
          try {
            if (Number.isInteger(caret)) nextCaret = bobSoftLineFold(current.slice(0, caret)).value.length;
          } catch (_) {}
          try { textarea.value = folded.value; } catch (_) {}
          try {
            if (typeof textarea.setSelectionRange === "function") {
              textarea.setSelectionRange(Math.min(nextCaret, folded.value.length), Math.min(nextCaret, folded.value.length));
            }
          } catch (_) {}
          try { if (onFold) onFold("input"); } catch (_) {}
          try { bobSoftLineAutosize(textarea); } catch (_) {}
        } catch (_) {}
      });
    } catch (_) {}
    return textarea;
  } catch (_) {
    return textarea;
  }
}

function bobSoftLineAutosize(textarea) {
  try {
    if (!textarea || !textarea.style) return null;
    try {
      if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content") === true) {
        try { textarea.style.height = ""; } catch (_) {}
        return "css";
      }
    } catch (_) {}
    let start = null;
    let end = null;
    try {
      if (Number.isInteger(textarea.selectionStart)) start = textarea.selectionStart;
      if (Number.isInteger(textarea.selectionEnd)) end = textarea.selectionEnd;
    } catch (_) {}
    try { textarea.style.height = "auto"; } catch (_) {}
    let extra = 0;
    try { extra = Math.max(0, Number(textarea.offsetHeight || 0) - Number(textarea.clientHeight || 0)); } catch (_) {}
    let content = 0;
    try { content = Number(textarea.scrollHeight || 0); } catch (_) {}
    try { textarea.style.height = `${Math.max(0, content + extra)}px`; } catch (_) { return null; }
    try {
      if (Number.isInteger(start) && Number.isInteger(end) && typeof textarea.setSelectionRange === "function") {
        textarea.setSelectionRange(start, end);
      }
    } catch (_) {}
    return "js";
  } catch (_) {
    return null;
  }
}
