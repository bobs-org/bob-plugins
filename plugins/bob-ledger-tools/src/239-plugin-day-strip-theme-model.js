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
      const display = typeof displays[key] === "string" && displays[key]
        ? displays[key]
        : statsPanelFormatMinutes(minutes);
      entries.push({ key, value: minutes, display });
    }
    if (!entries.length) return dayStripThemeEmpty({ point });
    const built = typeof timeLaneLegend === "function" && typeof timeLaneThemeSegments === "function"
      ? timeLaneLegend(report, "theme", timeLaneThemeSegments(report, entries, fallback))
      : { segments: [], legend: [], overflow: [], overflowDefault: { count: 0, title: "" } };
    const titleLines = ["Time by theme", ...built.segments.map((segment) => segment.label + " " + segment.display)];
    if (dayStripThemeHasSplitSession(report, day)) {
      titleLines.push("Pomodoros with several themes are split evenly between them.");
    }
    return {
      segments: built.segments,
      legend: built.legend,
      overflow: built.overflow,
      overflowDefault: built.overflowDefault,
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
