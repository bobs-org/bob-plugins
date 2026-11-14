// Bank-walk landing toast. The single notice is replaced on each landing.
const BANK_WALK_NOTICE_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function bankWalkNoticeMonthLabel(entry) {
  if (entry && typeof entry.monthLabel === "string" && entry.monthLabel.trim()) {
    return entry.monthLabel.trim();
  }
  const month = entry && typeof entry.month === "string" ? entry.month : "";
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    return month;
  }
  const name = BANK_WALK_NOTICE_MONTH_NAMES[Number(match[2]) - 1];
  return name ? `${name} ${match[1]}` : month;
}

function buildBankWalkNoticeModel(snapshot, plan, banner) {
  const entry = plan && plan.entry ? plan.entry : {};
  const scope = bankWalkScope(snapshot);
  const rank = Number.isInteger(plan && plan.rank) ? plan.rank : 1;
  const total = Number.isInteger(plan && plan.total) ? plan.total : 1;
  const dayRank = Number.isInteger(plan && plan.dayRank) ? plan.dayRank : 1;
  const dayTotal = Number.isInteger(plan && plan.dayTotal) ? plan.dayTotal : 1;
  const dayIndex = Number.isInteger(plan && plan.dayIndex) ? plan.dayIndex : 0;
  const dayCount = Number.isInteger(plan && plan.dayCount)
    ? plan.dayCount
    : (snapshot && Array.isArray(snapshot.days) ? snapshot.days.length : 0);
  const waiting = snapshot && snapshot.counts && Number.isInteger(snapshot.counts.waiting)
    ? snapshot.counts.waiting
    : 0;
  const payee = String(entry.payee || "Bank row").trim() || "Bank row";
  const label = String(entry.label || entry.date || "").trim();
  const amount = String(entry.amountText || "");
  const monthLabel = bankWalkNoticeMonthLabel(entry);
  const hint = scope === "waiting" ? "Ctrl+Enter file" : "]} next day";
  const wrapped = Boolean(plan && plan.wrapped);
  const scopeWord = scope === "waiting" ? "WAITING" : "ALL";
  const bannerText = typeof banner === "string" && banner ? banner : "";
  const header = `$ ${scopeWord} ${rank}/${total}${wrapped ? " ↻ wrapped" : ""}`;
  const dayLine = label ? `${label} · ${dayRank} of ${dayTotal}` : `${dayRank} of ${dayTotal}`;
  const moneyLine = [amount, payee].filter(Boolean).join("  ");
  const lastLine = [monthLabel, hint].filter(Boolean).join(" · ");
  const text = [bannerText, header, dayLine, moneyLine, lastLine].filter(Boolean).join(" · ");
  return Object.freeze({
    empty: false,
    text,
    banner: bannerText || null,
    scope,
    rank,
    total,
    dayRank,
    dayTotal,
    dayIndex,
    dayCount,
    waiting,
    title: payee,
    label,
    date: String(entry.date || ""),
    amount,
    payee,
    inflow: entry.inflow === true,
    monthLabel,
    hint,
    wrapped,
  });
}

function renderBankWalkDayRail(rail, model) {
  const count = Number.isInteger(model.dayCount) ? model.dayCount : 0;
  const lit = Number.isInteger(model.dayIndex) ? model.dayIndex : 0;
  if (count > 30) {
    const bar = rail.createDiv({ cls: "bob-nh-bank-walk-bar" });
    const fill = bar.createDiv({ cls: "bob-nh-bank-walk-bar-fill" });
    const percent = count > 0 ? Math.max(4, Math.min(100, ((lit + 0.5) / count) * 100)) : 4;
    try {
      fill.setAttribute("style", `width: ${percent}%`);
    } catch (_error) {}
    return;
  }
  const dots = count > 0 ? count : 1;
  for (let i = 0; i < dots; i += 1) {
    const current = i === lit;
    rail.createSpan({
      cls: `bob-nh-bank-walk-dot${current ? " is-current" : ""}`,
      attr: { "aria-hidden": "true" },
    });
  }
}

function renderBankWalkNoticeFragment(model, root) {
  const scope = model.scope === "all" ? "all" : "waiting";
  const card = root.createDiv({
    cls: `bob-nh-notice bob-nh-bank-walk is-${scope}`,
    attr: { "aria-label": model.text },
  });
  if (model.banner) {
    card.createDiv({ cls: "bob-nh-bank-walk-banner", text: model.banner });
  }
  const header = card.createDiv({ cls: "bob-nh-notice-header" });
  header.createSpan({ cls: "bob-nh-bank-walk-glyph", text: "$", attr: { "aria-hidden": "true" } });
  header.createSpan({ cls: "bob-nh-notice-level", text: scope === "waiting" ? "WAITING" : "ALL" });
  header.createSpan({ cls: "bob-nh-notice-count", text: `${model.rank}/${model.total}` });
  if (model.wrapped) {
    header.createSpan({ cls: "bob-nh-notice-receipt", text: "↻ wrapped" });
  }
  const rail = card.createDiv({ cls: "bob-nh-bank-walk-rail", attr: { "aria-hidden": "true" } });
  renderBankWalkDayRail(rail, model);
  card.createDiv({ cls: "bob-nh-bank-walk-day", text: model.label ? `${model.label} · ${model.dayRank} of ${model.dayTotal}` : `${model.dayRank} of ${model.dayTotal}` });
  const money = card.createDiv({ cls: "bob-nh-bank-walk-money" });
  if (model.amount) {
    money.createSpan({
      cls: `bob-nh-bank-walk-amount${model.inflow ? " is-inflow" : ""}`,
      text: model.amount,
    });
  }
  if (model.payee) {
    money.createSpan({ cls: "bob-nh-bank-walk-payee", text: model.payee });
  }
  const footer = card.createDiv({ cls: "bob-nh-bank-walk-footer" });
  if (model.monthLabel) {
    footer.createSpan({ cls: "bob-nh-bank-walk-month", text: model.monthLabel });
  }
  if (model.hint) {
    footer.createSpan({ cls: "bob-nh-bank-walk-hint", text: model.hint });
  }
  return card;
}

function showBankWalkEmptyNotice(plugin, text) {
  showBankWalkNotice(plugin, { empty: true, text: String(text || "No bank rows yet — bob bank import adds them") });
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
