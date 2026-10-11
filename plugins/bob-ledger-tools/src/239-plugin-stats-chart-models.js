// Pure chart geometry and date helpers shared by the focus chart and panels.
const STATS_SVG_NS = "http://www.w3.org/2000/svg";

function statsFinite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function statsChartDomain(values, unit) {
  const finite = (Array.isArray(values) ? values : []).filter(statsFinite);
  if (unit === "ratio") {
    return [0, 10000];
  }
  let min = Math.min(0, ...(finite.length ? finite : [0]));
  let max = Math.max(0, ...(finite.length ? finite : [0]));
  if (min === 0 && max === 0) {
    return [0, 1];
  }
  const span = max - min;
  if (span === 0) {
    const pad = Math.max(Math.abs(max) * 0.1, 1);
    return [Math.min(0, min - pad), Math.max(0, max + pad)];
  }
  const pad = span * 0.06;
  return [min < 0 ? min - pad : 0, max > 0 ? max + pad : 0];
}

function statsNiceStep(rawStep) {
  if (!statsFinite(rawStep) || rawStep <= 0) {
    return 1;
  }
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const fraction = rawStep / power;
  const factor = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return factor * power;
}

function statsChartTicks(domain, unit, targetCount) {
  const pair = Array.isArray(domain) ? domain : [0, 1];
  let min = statsFinite(pair[0]) ? pair[0] : 0;
  let max = statsFinite(pair[1]) ? pair[1] : 1;
  if (max < min) {
    const swap = min;
    min = max;
    max = swap;
  }
  if (max === min) {
    max = min + 1;
  }
  const count = Number.isInteger(targetCount) && targetCount >= 2 ? targetCount : 5;
  let step = statsNiceStep((max - min) / (count - 1));
  step = Math.max(1, step);
  if (unit === "minutes" && max - min >= 240) {
    step = Math.max(60, statsNiceStep((max - min) / (count - 1) / 60) * 60);
  }
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let value = start, guard = 0; value <= max + step * 1e-8 && guard < 100; value += step, guard += 1) {
    if (statsFinite(value)) {
      ticks.push(Math.round(value));
    }
  }
  if (ticks.length === 0) {
    ticks.push(Math.round(min), Math.round(max));
  }
  return { step, values: ticks };
}

function statsChartFormatTick(value, unit, step) {
  if (!statsFinite(value)) {
    return "–";
  }
  const number = Math.round(value);
  if (unit === "ratio") {
    return (number / 100).toFixed(number % 100 === 0 ? 0 : 1) + "%";
  }
  if (unit === "minutes" && step >= 60) {
    const hours = number / 60;
    return (Number.isInteger(hours) ? String(hours) : hours.toFixed(1)) + "h";
  }
  return String(number).replace(/^-/, "−");
}

function statsChartY(value, domain, top, height) {
  const low = Array.isArray(domain) && statsFinite(domain[0]) ? domain[0] : 0;
  const high = Array.isArray(domain) && statsFinite(domain[1]) && domain[1] > low ? domain[1] : low + 1;
  if (!statsFinite(value) || !statsFinite(top) || !statsFinite(height) || height <= 0) {
    return statsFinite(top) ? top + height : 0;
  }
  const result = top + ((high - value) / (high - low)) * height;
  return statsFinite(result) ? result : top + height;
}

function statsChartPointSlots(pointCount, left, width) {
  const count = Number.isInteger(pointCount) && pointCount > 0 ? pointCount : 0;
  const start = statsFinite(left) ? left : 0;
  const span = statsFinite(width) && width > 0 ? width : 0;
  if (!count || span <= 0) {
    return [];
  }
  const slotWidth = span / count;
  const gap = slotWidth >= 4 ? 2 : Math.min(0.75, slotWidth * 0.15);
  const barWidth = Math.max(0, Math.min(24, slotWidth - gap));
  return Array.from({ length: count }, (_, index) => ({
    index,
    slotStart: start + index * slotWidth,
    center: start + (index + 0.5) * slotWidth,
    x: start + index * slotWidth + (slotWidth - barWidth) / 2,
    width: barWidth,
  }));
}

function statsRoundedTerminalBarPath(x, baselineY, valueY, width, radius) {
  if (![x, baselineY, valueY, width].every(statsFinite) || width <= 0 || baselineY === valueY) {
    return "";
  }
  const left = x;
  const right = x + width;
  const top = Math.min(baselineY, valueY);
  const bottom = Math.max(baselineY, valueY);
  const height = bottom - top;
  const r = Math.max(0, Math.min(statsFinite(radius) ? radius : 4, width / 2, height / 2));
  if (valueY < baselineY) {
    return "M " + left + " " + baselineY + " L " + left + " " + (top + r) +
      " Q " + left + " " + top + " " + (left + r) + " " + top +
      " L " + (right - r) + " " + top + " Q " + right + " " + top + " " + right + " " + (top + r) +
      " L " + right + " " + baselineY + " Z";
  }
  return "M " + left + " " + baselineY + " L " + right + " " + baselineY +
    " L " + right + " " + (bottom - r) + " Q " + right + " " + bottom + " " + (right - r) + " " + bottom +
    " L " + (left + r) + " " + bottom + " Q " + left + " " + bottom + " " + left + " " + (bottom - r) + " Z";
}

function statsLinePath(points, xPositions, yFor) {
  const values = Array.isArray(points) ? points : [];
  const xs = Array.isArray(xPositions) ? xPositions : [];
  if (typeof yFor !== "function") {
    return "";
  }
  let path = "";
  let drawing = false;
  for (let index = 0; index < values.length; index += 1) {
    const point = values[index] && typeof values[index] === "object" ? values[index] : {};
    const x = xs[index];
    const value = point.rolling_median;
    if (!statsFinite(x) || !statsFinite(value)) {
      drawing = false;
      continue;
    }
    const y = yFor(value);
    if (!statsFinite(y)) {
      drawing = false;
      continue;
    }
    path += (drawing ? " L " : " M ") + x + " " + y;
    drawing = true;
  }
  return path.trim();
}

function statsIsoOrdinal(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    return null;
  }
  return parsed / 86400000;
}

function statsPointOrdinal(point, end) {
  const safe = point && typeof point === "object" ? point : {};
  const source = end ? (safe.end || safe.date) : (safe.date || safe.end);
  return statsIsoOrdinal(source);
}

function statsAlignPriorPoints(points, priorPoints) {
  const current = (Array.isArray(points) ? points : []).filter((point) => point && point.provisional !== true);
  const prior = Array.isArray(priorPoints) ? priorPoints : [];
  const currentStarts = current.map((point) => statsPointOrdinal(point, false)).filter(statsFinite);
  const currentEnds = current.map((point) => statsPointOrdinal(point, true)).filter(statsFinite);
  const priorStarts = prior.map((point) => statsPointOrdinal(point, false)).filter(statsFinite);
  const priorEnds = prior.map((point) => statsPointOrdinal(point, true)).filter(statsFinite);
  if (!currentStarts.length || !currentEnds.length || !priorStarts.length || !priorEnds.length) {
    return [];
  }
  const priorStart = Math.min(...priorStarts);
  const priorEnd = Math.max(...priorEnds) + 1;
  const currentSpan = Math.max(1, Math.max(...currentEnds) + 1 - Math.min(...currentStarts));
  const priorSpan = Math.max(1, priorEnd - priorStart);
  return prior
    .map((point) => {
      const start = statsPointOrdinal(point, false);
      const end = statsPointOrdinal(point, true);
      if (!statsFinite(start) || !statsFinite(end) || !statsFinite(point && point.value)) {
        return null;
      }
      const center = (start + end + 1) / 2;
      const ratio = (center - priorStart) / priorSpan;
      if (!statsFinite(ratio) || ratio < 0 || ratio > 1) {
        return null;
      }
      return {
        point,
        ratio: Math.max(0, Math.min(1, ratio)),
        partial: point.partial === true,
        unmatchedEdge: point.partial === true && (start === priorStart || end + 1 === priorEnd),
      };
    })
    .filter(Boolean);
}

function statsResponsiveLabelDensity(width, pointCount) {
  const safeWidth = statsFinite(width) && width > 0 ? width : 0;
  const count = Number.isInteger(pointCount) && pointCount > 0 ? pointCount : 0;
  if (safeWidth < 420) {
    return { compact: true, y: "max", xIndices: count ? [...new Set([0, count - 1])] : [] };
  }
  const maxLabels = Math.max(3, Math.floor(safeWidth / 100));
  const stride = Math.max(1, Math.ceil(count / maxLabels));
  const xIndices = [];
  for (let index = 0; index < count; index += stride) {
    xIndices.push(index);
  }
  if (count > 0 && xIndices[xIndices.length - 1] !== count - 1) {
    xIndices.push(count - 1);
  }
  return { compact: false, y: "all", xIndices };
}

function statsChartDateLabel(point) {
  const safe = point && typeof point === "object" ? point : {};
  const start = typeof safe.date === "string" ? safe.date : "";
  const end = typeof safe.end === "string" ? safe.end : start;
  if (!start) {
    return "Date unavailable";
  }
  const short = (date) => date.length >= 10 ? date.slice(5, 10).replace("-", "/") : date;
  return start === end ? short(start) : short(start) + "–" + short(end);
}

function statsChartTooltip(metric, point) {
  const safeMetric = metric && typeof metric === "object" ? metric : {};
  const safe = point && typeof point === "object" ? point : {};
  const lines = [typeof safe.display === "string" && safe.display ? safe.display : "–", statsChartDateLabel(safe)];
  if (safe.provisional === true) {
    lines.push("Provisional today");
  }
  if (safe.partial === true) {
    lines.push("Partial bucket");
  }
  if (safe.quality && safe.quality !== "ok") {
    lines.push(String(safe.quality) + (safe.reason ? ": " + safe.reason : ""));
  } else if (safe.reason) {
    lines.push(String(safe.reason));
  }
  const parts = safe.parts && typeof safe.parts === "object" ? safe.parts : {};
  const display = safe.parts_display && typeof safe.parts_display === "object" ? safe.parts_display : {};
  const ranked = [];
  for (const [dimension, entries] of Object.entries(parts)) {
    if (!entries || typeof entries !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(entries)) {
      if (statsFinite(value)) {
        const formatted = display[dimension] && typeof display[dimension][key] === "string"
          ? display[dimension][key]
          : String(value);
        ranked.push({ dimension, key, value, formatted });
      }
    }
  }
  ranked.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  for (const part of ranked.slice(0, 3)) {
    lines.push(part.dimension + ": " + part.key + " — " + part.formatted);
  }
  if (!ranked.length && safeMetric.id === "worked") {
    lines.push("No theme parts for this point");
  }
  return lines.join("\n");
}
