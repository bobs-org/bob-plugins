// Property editor browse keys and discrete-operation intents
// (bob-cli-pf.4.1.2 editor-shell). DOM-free: key mapping never touches the
// document; the modal passes its event and input state. Native text undo and
// typing inside inputs stay separate from browse shortcuts. `=` and y/Ctrl+E
// are exposed as intents for the later integration phase.
function propertyEditorKeyIsTypingTarget(event) {
  try {
    const target = event?.target;
    if (!target || typeof target.closest !== "function") return false;
    if (target.closest("input,select,textarea")) return true;
    const editable = target.closest("[contenteditable]");
    if (editable) {
      const value = typeof editable.getAttribute === "function"
        ? editable.getAttribute("contenteditable")
        : editable.contentEditable;
      if (String(value).toLowerCase() !== "false") return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function propertyEditorKeyAction(event, context = {}) {
  try {
    if (!event || event.isComposing || event.keyCode === 229) return null;
    const inInput = context.inInput === true || propertyEditorKeyIsTypingTarget(event);
    const key = event.key;
    const ctrl = event.ctrlKey === true;
    const meta = event.metaKey === true;
    const alt = event.altKey === true;
    const shift = event.shiftKey === true;
    const cmd = ctrl || meta;

    if (key === "Escape") return "close";

    if (inInput) return null;

    if (!ctrl && !meta && !alt && (key === "q" || key === "Q")) return "close";
    if (ctrl && !meta && !alt && !shift && (event.code === "BracketLeft" || key === "[")) return "close";

    if (!ctrl && !meta && !alt && key === "j") return "down";
    if (!ctrl && !meta && !alt && key === "k") return "up";
    if (!ctrl && !meta && !alt && key === "l") return "open";
    if (!ctrl && !meta && !alt && !shift && key === "o") return "add-below";
    if (!ctrl && !meta && !alt && (key === "O" || (shift && key === "o"))) return "add-above";
    if (cmd && !alt && !shift && (key === ";" || event.code === "Semicolon")) return "add-end";
    if (!ctrl && !meta && !alt && key === "g") return "top";
    if (!ctrl && !meta && !alt && key === "G") return "bottom";
    if (!ctrl && !meta && !alt && key === "u") return "undo";
    if (!ctrl && !meta && !alt && (key === "=")) return "equals";
    if (!ctrl && !meta && !alt && (key === "y" || key === "Y")) return "yaml";
    if (key === "ArrowDown" && !meta && !alt) {
      if (ctrl && shift) return null;
      if (ctrl) return "down";
      if (!shift) return "down";
      return null;
    }
    if (key === "ArrowUp" && !meta && !alt) {
      if (ctrl) return "up";
      if (!shift) return "up";
      return null;
    }
    if (key === "Home" && !ctrl && !meta && !alt) return "top";
    if (key === "End" && !ctrl && !meta && !alt) return "bottom";
    if (ctrl && !meta && !alt && !shift && (key === "n" || key === "N")) return "down";
    if (ctrl && !meta && !alt && !shift && (key === "p" || key === "P")) return "up";
    if (key === "Enter" && !ctrl && !meta && !alt) return "open";
    if (ctrl && !meta && !alt && !shift && (key === "d" || key === "D")) return "delete";
    if ((cmd && !alt && !shift && (key === "Backspace" || key === "Delete"))
      || (!ctrl && !meta && alt && key === "Backspace")) return "delete";
    if (!ctrl && !meta && !alt && (key === "u" || key === "U")) return "undo";
    if (ctrl && !meta && !alt && !shift && (key === "z" || key === "Z")) return "undo";
    if (ctrl && !meta && !alt && !shift && (key === "r" || key === "R")) return "redo";
    if (ctrl && !meta && !alt && shift && (key === "Z" || key === "z")) return "redo";
    if (ctrl && !meta && !alt && (key === "e" || key === "E")) return "yaml";
    return null;
  } catch (_) {
    return null;
  }
}

// Close-ladder order for tests and the modal: menu, typed stage, reserved
// filter layer, modal.
function propertyEditorCloseLadder(state = {}) {
  if (state.menuOpen === true) return "menu";
  if (state.stage || state.addName) return "stage";
  if (state.filterOpen === true) return "filter";
  return "modal";
}
