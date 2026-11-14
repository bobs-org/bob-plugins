// Bank-walk landing toast. The single notice is replaced on each landing.
function buildBankWalkNoticeModel(snapshot, plan) {
  const entry = plan && plan.entry ? plan.entry : {};
  const scope = bankWalkScope(snapshot);
  const rank = Number.isInteger(plan && plan.rank) ? plan.rank : 1;
  const total = Number.isInteger(plan && plan.total) ? plan.total : 1;
  const dayRank = Number.isInteger(plan && plan.dayRank) ? plan.dayRank : 1;
  const dayTotal = Number.isInteger(plan && plan.dayTotal) ? plan.dayTotal : 1;
  const waiting = snapshot && snapshot.counts && Number.isInteger(snapshot.counts.waiting)
    ? snapshot.counts.waiting
    : 0;
  const title = String(entry.payee || "Bank row").trim() || "Bank row";
  const date = String(entry.date || "");
  const amount = String(entry.amountText || "");
  const text = `${scope.toUpperCase()} ${rank}/${total} · ${date}${amount ? ` · ${amount}` : ""} ${title}${plan && plan.wrapped ? " · ↻ wrapped" : ""}`.trim();
  return Object.freeze({
    empty: false,
    text,
    scope,
    rank,
    total,
    dayRank,
    dayTotal,
    waiting,
    title,
    date,
    amount,
    inflow: entry.inflow === true,
    wrapped: Boolean(plan && plan.wrapped),
  });
}

function renderBankWalkNoticeFragment(model, root) {
  const scope = model.scope === "all" ? "all" : "waiting";
  const card = root.createDiv({
    cls: `bob-nh-notice bob-nh-bank-walk is-${scope}`,
    attr: { "aria-label": model.text },
  });
  const header = card.createDiv({ cls: "bob-nh-notice-header" });
  header.createSpan({ cls: "bob-nh-bank-walk-glyph", text: "$", attr: { "aria-hidden": "true" } });
  header.createSpan({ cls: "bob-nh-notice-level", text: scope === "waiting" ? "WAITING" : "ALL" });
  header.createSpan({ cls: "bob-nh-notice-count", text: `${model.rank}/${model.total}` });
  header.createSpan({ cls: "bob-nh-notice-receipt", text: `${model.dayRank}/${model.dayTotal}` });
  const rail = card.createDiv({ cls: "bob-nh-bank-walk-rail", attr: { "aria-hidden": "true" } });
  const progress = rail.createDiv({ cls: "bob-nh-bank-walk-progress" });
  progress.setAttribute("style", `width: ${Math.max(3, Math.min(100, (model.rank / Math.max(1, model.total)) * 100))}%`);
  card.createDiv({ cls: "bob-nh-bank-walk-title", text: model.title });
  const chips = card.createDiv({ cls: "bob-nh-notice-chips" });
  if (model.date) chips.createSpan({ cls: "bob-nh-notice-chip", text: model.date });
  if (model.amount) chips.createSpan({ cls: `bob-nh-notice-chip ${model.inflow ? "is-info" : ""}`, text: model.amount });
  if (model.wrapped) chips.createSpan({ cls: "bob-nh-notice-chip is-info", text: "↻ wrapped" });
  if (model.waiting > 0) chips.createSpan({ cls: "bob-nh-notice-chip", text: `${model.waiting} waiting` });
  const hint = card.createDiv({ cls: "bob-nh-lane-walk-hint" });
  hint.createSpan({ cls: "bob-nh-lane-walk-key", text: "]b / [b" });
  hint.createSpan({ text: " rows · " });
  hint.createSpan({ cls: "bob-nh-lane-walk-key", text: "]B / [B" });
  hint.createSpan({ text: " days" });
  return card;
}

function showBankWalkEmptyNotice(plugin, text) {
  showBankWalkNotice(plugin, { empty: true, text: String(text || "No bank rows — bob bank import") });
}

function showBankWalkNotice(plugin, model) {
  const fallback = model && typeof model.text === "string" ? model.text : String(model || "");
  const showText = (text) => {
    try { new Notice(String(text)); } catch (_error) {}
  };
  try {
    if (plugin && plugin.bankWalkNotice && typeof plugin.bankWalkNotice.hide === "function") {
      plugin.bankWalkNotice.hide();
    }
    if (plugin) plugin.bankWalkNotice = null;
    if (typeof document === "undefined") {
      showText(fallback);
      return;
    }
    const fragment = document.createDocumentFragment();
    if (!fragment || typeof fragment.createDiv !== "function") {
      showText(fallback);
      return;
    }
    if (model && model.empty === true) {
      const card = fragment.createDiv({ cls: "bob-nh-notice bob-nh-bank-walk is-clear", attr: { "aria-label": fallback } });
      card.createDiv({ cls: "bob-nh-notice-header" }).createSpan({ cls: "bob-nh-notice-level", text: "Bank walk" });
      card.createDiv({ cls: "bob-nh-bank-walk-title", text: fallback });
    } else {
      renderBankWalkNoticeFragment(model || {}, fragment);
    }
    const notice = new Notice(fragment);
    if (plugin) plugin.bankWalkNotice = notice;
  } catch (_error) {
    showText(fallback);
  }
}
