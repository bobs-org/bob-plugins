// Pure bracket-selector view helpers. Kept out of the painter fragment so
// the growing family-specific attention model does not crowd the DOM code.
function bracketModeAttentionMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  if (Object.prototype.hasOwnProperty.call(value, "tier") || Object.prototype.hasOwnProperty.call(value, "label")) {
    return { s: value };
  }
  return value;
}

function bracketModeViewKey(view) {
  const segments = view && Array.isArray(view.segments) ? view.segments : [];
  const attention = segments
    .filter((segment) => segment && (segment.attention === true || segment.attentionInk === true))
    .map((segment) => `${segment.type}:${segment.attentionInk === true ? "ink" : "dot"}:${segment.attentionTier || ""}:${segment.attentionLabel || ""}`)
    .join("\u0001");
  return `${view && view.mode || "none"}\0${attention}`;
}

function buildBracketModeView(type, attention = {}) {
  let normalized = null;
  try {
    normalized = typeof normalizeBracketRepeatType === "function"
      ? normalizeBracketRepeatType(type)
      : BRACKET_MODE_FAMILIES.some((family) => family.type === type) ? type : null;
  } catch (error) {
    normalized = null;
  }
  const attentionByType = bracketModeAttentionMap(attention);
  const family = BRACKET_MODE_FAMILIES.find((item) => item.type === normalized) || null;
  const emptyNotice = typeof BRACKET_REPEAT_EMPTY_NOTICE === "string"
    ? BRACKET_REPEAT_EMPTY_NOTICE
    : "Nothing to repeat yet — press ]s, ]w, ]n, or ]b first";
  const BRACKET_MODE_ATTENTION_DEFAULT_LABELS = Object.freeze({
    s: "Review rows are due",
    w: "Lanes are over limit",
    b: "Bank rows are waiting",
  });
  const segments = BRACKET_MODE_FAMILIES.map((item) => {
    const raw = attentionByType[item.type];
    const present = Boolean(raw && typeof raw === "object");
    const selected = item.type === normalized;
    const label = present
      ? String(raw.label || BRACKET_MODE_ATTENTION_DEFAULT_LABELS[item.type] || "")
      : "";
    return Object.freeze({
      type: item.type,
      letter: item.letter,
      name: item.name,
      active: item.type === normalized,
      ariaLabel: present ? `${item.segmentAria}. ${label}` : item.segmentAria,
      attention: present && !selected,
      attentionInk: present && selected,
      attentionTier: present ? String(raw.tier || "") : "",
      attentionLabel: label,
    });
  });
  if (!family) {
    return Object.freeze({
      mode: "none",
      index: -1,
      ariaLabel: "Bracket repeat mode: not set",
      tooltip: `${emptyNotice}\n\n${BRACKET_MODE_NONE_HINT}`,
      segments: Object.freeze(segments),
    });
  }
  return Object.freeze({
    mode: normalized,
    index: BRACKET_MODE_FAMILIES.indexOf(family),
    ariaLabel: `Bracket repeat mode: ${family.name}`,
    tooltip: `${family.tooltip}\n${family.upperTooltip}\n\n${BRACKET_MODE_ACTIVE_HINT}`,
    segments: Object.freeze(segments),
  });
}
