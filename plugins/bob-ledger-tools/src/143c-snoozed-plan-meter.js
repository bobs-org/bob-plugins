// Independent snoozed meter and wake forecast for the daily bob-plan
// block. It consumes the already-classified queue and never changes the
// ledger budget or Today membership.

function snoozePlanMeterTargetMinutes(row) {
  try {
    if (row && Number.isInteger(row.minutes) && row.minutes >= 0 && row.minutes < 1440) {
      return row.minutes;
    }
    const target = row && typeof row.target === "string"
      ? row.target.replace(":", "")
      : "";
    return snoozeRowPaintTargetMinutes(target);
  } catch (error) {
    return null;
  }
}

function snoozePlanMeterColonTime(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) {
    return null;
  }
  return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" +
    String(minutes % 60).padStart(2, "0");
}

// Input matches the canonical SM-P vectors. In production the caller
// supplies `available` only after both the Tasks and daily snooze caches
// are current, and annotates rows with the shared effective-clock result.
function snoozePlanMeterModel(input = {}) {
  try {
    const value = input && typeof input === "object" ? input : {};
    const linksCount = Number.isInteger(value.links_count) && value.links_count >= 0
      ? value.links_count
      : 0;
    const cap = Number.isInteger(value.cap) && value.cap > 0
      ? value.cap
      : null;
    const queue = Array.isArray(value.queue) ? value.queue : null;
    const available =
      value.available !== false &&
      value.cache_ready !== false &&
      value.daily_missing !== true &&
      queue !== null;
    const emptyForecast = Object.freeze({
      cap,
      count: linksCount,
      over: cap !== null && linksCount > cap,
    });
    const empty = {
      chip: false,
      forecast: emptyForecast,
      lint: null,
      text: null,
      tone: null,
      tooltip: null,
    };
    if (!available) {
      return Object.freeze(empty);
    }

    const seen = new Set();
    let asleep = 0;
    let due = 0;
    let blocked = 0;
    let eligibleWakeCount = 0;
    let nextMinutes = null;
    for (const row of queue) {
      if (!row || typeof row !== "object") continue;
      const state = typeof row.state === "string" ? row.state : "";
      if (state !== "asleep" && state !== "due" && state !== "blocked") {
        continue;
      }
      const identity =
        typeof row.id === "string" && row.id
          ? row.id
          : typeof row.key === "string" && row.key
            ? row.key
            : typeof row.identity === "string" && row.identity
              ? row.identity
              : null;
      // An unresolved identity cannot safely contribute to the unique
      // queue count or the forecast.
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      if (state === "asleep") asleep += 1;
      else if (state === "due") due += 1;
      else blocked += 1;

      if (state === "blocked") continue;
      const minutes = snoozePlanMeterTargetMinutes(row);
      if (minutes !== null && (nextMinutes === null || minutes < nextMinutes)) {
        nextMinutes = minutes;
      }
      if (row.on_clock === true) eligibleWakeCount += 1;
    }

    const count = asleep + due + blocked;
    if (!count) {
      return Object.freeze(empty);
    }
    const forecastCount = linksCount + eligibleWakeCount;
    const forecast = Object.freeze({
      cap,
      count: forecastCount,
      over: cap !== null && forecastCount > cap,
    });
    const next = snoozePlanMeterColonTime(nextMinutes);
    const text = "⏰ " + count + (next ? " · " + next : "");
    const parts = [count + " snoozed"];
    if (due) parts.push(due + " due");
    if (blocked) parts.push(blocked + " blocked");
    if (next) parts.push("next wakes " + next);
    parts.push("not counted in TODAY");
    const todayCount = Number.isInteger(value.today_count) && value.today_count >= 0
      ? value.today_count
      : null;
    if (todayCount !== null) {
      parts.push(todayCount + "/" + (todayCount + eligibleWakeCount) + " when all wake");
    }
    return Object.freeze({
      chip: true,
      count,
      due,
      blocked,
      eligibleWakeCount,
      forecast,
      lint: forecast.over ? "snooze_wake_would_exceed_cap" : null,
      text,
      tone: due > 0 ? "amber" : "indigo",
      tooltip: parts.join(" · "),
    });
  } catch (error) {
    return Object.freeze({
      chip: false,
      forecast: Object.freeze({ cap: null, count: 0, over: false }),
      lint: null,
      text: null,
      tone: null,
      tooltip: null,
    });
  }
}
