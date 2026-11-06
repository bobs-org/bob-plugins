// Successor offer cancel and notice APIs (docs/develop/plugin-apis.md §12.13).
const OFFER_CANCEL_FALLBACK_REASON = "🤷 no reason given";

function createCancelApi() {
  return Object.freeze({
    version: 1,
    planCancel(content, targets, options = {}) {
      const rows = Array.isArray(targets) ? targets : [];
      return planTaskCancelBatch(
        content,
        { valid: true, targets: rows },
        {
          date: options.date,
          reason: options.reason,
          fallbackReason: OFFER_CANCEL_FALLBACK_REASON,
        },
      );
    },
  });
}

const buildUnblockedNoticeModelBeforeOfferCloses = buildUnblockedNoticeModel;
buildUnblockedNoticeModel = function buildUnblockedNoticeModelWithOfferCloses(model, options = {}) {
  const view = buildUnblockedNoticeModelBeforeOfferCloses(model, options);
  const source = model && typeof model === "object" ? model : {};
  const offerCloses = (Array.isArray(source.offer_closes) ? source.offer_closes : [])
    .filter((row) => row && typeof row === "object")
    .map((row) => Object.freeze({
      outcome: row.outcome === "done" ? "done" : "cancelled",
      text: unblockedNoticeText(row.text),
      message: unblockedNoticeText(row.message),
      recovered: Object.freeze((Array.isArray(row.recovered) ? row.recovered : [])
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => Object.freeze({
          text: unblockedNoticeText(entry.text),
          unblockedStamped: entry.unblocked_stamped === true || entry.unblockedStamped === true,
        }))),
    }));
  const hasOfferCloseResult = Array.isArray(source.offer_closes) ||
    (source.offer_close_refused && typeof source.offer_close_refused === "object");
  const failures = Object.freeze((hasOfferCloseResult && Array.isArray(source.failures) ? source.failures : [])
    .filter((failure) => failure && typeof failure === "object")
    .map((failure) => Object.freeze({
      kind: failure.kind === "recovery" ? "recovery" : "write",
      path: unblockedNoticeText(failure.path),
      reason: unblockedNoticeText(failure.reason),
    })));
  const refusalRows = source.offer_close_refused && Array.isArray(source.offer_close_refused.rows)
    ? source.offer_close_refused.rows : [];
  const refusal = source.offer_close_refused && typeof source.offer_close_refused === "object"
    ? Object.freeze({
        count: Math.max(0, Math.floor(numericOrDefault(source.offer_close_refused.count, refusalRows.length))),
        rows: Object.freeze(refusalRows.filter((row) => row && typeof row === "object")
          .map((row) => Object.freeze({ text: unblockedNoticeText(row.text), why: unblockedNoticeText(row.why) }))),
      })
    : null;
  const restores = source.undo && Array.isArray(source.undo.restores) ? source.undo.restores : [];
  if (!view && offerCloses.length === 0 && !(refusal && refusal.count > 0) && failures.length === 0) return null;
  const base = view || Object.freeze({
    rows: Object.freeze([]), visibleRows: Object.freeze([]), moreCount: 0,
    predecessors: Object.freeze([]), linked: Object.freeze([]), recovered: Object.freeze([]),
    stillBlocked: Object.freeze([]), chips: Object.freeze([]),
    receipt: "Offer closes", title: "Offer closes", glyph: "🔓", text: "Offer closes",
    durationMs: 10000, dailyPath: "", failure: null,
  });
  return Object.freeze({
    ...base,
    offerCloses: Object.freeze(offerCloses),
    offerCloseRefused: refusal && refusal.count > 0 ? refusal : null,
    offerCloseUndo: restores.length > 0 ? Object.freeze(restores.slice()) : null,
    offerCloseFailures: failures,
    offerClosePlugin: source.__noticePlugin || null,
    text: [
      base.text,
      ...offerCloses.map((row) => row.message || row.text).filter(Boolean),
      ...((() => {
        const stamped = offerCloses.flatMap((row) => row.recovered.filter((entry) => entry.unblockedStamped));
        if (stamped.length === 1) return [`↳ “${stamped[0].text}” back tomorrow as a tickler`];
        if (stamped.length > 1) return [`↳ ${stamped.length} unblocked tasks back tomorrow as ticklers`];
        return [];
      })()),
      ...(refusal && refusal.count > 0 ? [`${refusal.count} not closed · changed since the card opened`] : []),
      ...failures.map((failure) => `⚠ ${failure.kind === "recovery" ? "Recovery failed" : "Close write failed"}${failure.path ? ` · ${failure.path}` : ""}: ${failure.reason || "The write could not be completed."}`),
    ].filter(Boolean).join("\n"),
  });
};

const renderUnblockedNoticeBeforeOfferCloses = renderUnblockedNoticeFragment;
renderUnblockedNoticeFragment = function renderUnblockedNoticeWithOfferCloses(view, root, options = {}) {
  const card = renderUnblockedNoticeBeforeOfferCloses(view, root, options);
  if (!card || !view || (!view.offerCloses?.length && !view.offerCloseRefused && !view.offerCloseUndo && !view.offerCloseFailures?.length)) return card;
  const stampedRecoveries = [];
  for (const close of view.offerCloses || []) {
    const row = card.createDiv({ cls: `bob-nh-unblock-row is-offer-close is-${close.outcome}` });
    row.createSpan({ cls: "bob-nh-unblock-glyph", text: close.outcome === "done" ? "✓" : "⊘", attr: { "aria-hidden": "true" } });
    row.createSpan({ cls: "bob-nh-unblock-text", text: close.message || close.text });
    for (const recovered of close.recovered || []) {
      if (recovered.unblockedStamped) stampedRecoveries.push(recovered);
    }
  }
  if (stampedRecoveries.length === 1) {
    card.createDiv({ cls: "bob-nh-unblock-row is-muted is-offer-tickler", text: `↳ “${stampedRecoveries[0].text}” back tomorrow as a tickler` });
  } else if (stampedRecoveries.length > 1) {
    card.createDiv({ cls: "bob-nh-unblock-row is-muted is-offer-tickler", text: `↳ ${stampedRecoveries.length} unblocked tasks back tomorrow as ticklers` });
  }
  if (view.offerCloseRefused) {
    const refused = card.createDiv({ cls: "bob-nh-notice-reason is-refusal" });
    refused.createSpan({ cls: "bob-nh-notice-reason-text", text: `${view.offerCloseRefused.count} not closed · changed since the card opened` });
    for (const row of view.offerCloseRefused.rows) {
      if (row.text || row.why) refused.createDiv({ cls: "bob-nh-notice-reason-text", text: [row.text, row.why].filter(Boolean).join(" · ") });
    }
  }
  for (const failure of view.offerCloseFailures || []) {
    const failed = card.createDiv({ cls: "bob-nh-notice-reason is-failure" });
    failed.createSpan({ cls: "bob-nh-notice-reason-text", text: `⚠ ${failure.kind === "recovery" ? "Recovery failed" : "Close write failed"}${failure.path ? ` · ${failure.path}` : ""}: ${failure.reason || "The write could not be completed."}` });
  }
  if (view.offerCloseUndo && view.offerClosePlugin) {
    const plugin = view.offerClosePlugin;
    const button = typeof card.createEl === "function"
      ? card.createEl("button", { text: "Undo closes", cls: "bob-nh-notice-action" })
      : card.createDiv({ text: "Undo closes", cls: "bob-nh-notice-action", attr: { role: "button" } });
    if (typeof button.addEventListener === "function") button.addEventListener("click", () => {
      if (typeof plugin.restoreGuardedSnapshots === "function") {
        void plugin.restoreGuardedSnapshots(view.offerCloseUndo, {
          successMessage: "Closes undone",
          failureLabel: "Could not undo closes",
        });
      }
    });
  }
  return card;
};

// Extend only the offer-close receipt; payloads without the v4 fields keep the
// original v3 card and copy byte-for-byte.
const showUnblockedNoticeBeforeOfferCloses = showUnblockedNotice;
showUnblockedNotice = function showUnblockedNoticeWithOfferCloses(app, model, options = {}) {
  const view = buildUnblockedNoticeModel(model, { app });
  if (!view || !view.offerClosePlugin) return showUnblockedNoticeBeforeOfferCloses(app, model, options);
  const fallbackText = view.text || "Offer closes";
  try {
    if (typeof document === "undefined") {
      showBulletPropertyNotice(fallbackText, { ...options, app, duration: view.durationMs });
      return true;
    }
    const fragment = document.createDocumentFragment();
    if (!fragment || typeof fragment.createDiv !== "function") {
      showBulletPropertyNotice(fallbackText, { ...options, app, duration: view.durationMs });
      return true;
    }
    const card = renderUnblockedNoticeFragment(view, fragment, { app });
    if (!card) return false;
    showBulletPropertyNotice(fragment, { ...options, app, duration: view.durationMs });
    return true;
  } catch (_error) {
    showBulletPropertyNotice(fallbackText, { ...options, app, duration: view.durationMs });
    return true;
  }
};

try {
  if (typeof module !== "undefined" && module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      createCancelApi,
      buildUnblockedNoticeModel,
      renderUnblockedNoticeFragment,
      showUnblockedNotice,
      restoreGuardedSnapshots: (plugin, restores, options = {}) =>
        plugin && typeof plugin.restoreGuardedSnapshots === "function"
          ? plugin.restoreGuardedSnapshots(restores, options)
          : Promise.resolve(false),
      OFFER_CANCEL_FALLBACK_REASON,
    });
  }
} catch (_error) {
  // Keep the runtime independent from the CommonJS test harness.
}
