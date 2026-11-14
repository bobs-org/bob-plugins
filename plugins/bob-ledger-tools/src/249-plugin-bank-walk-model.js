// Pure bank-walk model (api.bankWalk v1): membership, snapshot building,
// locate, step/day planners, identity resolution. No Obsidian, no spawns.
// Nav, the footer, and the Category card call these through api.bankWalk;
// inside ledger the pure functions are used directly.

const BANK_WALK_VERSION = 1;
const BANK_WALK_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function bankWalkIsRow(row) {
  try {
    return Boolean(row && Number.isSafeInteger(row.cents));
  } catch (error) {
    return false;
  }
}

function bankWalkIsWaiting(row) {
  try {
    return bankWalkIsRow(row) && row.acknowledged === false;
  } catch (error) {
    return false;
  }
}

function bankWalkNormalizeRepeat(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return n;
}

function bankWalkTupleCompare(left, right) {
  const ld = String((left && left.date) || "");
  const rd = String((right && right.date) || "");
  if (ld !== rd) {
    return ld < rd ? -1 : 1;
  }
  const lp = String((left && left.path) || "");
  const rp = String((right && right.path) || "");
  if (lp !== rp) {
    return lp < rp ? -1 : 1;
  }
  const ll = Number.isInteger(left && left.line) ? left.line : 0;
  const rl = Number.isInteger(right && right.line) ? right.line : 0;
  return ll - rl;
}

function bankWalkShortDayLabel(dateIso) {
  try {
    if (typeof dateIso !== "string") {
      return null;
    }
    const m = dateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      return dateIso;
    }
    const month = Number(m[2]);
    const day = Number(m[3]);
    const abbr = (typeof BANK_MONTHS_ABBR !== "undefined" ? BANK_MONTHS_ABBR : ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"])[month - 1];
    if (!abbr) {
      return dateIso;
    }
    return `${abbr} ${day}`;
  } catch (error) {
    return null;
  }
}

function bankWalkLongDayLabel(dateIso) {
  try {
    if (typeof dateIso !== "string") {
      return null;
    }
    const m = dateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      return dateIso;
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    let weekday = null;
    try {
      weekday = bankWeekdayAbbr(year, month, day);
    } catch (error) {
      weekday = null;
    }
    if (!weekday) {
      const d = new Date(year, month - 1, day);
      if (!Number.isNaN(d.getTime())) {
        const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        weekday = names[d.getDay()];
        // bankWeekdayAbbr is Mon-first with Sun last; Date getDay is Sun-first.
        // Keep Date-derived value only when bank helper is unavailable.
      }
    }
    const short = bankWalkShortDayLabel(dateIso);
    if (weekday && short) {
      return `${weekday} ${short}`;
    }
    return short || dateIso;
  } catch (error) {
    return null;
  }
}

function bankWalkMonthKeyFromPath(path) {
  try {
    const parsed = bankMonthFromPath(path);
    return parsed ? parsed.key : null;
  } catch (error) {
    return null;
  }
}

function bankWalkMonthLabel(monthKey) {
  try {
    if (typeof monthKey !== "string") {
      return null;
    }
    const m = monthKey.match(/^(\d{4})-(\d{2})$/);
    if (!m) {
      return monthKey;
    }
    const month = Number(m[2]);
    const name = BANK_WALK_MONTH_NAMES[month - 1];
    if (!name) {
      return monthKey;
    }
    return `${name} ${m[1]}`;
  } catch (error) {
    return null;
  }
}

function bankWalkDailyDateFromPath(path) {
  try {
    const raw = String(path || "");
    const stem = raw.split("/").pop().replace(/\.md$/i, "");
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(stem);
    if (!m) {
      return null;
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    let valid = null;
    try {
      valid = bankValidDate(year, month, day);
    } catch (error) {
      valid = null;
    }
    if (valid && valid.iso) {
      return valid.iso;
    }
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
      return null;
    }
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  } catch (error) {
    return null;
  }
}

function bankWalkPayeeStart(raw) {
  try {
    const token = bankTokenizeLine(raw);
    if (!token) {
      return 0;
    }
    if (token.payeeSpan && Number.isInteger(token.payeeSpan.start)) {
      return token.payeeSpan.start;
    }
    if (token.amount && Number.isInteger(token.amount.end)) {
      return token.amount.end;
    }
    return 0;
  } catch (error) {
    return 0;
  }
}

function bankWalkBuildEntries(allRows) {
  // allRows: [{ path, line, date, cents, acknowledged, ackId, text }]
  // sorted by (date, path, line); scope filtered by waiting rule.
  const rows = Array.isArray(allRows) ? allRows.slice() : [];
  rows.sort(bankWalkTupleCompare);
  const waitingTotal = rows.filter((r) => r.waiting).length;
  const scope = waitingTotal > 0 ? "waiting" : "all";
  const scoped = scope === "waiting" ? rows.filter((r) => r.waiting) : rows;
  // Keys: bank:<ackId> when unique in the snapshot, else text key.
  const ackCounts = new Map();
  for (const e of scoped) {
    if (e.ackId) {
      ackCounts.set(e.ackId, (ackCounts.get(e.ackId) || 0) + 1);
    }
  }
  const textCounts = new Map();
  for (const e of scoped) {
    const tkey = `${e.path}|${e.date}|${e.text}`;
    textCounts.set(tkey, (textCounts.get(tkey) || 0) + 1);
  }
  const textSeen = new Map();
  const entries = scoped.map((e) => {
    let key;
    if (e.ackId && ackCounts.get(e.ackId) === 1) {
      key = `bank:${e.ackId}`;
    } else {
      const tkey = `${e.path}|${e.date}|${e.text}`;
      const occ = (textSeen.get(tkey) || 0) + 1;
      textSeen.set(tkey, occ);
      key = `${e.path}|${e.date}|${e.text}|${occ}`;
    }
    return {
      key,
      path: e.path,
      line: e.line,
      date: e.date,
      label: bankWalkLongDayLabel(e.date),
      short: bankWalkShortDayLabel(e.date),
      month: bankWalkMonthKeyFromPath(e.path),
      waiting: e.waiting,
      cents: e.cents,
      amountText: bankFormatCents(e.cents),
      inflow: e.cents > 0,
      payee: e.payee,
      ackId: e.ackId || null,
      text: e.text,
      rank: 0,
      dayRank: 0,
      dayTotal: 0,
    };
  });
  // Ranks and day groups.
  const days = [];
  const dayIndexByDate = new Map();
  entries.forEach((entry, idx) => {
    entry.rank = idx + 1;
    entry.total = entries.length;
    let day = dayIndexByDate.has(entry.date) ? days[dayIndexByDate.get(entry.date)] : null;
    if (!day) {
      day = {
        date: entry.date,
        label: bankWalkLongDayLabel(entry.date),
        short: bankWalkShortDayLabel(entry.date),
        first: idx,
        count: 0,
        waiting: 0,
      };
      dayIndexByDate.set(entry.date, days.length);
      days.push(day);
    }
    day.count += 1;
    if (entry.waiting) {
      day.waiting += 1;
    }
  });
  entries.forEach((entry) => {
    const dayPos = dayIndexByDate.get(entry.date);
    const day = days[dayPos];
    // dayRank: 1-based position within the day in entry order.
    let seen = 0;
    for (let i = day.first; i < day.first + day.count; i += 1) {
      if (entries[i] === entry) {
        entry.dayRank = seen + 1;
        break;
      }
      seen += 1;
    }
    entry.dayTotal = day.count;
  });
  return { entries, days, scope };
}

function bankWalkBuildSnapshotFromContents(fileContents, generation) {
  // fileContents: [{ path, content }] already merged (overlay wins).
  // Returns a frozen snapshot or an indexing/empty shape.
  const files = {};
  const allRows = [];
  const monthSeen = new Map();
  const waitingMonths = new Set();
  const daysAll = new Map();
  const waitingDays = new Set();
  for (const file of Array.isArray(fileContents) ? fileContents : []) {
    const path = bankNormalizePath(file && file.path);
    const content = typeof file.content === "string" ? file.content : "";
    if (!bankMonthFromPath(path)) {
      continue;
    }
    let scan = null;
    try {
      scan = bankScanSource(path, content);
    } catch (error) {
      scan = null;
    }
    if (!scan || !scan.month) {
      continue;
    }
    const lines = content.replace(/^\uFEFF/, "").split("\n");
    const headings = (scan.days || []).map((d) => ({ date: d.date, line: d.line })).sort((a, b) => a.line - b.line);
    files[path] = Object.freeze({
      month: scan.month,
      headings: Object.freeze(headings.map((h) => Object.freeze({ ...h }))),
    });
    for (const row of scan.rows || []) {
      if (!bankWalkIsRow(row)) {
        continue;
      }
      const raw = (lines[row.line - 1] || "").replace(/\r$/, "");
      let payee = "";
      try {
        const token = bankTokenizeLine(raw);
        payee = token && typeof token.payee === "string" ? token.payee : "";
      } catch (error) {
        payee = "";
      }
      const waiting = row.acknowledged === false;
      allRows.push({
        path: scan.path,
        line: row.line,
        date: row.date,
        cents: row.cents,
        waiting,
        payee,
        ackId: row.ackId || null,
        text: raw,
      });
      monthSeen.set(path, (monthSeen.get(path) || 0) + 1);
      if (!daysAll.has(row.date)) {
        daysAll.set(row.date, { count: 0, waiting: 0 });
      }
      daysAll.get(row.date).count += 1;
      if (waiting) {
        daysAll.get(row.date).waiting += 1;
        waitingDays.add(row.date);
        waitingMonths.add(path);
      }
    }
  }
  const built = bankWalkBuildEntries(allRows);
  const counts = Object.freeze({
    rows: allRows.length,
    waiting: allRows.filter((r) => r.waiting).length,
    days: daysAll.size,
    waitingDays: waitingDays.size,
    months: monthSeen.size,
    waitingMonths: waitingMonths.size,
  });
  const frozenEntries = Object.freeze(built.entries.map((e) => Object.freeze({ ...e })));
  const frozenDays = Object.freeze(built.days.map((d) => Object.freeze({ ...d })));
  const frozenFiles = Object.freeze(Object.fromEntries(Object.entries(files)));
  return Object.freeze({
    available: true,
    version: BANK_WALK_VERSION,
    generation: Number.isInteger(generation) ? generation : 0,
    scope: built.scope,
    counts,
    entries: frozenEntries,
    days: frozenDays,
    files: frozenFiles,
  });
}

function bankWalkLocate(snapshot, cursor) {
  try {
    if (!snapshot || snapshot.available !== true) {
      return null;
    }
    if (!cursor || typeof cursor.path !== "string") {
      return null;
    }
    const path = bankNormalizePath(cursor.path);
    const line0 = Number.isInteger(cursor.line0) ? cursor.line0 : null;
    if (line0 === null || line0 < 0) {
      return null;
    }
    const line = line0 + 1;
    if (!bankMonthFromPath(path)) {
      return Object.freeze({ inBank: false, path, date: null, line0, entry: null, member: false });
    }
    const fileEntry = snapshot.files && snapshot.files[path];
    const headings = fileEntry && Array.isArray(fileEntry.headings) ? fileEntry.headings : [];
    let date = null;
    for (const h of headings) {
      if (Number.isInteger(h.line) && h.line <= line && typeof h.date === "string") {
        date = h.date;
      }
    }
    const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
    const entry = entries.find((e) => e.path === path && e.line === line) || null;
    return Object.freeze({
      inBank: true,
      path,
      date,
      line0,
      entry,
      member: Boolean(entry),
    });
  } catch (error) {
    return null;
  }
}

function bankWalkFindEntryIndex(entries, entry) {
  if (!entry) {
    return -1;
  }
  if (typeof entry.key === "string") {
    const byKey = entries.findIndex((e) => e.key === entry.key);
    if (byKey >= 0) {
      return byKey;
    }
  }
  return entries.findIndex((e) => e.path === entry.path && e.line === entry.line);
}

function bankWalkInsertionForTuple(entries, tuple) {
  // First index with entry > tuple (for direction +1).
  for (let i = 0; i < entries.length; i += 1) {
    if (bankWalkTupleCompare(tuple, entries[i]) < 0) {
      return i;
    }
  }
  return entries.length;
}

function bankWalkLastBeforeTuple(entries, tuple) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (bankWalkTupleCompare(tuple, entries[i]) > 0) {
      return i;
    }
  }
  return -1;
}

function bankWalkFinishJump(entries, days, at, wrapped, origin, scope) {
  const entry = entries[at];
  const dayPos = days.findIndex((d) => d.date === entry.date);
  const day = days[dayPos];
  let dayRank = entry.dayRank;
  let dayTotal = entry.dayTotal;
  if (day) {
    dayRank = at - day.first + 1;
    dayTotal = day.count;
  }
  return Object.freeze({
    kind: "jump",
    entry,
    rank: at + 1,
    total: entries.length,
    dayRank,
    dayTotal,
    dayIndex: dayPos >= 0 ? dayPos : 0,
    dayCount: days.length,
    wrapped: Boolean(wrapped),
    origin,
    scope,
  });
}

function bankWalkApplyRepeatToRow(entries, days, base, direction, repeat, origin, scope) {
  if (entries.length === 0) {
    return Object.freeze({ kind: "empty", scope });
  }
  const steps = bankWalkNormalizeRepeat(repeat);
  const raw = base + direction * (steps - 1);
  const wrapped = raw < 0 || raw >= entries.length;
  const at = ((raw % entries.length) + entries.length) % entries.length;
  // If the base itself wrapped (insertion at ends), that counts too; the
  // caller passes wrappedBase separately. Here we only account for repeat.
  return bankWalkFinishJump(entries, days, at, wrapped, origin, scope);
}

// Pure jump planner. options: { direction: 1|-1, dayJump, repeat,
// cursor: { path, line0 }|null, anchor, dailyDate? }. anchor: { key, path,
// line, date, text, day }. Returns { kind: "jump", ... } or
// { kind: "empty", scope }.
function bankWalkPlan(snapshot, options = {}) {
  try {
    if (!snapshot || snapshot.available !== true) {
      return Object.freeze({ kind: "empty", scope: (snapshot && snapshot.scope) || "waiting" });
    }
    const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
    const days = Array.isArray(snapshot.days) ? snapshot.days : [];
    const scope = snapshot.scope === "all" ? "all" : "waiting";
    if (entries.length === 0 || days.length === 0) {
      return Object.freeze({ kind: "empty", scope });
    }
    const direction = options.direction < 0 ? -1 : 1;
    const dayJump = options.dayJump === true;
    const repeat = bankWalkNormalizeRepeat(options.repeat);
    const cursor = options.cursor && typeof options.cursor === "object" ? options.cursor : null;
    const anchor = options.anchor && typeof options.anchor === "object" ? options.anchor : null;

    const located = cursor ? bankWalkLocate(snapshot, cursor) : null;

    // 1. Cursor in a bank month note always wins.
    if (located && located.inBank) {
      if (located.member && located.entry) {
        const idx = bankWalkFindEntryIndex(entries, located.entry);
        if (idx >= 0) {
          if (dayJump) {
            const dayPos = days.findIndex((d) => d.date === located.entry.date);
            if (dayPos < 0) {
              return Object.freeze({ kind: "empty", scope });
            }
            const raw = dayPos + direction * repeat;
            // One jump moves one day; repeat N moves N days from origin day.
            const wrapped = raw < 0 || raw >= days.length;
            const targetDay = ((raw % days.length) + days.length) % days.length;
            const at = days[targetDay].first;
            return bankWalkFinishJump(entries, days, at, wrapped, "cursor", scope);
          }
          const raw = idx + direction * repeat;
          const wrapped = raw < 0 || raw >= entries.length;
          const at = ((raw % entries.length) + entries.length) % entries.length;
          return bankWalkFinishJump(entries, days, at, wrapped, "cursor", scope);
        }
      }
      // Gap: insert the cursor tuple and step from there.
      const gap = {
        date: located.date || "",
        path: located.path,
        line: (Number.isInteger(located.line0) ? located.line0 + 1 : 1),
      };
      if (dayJump) {
        // Day-granularity insertion.
        let pos = days.length;
        if (!gap.date) {
          pos = 0;
        } else {
          for (let i = 0; i < days.length; i += 1) {
            if (days[i].date > gap.date) {
              pos = i;
              break;
            }
            if (days[i].date === gap.date) {
              pos = i;
              break;
            }
          }
          // If gap date matches a day, stepping moves off it; if it falls
          // between days, pos is already the next day.
          if (days[pos] && days[pos].date === gap.date) {
            // From inside the day, a day jump leaves it.
            const raw = pos + direction * repeat;
            // For a gap inside a day, the first jump leaves the day, so the
            // base is pos + direction, then repeat-1 more.
            const base = pos + direction;
            const rest = repeat - 1;
            const rawFinal = base + direction * rest;
            const wrapped = rawFinal < 0 || rawFinal >= days.length;
            const targetDay = ((rawFinal % days.length) + days.length) % days.length;
            const at = days[targetDay].first;
            return bankWalkFinishJump(entries, days, at, wrapped, "cursor-gap", scope);
          }
        }
        if (direction > 0) {
          const base = pos >= days.length ? 0 : pos;
          const baseWrapped = pos >= days.length;
          const rawFinal = base + (repeat - 1);
          const wrapped = baseWrapped || rawFinal >= days.length;
          const targetDay = rawFinal % days.length;
          const at = days[targetDay].first;
          return bankWalkFinishJump(entries, days, at, wrapped, "cursor-gap", scope);
        }
        const base = pos <= 0 ? days.length - 1 : pos - 1;
        const baseWrapped = pos <= 0;
        const rawFinal = base - (repeat - 1);
        const wrapped = baseWrapped || rawFinal < 0;
        const targetDay = ((rawFinal % days.length) + days.length) % days.length;
        const at = days[targetDay].first;
        return bankWalkFinishJump(entries, days, at, wrapped, "cursor-gap", scope);
      }
      if (direction > 0) {
        const base = bankWalkInsertionForTuple(entries, gap);
        const baseWrapped = base >= entries.length;
        const at0 = base >= entries.length ? 0 : base;
        const rawFinal = at0 + (repeat - 1);
        const wrapped = baseWrapped || rawFinal >= entries.length;
        const at = rawFinal % entries.length;
        return bankWalkFinishJump(entries, days, at, wrapped, "cursor-gap", scope);
      }
      const base = bankWalkLastBeforeTuple(entries, gap);
      if (base < 0) {
        const at0 = entries.length - 1;
        const rawFinal = at0 - (repeat - 1);
        const wrapped = true || rawFinal < 0;
        const at = ((rawFinal % entries.length) + entries.length) % entries.length;
        return bankWalkFinishJump(entries, days, at, wrapped, "cursor-gap", scope);
      }
      const rawFinal = base - (repeat - 1);
      const wrapped = rawFinal < 0;
      const at = ((rawFinal % entries.length) + entries.length) % entries.length;
      return bankWalkFinishJump(entries, days, at, wrapped, "cursor-gap", scope);
    }

    // 2. Daily note whose date has scope rows.
    if (located && !located.inBank && cursor && typeof cursor.path === "string") {
      const dailyDate = bankWalkDailyDateFromPath(cursor.path);
      if (dailyDate) {
        const dayPos = days.findIndex((d) => d.date === dailyDate);
        if (dayPos >= 0) {
          const day = days[dayPos];
          if (direction > 0 || dayJump) {
            // ]b / ]B / [B land its first scope row.
            const base = day.first;
            const rawFinal = base + (repeat - 1);
            const wrapped = rawFinal >= entries.length || (rawFinal - base >= day.count && repeat > day.count);
            // Repeat spills past the day into following rows.
            const at = rawFinal % entries.length;
            const spilled = repeat > day.count;
            return bankWalkFinishJump(entries, days, at, false, "daily", scope);
          }
          // [b lands its last scope row.
          const base = day.first + day.count - 1;
          const rawFinal = base - (repeat - 1);
          const at = ((rawFinal % entries.length) + entries.length) % entries.length;
          return bankWalkFinishJump(entries, days, at, false, "daily", scope);
        }
      }
    }

    // 3. Session anchor (valid only on its local day).
    if (anchor && typeof anchor === "object") {
      let today = "";
      try {
        today = bankLocalDate();
      } catch (error) {
        today = "";
      }
      const anchorDay = typeof anchor.day === "string" ? anchor.day : "";
      if (!anchorDay || !today || anchorDay === today) {
        const key = typeof anchor.key === "string" ? anchor.key : null;
        const anchorIdx = key !== null ? entries.findIndex((e) => e.key === key) : -1;
        if (anchorIdx >= 0) {
          if (dayJump) {
            const dayPos = days.findIndex((d) => d.date === entries[anchorIdx].date);
            const raw = dayPos + direction * repeat;
            const wrapped = raw < 0 || raw >= days.length;
            const targetDay = ((raw % days.length) + days.length) % days.length;
            const at = days[targetDay].first;
            return bankWalkFinishJump(entries, days, at, wrapped, "anchor", scope);
          }
          const raw = anchorIdx + direction * repeat;
          const wrapped = raw < 0 || raw >= entries.length;
          const at = ((raw % entries.length) + entries.length) % entries.length;
          return bankWalkFinishJump(entries, days, at, wrapped, "anchor", scope);
        }
        if (typeof anchor.path === "string" && Number.isInteger(anchor.line)) {
          const gap = {
            date: typeof anchor.date === "string" ? anchor.date : "",
            path: bankNormalizePath(anchor.path),
            line: anchor.line,
          };
          if (dayJump) {
            let pos = days.length;
            if (!gap.date) {
              pos = 0;
            } else {
              for (let i = 0; i < days.length; i += 1) {
                if (days[i].date >= gap.date) {
                  pos = i;
                  break;
                }
              }
            }
            if (direction > 0) {
              const base = pos >= days.length ? 0 : pos;
              const baseWrapped = pos >= days.length;
              const rawFinal = base + (repeat - 1);
              const wrapped = baseWrapped || rawFinal >= days.length;
              const targetDay = rawFinal % days.length;
              const at = days[targetDay].first;
              return bankWalkFinishJump(entries, days, at, wrapped, "anchor-gap", scope);
            }
            const base = pos <= 0 ? days.length - 1 : pos - 1;
            const baseWrapped = pos <= 0;
            const rawFinal = base - (repeat - 1);
            const wrapped = baseWrapped || rawFinal < 0;
            const targetDay = ((rawFinal % days.length) + days.length) % days.length;
            const at = days[targetDay].first;
            return bankWalkFinishJump(entries, days, at, wrapped, "anchor-gap", scope);
          }
          if (direction > 0) {
            const base = bankWalkInsertionForTuple(entries, gap);
            const baseWrapped = base >= entries.length;
            const at0 = base >= entries.length ? 0 : base;
            const rawFinal = at0 + (repeat - 1);
            const wrapped = baseWrapped || rawFinal >= entries.length;
            const at = rawFinal % entries.length;
            return bankWalkFinishJump(entries, days, at, wrapped, "anchor-gap", scope);
          }
          const base = bankWalkLastBeforeTuple(entries, gap);
          if (base < 0) {
            const at0 = entries.length - 1;
            const rawFinal = at0 - (repeat - 1);
            const at = ((rawFinal % entries.length) + entries.length) % entries.length;
            return bankWalkFinishJump(entries, days, at, true, "anchor-gap", scope);
          }
          const rawFinal = base - (repeat - 1);
          const wrapped = rawFinal < 0;
          const at = ((rawFinal % entries.length) + entries.length) % entries.length;
          return bankWalkFinishJump(entries, days, at, wrapped, "anchor-gap", scope);
        }
      }
    }

    // 4. Entry: oldest/newest per scope, never a wrap.
    const lastDay = days[days.length - 1];
    if (scope === "waiting") {
      if (direction > 0) {
        if (dayJump) {
          const base = 0;
          const daySteps = repeat - 1;
          const targetDay = daySteps % days.length;
          const at = days[targetDay].first + 0;
          // Repeat day jumps from the oldest waiting day.
          const rawFinal = 0 + daySteps;
          const atFinal = days[rawFinal % days.length].first;
          return bankWalkFinishJump(entries, days, atFinal, false, "entry", scope);
        }
        const at = (repeat - 1) % entries.length;
        return bankWalkFinishJump(entries, days, at, false, "entry", scope);
      }
      if (dayJump) {
        // [B: first waiting row of the newest waiting day.
        const base = lastDay.first;
        const daySteps = repeat - 1;
        const targetDayIdx = days.length - 1 - daySteps;
        const wrappedIdx = ((targetDayIdx % days.length) + days.length) % days.length;
        const at = days[wrappedIdx].first;
        return bankWalkFinishJump(entries, days, at, false, "entry", scope);
      }
      const at = entries.length - 1 - ((repeat - 1) % entries.length);
      return bankWalkFinishJump(entries, days, at, false, "entry", scope);
    }
    // scope all
    if (direction > 0 || dayJump) {
      // ]b / ]B / [B land the first row of the newest occupied day.
      const daySteps = repeat - 1;
      const targetDayIdx = days.length - 1 + (direction > 0 ? daySteps : -daySteps);
      // Entry never wraps: clamp repeat within one pass for entry origin.
      // For repeat past the day, spill into following rows (row jumps) or
      // wrap days only when repeat exceeds the day count (day jumps). Keep
      // it simple: spill forward/backward linearly without wrap.
      if (dayJump) {
        const idx = days.length - 1 + daySteps * 1;
        // [B from entry is defined as newest day; repeat moves backward.
        // Direction -1 with dayJump from entry still lands newest day first.
        const target = direction > 0 ? (days.length - 1 + daySteps) % days.length : (days.length - 1 - daySteps + days.length * 100) % days.length;
        const at = days[target].first;
        return bankWalkFinishJump(entries, days, at, false, "entry", scope);
      }
      const base = lastDay.first;
      const at = Math.min(base + (repeat - 1), entries.length - 1);
      return bankWalkFinishJump(entries, days, at, false, "entry", scope);
    }
    const at = entries.length - 1 - ((repeat - 1) % entries.length);
    return bankWalkFinishJump(entries, days, at, false, "entry", scope);
  } catch (error) {
    try {
      return Object.freeze({ kind: "empty", scope: "waiting" });
    } catch (ignored) {
      return { kind: "empty", scope: "waiting" };
    }
  }
}

function bankWalkResolve(input = {}) {
  try {
    const path = typeof input.path === "string" ? bankNormalizePath(input.path) : "";
    const content = typeof input.content === "string" ? input.content : null;
    const entry = input.entry && typeof input.entry === "object" ? input.entry : null;
    if (!path || content === null || !entry) {
      return { ok: false, reason: "invalid" };
    }
    if (!bankMonthFromPath(path)) {
      return { ok: false, reason: "invalid" };
    }
    const wantLine = Number.isInteger(entry.line) ? entry.line : null;
    const wantText = typeof entry.text === "string" ? entry.text : null;
    const wantAck = typeof entry.ackId === "string" && entry.ackId ? entry.ackId.toLowerCase() : null;
    const wantDate = typeof entry.date === "string" ? entry.date : null;
    if (wantLine === null || wantText === null) {
      return { ok: false, reason: "invalid" };
    }
    let scan = null;
    try {
      scan = bankScanSource(path, content);
    } catch (error) {
      return { ok: false, reason: "invalid" };
    }
    if (!scan || !scan.month) {
      return { ok: false, reason: "invalid" };
    }
    const lines = content.replace(/^\uFEFF/, "").split("\n");
    const lineAt = (n) => (lines[n - 1] || "").replace(/\r$/, "");
    // 1. ^bank-<hex> identity; a duplicate ID is ambiguous, never first-match.
    if (wantAck) {
      const matches = (scan.rows || []).filter((r) => r && r.ackId === wantAck);
      if (matches.length > 1) {
        return { ok: false, reason: "ambiguous" };
      }
      if (matches.length === 1) {
        const raw = lineAt(matches[0].line);
        return { ok: true, line0: matches[0].line - 1, ch: bankWalkPayeeStart(raw) };
      }
    }
    // 2. Exact line text at the expected line.
    if (wantLine >= 1 && wantLine <= lines.length && lineAt(wantLine) === wantText) {
      let token = null;
      try {
        token = bankTokenizeLine(lineAt(wantLine));
      } catch (error) {
        token = null;
      }
      if (token) {
        return { ok: true, line0: wantLine - 1, ch: bankWalkPayeeStart(lineAt(wantLine)) };
      }
      return { ok: false, reason: "invalid" };
    }
    // 3. Unique exact text within the same day.
    const sameDay = (scan.rows || []).filter((r) => r && r.date === wantDate && lineAt(r.line) === wantText);
    if (sameDay.length === 1) {
      const raw = lineAt(sameDay[0].line);
      return { ok: true, line0: sameDay[0].line - 1, ch: bankWalkPayeeStart(raw) };
    }
    if (sameDay.length > 1) {
      return { ok: false, reason: "ambiguous" };
    }
    return { ok: false, reason: "missing" };
  } catch (error) {
    return { ok: false, reason: "invalid" };
  }
}
