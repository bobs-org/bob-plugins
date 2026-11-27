// Numbered cabinet pick: `_` with two or more extras arms a cancel-safe pick.
// Zero extras falls back to the details fold, one extra toggles at once.
// The pick snapshots semantic kinds (never DOM positions), lights on-card
// digits plus the walker-footer overlay, and disarms on every trigger in
// the `_` keymap table. Painting, toggling, arming, and cancelling never
// write the vault or spawn bob; only an explicit Sync click does.
const propertyCardCabinetPickState = {
  active: false,
  view: null,
  plugin: null,
  path: "",
  stack: null,
  snapshot: [],
  generation: 0,
  scope: null,
  keyHandler: null,
  blurHandler: null,
  visibilityHandler: null,
  mouseHandler: null,
  workspaceRefs: [],
  workspaceOffs: [],
  delayTimer: null,
  overlayToken: null,
  overlayPushed: false,
  handledEvents: null,
  unloadRelease: null,
  announceText: "",
};

let propertyCardCabinetPickDelayMs = 150;

function propertyCardCabinetPickSetDelayForTests(ms) {
  if (typeof ms === "number" && ms >= 0 && ms <= 5000) propertyCardCabinetPickDelayMs = ms;
  return propertyCardCabinetPickDelayMs;
}

function propertyCardCabinetPickActive() {
  return propertyCardCabinetPickState.active === true;
}

function propertyCardCabinetPickSnapshotForTests() {
  return {
    active: propertyCardCabinetPickState.active === true,
    path: propertyCardCabinetPickState.path,
    snapshot: (propertyCardCabinetPickState.snapshot || []).map((row) => ({ ...row })),
    overlayPushed: propertyCardCabinetPickState.overlayPushed === true,
    announce: propertyCardCabinetPickState.announceText,
  };
}

function propertyCardCabinetPickResetForTests() {
  try { propertyCardCabinetPickDisarmPick({ silent: true }); } catch (_) {}
  propertyCardCabinetPickState.active = false;
  propertyCardCabinetPickState.view = null;
  propertyCardCabinetPickState.plugin = null;
  propertyCardCabinetPickState.path = "";
  propertyCardCabinetPickState.stack = null;
  propertyCardCabinetPickState.snapshot = [];
  propertyCardCabinetPickState.scope = null;
  propertyCardCabinetPickState.overlayToken = null;
  propertyCardCabinetPickState.overlayPushed = false;
  propertyCardCabinetPickState.announceText = "";
  propertyCardCabinetPickDelayMs = 150;
  return true;
}

function propertyCardCabinetPickPluginForView(view, hint) {
  if (hint && typeof hint === "object") return hint;
  try {
    for (const mount of propertyCardCabinetMounts || []) {
      if (mount && mount.view === view && mount.plugin) return mount.plugin;
    }
  } catch (_) {}
  return null;
}

function propertyCardCabinetPickFooterText(snapshot, extrasByKind, maxNumber) {
  const rows = (Array.isArray(snapshot) ? snapshot : []).slice().sort((a, b) => a.number - b.number);
  const chips = rows.map((row) => {
    const noun = (PROPERTY_CARD_CABINET_KINDS[row.kind] || {}).noun || row.kind;
    const open = extrasByKind instanceof Map ? extrasByKind.get(row.kind) : null;
    const glyph = open === true ? "▾" : "▸";
    return `${row.number} ${noun} ${glyph}`;
  });
  const legend = maxNumber > 0 ? `Choose 1–${maxNumber}` : "";
  void legend;
  return `▤ Cabinets   ${chips.join(" · ")}   - Properties   esc`;
}

function propertyCardCabinetPickAnnounceText(snapshot) {
  const rows = (Array.isArray(snapshot) ? snapshot : []).slice().sort((a, b) => a.number - b.number);
  const names = rows.map((row) => `${row.number} ${(PROPERTY_CARD_CABINET_KINDS[row.kind] || {}).noun || row.kind}`);
  return names.length ? `Cabinets: ${names.join(", ")}. Press a number, or Escape to cancel.` : "";
}

function propertyCardCabinetPickNotify(message) {
  if (!message) return false;
  try {
    if (typeof Notice === "function") {
      try { new Notice(String(message)); return true; } catch (_) { return false; }
    }
  } catch (_) {}
  return false;
}

function propertyCardCabinetPickConsume(event) {
  try { event?.preventDefault?.(); } catch (_) {}
  try { event?.stopPropagation?.(); } catch (_) {}
  try {
    if (typeof event?.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  } catch (_) {}
}

function propertyCardCabinetPickScopeCtor(app) {
  try {
    if (typeof Scope === "function") return Scope;
  } catch (_) {}
  try {
    const ctor = app && app.scope && app.scope.constructor;
    if (typeof ctor === "function") return ctor;
  } catch (_) {}
  return null;
}

function propertyCardCabinetPickPushScope(plugin) {
  if (propertyCardCabinetPickState.scope) return propertyCardCabinetPickState.scope;
  try {
    const app = plugin && plugin.app;
    const keymap = app && app.keymap;
    const Ctor = propertyCardCabinetPickScopeCtor(app);
    if (!Ctor || !keymap || typeof keymap.pushScope !== "function") return null;
    let scope = null;
    try { scope = new Ctor(app && app.scope); } catch (_) {
      try { scope = new Ctor(); } catch (_) { return null; }
    }
    if (!scope || typeof scope.register !== "function") return null;
    const handler = (event) => propertyCardCabinetPickOnScopeKey(event);
    try { scope.register(null, null, handler); } catch (_) { return null; }
    try { keymap.pushScope(scope); } catch (_) { return null; }
    propertyCardCabinetPickState.scope = scope;
    propertyCardCabinetPickState.scopeHandler = handler;
    return scope;
  } catch (_) {
    return null;
  }
}

function propertyCardCabinetPickPopScope(plugin) {
  const scope = propertyCardCabinetPickState.scope;
  propertyCardCabinetPickState.scope = null;
  propertyCardCabinetPickState.scopeHandler = null;
  if (!scope) return false;
  try {
    const keymap = plugin && plugin.app && plugin.app.keymap;
    if (keymap && typeof keymap.popScope === "function") {
      try { keymap.popScope(scope); } catch (_) {}
      return true;
    }
  } catch (_) {}
  return false;
}

function propertyCardCabinetPickEventTargets() {
  const targets = [];
  try {
    const win = typeof window !== "undefined" ? window : null;
    if (win && typeof win.addEventListener === "function") targets.push(win);
  } catch (_) {}
  try {
    const doc = typeof document !== "undefined" ? document : null;
    if (doc && typeof doc.addEventListener === "function") targets.push(doc);
  } catch (_) {}
  return targets;
}

function propertyCardCabinetPickOverlayPush(plugin, view, text) {
  try {
    if (plugin && typeof plugin.walkerFooterOverlayPush === "function") {
      return plugin.walkerFooterOverlayPush(text, { view: view || null });
    }
    if (typeof walkerFooterOverlayPush === "function") {
      return walkerFooterOverlayPush(plugin, text, { view: view || null });
    }
  } catch (_) {}
  return null;
}

function propertyCardCabinetPickOverlayPop(plugin, token) {
  try {
    if (plugin && typeof plugin.walkerFooterOverlayPop === "function") {
      return plugin.walkerFooterOverlayPop(token);
    }
    if (typeof walkerFooterOverlayPop === "function") {
      return walkerFooterOverlayPop(plugin, token);
    }
  } catch (_) {}
  return false;
}

function propertyCardCabinetPickScheduleOverlay(plugin, view, snapshot, extrasByKind, maxNumber) {
  try {
    if (propertyCardCabinetPickState.delayTimer) {
      try { clearTimeout(propertyCardCabinetPickState.delayTimer); } catch (_) {}
      propertyCardCabinetPickState.delayTimer = null;
    }
  } catch (_) {}
  const text = propertyCardCabinetPickFooterText(snapshot, extrasByKind, maxNumber);
  const announce = propertyCardCabinetPickAnnounceText(snapshot);
  propertyCardCabinetPickState.announceText = announce;
  const push = () => {
    propertyCardCabinetPickState.delayTimer = null;
    if (propertyCardCabinetPickState.active !== true) return;
    try {
      if (propertyCardCabinetPickState.stack && propertyCardCabinetPickState.stack.isConnected === false) return;
    } catch (_) {}
    const token = propertyCardCabinetPickOverlayPush(plugin, view, text);
    propertyCardCabinetPickState.overlayToken = token;
    propertyCardCabinetPickState.overlayPushed = token !== null && token !== undefined;
  };
  const delay = propertyCardCabinetPickDelayMs;
  if (delay <= 0) {
    push();
    return;
  }
  try {
    propertyCardCabinetPickState.delayTimer = setTimeout(push, delay);
  } catch (_) {
    push();
  }
}

function propertyCardCabinetPickNudge(message) {
  const text = typeof message === "string" && message ? message : "";
  if (!text) return false;
  try {
    const plugin = propertyCardCabinetPickState.plugin;
    const el = plugin && plugin.freshnessStatusEl;
    const overlay = el && el.querySelector ? el.querySelector(".bob-walker-footer-overlay") : null;
    if (overlay) {
      const base = overlay.textContent || "";
      if (!base.includes(text)) overlay.textContent = base ? `${base} · ${text}` : text;
      return true;
    }
    const fallback = plugin && plugin.walkerFooterOverlayFallback;
    if (fallback) {
      const base = fallback.textContent || "";
      if (!base.includes(text)) fallback.textContent = base ? `${base} · ${text}` : text;
      return true;
    }
  } catch (_) {}
  propertyCardCabinetPickNotify(text);
  return true;
}

function propertyCardCabinetPickFreshExtras(view, path) {
  try {
    const collected = propertyCardCabinetsInView(view);
    if (!collected || collected.path !== path) return null;
    return collected;
  } catch (_) {
    return null;
  }
}

function propertyCardCabinetPickAfterToggle(view, kind, wasOpen) {
  try {
    const noun = (PROPERTY_CARD_CABINET_KINDS[kind] || {}).noun || kind;
    propertyCardCabinetPickNotify(`${noun} ${wasOpen === true ? "closed" : "opened"}`);
  } catch (_) {}
  if (wasOpen === true) return;
  try {
    const collected = propertyCardCabinetsInView(view);
    const row = (collected && collected.extras ? collected.extras : []).find((item) => item && item.kind === kind);
    const head = row && row.element ? (row.element.closest ? row.element.closest("[data-cabinet-kind]") || row.element : row.element) : null;
    const target = head || (row && row.element) || null;
    if (target && typeof target.scrollIntoView === "function") {
      try { target.scrollIntoView({ block: "nearest" }); } catch (_) {}
    } else if (target && typeof target.getBoundingClientRect === "function") {
      try {
        const rect = target.getBoundingClientRect();
        const viewHeight = (typeof window !== "undefined" && window.innerHeight) || 800;
        if (rect && (rect.top < 0 || rect.bottom > viewHeight) && typeof target.scrollIntoView === "function") {
          target.scrollIntoView({ block: "nearest" });
        }
      } catch (_) {}
    }
  } catch (_) {}
}

function propertyCardCabinetPickToggleKind(view, kind) {
  let wasOpen = null;
  try {
    const collected = propertyCardCabinetsInView(view);
    const row = (collected && collected.extras ? collected.extras : []).find((item) => item && item.kind === kind);
    const prop = collected && collected.properties;
    if (kind === "properties") wasOpen = prop ? prop.open === true : null;
    else wasOpen = row ? row.open === true : null;
  } catch (_) {}
  let ok = false;
  try {
    ok = propertyCardCabinetToggle(view, kind) === true;
  } catch (_) {
    ok = false;
  }
  if (ok) propertyCardCabinetPickAfterToggle(view, kind, wasOpen);
  return ok;
}

function propertyCardCabinetPickDisarmPick(options = {}) {
  const wasActive = propertyCardCabinetPickState.active === true;
  const stack = propertyCardCabinetPickState.stack;
  const plugin = propertyCardCabinetPickState.plugin;
  propertyCardCabinetPickState.active = false;
  propertyCardCabinetPickState.view = null;
  propertyCardCabinetPickState.path = "";
  propertyCardCabinetPickState.snapshot = [];
  try {
    if (propertyCardCabinetPickState.delayTimer) {
      try { clearTimeout(propertyCardCabinetPickState.delayTimer); } catch (_) {}
      propertyCardCabinetPickState.delayTimer = null;
    }
  } catch (_) {}
  try {
    if (propertyCardCabinetPickState.keyHandler) {
      for (const target of propertyCardCabinetPickEventTargets()) {
        try { target.removeEventListener("keydown", propertyCardCabinetPickState.keyHandler, true); } catch (_) {}
      }
    }
  } catch (_) {}
  propertyCardCabinetPickState.keyHandler = null;
  try {
    const win = typeof window !== "undefined" ? window : null;
    if (win && propertyCardCabinetPickState.blurHandler) {
      try { win.removeEventListener("blur", propertyCardCabinetPickState.blurHandler); } catch (_) {}
    }
  } catch (_) {}
  propertyCardCabinetPickState.blurHandler = null;
  try {
    const doc = typeof document !== "undefined" ? document : null;
    if (doc) {
      if (propertyCardCabinetPickState.visibilityHandler) {
        try { doc.removeEventListener("visibilitychange", propertyCardCabinetPickState.visibilityHandler); } catch (_) {}
      }
      if (propertyCardCabinetPickState.mouseHandler) {
        try { doc.removeEventListener("mousedown", propertyCardCabinetPickState.mouseHandler, true); } catch (_) {}
      }
    }
  } catch (_) {}
  propertyCardCabinetPickState.visibilityHandler = null;
  propertyCardCabinetPickState.mouseHandler = null;
  try {
    for (const off of propertyCardCabinetPickState.workspaceOffs || []) {
      try { if (typeof off === "function") off(); } catch (_) {}
    }
  } catch (_) {}
  propertyCardCabinetPickState.workspaceRefs = [];
  propertyCardCabinetPickState.workspaceOffs = [];
  try { propertyCardCabinetPickPopScope(plugin); } catch (_) {}
  try {
    if (stack && propertyCardCabinetPickState.overlayPushed !== true) {
      try { propertyCardCabinetPaintPick(stack, null); } catch (_) {}
    } else if (stack) {
      try { propertyCardCabinetPaintPick(stack, null); } catch (_) {}
    }
  } catch (_) {}
  try {
    if (propertyCardCabinetPickState.overlayPushed === true) {
      propertyCardCabinetPickOverlayPop(plugin, propertyCardCabinetPickState.overlayToken);
    }
  } catch (_) {}
  propertyCardCabinetPickState.overlayToken = null;
  propertyCardCabinetPickState.overlayPushed = false;
  try {
    if (propertyCardCabinetPickState.unloadRelease) {
      try { propertyCardCabinetPickState.unloadRelease(); } catch (_) {}
    }
  } catch (_) {}
  propertyCardCabinetPickState.unloadRelease = null;
  propertyCardCabinetPickState.plugin = null;
  propertyCardCabinetPickState.handledEvents = null;
  return wasActive;
}

function propertyCardCabinetPickReleasePlugin(plugin) {
  if (!plugin || propertyCardCabinetPickState.plugin !== plugin) return false;
  propertyCardCabinetPickDisarmPick({ silent: true });
  return true;
}

function propertyCardCabinetPickRegisterWorkspaceDisarm(plugin) {
  propertyCardCabinetPickState.workspaceRefs = [];
  propertyCardCabinetPickState.workspaceOffs = [];
  let workspace = null;
  try { workspace = plugin && plugin.app && plugin.app.workspace; } catch (_) {}
  if (!workspace || typeof workspace.on !== "function") return;
  const events = ["active-leaf-change", "layout-change", "file-open"];
  for (const name of events) {
    try {
      const ref = workspace.on(name, () => propertyCardCabinetPickDisarmPick({ silent: true }));
      propertyCardCabinetPickState.workspaceRefs.push(ref);
      if (typeof workspace.off === "function") {
        const handler = () => {};
        void handler;
        propertyCardCabinetPickState.workspaceOffs.push(() => {
          try { workspace.off(name, propertyCardCabinetPickState._workspaceHandlers?.[name]); } catch (_) {}
        });
      } else if (ref && typeof ref.off === "function") {
        propertyCardCabinetPickState.workspaceOffs.push(() => { try { ref.off(); } catch (_) {} });
      } else if (typeof plugin.registerEvent === "function") {
        try { plugin.registerEvent(ref); } catch (_) {}
      }
    } catch (_) {}
  }
  if (!propertyCardCabinetPickState._workspaceHandlers) {
    try { propertyCardCabinetPickState._workspaceHandlers = {}; } catch (_) {}
  }
  if (typeof plugin.register === "function" && propertyCardCabinetPickState.unloadRelease == null) {
    try {
      let released = false;
      const release = () => {
        if (released) return false;
        released = true;
        return propertyCardCabinetPickReleasePlugin(plugin);
      };
      plugin.register(release);
      propertyCardCabinetPickState.unloadRelease = release;
    } catch (_) {}
  }
}

function propertyCardCabinetPickArm(view, collected, plugin) {
  if (propertyCardCabinetPickState.active === true) propertyCardCabinetPickDisarmPick({ silent: true });
  const extras = (collected && collected.extras ? collected.extras : []).slice();
  if (extras.length < 2) return false;
  const path = collected.path || "";
  let stack = null;
  try { stack = propertyCardCabinetStackForView(view, path); } catch (_) { stack = null; }
  if (!stack) return false;
  const snapshot = extras.map((row) => ({ kind: row.kind, number: row.number }));
  const byKind = new Map(extras.map((row) => [row.kind, row.open === true]));
  const maxNumber = snapshot.reduce((max, row) => Math.max(max, row.number || 0), 0);
  propertyCardCabinetPickState.active = true;
  propertyCardCabinetPickState.view = view;
  propertyCardCabinetPickState.plugin = plugin || null;
  propertyCardCabinetPickState.path = path;
  propertyCardCabinetPickState.stack = stack;
  propertyCardCabinetPickState.snapshot = snapshot;
  propertyCardCabinetPickState.generation += 1;
  propertyCardCabinetPickState.handledEvents = typeof WeakSet === "function" ? new WeakSet() : null;
  try { propertyCardCabinetPaintPick(stack, snapshot); } catch (_) {}
  propertyCardCabinetPickScheduleOverlay(plugin, view, snapshot, byKind, maxNumber);
  propertyCardCabinetPickPushScope(plugin);
  const handler = (event) => propertyCardCabinetPickOnCaptureKey(event);
  propertyCardCabinetPickState.keyHandler = handler;
  for (const target of propertyCardCabinetPickEventTargets()) {
    try { target.addEventListener("keydown", handler, true); } catch (_) {}
  }
  try {
    const win = typeof window !== "undefined" ? window : null;
    if (win && typeof win.addEventListener === "function") {
      const onBlur = () => propertyCardCabinetPickDisarmPick({ silent: true });
      propertyCardCabinetPickState.blurHandler = onBlur;
      win.addEventListener("blur", onBlur);
    }
  } catch (_) {}
  try {
    const doc = typeof document !== "undefined" ? document : null;
    if (doc && typeof doc.addEventListener === "function") {
      const onVis = () => {
        try { if (doc.hidden) propertyCardCabinetPickDisarmPick({ silent: true }); } catch (_) {}
      };
      const onMouse = () => propertyCardCabinetPickDisarmPick({ silent: true });
      propertyCardCabinetPickState.visibilityHandler = onVis;
      propertyCardCabinetPickState.mouseHandler = onMouse;
      doc.addEventListener("visibilitychange", onVis);
      doc.addEventListener("mousedown", onMouse, true);
    }
  } catch (_) {}
  try { propertyCardCabinetPickRegisterWorkspaceDisarm(plugin); } catch (_) {}
  if (propertyCardCabinetPickState.scope == null) {
    // Scope is best-effort (Obsidian-only); the window capture listener alone
    // still swallows digits so none reach Vim.
  }
  return true;
}

function propertyCardCabinetPickOnScopeKey(event) {
  if (propertyCardCabinetPickState.active !== true) return true;
  return propertyCardCabinetPickOnCaptureKey(event);
}

function propertyCardCabinetPickOnCaptureKey(event) {
  if (propertyCardCabinetPickState.active !== true) return true;
  try {
    if (propertyCardCabinetPickState.handledEvents && event) {
      if (propertyCardCabinetPickState.handledEvents.has(event)) return false;
      try { propertyCardCabinetPickState.handledEvents.add(event); } catch (_) {}
    }
  } catch (_) {}
  try {
    if (event && (event.isComposing || event.keyCode === 229)) return false;
  } catch (_) {}
  try {
    if (event && event.repeat) {
      propertyCardCabinetPickConsume(event);
      return false;
    }
  } catch (_) {}
  let closeKind = null;
  try {
    closeKind = typeof bobCardCloseKey === "function" ? bobCardCloseKey(event) : (event && event.key === "Escape" ? "escape" : null);
  } catch (_) {
    closeKind = null;
  }
  if (closeKind === "escape" || closeKind === "q" || closeKind === "ctrl-bracket") {
    propertyCardCabinetPickConsume(event);
    propertyCardCabinetPickDisarmPick({ silent: true });
    return false;
  }
  try {
    const modified = event && (event.ctrlKey === true || event.metaKey === true || event.altKey === true);
    if (modified) {
      propertyCardCabinetPickDisarmPick({ silent: true });
      return true;
    }
  } catch (_) {}
  const key = event && typeof event.key === "string" ? event.key : "";
  const view = propertyCardCabinetPickState.view;
  const snapshot = propertyCardCabinetPickState.snapshot || [];
  const byNumber = new Map(snapshot.map((row) => [row.number, row.kind]));
  const maxNumber = snapshot.reduce((max, row) => Math.max(max, row.number || 0), 0);
  if (key >= "0" && key <= "9" && key.length === 1) {
    const digit = key === "0" ? 0 : parseInt(key, 10);
    const kind = byNumber.get(digit);
    if (!kind) {
      propertyCardCabinetPickConsume(event);
      propertyCardCabinetPickNudge(maxNumber > 0 ? `Choose 1–${maxNumber}` : "Choose 1–9");
      return false;
    }
    const fresh = view ? propertyCardCabinetPickFreshExtras(view, propertyCardCabinetPickState.path) : null;
    const stillThere = fresh && fresh.extras ? fresh.extras.some((row) => row && row.kind === kind) : true;
    if (!stillThere) {
      propertyCardCabinetPickConsume(event);
      propertyCardCabinetPickDisarmPick({ silent: true });
      propertyCardCabinetPickNotify("Cabinets changed — press _ again");
      return false;
    }
    propertyCardCabinetPickConsume(event);
    propertyCardCabinetPickDisarmPick({ silent: true });
    propertyCardCabinetPickToggleKind(view, kind);
    return false;
  }
  if (key === "_") {
    const kind = byNumber.get(1);
    if (!kind) {
      propertyCardCabinetPickConsume(event);
      propertyCardCabinetPickNudge(maxNumber > 0 ? `Choose 1–${maxNumber}` : "Choose 1–9");
      return false;
    }
    const fresh = view ? propertyCardCabinetPickFreshExtras(view, propertyCardCabinetPickState.path) : null;
    const stillThere = fresh && fresh.extras ? fresh.extras.some((row) => row && row.kind === kind) : true;
    if (!stillThere) {
      propertyCardCabinetPickConsume(event);
      propertyCardCabinetPickDisarmPick({ silent: true });
      propertyCardCabinetPickNotify("Cabinets changed — press _ again");
      return false;
    }
    propertyCardCabinetPickConsume(event);
    propertyCardCabinetPickDisarmPick({ silent: true });
    propertyCardCabinetPickToggleKind(view, kind);
    return false;
  }
  if (key === "-") {
    propertyCardCabinetPickConsume(event);
    propertyCardCabinetPickDisarmPick({ silent: true });
    propertyCardCabinetPickToggleKind(view, "properties");
    return false;
  }
  propertyCardCabinetPickDisarmPick({ silent: true });
  return true;
}

function propertyCardCabinetCanUnderscore(view) {
  try {
    const collected = propertyCardCabinetsInView(view);
    if (!collected || !collected.path) return false;
    const extras = collected.extras || [];
    if (extras.length === 0) {
      return Boolean(collected.details) && typeof propertyCardToggleDetails === "function";
    }
    return true;
  } catch (_) {
    return false;
  }
}

// 0 extras → the details fold (else Vim `_`); 1 extra → toggle it at once;
// 2 or more → arm the numbered pick and toggle nothing yet. Palette parity:
// the `toggle-card-details` command runs this same dispatch, so arming works
// in Reading and digits work in any mode while armed.
function propertyCardCabinetUnderscore(view, pluginHint) {
  let collected = null;
  try { collected = propertyCardCabinetsInView(view); } catch (_) { collected = null; }
  if (!collected || !collected.path) return false;
  const extras = collected.extras || [];
  if (extras.length === 0) {
    if (!collected.details || typeof propertyCardToggleDetails !== "function") return false;
    try { return propertyCardToggleDetails(view) === true; } catch (_) { return false; }
  }
  if (extras.length === 1) {
    try { return propertyCardCabinetToggle(view, extras[0].kind) === true; } catch (_) { return false; }
  }
  let plugin = null;
  try { plugin = propertyCardCabinetPickPluginForView(view, pluginHint); } catch (_) { plugin = null; }
  try { return propertyCardCabinetPickArm(view, collected, plugin) === true; } catch (_) { return false; }
}
