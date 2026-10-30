// Shared time-lane builders for the Day strip and the Stats window bars.
// Order, hue, shade, tone, legend labels, and overflow ranks live here so
// both surfaces stay one family. Bob owns every value; these helpers only
// arrange supplied parts.

function timeLanePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function timeLaneRootTone(key, hue) {
  if (key === "@unlinked" || key === "@unfiled") return "none";
  if (hue === "gray") return "gray";
  return "hue";
}

function timeLaneThemeTone(key, gray) {
  if (String(key).toLowerCase() === "(unnamed)") return "none";
  if (gray) return "gray";
  return "hue";
}

function timeLaneThemeUnconfigured(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.hue_source === "unconfigured") return true;
  if (entry.configured === false) return true;
  return false;
}

function timeLaneSegmentTitle(segment) {
  const label = segment && typeof segment.label === "string" ? segment.label : "";
  const display = segment && typeof segment.display === "string" ? segment.display : "";
  const share = segment && typeof segment.share === "string" ? segment.share : "";
  const parts = [label, display, share].filter(Boolean);
  let title = parts.join(" · ");
  if (segment && segment.unconfigured) title += " · not in your themes";
  return title;
}

function timeLaneRootSegments(report, dimension, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const hueMap = typeof statsPanelDistinctHues === "function"
    ? statsPanelDistinctHues(list, report)
    : new Map();
  return list.map((row) => {
    if (!row || typeof row.key !== "string" || !row.key) return null;
    const hue = hueMap.get(row.key) || row.hue || "gray";
    const tone = timeLaneRootTone(row.key, hue);
    const segment = {
      key: row.key,
      label: typeof row.label === "string" && row.label ? row.label : row.key,
      value: timeLanePositive(row.value) ? row.value : (Number(row.value) || 0),
      display: typeof row.display === "string" && row.display ? row.display : "",
      share: typeof row.share === "string" ? row.share : "",
      hue,
      shade: 0,
      gray: hue === "gray",
      tone,
      bucket: typeof row.key === "string" && row.key.startsWith("@"),
      unconfigured: false,
    };
    segment.title = timeLaneSegmentTitle(segment);
    return segment;
  }).filter(Boolean);
}

function timeLaneThemeSegments(report, entries, fallback) {
  const list = [];
  const raw = Array.isArray(entries) ? entries : [];
  for (const entry of raw) {
    if (!entry || typeof entry.key !== "string" || !entry.key) continue;
    const minutes = typeof entry.value === "number" && Number.isFinite(entry.value) ? entry.value : 0;
    if (minutes <= 0) continue;
    const ref = typeof statsThemeRef === "function"
      ? statsThemeRef(report, entry.key, fallback)
      : { key: entry.key, label: entry.key, hue: "gray", gray: true };
    const gray = Boolean(ref.gray);
    list.push({
      key: entry.key,
      label: ref.label || entry.label || entry.key,
      value: minutes,
      display: typeof entry.display === "string" && entry.display ? entry.display : "",
      share: typeof entry.share === "string" ? entry.share : "",
      hue: gray ? "gray" : ref.hue,
      gray,
      hue_source: typeof ref.hue_source === "string" ? ref.hue_source : "",
      unconfigured: timeLaneThemeUnconfigured(ref) || timeLaneThemeUnconfigured(entry),
    });
  }
  const coloured = list.filter((entry) => !entry.gray);
  const gray = list.filter((entry) => entry.gray);
  const shadeOf = new Map();
  const byHue = new Map();
  for (const entry of coloured) {
    const group = byHue.get(entry.hue) || [];
    group.push(entry);
    byHue.set(entry.hue, group);
  }
  for (const group of byHue.values()) {
    group.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    group.forEach((entry, index) => {
      shadeOf.set(entry.key, index === 0 ? 0 : index === 1 ? 1 : 2);
    });
  }
  coloured.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const unnamed = [];
  const other = [];
  const muted = [];
  for (const entry of gray) {
    const folded = String(entry.key).toLowerCase();
    if (folded === "(unnamed)") unnamed.push(entry);
    else if (folded === "other") other.push(entry);
    else muted.push(entry);
  }
  muted.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  other.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  unnamed.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const ordered = coloured.concat(muted, other, unnamed);
  return ordered.map((entry) => {
    const segment = {
      key: entry.key,
      label: entry.label,
      value: entry.value,
      display: entry.display,
      share: entry.share,
      hue: entry.hue,
      gray: entry.gray,
      shade: entry.gray ? 0 : (shadeOf.has(entry.key) ? shadeOf.get(entry.key) : 0),
      tone: timeLaneThemeTone(entry.key, entry.gray),
      bucket: entry.gray,
      unconfigured: Boolean(entry.unconfigured),
    };
    segment.title = timeLaneSegmentTitle(segment);
    return segment;
  });
}

function timeLaneLegendLabel(report, dimension, row) {
  try {
    if (typeof dayStripLegendLabel === "function") {
      return dayStripLegendLabel(report, dimension, row);
    }
  } catch (error) {
    // Fall through to the row label.
  }
  return row && typeof row.label === "string" && row.label ? row.label : (row ? row.key : "");
}

function timeLaneLegend(report, dimension, segments) {
  const list = Array.isArray(segments) ? segments : [];
  const byValue = list.slice().sort((a, b) => {
    const aValue = typeof a.value === "number" ? a.value : 0;
    const bValue = typeof b.value === "number" ? b.value : 0;
    const aLabel = typeof a.label === "string" ? a.label : "";
    const bLabel = typeof b.label === "string" ? b.label : "";
    return bValue - aValue || aLabel.localeCompare(bLabel);
  });
  const rankOf = new Map(byValue.map((segment, index) => [segment.key, index + 1]));
  const ranked = list.map((segment) => {
    const rank = rankOf.get(segment.key) || 0;
    if (segment && typeof segment === "object") segment.rank = rank;
    return segment;
  });
  const initialLabels = new Map(
    ranked.map((segment) => [segment.key, timeLaneLegendLabel(report, dimension, segment)]),
  );
  const labelCounts = new Map();
  for (const label of initialLabels.values()) {
    const folded = String(label).toLowerCase();
    labelCounts.set(folded, (labelCounts.get(folded) || 0) + 1);
  }
  const legend = ranked.map((segment) => {
    const initial = initialLabels.get(segment.key) || segment.label;
    const folded = String(initial).toLowerCase();
    const collided = (labelCounts.get(folded) || 0) > 1;
    return {
      key: segment.key,
      label: segment.label,
      legendLabel: collided ? segment.label : initial,
      display: segment.display,
      value: segment.value,
      hue: segment.hue,
      gray: segment.gray,
      shade: segment.shade,
      bucket: segment.bucket,
      rank: segment.rank || 0,
    };
  });
  const overflow = ranked.filter((segment) => (rankOf.get(segment.key) || 0) > 3);
  const overflowTitle = overflow.map((segment) => segment.label + " " + segment.display).join("\n");
  return {
    segments: ranked,
    legend,
    overflow,
    overflowDefault: { count: Math.max(0, ranked.length - 3), title: overflowTitle },
  };
}

function statsWindowLaneEmpty(dimension, extra) {
  const themes = dimension === "theme";
  return {
    omitted: true,
    empty: false,
    dimension: dimension || null,
    sentence: "",
    panelView: themes ? "themes" : (dimension === "area" ? "areas" : "roots"),
    segments: [],
    legend: [],
    overflowDefault: { count: 0, title: "" },
    ariaLabel: "",
    ...(extra || {}),
  };
}

function statsWindowLanesOmitted(extra) {
  return {
    state: "omitted",
    windowKey: "",
    span: "",
    meta: { text: "", title: "" },
    roots: statsWindowLaneEmpty("root_parent"),
    themes: statsWindowLaneEmpty("theme"),
    ariaLabel: "",
    ...(extra || {}),
  };
}

function statsWindowWorkedMetric(report) {
  const metrics = report && Array.isArray(report.metrics) ? report.metrics : [];
  return metrics.find((metric) => metric && metric.id === "worked") || null;
}

function statsWindowTotal(worked) {
  const summary = worked && worked.summary && typeof worked.summary === "object" ? worked.summary : null;
  const total = summary ? summary.total : null;
  if (total === null || total === undefined || typeof total !== "object") return null;
  const value = typeof total.value === "number" && Number.isFinite(total.value) ? total.value : null;
  const display = typeof total.display === "string" && total.display ? total.display : "";
  if (value === null && !display) return null;
  return { value, display };
}

function statsWindowThemeEntries(worked) {
  const summary = worked && worked.parts_summary && typeof worked.parts_summary === "object"
    ? worked.parts_summary
    : {};
  const raw = Array.isArray(summary.theme) ? summary.theme : [];
  return raw.filter((part) => part && typeof part.key === "string" && timeLanePositive(part.value));
}

function statsWindowLaneAria(sentence, span, segments) {
  const listed = (Array.isArray(segments) ? segments : []).map((segment) => {
    const share = segment.share ? " (" + segment.share + ")" : "";
    return segment.label + " " + segment.display + share;
  }).join(", ");
  const head = sentence + (span ? ", " + span : "");
  if (!listed) return head + ". Show details below.";
  return head + ": " + listed + ". Show details below.";
}

function statsWindowBuildLane(report, worked, dimension, sentence, panelView, segments, span) {
  const built = timeLaneLegend(report, dimension, segments);
  const legend = built.legend.map((entry) => {
    const segment = built.segments.find((item) => item.key === entry.key) || entry;
    return {
      ...entry,
      title: segment.title,
      tone: segment.tone,
    };
  });
  const overflowTitle = built.segments
    .filter((segment) => (segment.rank || 0) > 3)
    .map((segment) => segment.title || (segment.label + " " + segment.display))
    .join("\n");
  return {
    omitted: false,
    empty: false,
    dimension,
    sentence,
    panelView,
    segments: built.segments,
    legend,
    overflowDefault: { count: built.overflowDefault.count, title: overflowTitle },
    ariaLabel: statsWindowLaneAria(sentence, span, built.segments),
  };
}

function statsWindowLanesModel(report, context) {
  try {
    const safeReport = report && typeof report === "object" ? report : null;
    if (!safeReport) return statsWindowLanesOmitted();
    const worked = statsWindowWorkedMetric(safeReport);
    if (!worked || worked.unit !== "minutes") return statsWindowLanesOmitted();
    const total = statsWindowTotal(worked);
    if (!total) return statsWindowLanesOmitted();
    const range = safeReport.range && typeof safeReport.range === "object" ? safeReport.range : {};
    const span = typeof range.label === "string" ? range.label : "";
    const windowKey = String(range.start || "") + ".." + String(range.end || "");
    const metaTitle = "Worked" + (span ? " " + span : "") +
      (range.includes_today ? " · complete days; today is not included" : "");
    const meta = {
      text: (total.display || "0m") + " worked",
      title: metaTitle,
    };
    const ariaLabel = "Where the time went" + (span ? ", " + span : "");
    if (total.value === 0) {
      const roots = statsWindowLaneEmpty("root_parent", {
        omitted: false,
        empty: true,
        sentence: "Time by root parent",
        panelView: "roots",
        ariaLabel: statsWindowLaneAria("Time by root parent", span, []),
      });
      return {
        state: "ready",
        windowKey,
        span,
        meta,
        roots,
        themes: statsWindowLaneEmpty("theme"),
        ariaLabel,
      };
    }
    const hasRoots = typeof statsPanelHasRootParents === "function"
      ? statsPanelHasRootParents(worked)
      : Array.isArray(worked.parts_summary && worked.parts_summary.root_parent);
    const hasAreas = Array.isArray(worked.parts_summary && worked.parts_summary.area);
    const rootDimension = hasRoots ? "root_parent" : (hasAreas ? "area" : null);
    let roots = statsWindowLaneEmpty(rootDimension || "root_parent");
    if (rootDimension) {
      const rows = typeof statsPanelHomeRows === "function"
        ? statsPanelHomeRows(worked, safeReport, rootDimension, null)
        : [];
      const positive = (Array.isArray(rows) ? rows : []).filter((row) => row && timeLanePositive(row.value));
      if (positive.length) {
        const ordered = typeof statsPanelHomeAreaRows === "function"
          ? statsPanelHomeAreaRows(positive, safeReport)
          : positive;
        const segments = timeLaneRootSegments(safeReport, rootDimension, ordered);
        const sentence = rootDimension === "area" ? "Time by area" : "Time by root parent";
        const panelView = rootDimension === "area" ? "areas" : "roots";
        roots = statsWindowBuildLane(safeReport, worked, rootDimension, sentence, panelView, segments, span);
      }
    }
    let themes = statsWindowLaneEmpty("theme");
    const themeEntries = statsWindowThemeEntries(worked);
    if (themeEntries.length) {
      const fallback = context && typeof context.themeHueFor === "function" ? context.themeHueFor : null;
      const segments = timeLaneThemeSegments(safeReport, themeEntries, fallback);
      if (segments.length) {
        themes = statsWindowBuildLane(safeReport, worked, "theme", "Time by type", "themes", segments, span);
      }
    }
    if (roots.omitted && themes.omitted) return statsWindowLanesOmitted();
    return {
      state: "ready",
      windowKey,
      span,
      meta,
      roots,
      themes,
      ariaLabel,
    };
  } catch (error) {
    return statsWindowLanesOmitted();
  }
}
