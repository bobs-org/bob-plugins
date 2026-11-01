// --- Work badge tones -------------------------------------------------------
// Shared count-to-limit presentation for TODAY, PENDING, NEXT, and READY.
// Precedence (exact comparisons, never rounded percentages):
// n === 0 -> grey, 0 < n < 2L/5 -> blue, 2L/5 <= n < 3L/5 -> green,
// 3L/5 <= n < 4L/5 -> yellow, 4L/5 <= n < L -> orange, n === L -> magenta, n > L -> red.
// Invalid or missing input is unavailable (null), never numeric zero.
const WORK_BADGE_TONES = ["grey", "blue", "green", "yellow", "orange", "magenta", "red"];

function workBadgeTone(count, cap) {
  if (!Number.isInteger(count) || count < 0) {
    return null;
  }
  if (!Number.isInteger(cap) || cap < 1) {
    return null;
  }
  if (count === 0) {
    return "grey";
  }
  if (count > cap) {
    return "red";
  }
  if (count === cap) {
    return "magenta";
  }
  if (5 * count >= 4 * cap) {
    return "orange";
  }
  if (5 * count >= 3 * cap) {
    return "yellow";
  }
  if (5 * count >= 2 * cap) {
    return "green";
  }
  return "blue";
}

// TODAY tone: ledger-availability check plus the Task Link meter.
// `budget` is a plan budget (`computePlanBudget` / `emptyPlanBudget`
// shape). Missing section, missing/invalid link meter, or a missing budget
// is unavailable (null).
function todayBadgeTone(budget) {
  try {
    if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
      return null;
    }
    if (budget.hasSection !== true) {
      return null;
    }
    const links = budget.links;
    if (!links || typeof links !== "object" || Array.isArray(links)) {
      return null;
    }
    if (
      !Number.isInteger(links.count) ||
      links.count < 0 ||
      !Number.isInteger(links.cap) ||
      links.cap < 1
    ) {
      return null;
    }
    return workBadgeTone(links.count, links.cap);
  } catch (error) {
    return null;
  }
}

function workToneClass(tone) {
  if (typeof tone !== "string" || !tone) {
    return "";
  }
  if (WORK_BADGE_TONES.indexOf(tone) === -1) {
    return "";
  }
  return `bob-work-tone-${tone}`;
}

function workBadgeToneClass(count, cap) {
  return workToneClass(workBadgeTone(count, cap));
}

// Append (or replace) the Work tone class on a chip class string without
// accumulating stale tones. Keeps over/unavailable markers intact.
function withWorkToneClass(baseCls, tone) {
  const base = String(baseCls || "");
  const cleaned = base
    .replace(new RegExp(`\\s*bob-work-tone-(${WORK_BADGE_TONES.join("|")})\\b`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
  const toneCls = workToneClass(tone);
  if (!toneCls) {
    return cleaned;
  }
  return cleaned ? `${cleaned} ${toneCls}` : toneCls;
}
