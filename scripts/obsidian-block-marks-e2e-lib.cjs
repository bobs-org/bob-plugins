// Pure assertion and path helpers for the block-marks real-Obsidian e2e.
// Offline self-test imports these to reject empty tooltips, unchanged
// refresh evidence, wrong host origins, and fake snippet removal.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function scratchRoot(repoRoot) {
  return path.join(path.resolve(repoRoot), ".tmp-bm-e2e");
}

function makeScratch(repoRoot, prefix) {
  const root = scratchRoot(repoRoot);
  fs.mkdirSync(root, { recursive: true });
  const safe = String(prefix || "run").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+/, "") || "run";
  return fs.mkdtempSync(path.join(root, `${safe}-`));
}

function markerPattern(marker) {
  const escaped = String(marker || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`);
}

function contextHasMarker(context, marker) {
  return markerPattern(marker).test(String(context || ""));
}

function markForMarker(marks, marker) {
  const list = (marks || []).filter((item) => item && contextHasMarker(item.context, marker));
  return { all: list, visible: list.filter((item) => item.visible !== false) };
}

function normalizeTooltip(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function assertExactTooltip(observed) {
  const aria = normalizeTooltip(observed && observed.aria);
  const tip = normalizeTooltip(observed && observed.tip);
  const expected = normalizeTooltip(observed && observed.expected);
  const ariaOk = Boolean(expected) && aria === expected;
  if (!expected) return { ok: false, reason: "missing expected tooltip", aria, tip, ariaOk };
  if (!tip) return { ok: false, reason: "empty tooltip text", aria, tip, expected, ariaOk };
  if (tip !== expected) {
    return { ok: false, reason: `tooltip ${JSON.stringify(tip)} != ${JSON.stringify(expected)}`, aria, tip, expected, ariaOk };
  }
  return { ok: true, tip, aria, ariaOk, expected };
}

function assertRefreshChanged(before, after) {
  if (!before || !after) return { ok: false, reason: "missing before/after" };
  const sameKey = before.key === after.key;
  const sameTip = normalizeTooltip(before.tooltip) === normalizeTooltip(after.tooltip);
  const sameDate = String(before.date || "") === String(after.date || "");
  if (sameKey && sameTip && sameDate) {
    return { ok: false, reason: "refresh evidence unchanged", before, after };
  }
  return { ok: true, from: before, to: after };
}

function assertNamedHostMark(probe, { hostKind, marker, wantKey } = {}) {
  const kind = hostKind || "host";
  if (!probe || !probe.hostFound) return { ok: false, reason: `${kind} host missing` };
  if (probe.originHost && probe.originHost !== kind) {
    return { ok: false, reason: `wrong host origin ${probe.originHost}`, originHost: probe.originHost };
  }
  const marks = Array.isArray(probe.marks) ? probe.marks : [];
  const mark = marks.find((item) => contextHasMarker(item && item.context, marker));
  if (!mark) return { ok: false, reason: `${marker} missing in ${kind}` };
  if (wantKey && mark.key !== wantKey) {
    return { ok: false, reason: `${marker} key=${mark.key} want=${wantKey}`, mark };
  }
  if (!mark.box) return { ok: false, reason: `${marker} has no owned checkbox in ${kind}`, mark };
  return { ok: true, mark };
}

function assertSnippetDisabled(probe) {
  if (!probe) return { ok: false, reason: "no snippet probe" };
  if (probe.removedLinksOnly && probe.stylePresent) {
    return { ok: false, reason: "claimed snippet removal while style node remains" };
  }
  if (probe.stylePresent) return { ok: false, reason: "snippet stylesheet still present" };
  if (probe.enabled === true) return { ok: false, reason: "snippet still enabled" };
  if (!probe.paintOk) return { ok: false, reason: "family paint missing without snippet", probe };
  return { ok: true };
}

// Mirror of the CSS-only Tasks-results cascade in styles.css. Tasks rows
// cannot see open prerequisites, so a project tag always wins. Digit
// membership is the stored ladder value on a future scheduled date.
function tasksResultCssKey(row) {
  if (!row || String(row.dataTask || "") !== "?") return null;
  if (row.hasPrjTag) return "prj";
  const future = String(row.scheduled || "").startsWith("future-");
  const priority = String(row.priority || "");
  if (future && priority === "high") return "p1";
  if (future && priority === "medium") return "p2";
  if (future && priority === "low") return "p3";
  if (future && priority === "lowest") return "p4";
  if (future && row.hasRecurring) return "repeat";
  if (future) return "date";
  return "dep";
}

function computedContentGlyph(content) {
  const raw = String(content || "").trim();
  if (!raw || raw === "none" || raw === "normal") return "";
  const unquoted = raw.replace(/^["']|["']$/g, "");
  return unquoted === "none" ? "" : unquoted;
}

function maskIsDrawn(mask) {
  const value = String(mask || "").trim().toLowerCase();
  if (!value || value === "none") return false;
  return value.indexOf("url(") !== -1;
}

function assertTasksCssMark(row, { marker, wantKey, wantGlyph, wantMask, hidePriority, hidePrjTag } = {}) {
  if (!row) return { ok: false, reason: `${marker || "row"} missing` };
  if (row.jsMarked) return { ok: false, reason: `${marker} has JS data-bob-block`, row };
  const key = tasksResultCssKey(row);
  if (wantKey && key !== wantKey) {
    return { ok: false, reason: `${marker} cssKey=${key} want=${wantKey}`, row };
  }
  const glyph = computedContentGlyph(row.glyph);
  if (wantGlyph != null && glyph !== wantGlyph) {
    return { ok: false, reason: `${marker} glyph=${JSON.stringify(glyph)} want=${JSON.stringify(wantGlyph)}`, row };
  }
  if (wantMask === true && !maskIsDrawn(row.mask)) {
    return { ok: false, reason: `${marker} missing mask`, row };
  }
  if (wantMask === false && maskIsDrawn(row.mask)) {
    return { ok: false, reason: `${marker} unexpected mask`, row };
  }
  if (hidePriority === true && !(typeof row.priorityWidth === "number" && row.priorityWidth <= 4)) {
    return { ok: false, reason: `${marker} priority glyph still visible`, row };
  }
  if (hidePriority === false && row.priorityWidth != null && row.priorityWidth <= 4) {
    return { ok: false, reason: `${marker} priority glyph clipped`, row };
  }
  if (hidePrjTag === true && !(typeof row.prjTagWidth === "number" && row.prjTagWidth <= 4)) {
    return { ok: false, reason: `${marker} #prj_is_blocked still visible`, row };
  }
  if (hidePrjTag === false && row.hasPrjTag && row.prjTagWidth != null && row.prjTagWidth <= 4) {
    return { ok: false, reason: `${marker} #prj_is_blocked clipped`, row };
  }
  return { ok: true, key, glyph, row };
}

module.exports = {
  scratchRoot,
  makeScratch,
  markerPattern,
  contextHasMarker,
  markForMarker,
  normalizeTooltip,
  assertExactTooltip,
  assertRefreshChanged,
  assertNamedHostMark,
  assertSnippetDisabled,
  tasksResultCssKey,
  computedContentGlyph,
  maskIsDrawn,
  assertTasksCssMark,
};
