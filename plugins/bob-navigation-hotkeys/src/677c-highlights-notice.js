function highlightsNoticeModel(target, status = "opening", message = null) {
  const value = target || {};
  const title = typeof value.title === "string" && value.title ? value.title : "Untitled";
  const page = normalizeHighlightsPageOption(value.page);
  const kind = value.kind || "reading";
  const level = kind === "removed"
    ? "muted"
    : status === "failed" || kind === "error" || kind === "missing-highlight"
    ? "error"
    : status === "unavailable"
      ? "warn"
      : "opening";
  const state = kind === "removed"
    ? "Removed"
    : status === "failed" || kind === "error" || kind === "missing-highlight"
    ? "Couldn't open"
    : status === "unavailable"
      ? "Opened"
      : "Opening";
  const plain = message || (kind === "reading"
    ? `Opening ${title} in Highlights — resumes where you left off`
    : page !== null
      ? `Opening ${title} in Highlights at p. ${page}`
      : `Opening ${title} in Highlights — no page number on this highlight`);
  let detail = "No page number on this highlight — opens where you left off";
  if (kind === "reading") detail = "Resumes where you left off";
  else if (value.detail === "image") detail = "Image highlight";
  else if (kind === "caption") {
    const count = Number.isInteger(value.captionCount) ? value.captionCount : 0;
    detail = `${count} highlight${count === 1 ? "" : "s"} on this page`;
  } else if (page !== null && (value.detail === "quote" || value.detail === "note") && value.snippet) {
    detail = `“${value.snippet}”`;
  }
  if (kind === "removed" || kind === "missing-highlight" || kind === "error") {
    detail = String(message || value.message || plain);
  } else if (status === "unavailable") {
    detail = `Jumping to p. ${page} needs Hammerspoon`;
  } else if (status === "failed") {
    detail = String(message || "Could not open in Highlights");
  }
  return {
    target: value, title, page, kind, status, level, state, detail,
    duration: level === "error" || level === "warn" ? 8000 : 4000,
    text: plain,
  };
}

function renderHighlightsNoticeFragment(model, root) {
  const card = root.createDiv({
    cls: `bob-nh-notice bob-nh-highlights${model.level === "warn" ? " is-warn" : model.level === "error" ? " is-error" : model.level === "muted" ? " is-muted" : ""}`,
    attr: { "aria-label": model.text },
  });
  const header = card.createDiv({ cls: "bob-nh-notice-header" });
  const icon = header.createSpan({ cls: "bob-nh-notice-icon", attr: { "aria-hidden": "true" } });
  try { applyIcon(icon, "highlighter"); } catch (_error) { /* Icon is best-effort. */ }
  header.createSpan({ cls: "bob-nh-notice-level", text: "Highlights" });
  header.createSpan({ cls: "bob-nh-highlights-status", text: model.state });
  if (model.page !== null) header.createSpan({ cls: "bob-nh-notice-receipt", text: `p. ${model.page}` });
  card.createDiv({ cls: "bob-nh-highlights-title", text: model.title });
  card.createDiv({ cls: "bob-nh-highlights-detail", text: model.detail });
  if (model.target.archived) {
    const replaced = model.target.archived.replaced;
    card.createDiv({ cls: "bob-nh-notice-chip bob-nh-highlights-archive", text: `Archived copy${replaced ? ` · replaced ${replaced}` : ""}` });
  }
  return card;
}

function showHighlightsNotice(plugin, model, existing = null) {
  const fallbackText = model.text;
  const showText = (text) => { try { new Notice(String(text)); } catch (_error) { /* Notice is best-effort in tests. */ } };
  try {
    const fragment = typeof document === "undefined" ? null : document.createDocumentFragment();
    if (!fragment || typeof fragment.createDiv !== "function") {
      if (existing && typeof existing.hide === "function") existing.hide();
      showText(fallbackText);
      if (plugin) plugin.highlightsNotice = null;
      return null;
    }
    renderHighlightsNoticeFragment(model, fragment);
    if (existing && existing._bobHighlightsDuration === model.duration && typeof existing.setMessage === "function" && existing.noticeEl) {
      existing.setMessage(fragment);
      const card = existing.noticeEl.querySelector && existing.noticeEl.querySelector(".bob-nh-highlights");
      if (card && card.setAttribute) card.setAttribute("aria-label", model.text);
      if (plugin) plugin.highlightsNotice = existing;
      return existing;
    }
    if (existing && typeof existing.hide === "function") existing.hide();
    const notice = new Notice(fragment, model.duration);
    notice._bobHighlightsDuration = model.duration;
    if (plugin) plugin.highlightsNotice = notice;
    return notice;
  } catch (_error) {
    if (existing && typeof existing.hide === "function") existing.hide();
    showText(fallbackText);
    if (plugin) plugin.highlightsNotice = null;
    return null;
  }
}
