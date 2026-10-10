// --- Work badge tones -------------------------------------------------------
// Shared count-to-limit presentation for TODAY, PENDING, NEXT, and READY.
// Precedence (exact comparisons, never rounded percentages):
// n === 0 -> grey, 0 < n < L/2 -> blue, L/2 <= n < 3L/4 -> green,
// 3L/4 <= n < L -> yellow, n === L -> orange, n > L -> red.
// Invalid or missing input is unavailable (null), never numeric zero.
const WORK_BADGE_TONES = ["grey", "blue", "green", "yellow", "orange", "red"];

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
    return "orange";
  }
  if (count >= (3 * cap) / 4) {
    return "yellow";
  }
  if (count >= cap / 2) {
    return "green";
  }
  return "blue";
}

// TODAY tone: ledger-availability check plus the theme-overflow override.
// `budget` is a plan budget (`computePlanBudget` / `emptyPlanBudget`
// shape). Missing section, missing/invalid theme or link meters, or a
// missing budget is unavailable (null). Themes over cap force red,
// including when links are zero; themes exactly at cap keep the
// link-based tone. Both fractions remain displayed by callers.
function todayBadgeTone(budget) {
  try {
    if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
      return null;
    }
    if (budget.hasSection !== true) {
      return null;
    }
    const themes = budget.themes;
    const links = budget.links;
    if (!themes || typeof themes !== "object" || Array.isArray(themes)) {
      return null;
    }
    if (!links || typeof links !== "object" || Array.isArray(links)) {
      return null;
    }
    if (
      !Number.isInteger(themes.count) ||
      themes.count < 0 ||
      !Number.isInteger(themes.cap) ||
      themes.cap < 1
    ) {
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
    if (themes.count > themes.cap) {
      return "red";
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
    .replace(/\s*bob-work-tone-(grey|blue|green|yellow|orange|red)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const toneCls = workToneClass(tone);
  if (!toneCls) {
    return cleaned;
  }
  return cleaned ? `${cleaned} ${toneCls}` : toneCls;
}
