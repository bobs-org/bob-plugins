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
};
