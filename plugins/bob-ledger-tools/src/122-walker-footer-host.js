// Walker-footer host (plan 202611/walker_footers.md, phase host): one
// ledger status-bar item follows the persisted bracket walk. `s`, `w`,
// `n`, and `b` each paint their panel; unset hides. When nav is absent
// or its `api.walkMode` namespace is older than v1, the router stays on
// the legacy path: today's review footer exactly as now. Never throws;
// every entry point falls back to hiding or legacy.
const WALKER_FOOTER_DOORBELL_EVENT = "bob-navigation-hotkeys:walk-mode";
const WALKER_FOOTER_REPEAT_HINT = "]] next";

function walkerFooterOverlayEnsureNode(host, className, doc) {
  try {
    if (!host || !doc || typeof doc.createElement !== "function") return null;
    let node = host.querySelector?.("." + className);
    if (!node) {
      node = doc.createElement("div");
      node.className = className;
      host.appendChild?.(node);
    }
    node.setAttribute?.("role", "status");
    node.setAttribute?.("aria-live", "polite");
    node.setAttribute?.("aria-atomic", "true");
    return node;
  } catch (_error) {
    return null;
  }
}

function walkerFooterCabinetOverlayParts(text) {
  const match = String(text || "").match(/^▤ Cabinets\s{3}(.+)\s{3}- Properties\s{3}esc$/);
  if (!match) return null;
  const cabinets = match[1].split(" · ").map((chip) => {
    const row = chip.match(/^(\d+)\s+(.+?)\s+([▸▾])$/);
    return row ? { key: row[1], noun: row[2], state: row[3] } : null;
  });
  if (cabinets.some((row) => !row)) return null;
  return { label: "▤ Cabinets", cabinets, properties: { key: "-", noun: "Properties" }, cancel: "esc" };
}

function walkerFooterOverlayPaintText(overlay, text) {
  const parts = walkerFooterCabinetOverlayParts(text);
  if (!parts || !overlay?.ownerDocument?.createElement) {
    if (overlay) overlay.textContent = text;
    return false;
  }
  const doc = overlay.ownerDocument;
  const append = (className, value, parent = overlay) => {
    const node = doc.createElement("span");
    node.className = className;
    node.textContent = value;
    parent.appendChild(node);
    return node;
  };
  try {
    overlay.textContent = "";
    append("bob-walker-footer-overlay-label", parts.label);
    for (const cabinet of parts.cabinets) {
      const chip = append("bob-walker-footer-overlay-chip", "");
      append("bob-walker-footer-overlay-key", cabinet.key, chip);
      append("bob-walker-footer-overlay-noun", cabinet.noun, chip);
      append("bob-walker-footer-overlay-state", cabinet.state, chip);
    }
    const properties = append("bob-walker-footer-overlay-chip bob-walker-footer-overlay-properties", "");
    append("bob-walker-footer-overlay-key", parts.properties.key, properties);
    append("bob-walker-footer-overlay-noun", parts.properties.noun, properties);
    append("bob-walker-footer-overlay-cancel", parts.cancel);
    overlay.setAttribute?.("aria-label", text);
    return true;
  } catch (_error) {
    overlay.textContent = text;
    return false;
  }
}

function walkerFooterOverlayStatusBarVisible(el) {
  try {
    if (!el || el.isConnected === false) return false;
    const win = el.ownerDocument && el.ownerDocument.defaultView;
    const getStyle = win && win.getComputedStyle;
    if (typeof getStyle === "function") {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getStyle.call(win, node);
        if (style && (style.display === "none" || style.visibility === "hidden")) {
          return false;
        }
        if (node.classList?.contains("status-bar")) break;
      }
    }
    const bar = el.closest?.(".status-bar");
    if (bar && typeof bar.getClientRects === "function" && bar.getClientRects().length === 0) {
      return false;
    }
    return true;
  } catch (_error) {
    return Boolean(el);
  }
}

function walkerFooterOverlayRender(plugin) {
  const stack = plugin && Array.isArray(plugin.walkerFooterOverlayStack)
    ? plugin.walkerFooterOverlayStack
    : [];
  const top = stack.length ? stack[stack.length - 1] : null;
  const el = plugin && plugin.freshnessStatusEl;
  const previousFallback = plugin && plugin.walkerFooterOverlayFallback;
  try { previousFallback?.remove?.(); } catch (_error) {}
  if (plugin) plugin.walkerFooterOverlayFallback = null;

  if (!top) {
    try {
      el?.classList?.remove("bob-walker-footer-overlay-active");
      const overlay = el?.querySelector?.(".bob-walker-footer-overlay");
      overlay?.remove?.();
    } catch (_error) {}
    return;
  }

  const visible = walkerFooterOverlayStatusBarVisible(el);
  if (visible) {
    try {
      el.classList?.remove("bob-freshness-hidden");
      el.classList?.add("bob-walker-footer-overlay-active");
      el.setAttribute?.("aria-hidden", "false");
      const overlay = walkerFooterOverlayEnsureNode(
        el,
        "bob-walker-footer-overlay",
        el.ownerDocument,
      );
      if (overlay) walkerFooterOverlayPaintText(overlay, top.text);
    } catch (_error) {}
    return;
  }

  const host = top.view && (top.view.contentEl || top.view.containerEl);
  const doc = host && host.ownerDocument;
  const fallback = walkerFooterOverlayEnsureNode(
    host,
    "bob-walker-footer-fallback",
    doc,
  );
  if (fallback) {
    fallback.classList?.add("bob-walker-footer-overlay");
    walkerFooterOverlayPaintText(fallback, top.text);
    plugin.walkerFooterOverlayFallback = fallback;
  }
}

function walkerFooterOverlayPush(plugin, text, options = {}) {
  if (!plugin || typeof text !== "string") return null;
  if (!Array.isArray(plugin.walkerFooterOverlayStack)) {
    plugin.walkerFooterOverlayStack = [];
  }
  const token = {};
  plugin.walkerFooterOverlayStack.push({
    token,
    text,
    view: options && options.view ? options.view : null,
  });
  const el = plugin.freshnessStatusEl;
  if (el) {
    try {
      el.setAttribute?.("aria-live", "polite");
      el.setAttribute?.("aria-atomic", "true");
      el._bobWalkerFooterOverlayOwner = plugin;
    } catch (_error) {}
  }
  walkerFooterOverlayRender(plugin);
  return token;
}

function walkerFooterOverlayPop(plugin, token) {
  const stack = plugin && plugin.walkerFooterOverlayStack;
  if (!Array.isArray(stack) || !stack.length) return false;
  const top = stack[stack.length - 1];
  if (token && top.token !== token) return false;
  stack.pop();
  walkerFooterOverlayRender(plugin);
  if (stack.length) return true;

  const el = plugin.freshnessStatusEl;
  if (el) {
    try { el.classList?.remove("bob-walker-footer-overlay-active"); } catch (_error) {}
    const deferred = el._bobWalkerFooterDeferredView;
    el._bobWalkerFooterDeferredView = null;
    if (deferred) {
      try {
        plugin.freshnessFooterLastView = deferred;
        plugin.freshnessFooterParts = freshnessFooterPaint(el, deferred);
      } catch (_error) {}
    }
  }
  try {
    plugin.freshnessFooterPaintKey = null;
    plugin.updateFreshnessStatusBar?.();
  } catch (_error) {}
  return true;
}

function walkerFooterOverlayClear(plugin) {
  if (!plugin) return;
  plugin.walkerFooterOverlayStack = [];
  walkerFooterOverlayRender(plugin);
  const el = plugin.freshnessStatusEl;
  if (el) {
    el._bobWalkerFooterDeferredView = null;
    try { el.classList?.remove("bob-walker-footer-overlay-active"); } catch (_error) {}
  }
}

// The s mark is on exactly when ]s has a row to land on. Keep pushing while s
// is selected so nav v6 can paint its attention as readable ink. This is a
// display projection over the existing memo and never changes task or walk
// state.
function walkerFooterReviewAttentionLabel(walk, commitments, tierLabel) {
  const due = Number.isInteger(walk) && walk > 0 ? walk : 0;
  const count = Number.isInteger(commitments) && commitments >= 0
    ? commitments
    : 0;
  const first = String(tierLabel || "");
  if (count === 1) {
    return `Review: ${due} due · 1 commitment — ${first} first`;
  }
  if (count > 1) {
    return `Review: ${due} due · ${count} commitments — ${first} first`;
  }
  return `Review: ${due} due · commitments done — ${first} first`;
}

function walkerFooterPushReviewAttention(plugin, route, memo) {
  try {
    const api = plugin && typeof plugin.dependencyNavApi === "function"
      ? plugin.dependencyNavApi()
      : null;
    const walkMode = api && api.walkMode;
    if (
      !walkMode ||
      Number(walkMode.version) < 3 ||
      typeof walkMode.setAttention !== "function"
    ) {
      return;
    }
    if (!route || route.legacy) {
      walkMode.setAttention("s", null);
      return;
    }
    let snapshot = memo;
    if (!snapshot || typeof snapshot !== "object") {
      snapshot = typeof plugin.freshnessEnsureMemo === "function"
        ? plugin.freshnessEnsureMemo()
        : plugin.freshnessMemo;
    }
    if (!snapshot || snapshot.tasksAvailable === false) {
      walkMode.setAttention("s", null);
      return;
    }
    const read = freshnessFooterReadTiers(snapshot.counts || snapshot);
    const commitments = read.commitments;
    if (read.walk <= 0) {
      walkMode.setAttention("s", null);
      return;
    }
    const tier = FRESHNESS_FOOTER_TIERS.find((key) => read.tiers[key] > 0);
    if (!tier) {
      walkMode.setAttention("s", null);
      return;
    }
    const dueLabel = freshnessTierFooterLabel(tier);
    const clickHint = route.mode === "s" ? "" : "; click to show";
    walkMode.setAttention("s", {
      tier,
      label: `${walkerFooterReviewAttentionLabel(read.walk, commitments, dueLabel)}${clickHint}`,
    });
  } catch (_error) {
    // A stale or throwing nav listener never blocks footer painting.
  }
}

// Resolve which panel the host should paint. `legacy: true` means nav
// is missing or predates `api.walkMode` v1, so the caller paints the
// ungated review footer. Otherwise `mode` is the persisted family
// ("s", "w", "n", "b", or null for unset).
function walkerFooterWalkMode(plugin) {
  try {
    const api =
      plugin && typeof plugin.dependencyNavApi === "function"
        ? plugin.dependencyNavApi()
        : null;
    const walkMode =
      api && api.walkMode && typeof api.walkMode === "object"
        ? api.walkMode
        : null;
    if (
      !walkMode ||
      !(Number(walkMode.version) >= 1) ||
      typeof walkMode.current !== "function"
    ) {
      return { legacy: true, mode: null };
    }
    let mode = null;
    try {
      mode = walkMode.current();
    } catch (error) {
      // An unreadable family is a missing provider, never "the mode is
      // s": fall back to today's ungated footer rather than hiding.
      return { legacy: true, mode: null };
    }
    if (mode !== "s" && mode !== "w" && mode !== "n" && mode !== "b") {
      mode = null;
    }
    return { legacy: false, mode };
  } catch (error) {
    return { legacy: true, mode: null };
  }
}

// Calm clear state for the gated `s` panel (A5): the queue is empty but
// the data is trustworthy, so the selected walk still paints instead of
// vanishing. `Review clear` describes the current eligible queue, not
// the week's commitments. The prioritized Alt+P preview folds into the
// hint slot when the cursor sits on a prioritized task row.
function walkerFooterClearView(memo, options = {}) {
  try {
    const navAvailable = options.navAvailable !== false;
    const preview = freshnessFooterOffwalkQuickRoll(options.quickRoll);
    const counts =
      memo && memo.counts && typeof memo.counts === "object"
        ? memo.counts
        : memo;
    const read = freshnessFooterReadTiers(counts);
    const upkeep = Number.isInteger(read.upkeep) && read.upkeep >= 0
      ? read.upkeep
      : 0;
    const meter = read.budget !== null
      ? upkeep + "/" + read.budget
      : String(upkeep);
    const meterText = "✓ " + meter + " today";
    const action = navAvailable ? "jump" : "review";
    const dueText = "Review clear";
    const hintText = preview ? preview.compact : "";
    const tooltipLines = [
      freshnessFooterJoin([dueText, hintText, meterText]),
    ];
    if (preview && preview.detail) {
      tooltipLines.push(preview.detail);
    }
    tooltipLines.push(
      action === "jump"
        ? "click for the next due task"
        : "click to open the review page",
    );
    return {
      visible: true,
      mode: "clear",
      walk: 0,
      commitments: 0,
      dueText,
      contextText: "",
      detailText: "",
      detailCompactText: "",
      hintText,
      groups: [],
      groupsText: "",
      meterText,
      tooltip: tooltipLines.filter(Boolean).join("\n"),
      ariaLabel: freshnessFooterJoin([dueText, hintText, meterText]),
      current: null,
      action,
      answer: null,
    };
  } catch (error) {
    return freshnessFooterHiddenView();
  }
}

// Gated `s` review view: today's review footer with `]] next` hints and
// the clear state in place of hide-on-empty. The caller passes the same
// options it would pass to `freshnessFooterView`.
function walkerFooterReviewView(memo, options = {}) {
  try {
    if (memo && typeof memo === "object" && memo.tasksAvailable === false) {
      return freshnessFooterHiddenView();
    }
    const fromMemo =
      memo && Array.isArray(memo.queue) ? memo.queue : null;
    const fromOptions =
      options && Array.isArray(options.queue) ? options.queue : null;
    const queue = fromMemo || fromOptions || [];
    if (queue.length === 0) {
      return walkerFooterClearView(memo, options);
    }
    const merged = {};
    if (options && typeof options === "object") {
      for (const key of Object.keys(options)) {
        merged[key] = options[key];
      }
    }
    merged.repeatHint = WALKER_FOOTER_REPEAT_HINT;
    const view = freshnessFooterView(memo, merged);
    if (view && view.visible === true) {
      return view;
    }
    if (memo && typeof memo === "object" && memo.tasksAvailable !== false) {
      return walkerFooterClearView(memo, options);
    }
    return freshnessFooterHiddenView();
  } catch (error) {
    return freshnessFooterHiddenView();
  }
}
