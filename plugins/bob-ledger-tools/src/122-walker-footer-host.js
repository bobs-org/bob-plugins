// Walker-footer host (plan 202611/walker_footers.md, phase host): one
// ledger status-bar item follows the persisted bracket walk. While `s`
// is the family the existing review footer paints (gated, with a calm
// clear state instead of hiding); `w`, `n`, and unset hide in this
// phase — their panels land in the lanes and links phases. When nav is
// absent or its `api.walkMode` namespace is older than v1, the router
// stays on the legacy path: today's review footer exactly as now.
// Never throws; every entry point falls back to hiding or legacy.
const WALKER_FOOTER_DOORBELL_EVENT = "bob-navigation-hotkeys:walk-mode";
const WALKER_FOOTER_REPEAT_HINT = "]] next";

// Resolve which panel the host should paint. `legacy: true` means nav
// is missing or predates `api.walkMode` v1, so the caller paints the
// ungated review footer. Otherwise `mode` is the persisted family
// ("s", "w", "n", or null for unset); only "s" paints in this phase.
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
    if (mode !== "s" && mode !== "w" && mode !== "n") {
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
