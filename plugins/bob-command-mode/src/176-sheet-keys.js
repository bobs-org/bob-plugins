// Bob Command Mode: key aliases, focus-preserving render, and scroll.
function cmIsCtrlOnly(event) {
  return Boolean(event && event.ctrlKey) && !event.altKey && !event.metaKey && !event.shiftKey;
}

function cmIsCtrlLeftBracketKeydown(event) {
  if (!event || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
  if (event.code === "BracketLeft") return true;
  return event.key === "[";
}

function cmCommandModeKeyAlias(event) {
  if (!event || typeof event.key !== "string") return null;
  if (event.isComposing) return null;
  if (cmIsCtrlLeftBracketKeydown(event)) return "Escape";
  if (!cmIsCtrlOnly(event)) return null;
  const key = String(event.key || "").toLowerCase();
  const code = String(event.code || "");
  if (key === "n" || code === "KeyN") return "ArrowDown";
  if (key === "p" || code === "KeyP") return "ArrowUp";
  return null;
}

function cmAliasedKeyEvent(event, aliasKey) {
  const aliased = {
    key: aliasKey,
    code: event.code,
    target: event.target,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    __cmAliasedFrom: event.key,
    preventDefault() {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
    },
    stopPropagation() {
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
    },
  };
  try {
    Object.defineProperty(aliased, "defaultPrevented", {
      enumerable: true,
      get() {
        return Boolean(event && event.defaultPrevented);
      },
    });
  } catch (error) {
    aliased.defaultPrevented = Boolean(event && event.defaultPrevented);
  }
  return aliased;
}

const cmHandledSheetKeys = new WeakSet();

function cmSheetFocusInside(sheet) {
  try {
    const doc = typeof document !== "undefined" ? document : null;
    const active = doc && doc.activeElement ? doc.activeElement : null;
    if (active && sheet && sheet.modalEl) {
      for (let current = active; current; current = current.parent) {
        if (current === sheet.modalEl) return true;
      }
      try {
        if (typeof sheet.modalEl.contains === "function" && sheet.modalEl.contains(active)) return true;
      } catch (error) {
        // Fall through to stub flags.
      }
      if (active !== (doc.body || null)) {
        // Active element exists but is outside the sheet.
      } else {
        // Body focus counts as outside.
      }
    }
  } catch (error) {
    // Fall through to stub flags.
  }
  try {
    if (sheet && sheet.inputEl && sheet.inputEl.focused) return true;
    if (sheet && sheet.modalEl && sheet.modalEl.focused) return true;
  } catch (error) {
    // Best effort.
  }
  return false;
}

function cmSheetHomeFocus(sheet) {
  if (!sheet) return;
  if (sheet.stage === "output") {
    if (sheet.modalEl) {
      try {
        if (typeof sheet.modalEl.getAttribute === "function" && !sheet.modalEl.getAttribute("tabindex")) {
          sheet.modalEl.setAttribute("tabindex", "-1");
        }
      } catch (error) {
        // Best effort.
      }
      try {
        if (typeof sheet.modalEl.focus === "function") sheet.modalEl.focus();
      } catch (error) {
        // Best effort.
      }
    }
    return;
  }
  try {
    if (sheet.inputEl && typeof sheet.inputEl.focus === "function") sheet.inputEl.focus();
  } catch (error) {
    // Best effort.
  }
}

function cmSheetScrollSelectionIntoView(sheet) {
  const isArgs = sheet && sheet.stage === "args";
  const listEl = isArgs ? sheet.argListEl : sheet.listEl;
  if (!listEl) return;
  const rowEls = isArgs ? sheet.argRowEls : sheet.rowEls;
  const selectedKey = isArgs ? sheet.argSelectedKey : sheet.selectedKey;
  if (!rowEls || !selectedKey) return;
  const rowEl = typeof rowEls.get === "function" ? rowEls.get(selectedKey) : rowEls[selectedKey];
  if (!rowEl) return;
  let targets = [rowEl];
  if (!isArgs) {
    if (sheet.aboutEl) targets.push(sheet.aboutEl);
    const heading = sheet.sectionHeadingEls && typeof sheet.sectionHeadingEls.get === "function"
      ? sheet.sectionHeadingEls.get(selectedKey)
      : null;
    if (heading) targets.push(heading);
  }
  const getRect = (el) => {
    try {
      if (el && typeof el.getBoundingClientRect === "function") return el.getBoundingClientRect();
    } catch (error) {
      // Fall through.
    }
    return null;
  };
  const listRect = getRect(listEl);
  const rects = targets.map(getRect);
  if (!listRect || rects.some((rect) => !rect)) {
    try {
      rowEl.scrollIntoView({ block: "nearest" });
    } catch (error) {
      // Headless stubs ignore scrolling.
    }
    return;
  }
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const listTop = listRect.top;
  const listBottom = listRect.bottom;
  const rowRect = getRect(rowEl);
  const rowHeight = rowRect ? Math.max(0, rowRect.bottom - rowRect.top) : 0;
  let margin = rowHeight;
  const viewportHeight = Number(listEl.clientHeight) || (listBottom - listTop);
  if (viewportHeight && rowHeight && viewportHeight < rowHeight * 3) margin = 0;
  const ordered = isArgs
    ? (typeof cmArgRenderedRows === "function" ? cmArgRenderedRows(sheet) : [])
    : (sheet.visible || []);
  const firstKey = ordered.length ? ordered[0].key : null;
  if (selectedKey === firstKey) {
    listEl.scrollTop = 0;
    return;
  }
  const scrollTop = Number(listEl.scrollTop) || 0;
  if (top - margin < listTop) {
    listEl.scrollTop = scrollTop - (listTop - (top - margin));
  } else if (bottom + margin > listBottom) {
    listEl.scrollTop = scrollTop + ((bottom + margin) - listBottom);
  }
  if (Number(listEl.scrollTop) < 0) listEl.scrollTop = 0;
}

function cmIsBlockedCtrlLetter(event) {
  if (!event || typeof event.key !== "string") return false;
  if (!event.ctrlKey) return false;
  if (!event.altKey && !event.metaKey && !event.shiftKey) return false;
  const key = String(event.key || "").toLowerCase();
  const code = String(event.code || "");
  return key === "n" || key === "p" || code === "KeyN" || code === "KeyP";
}

const cmOriginalSheetKeydownKeys = CommandModeSheetModal.prototype.handleSheetKeydown;
CommandModeSheetModal.prototype.handleSheetKeydown = function handleSheetKeydownWithAliases(event) {
  if (!event || typeof event.key !== "string") return false;
  if (cmHandledSheetKeys.has(event)) return true;
  if (cmIsBlockedCtrlLetter(event)) return false;
  const alias = cmCommandModeKeyAlias(event);
  let effective = event;
  if (alias === "Escape") {
    effective = cmAliasedKeyEvent(event, "Escape");
  } else if ((alias === "ArrowDown" || alias === "ArrowUp") &&
    (this.stage === "list" || this.stage === "args" || this.stage === "vim")) {
    effective = cmAliasedKeyEvent(event, alias);
  }
  const result = cmOriginalSheetKeydownKeys.call(this, effective);
  if (result) cmHandledSheetKeys.add(event);
  return result;
};

const cmOriginalPagerKeydownKeys = CommandModePagerModal.prototype.handlePagerKeydown;
CommandModePagerModal.prototype.handlePagerKeydown = function handlePagerKeydownWithAlias(event) {
  if (!event || typeof event.key !== "string") return false;
  if (cmHandledSheetKeys.has(event)) return true;
  const alias = cmCommandModeKeyAlias(event);
  let effective = event;
  if (alias === "Escape") effective = cmAliasedKeyEvent(event, "Escape");
  const result = cmOriginalPagerKeydownKeys.call(this, effective);
  if (result) cmHandledSheetKeys.add(event);
  return result;
};

const cmOriginalRenderKeys = CommandModeSheetModal.prototype.render;
CommandModeSheetModal.prototype.render = function renderFocusPreserving() {
  const prevStage = this.stage;
  const prevQuery = this.query;
  const prevInput = this.inputEl;
  let wasFocused = false;
  let prevValue = null;
  let selStart = null;
  let selEnd = null;
  try {
    wasFocused = cmSheetFocusInside(this) && Boolean(prevInput) && (
      (prevInput.focused) ||
      (typeof document !== "undefined" && document.activeElement === prevInput)
    );
    if (!wasFocused && prevInput) {
      // Any focus inside the sheet counts as needing a home after re-render.
      wasFocused = cmSheetFocusInside(this);
    }
    if (prevInput) {
      prevValue = prevInput.value;
      selStart = typeof prevInput.selectionStart === "number" ? prevInput.selectionStart : null;
      selEnd = typeof prevInput.selectionEnd === "number" ? prevInput.selectionEnd : null;
    }
  } catch (error) {
    wasFocused = false;
  }
  let prevScrollTop = null;
  try {
    const listNode = prevStage === "args" ? this.argListEl : this.listEl;
    if (listNode && typeof listNode.scrollTop === "number") prevScrollTop = listNode.scrollTop;
  } catch (error) {
    prevScrollTop = null;
  }
  const result = cmOriginalRenderKeys.call(this);
  const focusInside = (() => {
    try {
      return cmSheetFocusInside(this);
    } catch (error) {
      return false;
    }
  })();
  if (!focusInside) cmSheetHomeFocus(this);
  try {
    if (this.inputEl && prevValue !== null && prevValue !== undefined) {
      if (this.inputEl.value === prevValue && typeof selStart === "number") {
        try {
          if (typeof this.inputEl.setSelectionRange === "function") this.inputEl.setSelectionRange(selStart, selEnd);
          else {
            this.inputEl.selectionStart = selStart;
            this.inputEl.selectionEnd = selEnd;
          }
        } catch (error) {
          // Caret restore is best effort.
        }
      } else if (this.inputEl.value !== prevValue) {
        try {
          const len = String(this.inputEl.value || "").length;
          if (typeof this.inputEl.setSelectionRange === "function") this.inputEl.setSelectionRange(len, len);
          else {
            this.inputEl.selectionStart = len;
            this.inputEl.selectionEnd = len;
          }
        } catch (error) {
          // Caret restore is best effort.
        }
      }
    }
  } catch (error) {
    // Caret restore is best effort.
  }
  try {
    const listNode = this.stage === "args" ? this.argListEl : this.listEl;
    if (listNode) {
      const lastStage = this.cmLastRenderStage;
      const lastQuery = this.cmLastRenderQuery;
      const sameRender = lastStage === this.stage && lastQuery === this.query && lastStage !== undefined;
      if (sameRender && typeof prevScrollTop === "number") {
        listNode.scrollTop = prevScrollTop;
      } else if (typeof listNode.scrollTop === "number" || listNode.scrollTop === undefined) {
        listNode.scrollTop = 0;
      }
    }
    try {
      this.cmLastRenderStage = this.stage;
      this.cmLastRenderQuery = this.query;
    } catch (error) {
      // Best effort.
    }
  } catch (error) {
    // Scroll restore is best effort.
  }
  try {
    if (typeof this.scrollSelectionIntoView === "function") this.scrollSelectionIntoView();
  } catch (error) {
    // Best effort.
  }
  return result;
};

CommandModeSheetModal.prototype.scrollSelectionIntoView = function scrollSelectionIntoViewReal() {
  cmSheetScrollSelectionIntoView(this);
};

function cmSheetListScrollHelper(sheet) {
  cmSheetScrollSelectionIntoView(sheet);
}

const cmOriginalRenderRowKeys = CommandModeSheetModal.prototype.renderRow;
CommandModeSheetModal.prototype.renderRow = function renderRowWithMousedownGuard(list, row) {
  const el = cmOriginalRenderRowKeys.call(this, list, row);
  try {
    el.addEventListener("mousedown", (event) => {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
    });
  } catch (error) {
    // Best effort.
  }
  return el;
};

const cmOriginalRenderArgumentsKeys = CommandModeSheetModal.prototype.renderArguments;
if (typeof cmOriginalRenderArgumentsKeys === "function") {
  CommandModeSheetModal.prototype.renderArguments = function renderArgumentsWithMousedownGuard() {
    const result = cmOriginalRenderArgumentsKeys.call(this);
    try {
      const rows = this.argRowEls;
      const visit = (rowEl) => {
        try {
          rowEl.addEventListener("mousedown", (event) => {
            if (event && typeof event.preventDefault === "function") event.preventDefault();
          });
        } catch (error) {
          // Best effort.
        }
      };
      if (rows && typeof rows.values === "function") {
        for (const rowEl of rows.values()) visit(rowEl);
      }
    } catch (error) {
      // Best effort.
    }
    return result;
  };
}

const cmOriginalSheetOnOpenKeys = CommandModeSheetModal.prototype.onOpen;
const cmOriginalSheetOnCloseKeys = CommandModeSheetModal.prototype.onClose;
CommandModeSheetModal.prototype.onOpen = function onOpenWithScopeFallback() {
  const result = cmOriginalSheetOnOpenKeys.call(this);
  try {
    if (this.scope && typeof this.scope.register === "function") {
      const handler = (event) => {
        if (!event) return true;
        if (cmHandledSheetKeys.has(event)) return false;
        let inside = false;
        try {
          for (let current = event.target; current; current = current.parent) {
            if (current === this.modalEl) {
              inside = true;
              break;
            }
          }
          if (!inside && this.modalEl && typeof this.modalEl.contains === "function") {
            try {
              inside = Boolean(this.modalEl.contains(event.target));
            } catch (error) {
              // Best effort.
            }
          }
        } catch (error) {
          inside = false;
        }
        if (inside) return true;
        cmSheetHomeFocus(this);
        let handled = false;
        try {
          handled = this.handleSheetKeydown(event);
        } catch (error) {
          handled = false;
        }
        if (handled) cmHandledSheetKeys.add(event);
        return handled ? false : true;
      };
      let ref = null;
      try {
        ref = this.scope.register(null, null, handler);
      } catch (error) {
        ref = null;
      }
      this.cmScopeUnregister = () => {
        try {
          if (this.scope && typeof this.scope.unregister === "function" && ref) this.scope.unregister(ref);
          else if (typeof ref === "function") ref();
        } catch (error) {
          // Best effort.
        }
        this.cmScopeUnregister = null;
      };
    }
  } catch (error) {
    // Scope fallback is best effort.
  }
  return result;
};
CommandModeSheetModal.prototype.onClose = function onCloseWithScopeFallback() {
  try {
    if (typeof this.cmScopeUnregister === "function") this.cmScopeUnregister();
  } catch (error) {
    // Best effort.
  }
  return cmOriginalSheetOnCloseKeys.call(this);
};
