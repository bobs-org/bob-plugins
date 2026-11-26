// Shared injected-zone snooze clock model. Keep this fragment byte-identical
// in bob-navigation-hotkeys, block-id-prompt, and task-status-cycler.

function snoozeFormatHhmm(minutes) {
  const value = Number(minutes);
  return String(Math.floor(value / 60)).padStart(2, "0") + String(value % 60).padStart(2, "0");
}

function snoozeParseNowMinutes(value) {
  if (Number.isInteger(value) && value >= 0 && value < 1440) return value;
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value == null ? "" : value).trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function snoozeParseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null;
  return { year, month, day, text: String(value) };
}

function snoozeIntlParts(epochMs, zone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = {};
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts;
}

function snoozeLocalEpoch(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
}

function snoozeResolveTarget(dateText, minutes, zone) {
  const date = snoozeParseDate(dateText);
  const value = Number(minutes);
  if (!date || !Number.isInteger(value) || value < 0 || value >= 1440) return null;
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  const localEpoch = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0);
  const offsets = new Set();
  try {
    for (let delta = -48; delta <= 48; delta += 6) {
      const instant = localEpoch + delta * 60 * 60 * 1000;
      const local = snoozeIntlParts(instant, zone);
      offsets.add(snoozeLocalEpoch(local) - instant);
    }
  } catch (_) {
    return null;
  }
  const candidates = [];
  for (const offset of offsets) {
    const instant = localEpoch - offset;
    try {
      const local = snoozeIntlParts(instant, zone);
      if (
        local.year === date.year &&
        local.month === date.month &&
        local.day === date.day &&
        local.hour === hour &&
        local.minute === minute &&
        local.second === 0
      ) {
        candidates.push({ instant, offset: snoozeLocalEpoch(local) - instant });
      }
    } catch (_) {
      return null;
    }
  }
  if (!candidates.length) return null;
  candidates.sort((left, right) => left.instant - right.instant);
  const picked = candidates[0];
  const offsetMinutes = Math.trunc(picked.offset / 60000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetText = sign + String(Math.floor(absoluteOffset / 60)).padStart(2, "0") + ":" + String(absoluteOffset % 60).padStart(2, "0");
  return {
    minutes: value,
    hhmm: snoozeFormatHhmm(value),
    rfc3339: date.text + "T" + snoozeFormatHhmm(value).slice(0, 2) + ":" + snoozeFormatHhmm(value).slice(2) + ":00" + offsetText,
  };
}

function snoozeParseRelativeMinutes(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return { ok: false, refusal: "invalid" };
  let cursor = 0;
  let total = 0;
  let saw = false;
  while (cursor < text.length) {
    while (/\s/.test(text[cursor] || "")) cursor += 1;
    if (cursor >= text.length) break;
    const match = /^(\d+)([hm])/.exec(text.slice(cursor));
    if (!match) return { ok: false, refusal: "invalid" };
    const amount = Number(match[1]);
    if (!Number.isSafeInteger(amount)) return { ok: false, refusal: "invalid" };
    total += amount * (match[2] === "h" ? 60 : 1);
    if (!Number.isSafeInteger(total) || total > 65535) return { ok: false, refusal: "invalid" };
    cursor += match[0].length;
    saw = true;
  }
  if (!saw || total === 0) return { ok: false, refusal: "invalid" };
  return { ok: true, minutes: Math.ceil(total / 5) * 5 };
}

function snoozeFutureToday(minutes, clock) {
  if (minutes <= clock.nowMinutes) return { ok: false, refusal: "past" };
  const resolved = snoozeResolveTarget(clock.date, minutes, clock.zone);
  return resolved ? { ok: true, value: resolved } : { ok: false, refusal: "dst_gap" };
}

function snoozeSplitMeridiem(lowered) {
  for (const suffix of ["am", "pm"]) {
    if (lowered.endsWith(suffix)) return { core: lowered.slice(0, -suffix.length).trimEnd(), meridiem: suffix };
  }
  if (lowered.endsWith("a") || lowered.endsWith("p")) {
    return { core: lowered.slice(0, -1).trimEnd(), meridiem: lowered.slice(-1) };
  }
  return { core: lowered, meridiem: null };
}

function snoozeMeridiemHour(hour, pm) {
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

function snoozeResolveMeridiem(core, meridiem, clock) {
  const pm = meridiem[0] === "p";
  if (core.includes(":")) {
    const pieces = core.split(":");
    if (pieces.length !== 2 || !pieces[0].trim() || pieces[1].trim().length !== 2) return { ok: false, refusal: "invalid" };
    const hour = Number(pieces[0].trim());
    const minute = Number(pieces[1].trim());
    if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute > 59) return { ok: false, refusal: "invalid" };
    return snoozeFutureToday(snoozeMeridiemHour(hour, pm) * 60 + minute, clock);
  }
  if (!/^\d+$/.test(core)) return { ok: false, refusal: "invalid" };
  const hour = Number(core);
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) return { ok: false, refusal: "invalid" };
  return snoozeFutureToday(snoozeMeridiemHour(hour, pm) * 60, clock);
}

function snoozeResolveAbsolute(raw, clock) {
  const lowered = String(raw || "").trim().toLowerCase();
  const split = snoozeSplitMeridiem(lowered);
  if (split.meridiem) return snoozeResolveMeridiem(split.core, split.meridiem, clock);
  const core = split.core;
  if (core.includes(":")) {
    const pieces = core.split(":");
    if (pieces.length !== 2 || !pieces[0].trim() || pieces[1].trim().length !== 2) return { ok: false, refusal: "invalid" };
    const hour = Number(pieces[0].trim());
    const minute = Number(pieces[1].trim());
    if (!Number.isInteger(hour) || hour > 23 || !Number.isInteger(minute) || minute > 59) return { ok: false, refusal: "invalid" };
    return snoozeFutureToday(hour * 60 + minute, clock);
  }
  if (!/^\d+$/.test(core)) return { ok: false, refusal: "invalid" };
  if (core.length === 1 || core.length === 2) {
    const hour = Number(core);
    if (hour > 23) return { ok: false, refusal: "invalid" };
    return snoozeFutureToday(hour * 60, clock);
  }
  if (core.length === 3) {
    const hour = Number(core.slice(0, 1));
    const minute = Number(core.slice(1));
    if (hour > 12 || minute > 59) return { ok: false, refusal: "invalid" };
    const first = hour * 60 + minute;
    if (first > clock.nowMinutes) {
      const resolved = snoozeResolveTarget(clock.date, first, clock.zone);
      return resolved ? { ok: true, value: resolved } : { ok: false, refusal: "dst_gap" };
    }
    const second = first + 12 * 60;
    if (second < 1440 && second > clock.nowMinutes) {
      const resolved = snoozeResolveTarget(clock.date, second, clock.zone);
      return resolved ? { ok: true, value: resolved } : { ok: false, refusal: "dst_gap" };
    }
    return { ok: false, refusal: "past" };
  }
  if (core.length === 4) {
    const hour = Number(core.slice(0, 2));
    const minute = Number(core.slice(2));
    if (hour > 23 || minute > 59) return { ok: false, refusal: "invalid" };
    return snoozeFutureToday(hour * 60 + minute, clock);
  }
  return { ok: false, refusal: "invalid" };
}

function snoozeParseWhen(input, clockInput) {
  const clock = clockInput && typeof clockInput === "object" ? clockInput : {};
  const date = String(clock.date || "");
  const nowMinutes = snoozeParseNowMinutes(clock.nowMinutes !== undefined ? clock.nowMinutes : clock.now);
  if (!snoozeParseDate(date) || nowMinutes === null || typeof clock.zone !== "string" || !clock.zone) {
    return { ok: false, refusal: "invalid" };
  }
  const value = String(input == null ? "" : input).trim();
  if (!value) return { ok: false, refusal: "invalid" };
  const parsedClock = { date, nowMinutes, zone: clock.zone };
  if (value.startsWith("+")) {
    const relative = snoozeParseRelativeMinutes(value.slice(1));
    if (!relative.ok) return relative;
    const target = nowMinutes + relative.minutes;
    if (target >= 1440) return { ok: false, refusal: "next_day" };
    const resolved = snoozeResolveTarget(date, target, clock.zone);
    return resolved ? { ok: true, value: resolved } : { ok: false, refusal: "dst_gap" };
  }
  return snoozeResolveAbsolute(value, parsedClock);
}
