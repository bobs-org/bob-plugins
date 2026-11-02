// Relation-successor copy builder (`docs/task-dependencies.md` §12.13 and
// §12.18). Pure: no vault I/O. Driven by the copied `relation_successor`
// copy vectors. Truncation matches the shared 48-scalar clean-text rule
// (ellipsis included).
const RELATION_COPY_MAX_TEXT = 48;
const RELATION_COPY_GLYPH = "🪢";
const RELATION_COPY_TAG = "your links · not dependents";
const RELATION_COPY_EVENTS = Object.freeze(["parked", "done"]);

function relationCopyTruncate(text) {
  const source = String(text === null || text === undefined ? "" : text);
  const chars = Array.from(source);
  if (chars.length <= RELATION_COPY_MAX_TEXT) {
    return source;
  }
  return `${chars.slice(0, RELATION_COPY_MAX_TEXT - 1).join("").trimEnd()}…`;
}

function relationCopyText(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function relationCopyList(value) {
  return Array.isArray(value) ? value.map(relationCopyText).filter(Boolean) : [];
}

function relationCopyQuote(text) {
  return `\u201c${relationCopyTruncate(relationCopyText(text))}\u201d`;
}

function relationCopyLabelTitle(label) {
  const value = relationCopyText(label);
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function relationCopyEvent(value) {
  const event = relationCopyText(value);
  return RELATION_COPY_EVENTS.includes(event) ? event : "";
}

function relationCopyGroupTitle(label, target) {
  return `${relationCopyLabelTitle(label)} ${relationCopyQuote(target)}`;
}

function relationCopyWhy(target, event) {
  const quoted = relationCopyQuote(target);
  if (event === "parked") {
    return `${quoted} is parked \u00b7 Pending, off today's plan`;
  }
  if (event === "done") {
    return `${quoted} is done`;
  }
  return "";
}

function relationCopyTag() {
  return RELATION_COPY_TAG;
}

function relationCopyChip(label, target) {
  return `${relationCopyText(label)} ${relationCopyQuote(target)}`;
}

function relationCopyReason(label, target) {
  const chip = relationCopyChip(label, target);
  return chip.trim() ? `\u00b7 ${chip}` : "";
}

function relationCopySuffix(targets) {
  const names = relationCopyList(targets);
  if (names.length < 2) return "";
  if (names.length === 2) {
    return `after ${relationCopyQuote(names[0])} and ${relationCopyQuote(names[1])}`;
  }
  return `after ${relationCopyQuote(names[0])} and ${names.length - 1} more`;
}

function relationCopyFold(input, style) {
  const src = input && typeof input === "object" ? input : {};
  const waits = relationCopyList(src.waits_for);
  const source = relationCopyText(src.source);
  const already = Math.max(0, Math.floor(Number(src.already_started) || 0));
  const blocked = Math.max(0, Math.floor(Number(src.blocked) || 0));
  const hidden = Math.max(0, Math.floor(Number(src.hidden) || 0));
  const waitTarget = waits[0] || (style === "cli" ? relationCopyText(src.target) : "");
  const parts = [];
  if (source && waitTarget) {
    parts.push(`${relationCopyQuote(source)} waits for ${relationCopyQuote(waitTarget)}`);
    if (waits.length > 1) {
      parts.push(`+${waits.length - 1} more waiting`);
    }
  }
  if (already > 0) parts.push(`${already} already started`);
  if (blocked > 0) parts.push(`${blocked} blocked`);
  if (hidden > 0) parts.push(`${hidden} hidden`);
  if (parts.length === 0) return "";
  if (style === "cli") return `not offered  ${parts.join(" \u00b7 ")}`;
  return ["not offered", ...parts].join(" \u00b7 ");
}

function relationCopyPickerTitle(input) {
  const src = input && typeof input === "object" ? input : {};
  const mixed = Array.isArray(src.mixed_groups) ? src.mixed_groups : [];
  if (mixed.some((group) => group !== "relation") && relationCopyText(src.existing_title)) {
    return relationCopyText(src.existing_title);
  }
  const targets = relationCopyList(src.targets);
  const count = Number.isFinite(Number(src.count)) ? Math.max(0, Math.floor(Number(src.count))) : 0;
  if (targets.length > 1) {
    const tasks = count > 0 ? count : targets.length;
    return `${relationCopyLabelTitle(src.label)} ${tasks} tasks`;
  }
  if (relationCopyText(src.target) || targets.length === 1) {
    return relationCopyGroupTitle(src.label, src.target || targets[0]);
  }
  if (count > 1) {
    return `${relationCopyLabelTitle(src.label)} ${count} tasks`;
  }
  return "";
}

function relationCopyLinkedNotice(input) {
  const src = input && typeof input === "object" ? input : {};
  const dest = relationCopyText(src.destination);
  const chip = relationCopyChip(src.label, src.target);
  const count = Number.isFinite(Number(src.count)) ? Math.max(1, Math.floor(Number(src.count))) : 1;
  if (count === 1 && relationCopyText(src.source)) {
    return `${RELATION_COPY_GLYPH} Next in ${dest}: ${relationCopyTruncate(src.source)} \u00b7 ${chip}`;
  }
  return `${RELATION_COPY_GLYPH} ${count} linked \u2192 ${dest} \u00b7 ${chip}`;
}

function relationCopyHeldReasonText(reason, input) {
  const src = input && typeof input === "object" ? input : {};
  if (reason === "waits_for") {
    return `waits for ${relationCopyQuote(src.other_target)}`;
  }
  if (reason === "already_started") return "already started";
  if (reason === "blocked") {
    const waitsOn = Math.max(0, Math.floor(Number(src.waits_on) || 0));
    return `blocked (waits on ${waitsOn})`;
  }
  if (reason === "scheduled") return `scheduled ${relationCopyText(src.date)}`;
  if (reason === "project") return "blocked by its project";
  if (reason === "hidden") return "hidden";
  return "";
}

function relationCopyHeldNotice(input, reason) {
  const src = input && typeof input === "object" ? input : {};
  const detail = relationCopyHeldReasonText(reason || src.reason, src);
  if (!detail) return "";
  return `${RELATION_COPY_GLYPH} ${relationCopyQuote(src.source)} ${relationCopyText(src.label)} ${relationCopyQuote(src.target)} \u00b7 not offered: ${detail}`;
}

function relationCopyUncertainty(input) {
  const src = input && typeof input === "object" ? input : {};
  const labels = relationCopyList(src.labels);
  if (labels.length === 0 && relationCopyText(src.label)) {
    labels.push(relationCopyText(src.label));
  }
  const what = labels.length > 1 ? "relation" : relationCopyText(labels[0] || "relation");
  return `${RELATION_COPY_GLYPH} Couldn't check ${what} links \u00b7 nothing offered`;
}

function relationCopyCliHeader(input) {
  const src = input && typeof input === "object" ? input : {};
  const event = relationCopyEvent(src.event) || "parked";
  return `${relationCopyGroupTitle(src.label, src.target)} \u00b7 it is ${event} (your ${RELATION_COPY_GLYPH} links, not dependents)`;
}

function relationCopyReceipt(target, event) {
  const text = relationCopyTruncate(relationCopyText(target));
  if (!text) return "";
  if (event === "parked") return `${text} parked`;
  return `\u2713 ${text}`;
}

function relationCopyAlreadyParked(input) {
  const src = input && typeof input === "object" ? input : {};
  return `${relationCopyQuote(src.target)} is already parked \u2014 ${relationCopyQuote(src.source)} will be offered when it is done`;
}

function relationCopyAlreadyClosed(input) {
  const src = input && typeof input === "object" ? input : {};
  return `${relationCopyQuote(src.target)} is already closed \u2014 nothing left to wait for`;
}

function relationCopyInverseHint(input) {
  const src = input && typeof input === "object" ? input : {};
  return `${relationCopyQuote(src.typed)} never offers anything \u00b7 to offer ${relationCopyQuote(src.source)} after this task, use ~~ with ${relationCopyQuote(src.label)}`;
}

function relationCopyOffersVerdict(input) {
  const src = input && typeof input === "object" ? input : {};
  return `${RELATION_COPY_GLYPH} Offers ${relationCopyQuote(src.source)} when ${relationCopyQuote(src.target)} is parked or done \u00b7 never blocks`;
}

function relationCopyRenameWarning(input) {
  const src = input && typeof input === "object" ? input : {};
  return `${relationCopyQuote(src.label)} is a successor label in config.yml \u2014 update relations.successor_labels`;
}

function relationSuccessorCopyValue(input, key, expected) {
  const src = input && typeof input === "object" ? input : {};
  switch (key) {
    case "title":
      return relationCopyPickerTitle(src);
    case "why":
      return relationCopyWhy(src.target, relationCopyEvent(src.event));
    case "tag":
      return RELATION_COPY_TAG;
    case "fold": {
      const ui = relationCopyFold(src, "ui");
      const cli = relationCopyFold(src, "cli");
      if (expected === cli) return cli;
      return ui;
    }
    case "suffix":
      return relationCopySuffix(src.targets);
    case "reason":
      return relationCopyReason(src.label, src.target);
    case "capsule":
      return relationCopyLabelTitle(src.label);
    case "notice": {
      const candidates = [
        relationCopyLinkedNotice(src),
        relationCopyHeldNotice(src, src.reason),
        relationCopyUncertainty(src),
      ];
      if (candidates.includes(expected)) return expected;
      return candidates.find(Boolean) || "";
    }
    case "notices": {
      const reasons = Array.isArray(src.reasons) ? src.reasons : [];
      return reasons.map((reason) => relationCopyHeldNotice(src, reason));
    }
    case "header":
      return relationCopyCliHeader(src);
    case "linked_suffix":
      return relationCopyReason(src.label, src.target);
    case "notification": {
      const count = Math.max(0, Math.floor(Number(src.count) || 0));
      return `${RELATION_COPY_GLYPH} Pulled in ${count} \u00b7 ${relationCopyChip(src.label, src.target)}`;
    }
    case "badge_help":
      return "Offered by your relation link";
    case "target":
      return relationCopyTruncate(src.target);
    case "suggestion":
      return `${RELATION_COPY_GLYPH} offers`;
    case "relation_row":
      return `${RELATION_COPY_GLYPH} offers source`;
    case "list_header":
      return `\u00b7 ${Math.max(0, Math.floor(Number(src.count) || 0))} offer`;
    case "list_row": {
      const count = Math.max(0, Math.floor(Number(src.count) || 0));
      return `${count} links \u00b7 offers source`;
    }
    case "message": {
      const candidates = [
        relationCopyAlreadyParked(src),
        relationCopyAlreadyClosed(src),
        relationCopyOffersVerdict(src),
        relationCopyRenameWarning(src),
      ];
      if (candidates.includes(expected)) return expected;
      return candidates.find(Boolean) || "";
    }
    case "hint":
      return relationCopyInverseHint(src);
    case "code":
      return "relation_successor_already_released";
    default:
      return undefined;
  }
}

function relationSuccessorCopy(input, expected) {
  const src = input && typeof input === "object" ? input : {};
  const want = expected && typeof expected === "object" ? expected : {};
  const keys = Object.keys(want).length > 0
    ? Object.keys(want)
    : ["title", "why", "tag", "fold", "suffix", "reason", "capsule", "notice",
      "header", "linked_suffix", "notification", "badge_help", "target",
      "suggestion", "relation_row", "list_header", "list_row", "message", "hint", "code"];
  const out = {};
  for (const key of keys) {
    out[key] = relationSuccessorCopyValue(src, key, want[key]);
  }
  return Object.freeze(out);
}
