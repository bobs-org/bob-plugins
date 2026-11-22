// Notice v6: consume `req_outcomes` / `req_met` from the cycler apply
// service. Does not wire managed Done. Wraps the v5 jump/offer-close
// renderer so requirement receipts sit with the existing card and one
// guarded Undo. Req-only cards label the action `Undo`; mixed offer-close
// cards keep `Undo closes`.

function reqCloseNoticeList(value) {
  return (Array.isArray(value) ? value : [])
    .filter((entry) => entry && typeof entry === "object");
}

function reqCloseNoticeReceipt(entry) {
  return unblockedNoticeText(entry && (entry.receipt || entry.message || entry.text));
}

const buildUnblockedNoticeModelBeforeReqClose = buildUnblockedNoticeModel;
buildUnblockedNoticeModel = function buildUnblockedNoticeModelWithReqClose(model, options = {}) {
  const view = buildUnblockedNoticeModelBeforeReqClose(model, options);
  const source = model && typeof model === "object" ? model : {};
  const outcomes = reqCloseNoticeList(source.req_outcomes || source.reqOutcomes)
    .map((row) => Object.freeze({
      verdict: row.verdict === "drop" || row.verdict === "carry" || row.verdict === "carry_pulled"
        ? row.verdict
        : "met",
      receipt: reqCloseNoticeReceipt(row),
      text: unblockedNoticeText(row.text),
      rowKey: unblockedNoticeText(row.row_key || row.rowKey),
    }))
    .filter((row) => row.receipt);
  const met = reqCloseNoticeList(source.req_met || source.reqMet)
    .map((row) => Object.freeze({
      ownerKey: unblockedNoticeText(row.owner_key || row.ownerKey),
      count: Math.max(0, Math.floor(Number(row.count) || 0)),
      receipt: reqCloseNoticeReceipt(row),
    }))
    .filter((row) => row.receipt);
  if (outcomes.length === 0 && met.length === 0) return view;
  const restores = source.undo && Array.isArray(source.undo.restores)
    ? source.undo.restores
    : (Array.isArray(source.restores) ? source.restores : []);
  const extra = [
    ...outcomes.map((row) => row.receipt),
    ...met.map((row) => row.receipt),
  ];
  const base = view || Object.freeze({
    rows: Object.freeze([]), visibleRows: Object.freeze([]), moreCount: 0,
    predecessors: Object.freeze([]), linked: Object.freeze([]), recovered: Object.freeze([]),
    stillBlocked: Object.freeze([]), chips: Object.freeze([]),
    receipt: extra[0] || "Requirements", title: "Requirements", glyph: "✓",
    text: extra.join("\n"), durationMs: 10000, dailyPath: "", failure: null,
  });
  return Object.freeze({
    ...base,
    reqOutcomes: Object.freeze(outcomes),
    reqMet: Object.freeze(met),
    reqCloseUndo: restores.length > 0 ? Object.freeze(restores.slice()) : null,
    reqClosePlugin: source.__noticePlugin || null,
    text: [base.text, ...extra].filter(Boolean).join("\n"),
  });
};

const renderUnblockedNoticeBeforeReqClose = renderUnblockedNoticeFragment;
renderUnblockedNoticeFragment = function renderUnblockedNoticeWithReqClose(view, root, options = {}) {
  const card = renderUnblockedNoticeBeforeReqClose(view, root, options);
  if (!card || !view || (!(view.reqOutcomes && view.reqOutcomes.length) && !(view.reqMet && view.reqMet.length))) {
    return card;
  }
  for (const outcome of view.reqOutcomes || []) {
    const row = card.createDiv({ cls: `bob-nh-unblock-row is-req is-${outcome.verdict}` });
    row.createSpan({ cls: "bob-nh-unblock-text", text: outcome.receipt });
  }
  for (const row of view.reqMet || []) {
    card.createDiv({ cls: "bob-nh-unblock-row is-req is-met is-muted", text: row.receipt });
  }
  const alreadyUndo = Boolean(view.offerCloseUndo && view.offerClosePlugin);
  if (!alreadyUndo && view.reqCloseUndo && view.reqClosePlugin) {
    const plugin = view.reqClosePlugin;
    const button = typeof card.createEl === "function"
      ? card.createEl("button", { text: "Undo", cls: "bob-nh-notice-action" })
      : card.createDiv({ text: "Undo", cls: "bob-nh-notice-action", attr: { role: "button" } });
    if (typeof button.addEventListener === "function") {
      button.addEventListener("click", () => {
        if (typeof plugin.restoreGuardedSnapshots === "function") {
          void plugin.restoreGuardedSnapshots(view.reqCloseUndo, {
            successMessage: "Requirement writes undone",
            failureLabel: "Could not undo requirement writes",
          });
        }
      });
    }
  }
  return card;
};

const showUnblockedNoticeBeforeReqClose = showUnblockedNotice;
showUnblockedNotice = function showUnblockedNoticeWithReqClose(app, model, options = {}) {
  const view = buildUnblockedNoticeModel(model, { app });
  if (!view || !view.reqClosePlugin || view.offerClosePlugin) {
    return showUnblockedNoticeBeforeReqClose(app, model, options);
  }
  const fallbackText = view.text || "Requirements";
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
      buildUnblockedNoticeModel,
      renderUnblockedNoticeFragment,
      showUnblockedNotice,
      createNoticeApi,
    });
  }
} catch (_error) {
  // Keep the runtime independent from the CommonJS test harness.
}
