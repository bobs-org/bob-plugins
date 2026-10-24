// Day strip hosts: day identity, report selection, the strip registry
// with its visible/dirty/aged refresh policy and rollover, the
// `bob-day-stats` fence host, and `openStatsForDay`, which opens Stats
// with the day pinned. The painter (`paintDayStrip`) and the model
// (`dayStripModel`) own every pixel and value; this file only decides
// which day, which cache key, and when to re-run `bob stats`.
const DAY_STRIP_RECHECK_DEBOUNCE_MS = 2000;
const DAY_STRIP_TODAY_MIN_AGE_MS = 30 * 1000;
const DAY_STRIP_PAST_MIN_AGE_MS = 10 * 60 * 1000;
const DAY_STRIP_COLLAPSE_KEY = "bob-day-strip-collapsed";

// Canonical daily-note identity: `YYYY/YYYYMMDD.md` where the year
// folder equals the stem's year and the stem is a real calendar date.
// Never the active tab, the file mtime, or `new Date("YYYY-MM-DD")`.
// Returns `"YYYY-MM-DD"` or null. Never throws.
function dayStripDayForPath(path) {
  try {
    const text = typeof path === "string" ? path : "";
    if (!text) {
      return null;
    }
    const match = /^(?:(.*)\/)?(\d{4})\/(\d{8})\.md$/.exec(text);
    if (!match) {
      return null;
    }
    const folderYear = match[2];
    const stem = match[3];
    if (stem.slice(0, 4) !== folderYear) {
      return null;
    }
    const day =
      stem.slice(0, 4) + "-" + stem.slice(4, 6) + "-" + stem.slice(6, 8);
    return dayStripDateParts(day) ? day : null;
  } catch (error) {
    return null;
  }
}

// Local "today" as `YYYY-MM-DD` from local `getFullYear` / `getMonth` /
// `getDate`, the same way `refreshStatsBlocksForRollover` computes it.
// Never throws.
function dayStripLocalToday(now) {
  try {
    const value = now instanceof Date ? now : new Date();
    if (!Number.isFinite(value.getTime())) {
      return "";
    }
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const date = String(value.getDate()).padStart(2, "0");
    return value.getFullYear() + "-" + month + "-" + date;
  } catch (error) {
    return "";
  }
}

// Parse the optional `bob-day-stats` fence body (`day: YYYY-MM-DD`).
// Unknown keys are ignored. Accepts a YAML mapping via `parseYaml` when
// available and falls back to a line scan so plain `day:` bodies keep
// working. A YAML timestamp may decode to a Date (UTC midnight), which
// is read back in UTC. Returns `"YYYY-MM-DD"` or null. Never throws.
function dayStripParseFenceDay(source) {
  try {
    if (source instanceof Date) {
      if (!Number.isFinite(source.getTime())) {
        return null;
      }
      const month = String(source.getUTCMonth() + 1).padStart(2, "0");
      const date = String(source.getUTCDate()).padStart(2, "0");
      const asDay = source.getUTCFullYear() + "-" + month + "-" + date;
      return dayStripDateParts(asDay) ? asDay : null;
    }
    const text = typeof source === "string" ? source : "";
    if (!text.trim()) {
      return null;
    }
    let day = null;
    try {
      if (typeof parseYaml === "function") {
        const parsed = parseYaml(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          if (parsed.day !== undefined && parsed.day !== null) {
            day = parsed.day;
          } else if (parsed.Day !== undefined && parsed.Day !== null) {
            day = parsed.Day;
          }
        }
      }
    } catch (error) {
      day = null;
    }
    if (day === null || day === undefined || day === "") {
      const match = /(?:^|\n)\s*day\s*:\s*([^\s#]+)/i.exec(text);
      day = match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
    }
    if (day instanceof Date) {
      if (!Number.isFinite(day.getTime())) {
        return null;
      }
      const month = String(day.getUTCMonth() + 1).padStart(2, "0");
      const date = String(day.getUTCDate()).padStart(2, "0");
      const asDay = day.getUTCFullYear() + "-" + month + "-" + date;
      return dayStripDateParts(asDay) ? asDay : null;
    }
    if (typeof day !== "string") {
      return null;
    }
    const cleaned = day.trim().replace(/^["']|["']$/g, "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      return null;
    }
    return dayStripDateParts(cleaned) ? cleaned : null;
  } catch (error) {
    return null;
  }
}

// True when the default report (the Stats page's default arguments) is
// usable for D: its daily series contains every date D-7..D, and either
// D < `report.today` or D === `report.today` === local today. A cached
// report from before local today is never usable for D >=
// `report.today`, so yesterday's provisional numbers never read "so far"
// after midnight. Never throws.
function dayStripDefaultReportCovers(report, day, localToday) {
  try {
    if (!report || typeof report !== "object") {
      return false;
    }
    if (!dayStripDateParts(day)) {
      return false;
    }
    const today = typeof localToday === "string" ? localToday : "";
    const reportToday = typeof report.today === "string" ? report.today : "";
    if (reportToday && today && reportToday < today && day >= reportToday) {
      return false;
    }
    if (reportToday) {
      const usable =
        day < reportToday ||
        (Boolean(today) && day === reportToday && reportToday === today);
      if (!usable) {
        return false;
      }
    } else if (today && day > today) {
      return false;
    }
    const wanted = [];
    for (let back = 7; back >= 0; back -= 1) {
      wanted.push(dayStripShiftDay(day, -back));
    }
    const covered = new Set();
    const metrics = Array.isArray(report.metrics) ? report.metrics : [];
    for (const metric of metrics) {
      let points = null;
      try {
        points = statsChartDailyPoints(metric, report);
      } catch (error) {
        points = metric && Array.isArray(metric.points) ? metric.points : [];
      }
      for (const point of points || []) {
        if (point && typeof point.date === "string") {
          covered.add(point.date);
        }
      }
    }
    return wanted.every((date) => covered.has(date));
  } catch (error) {
    return false;
  }
}

// Report selection for one strip day: the shared default entry when it
// is usable for D, an explicit 8-day `-g day` range otherwise, and
// `none` for future days (which render nothing and spawn nothing). On a
// cold cache today reads the default key so the page and every recent
// strip share one entry; a past day fetches its own 8-day range once.
// Never throws.
function dayStripRequestFor(day, localToday, defaultPeek) {
  try {
    if (!dayStripDateParts(day)) {
      return { source: "none" };
    }
    const today =
      typeof localToday === "string" && dayStripDateParts(localToday)
        ? localToday
        : "";
    if (today && day > today) {
      return { source: "none" };
    }
    const peek =
      defaultPeek && typeof defaultPeek === "object" ? defaultPeek : null;
    const report =
      peek && peek.report && typeof peek.report === "object"
        ? peek.report
        : null;
    if (report) {
      if (dayStripDefaultReportCovers(report, day, today)) {
        return { source: "default" };
      }
      return {
        source: "range",
        options: { range: dayStripShiftDay(day, -7) + ".." + day, group: "day" },
      };
    }
    if (!today || day === today) {
      return { source: "default" };
    }
    return {
      source: "range",
      options: { range: dayStripShiftDay(day, -7) + ".." + day, group: "day" },
    };
  } catch (error) {
    return { source: "none" };
  }
}

// True when D lies inside a Stats report's current window, from
// `report.range.start/end` with a fallback to the daily-points union.
// Used by `openStatsForDay` to keep the page's window when it already
// shows D. Never throws.
function dayStripDayInReportWindow(day, report) {
  try {
    if (!dayStripDateParts(day) || !report || typeof report !== "object") {
      return false;
    }
    const range =
      report.range && typeof report.range === "object" ? report.range : {};
    let start = typeof range.start === "string" ? range.start : "";
    let end = typeof range.end === "string" ? range.end : "";
    if ((!start || !end) && Array.isArray(report.metrics)) {
      const dates = [];
      for (const metric of report.metrics) {
        let points = null;
        try {
          points = statsChartDailyPoints(metric, report);
        } catch (error) {
          points = [];
        }
        for (const point of points || []) {
          if (point && typeof point.date === "string") {
            dates.push(point.date);
          }
        }
      }
      if (dates.length > 0) {
        dates.sort();
        if (!start) {
          start = dates[0];
        }
        if (!end) {
          end = dates[dates.length - 1];
        }
      }
    }
    if (!start || !end) {
      return false;
    }
    return day >= start && day <= end;
  } catch (error) {
    return false;
  }
}

