// Notice v5: a trailing `↗ “S”` receipt when `model.jump.label` is set.
// Wraps the v4 offer-close renderer so the jump line stays last.
const buildUnblockedNoticeModelBeforeJump = buildUnblockedNoticeModel;
buildUnblockedNoticeModel = function buildUnblockedNoticeModelWithJump(
  model,
  options = {},
) {
  const view = buildUnblockedNoticeModelBeforeJump(model, options);
  const source = model && typeof model === "object" ? model : {};
  const jump = source.jump && typeof source.jump === "object" ? source.jump : null;
  const label =
    jump && typeof jump.label === "string" ? jump.label.trim() : "";
  if (!label) {
    return view;
  }
  const receipt = formatSuccessorJumpReceipt(label);
  const base = view || Object.freeze({
    rows: Object.freeze([]),
    visibleRows: Object.freeze([]),
    moreCount: 0,
    predecessors: Object.freeze([]),
    linked: Object.freeze([]),
    recovered: Object.freeze([]),
    stillBlocked: Object.freeze([]),
    chips: Object.freeze([]),
    receipt: receipt,
    title: receipt,
    glyph: "↗",
    text: receipt,
    durationMs: 6000,
    dailyPath: "",
    failure: null,
  });
  return Object.freeze({
    ...base,
    jumpLabel: label,
    text: view
      ? [base.text, receipt].filter(Boolean).join("\n")
      : receipt,
  });
};

const renderUnblockedNoticeBeforeJump = renderUnblockedNoticeFragment;
renderUnblockedNoticeFragment = function renderUnblockedNoticeWithJump(
  view,
  root,
  options = {},
) {
  const card = renderUnblockedNoticeBeforeJump(view, root, options);
  if (!card || !view || !view.jumpLabel) {
    return card;
  }
  const row = card.createDiv({ cls: "bob-nh-unblock-row is-jump" });
  row.createSpan({
    cls: "bob-nh-unblock-glyph",
    text: "↗",
    attr: { "aria-hidden": "true" },
  });
  row.createSpan({
    cls: "bob-nh-unblock-text",
    text: formatSuccessorJumpReceipt(view.jumpLabel),
  });
  return card;
};

try {
  if (typeof module !== "undefined" && module.exports && module.exports.helpers) {
    Object.assign(module.exports.helpers, {
      successorJumpQuote,
      formatSuccessorJumpReceipt,
      formatSuccessorJumpLostNotice,
      taskLandingTargetLabel,
      resolveTaskLandingLine,
      buildUnblockedNoticeModel,
      renderUnblockedNoticeFragment,
      showUnblockedNotice,
      createNoticeApi,
      createReviewWalkApi,
      createDependencyNavApi,
    });
  }
} catch (_error) {
  // Keep the runtime independent from the CommonJS test harness.
}
