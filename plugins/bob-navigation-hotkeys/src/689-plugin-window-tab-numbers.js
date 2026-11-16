// Tab-numeral stamper for the Ctrl+W numbered-tab epic. `prefix` starts it
// from `onload` and lights numerals through `setWindowTabNumbersLit`.
// The stamper never throws, never mutates the prefix live maps, and never
// cancels an in-flight flash during a refresh.
const WINDOW_TAB_NUMBERS_ATTRIBUTE = "data-bob-tab";
const WINDOW_TAB_NUMBERS_BODY_CLASS = "bob-tab-numbers";
const WINDOW_TAB_NUMBERS_LIT_CLASS = "bob-tab-numbers-lit";
const WINDOW_TAB_NUMBERS_FLASH_CLASS = "bob-tab-number-flash";
const WINDOW_TAB_NUMBERS_FLASH_MS = 220;
const WINDOW_TAB_NUMBERS_ARIA_DESCRIPTION = "Control W then N";

function windowTabNumbersIsMacHost() {
  try {
    if (typeof Platform !== "undefined" && Platform && Platform.isMacOS === true) return true;
  } catch (_error) {
    // Platform is optional in tests.
  }
  try {
    if (typeof windowPrefixIsMacPlatform === "function") return windowPrefixIsMacPlatform();
  } catch (_error) {
    // Fall through to navigator sniffing.
  }
  try {
    const nav = typeof navigator !== "undefined" ? navigator : null;
    return Boolean(nav && /Mac|iPhone|iPad/.test(String(nav.platform || nav.userAgent || "")));
  } catch (_error) {
    return false;
  }
}

function windowTabNumbersMacForPlugin(plugin) {
  try {
    if (plugin && plugin.windowTabNumbersForceMac === true) return true;
    if (plugin && plugin.windowTabNumbersForceMac === false) return false;
  } catch (_error) {
    // Forced flags are test-only.
  }
  return windowTabNumbersIsMacHost();
}

function windowTabNumbersIsPhoneHost(app) {
  try {
    if (app && app.isMobile === true) return true;
  } catch (_error) {
    // Vault stubs omit isMobile.
  }
  try {
    if (typeof Platform !== "undefined" && Platform && Platform.isPhone === true) return true;
  } catch (_error) {
    // Platform is optional in tests.
  }
  return false;
}

function windowTabNumbersHasClass(node, name) {
  if (!node || !name) return false;
  try {
    if (node.classList && typeof node.classList.contains === "function") {
      return node.classList.contains(name);
    }
  } catch (_error) {
    // Fall through to class-name parsing.
  }
  try {
    const current = typeof node.className === "string" ? node.className : String(node.className || "");
    return current.split(/\s+/).includes(name);
  } catch (_error) {
    return false;
  }
}

function windowTabNumbersFindInner(headerEl) {
  if (!headerEl) return null;
  try {
    if (typeof headerEl.querySelector === "function") {
      const inner = headerEl.querySelector(".workspace-tab-header-inner");
      if (inner) return inner;
    }
  } catch (_error) {
    // Stubs may throw from querySelector.
  }
  try {
    const children = Array.isArray(headerEl.children) ? headerEl.children : [];
    for (const child of children) {
      if (windowTabNumbersHasClass(child, "workspace-tab-header-inner")) return child;
      if (Array.isArray(child.children)) {
        for (const grand of child.children) {
          if (windowTabNumbersHasClass(grand, "workspace-tab-header-inner")) return grand;
        }
      }
    }
  } catch (_error) {
    // Manual child search is best-effort.
  }
  if (windowTabNumbersHasClass(headerEl, "workspace-tab-header-inner")) return headerEl;
  return null;
}

function windowTabNumbersHeaderForLeaf(leaf) {
  if (!leaf) return null;
  let headerEl = null;
  try {
    headerEl = leaf.tabHeaderEl || leaf.tabHeader || null;
  } catch (_error) {
    return null;
  }
  if (!headerEl) return null;
  const inner = windowTabNumbersFindInner(headerEl);
  if (!inner) return null;
  return { header: headerEl, inner };
}

function windowTabNumbersGetAttr(node, name) {
  if (!node || !name) return null;
  try {
    if (typeof node.getAttribute === "function") return node.getAttribute(name);
  } catch (_error) {
    // Fall through to attributes map.
  }
  try {
    if (node.attributes && Object.prototype.hasOwnProperty.call(node.attributes, name)) {
      return String(node.attributes[name]);
    }
  } catch (_error) {
    // Best effort.
  }
  return null;
}

function windowTabNumbersSetAttr(node, name, value) {
  if (!node || !name) return;
  try {
    if (typeof node.setAttribute === "function") {
      node.setAttribute(name, String(value));
      return;
    }
  } catch (_error) {
    // Fall through to attributes map.
  }
  try {
    if (node.attributes && typeof node.attributes === "object") node.attributes[name] = String(value);
  } catch (_error) {
    // Best effort.
  }
}

function windowTabNumbersRemoveAttr(node, name) {
  if (!node || !name) return;
  try {
    if (typeof node.removeAttribute === "function") {
      node.removeAttribute(name);
      return;
    }
  } catch (_error) {
    // Fall through to attributes map.
  }
  try {
    if (node.attributes && typeof node.attributes === "object") delete node.attributes[name];
  } catch (_error) {
    // Best effort.
  }
}

function windowTabNumbersAddClass(node, name) {
  if (!node || !name) return;
  try {
    if (node.classList && typeof node.classList.add === "function") {
      node.classList.add(name);
      return;
    }
  } catch (_error) {
    // Fall through.
  }
  try {
    const current = typeof node.className === "string" ? node.className : String(node.className || "");
    if (!current.split(/\s+/).includes(name)) node.className = `${current} ${name}`.trim();
  } catch (_error) {
    // Best effort.
  }
}

function windowTabNumbersRemoveClass(node, name) {
  if (!node || !name) return;
  try {
    if (node.classList && typeof node.classList.remove === "function") {
      node.classList.remove(name);
      return;
    }
  } catch (_error) {
    // Fall through.
  }
  try {
    const current = typeof node.className === "string" ? node.className : String(node.className || "");
    node.className = current.split(/\s+/).filter((item) => item && item !== name).join(" ");
  } catch (_error) {
    // Best effort.
  }
}

function windowTabNumbersDocument(plugin) {
  try {
    const workspace = plugin && plugin.app && plugin.app.workspace;
    const doc = workspace && workspace.containerEl && workspace.containerEl.ownerDocument;
    if (doc && typeof doc.createElement === "function") return doc;
  } catch (_error) {
    // Fall through.
  }
  try {
    const doc = plugin && plugin.windowPrefixDocument;
    if (doc && doc.body) return doc;
  } catch (_error) {
    // Fall through.
  }
  try {
    if (typeof document !== "undefined" && document && document.body) return document;
  } catch (_error) {
    // No DOM.
  }
  return null;
}

class BobNavigationHotkeysWindowTabNumbersMixin {
  startWindowTabNumbers() {
    try {
      if (this.windowTabNumbersStarted === true) return true;
      this.windowTabNumbersStarted = true;
      if (!(this.windowTabNumbersStamped instanceof Map)) this.windowTabNumbersStamped = new Map();
      if (!Array.isArray(this.windowTabNumbersCleanups)) this.windowTabNumbersCleanups = [];
      this.windowTabNumbersLit = this.windowTabNumbersLit === true;
      this.windowTabNumbersFlashLeafId = null;
      this.windowTabNumbersRefreshScheduled = false;
      const workspace = this.app && this.app.workspace;
      const schedule = () => this.scheduleWindowTabNumbersRefresh();
      if (workspace && typeof workspace.on === "function") {
        const events = ["layout-change", "active-leaf-change", "file-open"];
        for (const name of events) {
          try {
            const ref = workspace.on(name, schedule);
            if (ref && typeof this.registerEvent === "function") this.registerEvent(ref);
            else if (typeof this.register === "function") {
              this.register(() => {
                try { if (typeof workspace.off === "function") workspace.off(name, schedule); } catch (_error) { /* unload */ }
              });
            } else {
              this.windowTabNumbersCleanups.push(() => {
                try { if (typeof workspace.off === "function") workspace.off(name, schedule); } catch (_error) { /* unload */ }
              });
            }
          } catch (_error) {
            // One missing event never blocks the rest.
          }
        }
        try {
          if (typeof workspace.onLayoutReady === "function") {
            workspace.onLayoutReady(schedule);
          }
        } catch (_error) {
          // Layout-ready is best-effort.
        }
      }
      const doc = windowTabNumbersDocument(this);
      const targets = [];
      try {
        const win = this.windowPrefixWindow || (typeof window !== "undefined" ? window : null);
        if (win && typeof win.addEventListener === "function") targets.push(win);
      } catch (_error) {
        // No window.
      }
      try {
        if (doc && doc !== targets[0] && typeof doc.addEventListener === "function") targets.push(doc);
      } catch (_error) {
        // No document listener.
      }
      this.windowTabNumbersKeydownHandler = (event) => {
        try {
          if (!event || event.defaultPrevented !== true) return;
          const key = typeof event.key === "string" ? event.key : "";
          const code = typeof event.code === "string" ? event.code : "";
          const isCtrlW = (event.ctrlKey === true || event.metaKey === true) &&
            (key.toLowerCase() === "w" || code === "KeyW");
          if (isCtrlW) this.scheduleWindowTabNumbersRefresh();
        } catch (_error) {
          // Keydown refresh never throws.
        }
      };
      for (const target of targets) {
        try {
          target.addEventListener("keydown", this.windowTabNumbersKeydownHandler, true);
          if (typeof this.register === "function") {
            const handler = this.windowTabNumbersKeydownHandler;
            this.register(() => {
              try { target.removeEventListener("keydown", handler, true); } catch (_error) { /* unload */ }
            });
          } else {
            this.windowTabNumbersCleanups.push(((node) => () => {
              try { node.removeEventListener("keydown", this.windowTabNumbersKeydownHandler, true); } catch (_error) { /* unload */ }
            })(target));
          }
        } catch (_error) {
          // One target never blocks the rest.
        }
      }
      this.refreshWindowTabNumbersNow();
      return true;
    } catch (_error) {
      return false;
    }
  }

  stopWindowTabNumbers() {
    try {
      this.windowTabNumbersStarted = false;
      this.windowTabNumbersRefreshScheduled = false;
      try {
        const setFn = this.windowTabNumbersSetTimeout ||
          (typeof setTimeout === "function" ? setTimeout : null);
        void setFn;
      } catch (_error) {
        // Timer lookup never throws.
      }
      this.windowTabNumbersClearTimer("refresh");
      this.windowTabNumbersClearTimer("flash");
      for (const cleanup of Array.isArray(this.windowTabNumbersCleanups) ? this.windowTabNumbersCleanups : []) {
        try { if (typeof cleanup === "function") cleanup(); } catch (_error) { /* unload */ }
      }
      this.windowTabNumbersCleanups = [];
      if (this.windowTabNumbersKeydownHandler) {
        try {
          const win = this.windowPrefixWindow || (typeof window !== "undefined" ? window : null);
          if (win && typeof win.removeEventListener === "function") {
            win.removeEventListener("keydown", this.windowTabNumbersKeydownHandler, true);
          }
        } catch (_error) {
          // Best effort.
        }
        try {
          const doc = windowTabNumbersDocument(this);
          if (doc && typeof doc.removeEventListener === "function") {
            doc.removeEventListener("keydown", this.windowTabNumbersKeydownHandler, true);
          }
        } catch (_error) {
          // Best effort.
        }
        this.windowTabNumbersKeydownHandler = null;
      }
      this.windowTabNumbersClearStamps();
      try {
        const doc = windowTabNumbersDocument(this);
        const body = doc && doc.body;
        if (body) {
          windowTabNumbersRemoveClass(body, WINDOW_TAB_NUMBERS_BODY_CLASS);
          windowTabNumbersRemoveClass(body, WINDOW_TAB_NUMBERS_LIT_CLASS);
        }
      } catch (_error) {
        // Body cleanup never throws.
      }
      this.windowTabNumbersLit = false;
      this.windowTabNumbersFlashLeafId = null;
    } catch (_error) {
      // Unload cleanup never throws.
    }
  }

  windowTabNumbersClearTimer(name) {
    try {
      const timers = this.windowTabNumbersTimers || (this.windowTabNumbersTimers = Object.create(null));
      const id = timers[name];
      if (id == null) return;
      timers[name] = null;
      const clearFn = this.windowTabNumbersClearTimeout ||
        (typeof clearTimeout === "function" ? clearTimeout : null);
      if (typeof clearFn === "function") {
        try { clearFn(id); } catch (_error) { /* best effort */ }
      }
    } catch (_error) {
      // Timer cleanup never throws.
    }
  }

  windowTabNumbersLater(name, callback, delay) {
    try {
      this.windowTabNumbersClearTimer(name);
      const setFn = this.windowTabNumbersSetTimeout ||
        (typeof setTimeout === "function" ? setTimeout : null);
      if (typeof setFn !== "function") {
        callback();
        return null;
      }
      const timers = this.windowTabNumbersTimers || (this.windowTabNumbersTimers = Object.create(null));
      const id = setFn(() => {
        timers[name] = null;
        callback();
      }, delay);
      timers[name] = id;
      return id;
    } catch (_error) {
      return null;
    }
  }

  scheduleWindowTabNumbersRefresh() {
    try {
      if (this.windowTabNumbersRefreshScheduled === true) return;
      this.windowTabNumbersRefreshScheduled = true;
      const run = () => {
        this.windowTabNumbersRefreshScheduled = false;
        this.refreshWindowTabNumbersNow();
      };
      try {
        const raf = this.windowTabNumbersRequestFrame ||
          (typeof requestAnimationFrame === "function" ? requestAnimationFrame : null);
        if (typeof raf === "function") {
          raf(run);
          return;
        }
      } catch (_error) {
        // Fall through to setTimeout.
      }
      this.windowTabNumbersLater("refresh", run, 0);
      this.windowTabNumbersRefreshScheduled = false;
    } catch (_error) {
      // Scheduling never throws.
    }
  }

  setWindowTabNumbersLit(on) {
    try {
      this.windowTabNumbersLit = on === true;
      this.refreshWindowTabNumbersNow();
    } catch (_error) {
      // Lit toggle never throws.
    }
  }

  flashWindowTabNumber(leafId) {
    try {
      if (leafId == null) return false;
      const id = String(leafId);
      const stamped = this.windowTabNumbersStamped instanceof Map ? this.windowTabNumbersStamped : new Map();
      let inner = stamped.get(id) || null;
      if (!inner) {
        try {
          const area = typeof this.snapshotWindowPrefixMainArea === "function"
            ? this.snapshotWindowPrefixMainArea()
            : null;
          const leaf = area && area.leafById && typeof area.leafById.get === "function"
            ? area.leafById.get(id)
            : null;
          const resolved = windowTabNumbersHeaderForLeaf(leaf);
          inner = resolved ? resolved.inner : null;
        } catch (_error) {
          inner = null;
        }
      }
      if (!inner) return false;
      try {
        if (!windowTabNumbersGetAttr(inner, WINDOW_TAB_NUMBERS_ATTRIBUTE)) {
          const area = typeof this.snapshotWindowPrefixMainArea === "function"
            ? this.snapshotWindowPrefixMainArea()
            : null;
          const catalog = area && typeof buildWindowPrefixTabCatalog === "function"
            ? buildWindowPrefixTabCatalog({ splits: area.splits, activeLeafId: area.activeLeafId })
            : null;
          const tab = catalog && Array.isArray(catalog.tabs)
            ? catalog.tabs.find((item) => String(item.leafId) === id)
            : null;
          if (tab && tab.number != null) {
            windowTabNumbersSetAttr(inner, WINDOW_TAB_NUMBERS_ATTRIBUTE, String(tab.number));
          }
        }
      } catch (_error) {
        // Flash content is best-effort.
      }
      try {
        const previousId = this.windowTabNumbersFlashLeafId;
        if (previousId && previousId !== id) {
          const previous = stamped.get(String(previousId));
          if (previous && previous !== inner) windowTabNumbersRemoveClass(previous, WINDOW_TAB_NUMBERS_FLASH_CLASS);
        }
      } catch (_error) {
        // Previous flash cleanup is best-effort.
      }
      windowTabNumbersAddClass(inner, WINDOW_TAB_NUMBERS_FLASH_CLASS);
      this.windowTabNumbersFlashLeafId = id;
      this.windowTabNumbersLater("flash", () => {
        try {
          windowTabNumbersRemoveClass(inner, WINDOW_TAB_NUMBERS_FLASH_CLASS);
          if (this.windowTabNumbersFlashLeafId === id) this.windowTabNumbersFlashLeafId = null;
          this.refreshWindowTabNumbersNow();
        } catch (_error) {
          // Flash cleanup never throws.
        }
      }, WINDOW_TAB_NUMBERS_FLASH_MS);
      return true;
    } catch (_error) {
      return false;
    }
  }

  windowTabNumbersClearStamps() {
    try {
      const stamped = this.windowTabNumbersStamped instanceof Map ? this.windowTabNumbersStamped : new Map();
      const flashing = this.windowTabNumbersFlashLeafId != null ? String(this.windowTabNumbersFlashLeafId) : null;
      for (const [leafId, inner] of stamped) {
        try {
          if (flashing && String(leafId) === flashing) {
            windowTabNumbersRemoveAttr(inner, WINDOW_TAB_NUMBERS_ATTRIBUTE);
            continue;
          }
          windowTabNumbersRemoveAttr(inner, WINDOW_TAB_NUMBERS_ATTRIBUTE);
          windowTabNumbersRemoveClass(inner, WINDOW_TAB_NUMBERS_FLASH_CLASS);
        } catch (_error) {
          // One stale element never blocks the rest.
        }
        try {
          const header = inner && (inner.parentNode || inner.parent) ? (inner.parentNode || inner.parent) : null;
          const target = windowTabNumbersHasClass(header, "workspace-tab-header") ? header : inner;
          if (target) windowTabNumbersRemoveAttr(target, "aria-description");
        } catch (_error) {
          // Aria cleanup is best-effort.
        }
      }
      this.windowTabNumbersStamped = new Map();
    } catch (_error) {
      // Clear never throws.
    }
  }

  refreshWindowTabNumbersNow(options = {}) {
    try {
      const doc = windowTabNumbersDocument(this);
      const body = doc && doc.body ? doc.body : null;
      let area = null;
      try {
        area = typeof this.snapshotWindowPrefixMainArea === "function"
          ? this.snapshotWindowPrefixMainArea()
          : null;
      } catch (_error) {
        area = null;
      }
      const snapshot = options && options.snapshot ? options.snapshot : null;
      let catalog = null;
      try {
        if (snapshot && typeof buildWindowPrefixTabCatalog === "function") {
          catalog = buildWindowPrefixTabCatalog(snapshot);
        } else if (area && typeof buildWindowPrefixTabCatalog === "function") {
          catalog = buildWindowPrefixTabCatalog({ splits: area.splits, activeLeafId: area.activeLeafId });
        }
      } catch (_error) {
        catalog = null;
      }
      if (!area || !catalog || catalog.ok !== true) {
        this.windowTabNumbersClearStamps();
        if (body) {
          windowTabNumbersRemoveClass(body, WINDOW_TAB_NUMBERS_BODY_CLASS);
          windowTabNumbersRemoveClass(body, WINDOW_TAB_NUMBERS_LIT_CLASS);
        }
        return { ok: false, shown: false, reason: !area ? "no-area" : "invalid-layout" };
      }
      let hotkeysKnown = false;
      let ctrlWOwner = null;
      try {
        const hotkeys = typeof readWindowPrefixHotkeyEntries === "function"
          ? readWindowPrefixHotkeyEntries(this.app)
          : { known: false, entries: [] };
        hotkeysKnown = hotkeys && hotkeys.known === true;
        if (typeof windowPrefixCtrlWOwner === "function") {
          ctrlWOwner = windowPrefixCtrlWOwner(hotkeys.entries, { mac: windowTabNumbersMacForPlugin(this) });
        }
      } catch (_error) {
        hotkeysKnown = false;
        ctrlWOwner = null;
      }
      let headersAvailable = false;
      try {
        const leafById = area.leafById;
        if (leafById && typeof leafById.get === "function") {
          for (const tab of catalog.tabs) {
            if (tab.number == null) continue;
            const resolved = windowTabNumbersHeaderForLeaf(leafById.get(tab.leafId));
            if (resolved && resolved.inner) {
              headersAvailable = true;
              break;
            }
          }
        } else {
          headersAvailable = true;
        }
      } catch (_error) {
        headersAvailable = false;
      }
      let verdict = { show: false, lit: false, reason: "unavailable" };
      try {
        if (typeof windowTabNumeralsVerdict === "function") {
          verdict = windowTabNumeralsVerdict({
            tabCount: catalog.total,
            ctrlWOwner,
            hotkeysKnown,
            mac: windowTabNumbersMacForPlugin(this),
            phone: windowTabNumbersIsPhoneHost(this.app),
            lit: this.windowTabNumbersLit === true,
            headersAvailable,
          });
        }
      } catch (_error) {
        verdict = { show: false, lit: false, reason: "unavailable" };
      }
      if (!verdict || verdict.show !== true) {
        if (this.windowTabNumbersFlashLeafId) {
          if (body) {
            windowTabNumbersAddClass(body, WINDOW_TAB_NUMBERS_BODY_CLASS);
            windowTabNumbersRemoveClass(body, WINDOW_TAB_NUMBERS_LIT_CLASS);
          }
          return {
            ok: true,
            shown: true,
            lit: false,
            reason: "flash-hold",
            total: catalog.total,
          };
        }
        this.windowTabNumbersClearStamps();
        if (body) {
          windowTabNumbersRemoveClass(body, WINDOW_TAB_NUMBERS_BODY_CLASS);
          windowTabNumbersRemoveClass(body, WINDOW_TAB_NUMBERS_LIT_CLASS);
        }
        return {
          ok: true,
          shown: false,
          reason: (verdict && verdict.reason) || "hidden",
          total: catalog.total,
          numbersHidden: headersAvailable !== true && catalog.total >= 2,
        };
      }
      if (body) {
        windowTabNumbersAddClass(body, WINDOW_TAB_NUMBERS_BODY_CLASS);
        if (verdict.lit === true) windowTabNumbersAddClass(body, WINDOW_TAB_NUMBERS_LIT_CLASS);
        else windowTabNumbersRemoveClass(body, WINDOW_TAB_NUMBERS_LIT_CLASS);
      }
      const next = new Map();
      const previous = this.windowTabNumbersStamped instanceof Map ? this.windowTabNumbersStamped : new Map();
      try {
        const leafById = area.leafById;
        for (const tab of catalog.tabs) {
          if (tab.number == null) continue;
          let leaf = null;
          try {
            leaf = leafById && typeof leafById.get === "function" ? leafById.get(tab.leafId) : null;
          } catch (_error) {
            leaf = null;
          }
          const resolved = windowTabNumbersHeaderForLeaf(leaf);
          if (!resolved) continue;
          const desired = String(tab.number);
          try {
            if (windowTabNumbersGetAttr(resolved.inner, WINDOW_TAB_NUMBERS_ATTRIBUTE) !== desired) {
              windowTabNumbersSetAttr(resolved.inner, WINDOW_TAB_NUMBERS_ATTRIBUTE, desired);
            }
          } catch (_error) {
            // One stamp never blocks the rest.
          }
          try {
            if (windowTabNumbersGetAttr(resolved.header, "aria-description") !== WINDOW_TAB_NUMBERS_ARIA_DESCRIPTION) {
              windowTabNumbersSetAttr(resolved.header, "aria-description", WINDOW_TAB_NUMBERS_ARIA_DESCRIPTION);
            }
          } catch (_error) {
            // Aria is best-effort.
          }
          next.set(tab.leafId, resolved.inner);
        }
      } catch (_error) {
        // Stamping never throws past here.
      }
      for (const [leafId, inner] of previous) {
        if (next.has(leafId) && next.get(leafId) === inner) continue;
        try {
          const stillFlashing = this.windowTabNumbersFlashLeafId != null &&
            String(leafId) === String(this.windowTabNumbersFlashLeafId);
          windowTabNumbersRemoveAttr(inner, WINDOW_TAB_NUMBERS_ATTRIBUTE);
          if (!stillFlashing) windowTabNumbersRemoveClass(inner, WINDOW_TAB_NUMBERS_FLASH_CLASS);
        } catch (_error) {
          // One stale element never blocks the rest.
        }
        try {
          const header = inner && (inner.parentNode || inner.parent) ? (inner.parentNode || inner.parent) : null;
          const target = windowTabNumbersHasClass(header, "workspace-tab-header") ? header : inner;
          if (target && (!next.has(leafId) || next.get(leafId) !== inner)) {
            windowTabNumbersRemoveAttr(target, "aria-description");
          }
        } catch (_error) {
          // Aria cleanup is best-effort.
        }
      }
      this.windowTabNumbersStamped = next;
      return {
        ok: true,
        shown: true,
        lit: verdict.lit === true,
        reason: verdict.reason || "available",
        total: catalog.total,
        stamped: next.size,
      };
    } catch (_error) {
      return { ok: false, shown: false, reason: "error" };
    }
  }
}
