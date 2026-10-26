// Pure theme-lane model for the daily-note Day strip. Splits the same
// worked minutes as the roots lane, by Pomodoro theme. Bob owns every
// value; this model never re-splits sessions and never hashes hues.
function dayStripThemeEmpty(extra) {
  return {
    segments: [],
    legend: [],
    overflow: [],
    overflowDefault: { count: 0, title: "" },
    empty: false,
    omitted: true,
    dimension: "theme",
    title: "",
    ...(extra || {}),
  };
}

function dayStripThemeHasSplitSession(report, day) {
  const sessions = report && Array.isArray(report.sessions) ? report.sessions : null;
  if (!sessions) return false;
  return sessions.some((session) => {
    if (!session || typeof session !== "object") return false;
    const sessionDay = session.date || session.day;
    if (sessionDay !== day) return false;
    const name = typeof session.name === "string" ? session.name : "";
    try {
      const parts = typeof pomodoroThemeSplitComponents === "function"
        ? pomodoroThemeSplitComponents(name)
        : [];
      return Array.isArray(parts) && parts.length >= 2;
    } catch (error) {
      return false;
    }
  });
}

function dayStripThemeMix(report, worked, day, context) {
  try {
    if (!worked || worked.unit !== "minutes") return dayStripThemeEmpty();
    const points = dayStripMetricPoints(worked, report);
    const hasThemeParts = points.some((point) =>
      point && point.parts && point.parts.theme &&
      typeof point.parts.theme === "object" &&
      !Array.isArray(point.parts.theme) &&
      Object.keys(point.parts.theme).length > 0);
    if (!hasThemeParts) return dayStripThemeEmpty();
    const point = points.find((candidate) => candidate && candidate.date === day) || null;
    const raw = point && point.parts && point.parts.theme && typeof point.parts.theme === "object"
      && !Array.isArray(point.parts.theme)
      ? point.parts.theme
      : null;
    if (!raw) return dayStripThemeEmpty({ point });
    const fallback = context && typeof context.themeHueFor === "function"
      ? context.themeHueFor
      : null;
    const displays = point && point.parts_display && point.parts_display.theme
      && typeof point.parts_display.theme === "object"
      ? point.parts_display.theme
      : {};
    const entries = [];
    for (const [key, value] of Object.entries(raw)) {
      const minutes = typeof value === "number" && Number.isFinite(value) ? value : 0;
      if (minutes <= 0) continue;
      const ref = typeof statsThemeRef === "function"
        ? statsThemeRef(report, key, fallback)
        : { key, label: key, hue: "gray", gray: true };
      const display = typeof displays[key] === "string" && displays[key]
        ? displays[key]
        : statsPanelFormatMinutes(minutes);
      entries.push({
        key,
        label: ref.label,
        value: minutes,
        display,
        hue: ref.gray ? "gray" : ref.hue,
        gray: Boolean(ref.gray),
      });
    }
    if (!entries.length) return dayStripThemeEmpty({ point });

    const coloured = entries.filter((entry) => !entry.gray);
    const gray = entries.filter((entry) => entry.gray);
    const shadeOf = new Map();
    const byHue = new Map();
    for (const entry of coloured) {
      const list = byHue.get(entry.hue) || [];
      list.push(entry);
      byHue.set(entry.hue, list);
    }
    for (const list of byHue.values()) {
      list.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
      list.forEach((entry, index) => {
        shadeOf.set(entry.key, index === 0 ? 0 : index === 1 ? 1 : 2);
      });
    }
    coloured.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    gray.sort((a, b) => {
      const aUnnamed = String(a.key).toLowerCase() === "(unnamed)" ? 1 : 0;
      const bUnnamed = String(b.key).toLowerCase() === "(unnamed)" ? 1 : 0;
      if (aUnnamed !== bUnnamed) return aUnnamed - bUnnamed;
      return b.value - a.value || a.label.localeCompare(b.label);
    });
    const ordered = coloured.concat(gray);
    const segments = ordered.map((entry) => ({
      key: entry.key,
      label: entry.label,
      value: entry.value,
      display: entry.display,
      hue: entry.hue,
      gray: entry.gray,
      shade: entry.gray ? 0 : (shadeOf.has(entry.key) ? shadeOf.get(entry.key) : 0),
      bucket: entry.gray,
    }));
    const byValue = segments.slice().sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    const rankOf = new Map(byValue.map((segment, index) => [segment.key, index + 1]));
    const legend = segments.map((segment) => ({
      key: segment.key,
      label: segment.label,
      legendLabel: segment.label,
      display: segment.display,
      value: segment.value,
      hue: segment.hue,
      gray: segment.gray,
      shade: segment.shade,
      bucket: segment.bucket,
      rank: rankOf.get(segment.key) || 0,
    }));
    const overflowList = segments.filter((segment) => (rankOf.get(segment.key) || 0) > 3);
    const overflowTitle = (list) => list.map((segment) => segment.label + " " + segment.display).join("\n");
    const titleLines = ["Time by theme", ...segments.map((segment) => segment.label + " " + segment.display)];
    if (dayStripThemeHasSplitSession(report, day)) {
      titleLines.push("Pomodoros with several themes are split evenly between them.");
    }
    return {
      segments,
      legend,
      overflow: overflowList,
      overflowDefault: { count: Math.max(0, segments.length - 3), title: overflowTitle(overflowList) },
      empty: false,
      omitted: false,
      dimension: "theme",
      title: titleLines.join("\n"),
      point,
    };
  } catch (error) {
    return dayStripThemeEmpty();
  }
}
