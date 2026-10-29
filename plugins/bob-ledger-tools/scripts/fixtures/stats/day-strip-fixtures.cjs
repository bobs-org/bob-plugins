// Presentation-only synthetic reports for the Day strip. These values are
// designed to exercise rendering states and are not observations from a vault.
const DAY = "2026-10-24";
const HUES = ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"];

function shiftDay(day, amount) {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(0);
  value.setHours(12, 0, 0, 0);
  value.setFullYear(year, month - 1, date + amount);
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

function dailyPoint(date, value, display, extra = {}) {
  return {
    date,
    end: date,
    value,
    display,
    quality: value === null ? "missing" : "ok",
    reason: value === null ? "No synthetic value for this day." : undefined,
    provisional: false,
    parts: {},
    parts_display: {},
    ...extra,
  };
}

function typicalWords(display, relation, options = {}) {
  if (options.short) return "no typical day yet";
  if (options.provisional) return "typical full day " + display;
  if (relation === "above") return "above the typical day of " + display;
  if (relation === "below") return "below the typical day of " + display;
  if (relation === "equal") return "the same as the typical day of " + display;
  return "typical day " + display;
}

function typicalDetail(display, relation, options = {}) {
  const span = options.span || "Oct 17 – Oct 23";
  const days = options.days !== undefined ? options.days : 7;
  if (options.short) {
    const verb = days === 1 ? "has" : "have";
    return `No typical day yet: ${days} of the previous 7 days ${verb} data (needs 4).`;
  }
  if (options.provisional) {
    return `Typical full day ${display}: median of ${span} (${days} of 7 days with data). Today is still in progress, so this is context, not a pace.`;
  }
  if (relation === "equal") {
    return `Typical day ${display}: median of ${span} (${days} of 7 days with data). This day matches it.`;
  }
  if (relation === "above" || relation === "below") {
    return `Typical day ${display}: median of ${span} (${days} of 7 days with data). This day is ${relation}.`;
  }
  return `Typical day ${display}: median of ${span} (${days} of 7 days with data).`;
}

function buildTypical(date, spec) {
  const start = spec.start || shiftDay(date, -7);
  const end = spec.end || shiftDay(date, -1);
  const days = spec.days !== undefined ? spec.days : 7;
  const display = spec.display;
  const value = spec.value;
  const relation = spec.relation === undefined ? null : spec.relation;
  const short = value === null || value === undefined;
  const words = spec.words || typicalWords(display, relation, {
    short,
    provisional: spec.provisional === true,
    days,
  });
  const detail = spec.detail || typicalDetail(display, relation, {
    short,
    provisional: spec.provisional === true,
    days,
    span: spec.span,
  });
  return { start, end, days, value, display, relation, words, detail };
}

function defaultTypicalSpecs(options) {
  if (options.shortHistory) {
    return {
      worked: { display: "–", value: null, relation: null, days: 2 },
      reviewed: { display: "–", value: null, relation: null, days: 2 },
      done: { display: "–", value: null, relation: null, days: 2 },
      created: { display: "–", value: null, relation: null, days: 2 },
    };
  }
  if (options.wideValues) {
    return {
      worked: { display: "10h 05m", value: 500, relation: "above" },
      reviewed: { display: "54", value: 54, relation: "above" },
      done: { display: "19", value: 19, relation: "above" },
      created: { display: "23", value: 23, relation: "above" },
    };
  }
  if (options.provisional === false) {
    return {
      worked: { display: "4h 10m", value: 250, relation: "below" },
      reviewed: { display: "6", value: 6, relation: "above" },
      done: { display: "8", value: 8, relation: "equal" },
      created: { display: "23", value: 23, relation: "below" },
    };
  }
  return {
    worked: { display: "4h 10m", value: 250, relation: null, provisional: true },
    reviewed: { display: "54", value: 54, relation: null, provisional: true },
    done: { display: "17", value: 17, relation: null, provisional: true },
    created: { display: "22", value: 22, relation: null, provisional: true },
  };
}

function attachDayTypical(metrics, day, options) {
  if (options.noTypical) return;
  if ((options.group || "day") !== "day") return;
  const specs = options.typical || defaultTypicalSpecs(options);
  for (const metric of metrics) {
    if (!metric || (metric.unit !== "minutes" && metric.unit !== "count")) continue;
    const spec = specs[metric.id];
    if (!spec) continue;
    const points = Array.isArray(metric.points) ? metric.points : [];
    const point = points.find((candidate) => candidate && candidate.date === day);
    if (!point) continue;
    point.typical = buildTypical(day, spec);
  }
}

function minutesDisplay(value) {
  if (value === 0) return "0m";
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (hours && remainder) return `${hours}h ${String(remainder).padStart(2, "0")}m`;
  if (hours) return `${hours}h`;
  return `${value}m`;
}

function themeEntry(key, name, hue, hueSource) {
  return { key, name, hue, hue_source: hueSource };
}

function defaultThemeSplit(value) {
  const gtd = Math.round(value * 0.55);
  const bob = value - gtd;
  return {
    parts: { GTD: gtd, BOB: bob },
    display: { GTD: minutesDisplay(gtd), BOB: minutesDisplay(bob) },
  };
}

function makeReport(options = {}) {
  const day = options.day || DAY;
  const today = options.today || DAY;
  const count = options.count || 8;
  const group = options.group || "day";
  const dates = Array.from({ length: count }, (_, index) => shiftDay(day, index - count + 1));
  const homes = {};
  const areaNames = options.manyAreas
    ? Array.from({ length: 7 }, (_, index) => `area-${index + 1}.md`)
    : ["gtd.md", "dev.md"];
  areaNames.forEach((key, index) => {
    const label = options.longLabels ? `Long ${["Systems Research", "Personal Development", "Writing"][index % 3]} ${index + 1}` : key.replace(/\.md$/, "");
    homes[key] = { label, kind: "area", area: key, root_parent: key, path: key, hue: HUES[index % HUES.length], project_label: `${label} · area tasks` };
  });
  homes["@unlinked"] = { label: "unlinked", kind: "bucket", area: "@unlinked", root_parent: "@unlinked", path: null, hue: null };
  homes["@unfiled"] = { label: "unfiled", kind: "bucket", area: "@unfiled", root_parent: "@unfiled", path: null, hue: null };
  if (options.sameHueRoots) {
    homes["bob.md"] = { label: "bob", kind: "project", area: "dev.md", root_parent: "bob.md", path: "bob.md", hue: "blue" };
    homes["sase.md"] = { label: "sase", kind: "project", area: "dev.md", root_parent: "sase.md", path: "sase.md", hue: "blue" };
    homes["dev.md"] = { label: "dev", kind: "area", area: "dev.md", root_parent: "dev.md", path: "dev.md", hue: "blue", project_label: "dev · area tasks" };
    homes["gtd_daily.md"] = { label: "gtd_daily", kind: "area", area: "gtd.md", root_parent: "gtd_daily.md", path: "gtd_daily.md", hue: "orange" };
    homes["gtd.md"] = { label: "gtd", kind: "area", area: "gtd.md", root_parent: "gtd.md", path: "gtd.md", hue: "orange", project_label: "gtd · area tasks" };
  }
  if (options.screenshotDay) {
    homes["bob.md"] = { label: "bob", kind: "project", area: "dev.md", root_parent: "bob.md", path: "bob.md", hue: "blue" };
    homes["sase_pypi_releases.md"] = { label: "sase_pypi_releases", kind: "project", area: "dev.md", root_parent: "sase_pypi_releases.md", path: "sase_pypi_releases.md", hue: "blue" };
    homes["sase_blog.md"] = { label: "sase_blog", kind: "project", area: "dev.md", root_parent: "sase_blog.md", path: "sase_blog.md", hue: "blue" };
    homes["dev.md"] = { label: "dev", kind: "area", area: "dev.md", root_parent: "dev.md", path: "dev.md", hue: "blue", project_label: "dev · area tasks" };
    homes["gtd_daily.md"] = { label: "gtd_daily", kind: "area", area: "gtd.md", root_parent: "gtd_daily.md", path: "gtd_daily.md", hue: "orange" };
    homes["gtd.md"] = { label: "gtd", kind: "area", area: "gtd.md", root_parent: "gtd.md", path: "gtd.md", hue: "orange", project_label: "gtd · area tasks" };
  }
  if (options.manyRoots) {
    for (let index = 1; index <= 7; index += 1) {
      const key = `root-${index}.md`;
      homes[key] = { label: `root-${index}`, kind: "project", area: "dev.md", root_parent: key, path: key, hue: HUES[(index - 1) % HUES.length] };
    }
  }
  if (options.longLabels) {
    homes["job_2026_apply_29.md"] = { label: "job_2026_apply_29 long root", kind: "project", area: "dev.md", root_parent: "job_2026_apply_29.md", path: "job_2026_apply_29.md", hue: "blue" };
  }

  const workedPoints = dates.map((date, index) => {
    const value = date === day
      ? (options.noPomodoros ? 0
        : options.allUnlinked ? 105
        : options.manyAreas ? 420
        : options.wideValues ? 605
        : options.screenshotDay ? 115
        : options.themeCollision ? 260
        : options.manyThemes ? 295
        : options.noThemeHues ? 90
        : options.redefinedWorked ? 4
        : 185)
      : 30 + index * 15;
    let parts = {};
    let partsDisplay = {};
    if (options.redefinedWorked) {
      parts = {};
      partsDisplay = {};
    } else if (date === day && options.allUnlinked) {
      parts = { area: { "@unlinked": 105 } };
      partsDisplay = { area: { "@unlinked": "1h 45m" } };
    } else if (date === day && options.manyAreas) {
      const entries = areaNames.map((key, areaIndex) => [key, (areaIndex + 1) * 30]);
      entries.push(["@unlinked", 30]);
      parts = { area: Object.fromEntries(entries) };
      partsDisplay = { area: Object.fromEntries(entries.map(([key, amount]) => [key, `${amount}m`])) };
    } else if (date === day && options.sameHueRoots) {
      parts = { area: { "dev.md": 120, "gtd.md": 65 }, root_parent: { "bob.md": 45, "sase.md": 75, "dev.md": 10, "@unfiled": 50, "gtd_daily.md": 20, "gtd.md": 15, "@unlinked": 5 } };
      partsDisplay = { area: { "dev.md": "2h 0m", "gtd.md": "1h 5m" }, root_parent: { "bob.md": "45m", "sase.md": "1h 15m", "dev.md": "10m", "@unfiled": "50m", "gtd_daily.md": "20m", "gtd.md": "15m", "@unlinked": "5m" } };
    } else if (date === day && options.screenshotDay) {
      parts = { area: { "dev.md": 70, "gtd.md": 45 }, root_parent: { "bob.md": 20, "sase_pypi_releases.md": 5, "sase_blog.md": 45, "gtd_daily.md": 45 } };
      partsDisplay = { area: { "dev.md": "1h 10m", "gtd.md": "45m" }, root_parent: { "bob.md": "20m", "sase_pypi_releases.md": "5m", "sase_blog.md": "45m", "gtd_daily.md": "45m" } };
    } else if (date === day && options.manyRoots) {
      const entries = Array.from({ length: 7 }, (_, rootIndex) => [`root-${rootIndex + 1}.md`, (rootIndex + 1) * 20]);
      entries.push(["@unlinked", 15]);
      parts = { area: { "dev.md": entries.reduce((sum, [, amount]) => sum + amount, 0) }, root_parent: Object.fromEntries(entries) };
      partsDisplay = {
        area: { "dev.md": `${entries.reduce((sum, [, amount]) => sum + amount, 0)}m` },
        root_parent: Object.fromEntries(entries.map(([key, amount]) => [key, `${amount}m`])),
      };
    } else if (date === day && options.noPomodoros) {
      parts = { area: {} };
      partsDisplay = { area: {} };
    } else if (!(date === day && options.redefinedWorked)) {
      parts = { area: { "gtd.md": Math.round(value * 0.55), "dev.md": value - Math.round(value * 0.55) } };
      partsDisplay = { area: { "gtd.md": `${Math.round(value * 0.55)}m`, "dev.md": `${value - Math.round(value * 0.55)}m` } };
    }
    // Default: mirror area parts into root_parent so the strip prefers
    // roots; areaOnly (old bob) skips the mirror.
    if (!options.areaOnly && !options.redefinedWorked && parts.area && !parts.root_parent) {
      parts = { ...parts, root_parent: { ...parts.area } };
      partsDisplay = { ...partsDisplay, root_parent: { ...(partsDisplay.area || {}) } };
    }
    if (options.longLabels && date === day && parts.root_parent) {
      parts = { ...parts, root_parent: { ...parts.root_parent, "job_2026_apply_29.md": 25 } };
      partsDisplay = { ...partsDisplay, root_parent: { ...(partsDisplay.root_parent || {}), "job_2026_apply_29.md": "25m" } };
    }
    if (!options.redefinedWorked && !options.noPomodoros && value > 0) {
      let theme = null;
      if (date === day && options.screenshotDay) {
        theme = { parts: { GTD: 45, SASE: 40, BOB: 20, DECKS: 10 }, display: { GTD: "45m", SASE: "40m", BOB: "20m", DECKS: "10m" } };
      } else if (date === day && options.themeCollision) {
        theme = {
          parts: { PYPI: 60, READ: 50, GTD: 50, WRITE: 45, BLOG: 35, VIBE: 20 },
          display: { PYPI: "1h", READ: "50m", GTD: "50m", WRITE: "45m", BLOG: "35m", VIBE: "20m" },
        };
      } else if (date === day && options.manyThemes) {
        const keys = ["ALPHA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF"];
        const amounts = keys.map((_, themeIndex) => (themeIndex + 1) * 10);
        amounts.push(15);
        const themeParts = Object.fromEntries(keys.map((key, themeIndex) => [key, amounts[themeIndex]]));
        themeParts["(unnamed)"] = 15;
        theme = {
          parts: themeParts,
          display: Object.fromEntries(Object.entries(themeParts).map(([key, amount]) => [key, minutesDisplay(amount)])),
        };
      } else if (date === day && options.noThemeHues) {
        theme = { parts: { BOB: 50, DECKS: 40 }, display: { BOB: "50m", DECKS: "40m" } };
      } else if (date === day && options.allUnlinked) {
        theme = { parts: { BOB: 105 }, display: { BOB: "1h 45m" } };
      } else {
        theme = defaultThemeSplit(value);
      }
      if (theme) {
        parts = { ...parts, theme: theme.parts };
        partsDisplay = { ...partsDisplay, theme: theme.display };
      }
      if (options.longLabels && date === day && parts.theme) {
        const bob = (parts.theme.BOB || 0) + 25;
        parts = { ...parts, theme: { ...parts.theme, BOB: bob } };
        partsDisplay = { ...partsDisplay, theme: { ...(partsDisplay.theme || {}), BOB: minutesDisplay(bob) } };
      }
    }
    return dailyPoint(date, value, options.redefinedWorked ? String(value) : value === 0 ? "0m" : `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`, {
      provisional: date === day && options.provisional !== false && day === today,
      parts,
      parts_display: partsDisplay,
    });
  });

  const reviewedPoints = dates.map((date, index) => {
    const count = options.wideValues ? 300 + index : index + 3;
    const target = dailyPoint(date, count, String(count), { provisional: date === day && day === today });
    if (options.notTracked && date === day) {
      Object.assign(target, { value: null, display: "–", quality: "not_tracked", reason: "No review answers have been recorded.", provisional: false });
    }
    if (options.missingWarning && date === day) {
      Object.assign(target, { value: null, display: "–", quality: "missing", reason: "The review journal has a gap for this day.", provisional: false });
    }
    return target;
  });
  const numberPoints = (base) => dates.map((date, index) => {
    const value = options.wideValues ? base * 100 + index : base + index;
    return dailyPoint(date, value, String(value), { provisional: date === day && day === today });
  });
  const closedPoints = dates.map((date, index) => {
    const value = date === day && day === today ? 0 : index % 2 === 0 ? 1 : 0;
    return dailyPoint(date, value, value ? "met" : date === day && day === today ? "not yet" : "missed", {
      provisional: date === day && day === today,
    });
  });
  const definitions = {
    worked: "Minutes in completed Pomodoros attributed to this day's areas.",
    reviewed: "GTD review answers completed on this day.",
    done: "Tasks completed on this day.",
    created: "Tasks created on this day.",
    review_closed: "Whether this day's review checklist was closed.",
  };
  const metric = (id, label, unit, kind, points, extra = {}) => ({
    id,
    label: options.longLabels && id === "review_closed" ? "Review Closeout With A Deliberately Long Display Label" : label,
    unit,
    kind,
    definition: definitions[id],
    source: "synthetic presentation fixture",
    since: options.notTracked && id === "reviewed" ? shiftDay(day, 1) : "2026-10-01",
    summary: { headline: null, total: null, days_with_data: 0 },
    chart: { group, p25: null, p75: null },
    points: group === "week" ? [dailyPoint(dates[0], 1, "week total")] : points,
    ...(group === "week" ? { daily_points: points } : {}),
    ...extra,
  });

  let workedUnit = options.redefinedWorked ? "count" : "minutes";
  if (options.redefinedWorked) {
    workedPoints.forEach((point) => { delete point.parts; delete point.parts_display; });
  }
  const metrics = [
    metric("worked", options.longLabels ? "Time in the systems and projects I touched today" : "Worked", workedUnit, "pomodoro", workedPoints),
    metric("reviewed", "Reviewed", "count", "journal", reviewedPoints),
    metric("done", "Done", "count", "tasks", numberPoints(1)),
    metric("created", "Created", "count", "tasks", numberPoints(4)),
    metric("review_closed", "Review closed", "bool", "checklist", closedPoints),
  ];
  attachDayTypical(metrics, day, { ...options, group });
  const warnings = options.missingWarning ? [{ code: "journal_gap", date: day, message: "The review journal has a gap for this day." }] : [];
  let themeHues = null;
  if (!options.noThemeHues && !options.redefinedWorked) {
    themeHues = {
      gtd: themeEntry("gtd", "GTD", null, "exempt"),
      bob: themeEntry("bob", "BOB", "magenta", "hash"),
      sase: themeEntry("sase", "SASE", "aqua", "pin"),
      decks: themeEntry("decks", "DECKS", "orange", "hash"),
      pypi: themeEntry("pypi", "PYPI", "green", "hash"),
      read: themeEntry("read", "READ", "green", "hash"),
      write: themeEntry("write", "WRITE", "magenta", "hash"),
      blog: themeEntry("blog", "BLOG", "orange", "hash"),
      vibe: themeEntry("vibe", "VIBE", "orange", "hash"),
      alpha: themeEntry("alpha", "ALPHA", "blue", "hash"),
      bravo: themeEntry("bravo", "BRAVO", "orange", "hash"),
      charlie: themeEntry("charlie", "CHARLIE", "aqua", "hash"),
      delta: themeEntry("delta", "DELTA", "yellow", "hash"),
      echo: themeEntry("echo", "ECHO", "magenta", "hash"),
      foxtrot: themeEntry("foxtrot", "FOXTROT", "green", "hash"),
      golf: themeEntry("golf", "GOLF", "violet", "hash"),
    };
  }
  const sessions = [];
  if (options.screenshotDay) {
    sessions.push({
      date: day,
      path: `${day.replace(/-/g, "/").slice(0, 7)}/${day.replace(/-/g, "")}.md`,
      line: 12,
      minutes: 30,
      minutes_display: "30m",
      quality: "ok",
      name: "BOB + DECKS",
      homes: {},
    });
  }
  return {
    ok: true,
    schema_version: 1,
    presentation_fixture: true,
    today,
    range: {
      preset: options.preset || null,
      offset: 0,
      start: dates[0],
      end: dates.at(-1),
      days: dates.length,
      includes_today: true,
      group,
      label: `${dates[0]} – ${dates.at(-1)}`,
    },
    metrics,
    warnings,
    homes,
    sessions,
    ...(themeHues ? { theme_hues: themeHues } : {}),
  };
}

function fixture(name, options = {}) {
  const day = options.day || DAY;
  return { name, day, localToday: options.localToday || DAY, fetchedAt: "2026-10-24T14:50:00", report: makeReport({ ...options, day }) };
}

const fixtures = {
  today: fixture("today in progress", { provisional: true }),
  past: fixture("complete past day", { day: "2026-10-21", localToday: DAY, today: DAY, provisional: false }),
  noPomodoros: fixture("no Pomodoros", { noPomodoros: true }),
  allUnlinked: fixture("all time unlinked", { allUnlinked: true }),
  notTracked: fixture("not tracked before since", { notTracked: true }),
  missingWarning: fixture("missing journal warning", { missingWarning: true }),
  manyAreas: fixture("seven areas and +N", { manyAreas: true }),
  redefinedWorked: fixture("redefined worked without area parts", { redefinedWorked: true }),
  areaOnly: fixture("old bob without root_parent", { areaOnly: true }),
  sameHueRoots: fixture("same-area roots get distinct hues", { sameHueRoots: true }),
  manyRoots: fixture("seven roots and +N", { manyRoots: true }),
  screenshotDay: fixture("four roots with minutes", { screenshotDay: true, provisional: true }),
  themeCollision: fixture("same-hue themes get shades", { themeCollision: true, provisional: false }),
  manyThemes: fixture("seven themes and unnamed", { manyThemes: true, provisional: false }),
  noThemeHues: fixture("theme parts without theme_hues", { noThemeHues: true, provisional: false }),
  longLabels: fixture("long metric and area labels", { longLabels: true }),
  wideValues: fixture("wide values", { wideValues: true, provisional: false }),
  weekGrouped: fixture("week grouped report with daily points", { group: "week" }),
  default4w: fixture("canonical-shaped default 4w", { preset: "4w", count: 28 }),
  explicitDay8: fixture("explicit -g day eight-day report", { count: 8 }),
  shortHistory: fixture("short typical history", { shortHistory: true, provisional: false }),
  oldBob: fixture("old bob without typical", { noTypical: true, provisional: false }),
};

module.exports = { ...fixtures, createReport: makeReport };
