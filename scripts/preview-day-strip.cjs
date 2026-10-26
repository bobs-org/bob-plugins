#!/usr/bin/env node
// Render the production Day strip model, painter, and stylesheet in Chromium,
// under mock plan badges and an Obsidian baseline stylesheet. The output is
// dev-only; no browser dependency is needed beyond Chromium.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "..");
const pluginRoot = path.join(repoRoot, "plugins/bob-ledger-tools");
// Height budgets at a 16 px base, measured with the theme lane plus 2 px.
const DAY_STRIP_HEIGHT_ONE_LINE = 132;
const DAY_STRIP_HEIGHT_WRAPPED = 198;
// Single-lane budgets at a 16 px base, measured plus 2 px.
const DAY_STRIP_HEIGHT_ONE_LANE_ONE_LINE = 100;
const DAY_STRIP_HEIGHT_ONE_LANE_WRAPPED = 166;

// Obsidian's app.css rules that reach plugin DOM. This commented baseline
// is what once broke the strip: every tile was a <button>, so the 30 px
// input height clipped each label, value, and history mark. It loads
// before the production CSS so a <button> regression fails the matrix.
const OBSIDIAN_BASELINE_CSS = [
  "/* Obsidian app.css baseline (excerpt).",
  "   These rules reach plugin DOM in both Live Preview and Reading view:",
  "   buttons render as 30 px inline-flex inputs, links take the accent",
  "   colour, and rendered Markdown sets the surrounding line-height. */",
  ":root { --input-height: 30px; }",
  "button {",
  "  display: inline-flex;",
  "  align-items: center;",
  "  justify-content: center;",
  "  height: var(--input-height);",
  "  padding: 4px 12px;",
  "  border: 1px solid var(--background-modifier-border);",
  "  border-radius: 5px;",
  "  background: var(--interactive-normal);",
  "  box-shadow: var(--input-shadow);",
  "  color: var(--text-normal);",
  "  font-family: var(--font-interface);",
  "  font-size: 13px;",
  "  font-weight: 500;",
  "  white-space: nowrap;",
  "}",
  "a { color: var(--text-accent); text-decoration-line: underline; }",
  ".markdown-rendered { line-height: 1.5; }",
  ".markdown-source-view.mod-cm6 .cm-content { line-height: 1.5; }",
].join("\n");

function parseArgs(argv) {
  const args = { out: path.join("/tmp", "bob-day-strip-preview") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out" && argv[index + 1]) args.out = path.resolve(argv[++index]);
    else if (argv[index] === "--help" || argv === "-h") {
      console.log("Usage: node scripts/preview-day-strip.cjs [--out DIRECTORY]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return args;
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  const cache = path.join(os.homedir(), ".cache/ms-playwright");
  if (fs.existsSync(cache)) {
    const candidates = [];
    for (const browserDir of fs.readdirSync(cache)) {
      if (!browserDir.startsWith("chromium-")) continue;
      for (const platformDir of ["chrome-linux64", "chrome-linux", "chrome-mac/Chromium.app/Contents/MacOS"]) {
        const executable = path.join(cache, browserDir, platformDir, process.platform === "darwin" ? "Chromium" : "chrome");
        if (fs.existsSync(executable)) candidates.push(executable);
      }
    }
    if (candidates.length) return candidates.sort().at(-1);
  }
  throw new Error("Could not find headless Chromium. Set CHROMIUM_PATH to an installed browser executable.");
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function loadFixtures() {
  const source = require(path.join(pluginRoot, "scripts/fixtures/stats/day-strip-fixtures.cjs"));
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "createReport" || !value || typeof value !== "object" || !value.report) continue;
    result[key] = value;
  }
  const notTrackedWarning = JSON.parse(JSON.stringify(result.notTracked));
  notTrackedWarning.name = "not tracked plus a journal warning";
  notTrackedWarning.report.warnings.push({
    code: "journal_gap",
    date: notTrackedWarning.day,
    message: "A review-journal gap was recorded for this day.",
  });
  result.notTrackedWarning = notTrackedWarning;
  const metPast = JSON.parse(JSON.stringify(result.past));
  metPast.name = "closed-out past day · met";
  const closedMetric = metPast.report.metrics.find((metric) => metric.id === "review_closed");
  if (closedMetric) {
    for (const point of closedMetric.chart_daily_points || closedMetric.daily_points || closedMetric.points || []) {
      if (point.date === metPast.day) {
        point.value = 1;
        point.display = "met";
      }
    }
  }
  result.metPast = metPast;
  return result;
}

function makeHtml({ pluginSource, css, fixtures }) {
  return fs.readFileSync(path.join(__dirname, "preview-day-strip.template.html"), "utf8")
    .replace("__OBSIDIAN_BASELINE_CSS__", () => OBSIDIAN_BASELINE_CSS)
    .replace("__PRODUCTION_CSS__", () => css)
    .replace("__PLUGIN_SOURCE_JSON__", () => safeJson(pluginSource))
    .replace("__FIXTURES_JSON__", () => safeJson(fixtures));
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(String(pending.method) + ": " + (message.error.message || JSON.stringify(message.error))));
      else pending.resolve(message.result || {});
    });
  }

  static async connect(endpoint) {
    let WebSocketClient = typeof globalThis.WebSocket === "function" ? globalThis.WebSocket : null;
    if (!WebSocketClient) {
      try { WebSocketClient = require("undici").WebSocket || null; }
      catch (error) { WebSocketClient = null; }
    }
    if (!WebSocketClient) throw new Error("The preview needs Node 22+ WebSocket or the undici WebSocket client.");
    const socket = new WebSocketClient(endpoint);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception && response.exceptionDetails.exception.description || response.exceptionDetails.text);
    }
    return response.result && response.result.value;
  }
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForFile(file, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function waitForPreview(client) {
  const start = Date.now();
  let lastError = "";
  let lastState = null;
  while (Date.now() - start < 15000) {
    let state;
    try {
      state = await client.evaluate("({ ready: Boolean(window.__dayStripPreviewReady), error: window.__previewError || '', stage: window.__dayStripStage || '', state: document.readyState })");
      lastState = state;
    } catch (error) { lastError = error && error.message ? error.message : String(error); }
    if (state && state.error) throw new Error(`Preview page error: ${state.error}`);
    if (state && state.ready) return;
    await sleep(50);
  }
  throw new Error("Day strip preview did not become ready." + (lastError ? " Last CDP error: " + lastError : "") + (lastState ? " Page state: " + JSON.stringify(lastState) : ""));
}

async function capturePage(client, output) {
  await client.evaluate("document.fonts && document.fonts.ready");
  await client.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const metrics = await client.call("Page.getLayoutMetrics");
  const width = Math.ceil(metrics.cssContentSize.width);
  const height = Math.ceil(metrics.cssContentSize.height);
  const response = await client.call("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  fs.writeFileSync(output, Buffer.from(response.data, "base64"));
}

function checkMeasurement(item, context) {
  const failures = [];
  const view = item.view || "both";
  const isSingleLaneView = view === "roots" || view === "themes";
  if (item.maxOverflow > 0.5) failures.push(`overflow ${item.maxOverflow}px escapes the strip box`);
  if (item.maxFactOverlap > 0.5) failures.push(`facts overlap by ${item.maxFactOverlap}px`);
  if (item.linesOverlap > 0.5) failures.push(`line 1 and line 2 overlap by ${item.linesOverlap}px`);
  if (item.legendOverlap > 0.5) failures.push(`legend items or meta overlap`);
  if (item.valueBaselineSpread > 1) failures.push(`value baselines spread ${item.valueBaselineSpread}px`);
  if (item.hasButton) failures.push(`strip contains a <button> element`);
  if (!item.relaxed) {
    if (item.factRows > 2 && item.state !== "unavailable") failures.push(`${item.factRows} fact rows (max 2)`);
    const budget = isSingleLaneView
      ? (item.factRows <= 1 ? DAY_STRIP_HEIGHT_ONE_LANE_ONE_LINE : DAY_STRIP_HEIGHT_ONE_LANE_WRAPPED)
      : (item.factRows <= 1 ? DAY_STRIP_HEIGHT_ONE_LINE : DAY_STRIP_HEIGHT_WRAPPED);
    if (item.stripHeight > budget + 0.5) failures.push(`height ${item.stripHeight}px over the ${budget}px budget`);
  }
  // (i) the strip precedes .bob-plan with a calm 6–16 px gap.
  if (item.domOrderOk === false && item.state !== "unavailable" && !String(item.state).startsWith("skeleton")) {
    failures.push(`strip does not precede .bob-plan in the DOM`);
  }
  if (typeof item.stripToBadges === "number" && (item.stripToBadges < 6 || item.stripToBadges > 16)) {
    failures.push(`strip bottom sits ${item.stripToBadges}px above the badges (want 6–16px)`);
  }
  // (j) every lane bar spans the content width (±1 px); the themes bar,
  // when present, is the strip's last line box (else the roots bar).
  const widthDeltas = Array.isArray(item.barWidthDeltas) && item.barWidthDeltas.length
    ? item.barWidthDeltas
    : (typeof item.barWidthDelta === "number" ? [item.barWidthDelta] : []);
  for (const delta of widthDeltas) {
    if (delta > 1) failures.push(`a lane bar misses the strip width by ${delta}px`);
  }
  const barIsLast = item.lastBarIsLast === undefined ? item.barIsLast : item.lastBarIsLast;
  if (barIsLast === false && item.state !== "unavailable" && !item.mixOmitted) {
    failures.push(`bar is not the strip's last line box`);
  }
  if (item.lanesOverlap > 0.5) failures.push(`theme and root lanes overlap`);
  if (item.themeLanePresent && item.laneGapOk === false) {
    failures.push(`roots-bar-to-themes-row gap is not larger than the themes legend-to-bar gap`);
  }
  // (k) no legend label is truncated and no legend item spills past its box.
  if (item.legendTruncation > 0.5) failures.push(`legend label truncates by ${item.legendTruncation}px`);
  if (item.legendItemOverflow > 0.5) failures.push(`legend item overflows its box by ${item.legendItemOverflow}px`);
  // (k)/(l) per legend: the visible counter equals that lane's segments
  // minus its visible items. screenshotDay fits four roots at 540/700
  // and at least three at 410. Clipping is covered by (a)(b)(k).
  const checkLegendFit = (fit, segments, label) => {
    if (!fit || typeof segments !== "number" || segments <= 0) return;
    if (segments > fit.visible && fit.counter !== segments - fit.visible) {
      failures.push(`${label} counter is +${fit.counter} for ${segments} segments and ${fit.visible} labels`);
    }
    if (segments === fit.visible && fit.counter !== null && fit.counter !== undefined) {
      failures.push(`${label} counter shows +${fit.counter} with every item visible`);
    }
  };
  const laneShown = Array.isArray(item.laneShown) ? item.laneShown : [];
  const showsRoots = laneShown.includes("roots") || (!laneShown.length && !item.mixOmitted);
  const showsThemes = laneShown.includes("themes") || (!laneShown.length && !item.themeOmitted);
  if (Array.isArray(item.legendFits) && item.legendFits.length) {
    const fitsByLane = {};
    if (item.laneRowCount === 1 && item.laneRows && item.laneRows.length === 1) {
      fitsByLane[item.laneRows[0]] = item.legendFits[0];
    } else {
      if (item.legendFits[0]) fitsByLane.roots = item.legendFits[0];
      if (item.legendFits[1]) fitsByLane.themes = item.legendFits[1];
    }
    if (item.state !== "skeleton" && item.state !== "skeleton-roots" && item.state !== "skeleton-themes" && !item.mixOmitted && showsRoots && fitsByLane.roots) {
      checkLegendFit(fitsByLane.roots, item.segments, "roots");
    }
    if (item.state !== "skeleton" && item.state !== "skeleton-roots" && item.state !== "skeleton-themes" && !item.themeOmitted && showsThemes && fitsByLane.themes) {
      checkLegendFit(fitsByLane.themes, item.themeSegmentsCount, "themes");
    }
  } else if (typeof item.segments === "number" && item.segments > 0 && item.state !== "skeleton" && !item.mixOmitted && showsRoots) {
    if (item.segments > item.visibleLegend && item.visibleCounter !== item.segments - item.visibleLegend) {
      failures.push(`counter is +${item.visibleCounter} for ${item.segments} segments and ${item.visibleLegend} labels`);
    }
    if (item.segments === item.visibleLegend && item.visibleCounter !== null && item.visibleCounter !== undefined) {
      failures.push(`counter shows +${item.visibleCounter} with every root visible`);
    }
  }
  const baseState = String(item.state || "").replace(/-(roots|themes)$/, "");
  if (baseState === "screenshot-day" && !item.mixOmitted && showsRoots) {
    if (context.width === 540 || context.width === 700) {
      if (item.visibleLegend !== 4 || item.segments !== 4) {
        failures.push(`screenshotDay shows ${item.visibleLegend} of ${item.segments} roots at ${context.width}px (want 4)`);
      }
      if (item.visibleCounter !== null && item.visibleCounter !== undefined) {
        failures.push(`screenshotDay shows +${item.visibleCounter} at ${context.width}px (want no counter)`);
      }
    }
    if (context.width === 410 && item.visibleLegend < 3) {
      failures.push(`screenshotDay shows ${item.visibleLegend} roots at 410px (want at least 3)`);
    }
  }
  // (u) single-lane views paint exactly one lane row and one bar; the bar is
  // the strip's last line; the lane is the chosen one when available.
  if (isSingleLaneView && !String(item.state).startsWith("skeleton") && item.state !== "unavailable" && item.state !== "hover" && item.state !== "focus" && item.state !== "reading") {
    if (item.laneRowCount !== 1) failures.push(`single-lane view paints ${item.laneRowCount} rows (want 1)`);
    if (item.laneBarCount !== 1) failures.push(`single-lane view paints ${item.laneBarCount} bars (want 1)`);
    const barIsLast = item.lastBarIsLast === undefined ? item.barIsLast : item.lastBarIsLast;
    if (barIsLast === false) failures.push(`single-lane bar is not the strip's last line`);
    if (item.laneRows.length === 1 && item.laneBars.length === 1 && item.laneRows[0] !== item.laneBars[0]) {
      failures.push(`single-lane row is ${item.laneRows[0]} but bar is ${item.laneBars[0]}`);
    }
    const want = view === "roots"
      ? (!item.mixOmitted ? "roots" : (!item.themeOmitted ? "themes" : ""))
      : (!item.themeOmitted ? "themes" : (!item.mixOmitted ? "roots" : ""));
    if (want && item.laneRows[0] && item.laneRows[0] !== want) {
      failures.push(`single-lane ${view} view shows ${item.laneRows[0]} (want ${want})`);
    }
  }
  // (w) the switch reads as quiet chrome at the legend dot's size.
  if (item.switchPresent && !String(item.state).startsWith("skeleton") && item.state !== "unavailable" && item.state !== "hover" && item.state !== "focus" && item.state !== "reading") {
    if (item.switchWidth < 20 - 0.5 || item.switchHeight < 14 - 0.5) {
      failures.push(`switch box is ${item.switchWidth}x${item.switchHeight} (want at least 20x14)`);
    }
    if (item.switchInsideTopRow === false) failures.push(`switch escapes the top row`);
    const marks = Array.isArray(item.switchMarks) ? item.switchMarks : [];
    if (marks.length !== 2) {
      failures.push(`switch paints ${marks.length} marks (want 2)`);
    } else {
      const dotSize = Math.max(Number(item.legendDotWidth) || 0, Number(item.legendDotHeight) || 0);
      for (const mark of marks) {
        if (Math.abs(mark.width - mark.height) > 0.5) {
          failures.push(`switch ${mark.lane} mark is ${mark.width}x${mark.height} (want square)`);
        }
        if (dotSize > 0 && Math.abs(mark.width - dotSize) > 0.5) {
          failures.push(`switch ${mark.lane} mark differs from the legend dot size`);
        }
      }
      const rootsMark = marks.find((mark) => mark.lane === "roots");
      const themesMark = marks.find((mark) => mark.lane === "themes");
      const isRound = (mark) => {
        if (!mark) return false;
        const text = String(mark.radiusText || "");
        if (text.includes("%")) {
          const percent = parseFloat(text) || 0;
          return percent >= 40;
        }
        return Math.abs(mark.width / 2 - mark.radius) <= 0.6;
      };
      if (rootsMark && !isRound(rootsMark)) {
        failures.push(`roots switch mark is not round`);
      }
      if (themesMark && themesMark.width > 0) {
        const text = String(themesMark.radiusText || "");
        if (text.includes("%")) {
          const percent = parseFloat(text) || 0;
          if (percent >= 50 - 0.5) failures.push(`themes switch mark radius is not below half its width`);
        } else if (themesMark.radius >= (themesMark.width / 2) - 0.05) {
          failures.push(`themes switch mark radius is not below half its width`);
        }
      }
      for (const mark of marks) {
        if (mark.on === "false") {
          const bg = String(mark.background || "").replace(/\s+/g, "").toLowerCase();
          if (bg !== "rgba(0,0,0,0)" && bg !== "transparent") {
            failures.push(`off switch mark is not transparent`);
          }
          const shadow = String(mark.shadow || "").toLowerCase();
          if (shadow === "none" || !shadow) failures.push(`off switch mark has no visible ring`);
        }
      }
    }
  }
  // (m) distinct hues: ready cells with <=8 non-gray segments carry pairwise
  // distinct bar hues and matching legend dots.
  if (!item.mixOmitted && !String(item.state).startsWith("skeleton") && item.state !== "unavailable" && Array.isArray(item.barHues)) {
    const nonGray = item.barHues.filter((hue) => hue !== "gray");
    if (nonGray.length > 0 && nonGray.length <= 8) {
      const seen = new Set();
      for (const hue of nonGray) {
        if (seen.has(hue)) {
          failures.push(`bar hues repeat ${hue} (want distinct hues)`);
          break;
        }
        seen.add(hue);
      }
      const byTitle = new Map();
      (Array.isArray(item.barTitles) ? item.barTitles : []).forEach((title, index) => {
        if (title) byTitle.set(title, item.barHues[index]);
      });
      for (const dot of (Array.isArray(item.legendDots) ? item.legendDots : [])) {
        const expected = byTitle.get(dot.title);
        if (expected && dot.hue !== expected) {
          failures.push(`legend dot ${dot.title} is ${dot.hue} but its segment is ${expected}`);
        }
      }
    }
  }
  const baseForFacts = String(item.state || "").replace(/-(roots|themes)$/, "");
  if (baseForFacts === "today" && context.width >= 540 && item.factRows !== 1) {
    failures.push(`facts wrap to ${item.factRows} rows at ${context.width}px (must fit on one line)`);
  }
  if (baseForFacts === "wide-values" && context.width >= 700 && item.factRows !== 1) {
    failures.push(`wide facts wrap to ${item.factRows} rows at ${context.width}px (must fit on one line)`);
  }
  // (n) the values lead: ready and stale cells carry values at least 2x their heads.
  if ((baseForFacts === "today" || baseForFacts === "stale") && typeof item.valueLeadMinRatio === "number") {
    if (item.valueLeadMinRatio < 2) failures.push(`values lead by ${item.valueLeadMinRatio}x (want at least 2x)`);
  }
  // (o) faithful text: aria-labels start with `<label> <display>` and, when
  // a reference is ready or short, include bob's words; values hold no warning.
  if (!String(item.state).startsWith("skeleton") && item.state !== "unavailable" && item.state !== "hover" && item.state !== "focus" && item.state !== "reading" && !String(item.state).startsWith("skeleton-")) {
    if (item.ariaFaithful === false) failures.push(`a fact aria-label does not start with its label and display`);
    if (item.valueHasWarning === true) failures.push(`a value contains the warning mark`);
  }
  if (item.state !== "unavailable" && !String(item.state).startsWith("hover") && item.state !== "focus") {
    if (typeof item.factCount === "number" && item.factCount > 0 && item.refCount !== item.factCount) {
      failures.push(`facts have ${item.refCount} reference lines, want ${item.factCount}`);
    }
    if (item.factCount > 0 && item.refHidden === false) failures.push(`a reference line is not aria-hidden`);
    if (typeof item.refBaselineSpread === "number" && item.refBaselineSpread > 0.5) {
      failures.push(`reference baselines spread ${item.refBaselineSpread}px`);
    }
    if (typeof item.refClip === "number" && item.refClip > 0.5) {
      failures.push(`a reference line clips by ${item.refClip}px`);
    }
    if (Array.isArray(item.refMarkFailures) && item.refMarkFailures.length) {
      failures.push(`reference marks: ${item.refMarkFailures[0]}`);
    }
    if (typeof item.refContrast === "number" && item.refContrast < 4.5) {
      failures.push(`reference contrast ${item.refContrast}:1 is below 4.5:1`);
    }
  }
  // (p) clean folds: at 410px facts fold and row starts hide their hairline;
  // at 540px and 700px every later fact draws its hairline.
  const hairlineHidden = (record) => {
    if (!record) return false;
    if (record.display === "none") return true;
    const content = String(record.content || "").trim().toLowerCase();
    return content === "none" || content === "normal";
  };
  if (context.width === 410 && !String(item.state).startsWith("skeleton") && item.state !== "unavailable" && item.state !== "hover" && item.state !== "focus" && item.state !== "reading") {
    if (item.factRows < 2) failures.push(`facts hold ${item.factRows} row at 410px (want a two-row fold)`);
    for (const record of item.rowStartHairlines || []) {
      if (!hairlineHidden(record)) failures.push(`a folded row starts with a hairline`);
    }
  }
  if (context.width >= 540 && !String(item.state).startsWith("skeleton") && item.state !== "unavailable" && item.state !== "hover" && item.state !== "focus" && item.state !== "reading") {
    for (const record of item.laterHairlines || []) {
      if (hairlineHidden(record)) failures.push(`a fact after the first hides its hairline at ${context.width}px`);
    }
  }
  // (q) empty track: the no-Pomodoros bar shows its track colour.
  if (String(item.state || "").replace(/-(roots|themes)$/, "") === "no-pomodoros") {
    const background = String(item.barBackground || "").replace(/\s+/g, "").toLowerCase();
    if (!background || background === "rgba(0,0,0,0)" || background === "transparent") {
      failures.push(`empty bar shows no track colour`);
    }
  }
  // (r) Geometry: every status mark is square, sized to the value font,
  // inside its value box, and vertically centred on it.
  if (Array.isArray(item.markGeometryFailures)) {
    for (const failure of item.markGeometryFailures) failures.push(`mark geometry: ${failure}`);
  }
  // Theme swatches: square within ±0.5 px, radius below half width, and
  // the same computed background as the matching segment (shade included).
  if (!String(item.state).startsWith("skeleton") && item.state !== "unavailable" && !item.themeOmitted) {
    const segmentsByTitle = new Map((Array.isArray(item.themeSegments) ? item.themeSegments : []).map((segment) => [segment.title, segment]));
    for (const swatch of (Array.isArray(item.themeSwatches) ? item.themeSwatches : [])) {
      if (Math.abs(swatch.width - swatch.height) > 0.5) {
        failures.push(`theme swatch ${swatch.title || ""} is ${Math.round(swatch.width * 10) / 10}x${Math.round(swatch.height * 10) / 10} (want square)`);
      }
      if (swatch.width > 0 && swatch.radius >= (swatch.width / 2) - 0.05) {
        failures.push(`theme swatch ${swatch.title || ""} radius ${swatch.radius} is not below half its width`);
      }
      const segment = segmentsByTitle.get(swatch.title);
      if (segment && rgbKey(segment.background) !== rgbKey(swatch.background)) {
        failures.push(`theme swatch ${swatch.title} background differs from its segment`);
      }
    }
  }
  if (String(item.state || "").replace(/-(roots|themes)$/, "") === "theme-collision") {
    const coloured = (Array.isArray(item.themeSegments) ? item.themeSegments : []).filter((segment) => !segment.gray);
    for (let index = 0; index < coloured.length - 1; index += 1) {
      if (rgbKey(coloured[index].background) === rgbKey(coloured[index + 1].background)) {
        failures.push(`adjacent coloured theme segments share a background`);
        break;
      }
    }
  }
  return failures;
}

function parseRgb(value) {
  const text = String(value || "").trim();
  let match = text.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
  match = text.match(/rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
  match = text.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (match) return [Number(match[1]) * 255, Number(match[2]) * 255, Number(match[3]) * 255];
  return null;
}

function rgbKey(value) {
  const rgb = parseRgb(value);
  return rgb ? rgb.map((n) => Math.round(n)).join(",") : String(value || "");
}

function isGrayRgb(value) {
  const rgb = parseRgb(value);
  if (!rgb) return true;
  return Math.max(...rgb) - Math.min(...rgb) < 16;
}

function checkMarkInks(measurements) {
  const failures = [];
  const byId = Object.fromEntries(measurements.map((item) => [item.state, item]));
  const ready = [
    ["met", byId.met],
    ["missed", byId.past],
    ["pending", byId.today],
  ];
  const missing = ready.filter(([, item]) => !item || !item.markInk);
  if (missing.length) {
    failures.push(`ready mark inks missing for ${missing.map(([name]) => name).join(", ")}`);
  } else {
    const keys = ready.map(([, item]) => rgbKey(item.markInk));
    if (new Set(keys).size !== 3) failures.push(`ready mark inks are not three distinct colours (${keys.join("; ")})`);
    for (const [name, item] of ready) {
      if (isGrayRgb(item.markInk)) failures.push(`${name} mark ink is gray (${item.markInk})`);
    }
  }
  if (byId.stale && byId.stale.markInk && byId.stale.markMutedMatch !== true) {
    failures.push(`stale mark ink is not muted (${byId.stale.markInk})`);
  }
  return failures;
}

function matrixMarkdown(matrix, browser, revision, interactionChecks) {
  const measurements = matrix.flatMap((entry) => entry.measurements.map((item) => ({ ...item, width: entry.width, theme: entry.theme, screenshot: entry.screenshot })));
  return [
    "# Day strip Chromium preview matrix",
    "",
    `- Renderer checkout revision: ${revision}.`,
    `- Browser: ${browser}.`,
    "- Source: production `main.js`, `styles.css`, and synthetic presentation fixtures; no fixture is captured vault data.",
    "- Each strip renders above mock plan badges (TODAY / PENDING / NEXT / READY plus a ★ theme line) inside a Live Preview code-block container, with a bare `## Pomodoros` heading below; one extra Reading-view cell renders today.",
    "- An Obsidian baseline stylesheet (30 px inline-flex buttons, link colours, rendered line-height) loads before the production CSS, so a `<button>` regression fails the matrix.",
    "- Grid: light and dark themes × 410, 540, and 700 px note columns × 24 states in both plus roots/themes for eight lanes cases plus Reading view.",
    `- Height budgets (16 px base): both ≤${DAY_STRIP_HEIGHT_ONE_LINE} px one-line / ≤${DAY_STRIP_HEIGHT_WRAPPED} px wrapped; single-lane ≤${DAY_STRIP_HEIGHT_ONE_LANE_ONE_LINE} px one-line / ≤${DAY_STRIP_HEIGHT_ONE_LANE_WRAPPED} px wrapped. The long-labels case is relaxed: geometry is enforced, height is reported.`,
    "- Geometry checks: (a) every strip descendant's box lies inside the strip's box (±0.5 px); (b) no two facts overlap, line 1 and line 2 never overlap, lanes never overlap, and legend items and meta never overlap; (c) values share a baseline within each wrapped line (≤1 px); (d) skeleton, today, and old-bob heights match at every width (≤0.5 px); (e) the height budget holds; (f) the today and wide-values facts fit on one line at 540 and 700; (g) the strip contains no `button` element; (h) forcing hover on a fact never shifts its box, and forcing `:focus-visible` shows an outline; (i) the strip precedes `.bob-plan` in the DOM with its bottom 6–16 px above the badges' top; (j) every lane bar spans the strip's content width (±1 px) and the last painted bar is the strip's last line box; (k) no legend label is truncated and no legend item spills past its box; (l) at every width, per legend, the visible counter equals that lane's segments minus its visible items, with screenshotDay showing all four roots at 540 and 700 px and at least three at 410 px; (m) ready cells with ≤8 non-gray root segments carry pairwise distinct bar hues and matching legend dots; theme swatches are square with a radius below half their width and match their segment background, and themeCollision adjacent coloured segments compute different backgrounds; (n) ready and stale values render at least 2× their heads; (o) every fact aria-label starts with `<label> <display>` and, when a reference is ready or short, includes bob's words, and no value holds a warning; (p) folded rows start without a hairline at 410 px while wider rows draw every hairline; (q) the no-Pomodoros bar shows its track colour; (r) every `.bob-day-strip-mark` is square within ±0.5 px, measures 0.95–1.12× its value's computed font size, lies inside its value box, and has its vertical centre within 1 px of the value box centre; (s) in ready cells the met, missed, and pending marks compute three distinct non-gray rim/ring colours, and in stale cells the mark ink computes to the muted text colour; (t) the switch anchor is identical across the three views for every switchable fixture; (u) single-lane views paint one lane row and bar with the chosen lane; (v) skeleton height equals ready height per view; (w) the switch marks are square at the legend dot size with a round roots mark, a rounded themes mark, a transparent off mark with a ring, and a 20×14 box inside the top row; (x) every fact has exactly one aria-hidden reference line; reference lines share a baseline within 0.5 px on each wrapped row; no reference clips; marks are square, inside their line, and vertically centred on the number; the line's colour contrasts at least 4.5:1 in light and dark.",
    "",
    "| Width | Theme | State | View | Strip height | Budget | Fact rows | Overflow | Facts overlap | Lines overlap | Legend overlap | Value baseline spread | Skeleton delta | Button | Result | Screenshot |",
    "| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ...measurements.map((item) => {
      const single = (item.view || "both") !== "both";
      const budget = item.relaxed ? "—" : `${item.factRows <= 1 ? (single ? DAY_STRIP_HEIGHT_ONE_LANE_ONE_LINE : DAY_STRIP_HEIGHT_ONE_LINE) : (single ? DAY_STRIP_HEIGHT_ONE_LANE_WRAPPED : DAY_STRIP_HEIGHT_WRAPPED)}px`;
      return `| ${item.width}px | ${item.theme} | ${item.state} | ${item.view || "both"} | ${item.stripHeight}px | ${budget} | ${item.factRows} | ${item.maxOverflow}px | ${item.maxFactOverlap}px | ${item.linesOverlap}px | ${item.legendOverlap}px | ${item.valueBaselineSpread}px | ${item.skeletonHeightDelta === null ? "—" : `${item.skeletonHeightDelta}px`} | ${item.hasButton ? "yes" : "no"} | ${item.result} | ${item.screenshot} |`;
    }),
    "",
    "Interaction checks (forced pseudo-states, per width × theme):",
    "",
    ...interactionChecks.map((item) => `- ${item.width}px ${item.theme}: ${item.label} — ${item.result}${item.detail ? ` (${item.detail})` : ""}`),
    "",
    "Synthetic cases: today in progress, complete past day, skeleton, stale cached frame, unavailable, no Pomodoros, not tracked with a journal warning, seven areas with `+N`, an old-bob report without `root_parent`, same-area roots get distinct hues, seven roots with `+N`, four roots that fit at 540 and 700 px, same-hue themes get shades, seven themes and unnamed, theme parts without `theme_hues`, a redefined `worked` without area parts, long labels (with a long `job_2026_apply_29` root), wide values (`10h 05m` with `▲ typical 10h 05m`), short typical history, D missing, old bob without `typical`, closed-out past day · met, forced hover, forced `:focus-visible`, and a Reading-view today cell, plus roots/themes views for today, past, screenshotDay, themeCollision, noPomodoros, noThemeHues, skeleton, and stale.",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const pluginSource = fs.readFileSync(path.join(pluginRoot, "main.js"), "utf8");
  const css = fs.readFileSync(path.join(pluginRoot, "styles.css"), "utf8");
  const fixtures = loadFixtures();
  const htmlFile = path.join(args.out, "index.html");
  fs.writeFileSync(htmlFile, makeHtml({ pluginSource, css, fixtures }));
  const chromium = findChromium();
  const profile = fs.mkdtempSync(path.join("/tmp", "bob-day-strip-chromium-"));
  const child = spawn(chromium, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore", env: { ...process.env, TMPDIR: "/tmp" } });
  let client = null;
  try {
    const activePortFile = path.join(profile, "DevToolsActivePort");
    await waitForFile(activePortFile);
    const port = fs.readFileSync(activePortFile, "utf8").split(/\s+/)[0];
    let pageInfo = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      pageInfo = pages.find((page) => page.type === "page");
      if (pageInfo) break;
      await sleep(100);
    }
    if (!pageInfo) throw new Error("Chromium did not publish a DevTools page.");
    client = await CdpClient.connect(pageInfo.webSocketDebuggerUrl);
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Page.navigate", { url: pathToFileURL(htmlFile).href });
    await waitForPreview(client);
    // DOM and CSS domains reset on navigation; enable them on the live page.
    await client.call("DOM.enable");
    await client.call("CSS.enable");
    const browserVersion = await client.call("Browser.getVersion");
    const revision = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim();
    const matrix = [];
    const interactionChecks = [];
    for (const width of [410, 540, 700]) {
      for (const theme of ["light", "dark"]) {
        await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        const result = await client.evaluate(`window.dayStripPreview.renderMatrix(${width}, ${JSON.stringify(theme)})`);
        const byState = new Map(result.measurements.map((item) => [item.state, item]));
        const skeletonDeltaForView = (view) => {
          const todayId = view === "both" ? "today" : `today-${view}`;
          const skeletonId = view === "both" ? "skeleton" : `skeleton-${view}`;
          const ready = byState.get(todayId);
          const skeleton = byState.get(skeletonId);
          if (!ready || !skeleton) return null;
          return Math.round(Math.abs(ready.stripHeight - skeleton.stripHeight) * 10) / 10;
        };
        const skeletonDeltas = {
          both: skeletonDeltaForView("both"),
          roots: skeletonDeltaForView("roots"),
          themes: skeletonDeltaForView("themes"),
        };
        const measurements = result.measurements.map((item) => {
          const failures = checkMeasurement(item, { width, theme });
          const view = item.view || "both";
          if (String(item.state).startsWith("skeleton")) {
            const delta = skeletonDeltas[view];
            if (typeof delta === "number" && delta > 0.5) {
              failures.push(`skeleton height differs from today by ${delta}px in ${view} view`);
            }
          }
          if (item.state === "old-bob") {
            const ready = byState.get("today");
            const skeleton = byState.get("skeleton");
            if (ready && Math.abs(item.stripHeight - ready.stripHeight) > 0.5) {
              failures.push(`old-bob height differs from today by ${Math.round(Math.abs(item.stripHeight - ready.stripHeight) * 10) / 10}px`);
            }
            if (skeleton && Math.abs(item.stripHeight - skeleton.stripHeight) > 0.5) {
              failures.push(`old-bob height differs from skeleton by ${Math.round(Math.abs(item.stripHeight - skeleton.stripHeight) * 10) / 10}px`);
            }
          }
          return {
            ...item,
            skeletonHeightDelta: String(item.state).startsWith("skeleton") ? (skeletonDeltas[view] ?? null) : null,
            result: "pass",
            failures,
          };
        });
        // (t) the switch anchor is identical across the three views: same
        // horizontal anchor and size (vertical page position differs).
        const switchableBases = ["today", "past", "screenshot-day", "theme-collision", "no-theme-hues", "stale"];
        for (const base of switchableBases) {
          const boxes = [];
          for (const view of ["both", "roots", "themes"]) {
            const id = view === "both" ? base : `${base}-${view}`;
            const found = measurements.find((item) => item.state === id);
            if (found && found.switchPresent && found.switchBox) boxes.push({ view, box: found.switchBox, item: found });
          }
          if (boxes.length === 3) {
            const first = boxes[0].box;
            for (const entry of boxes.slice(1)) {
              const delta = Math.max(
                Math.abs(entry.box.x - first.x),
                Math.abs(entry.box.width - first.width),
                Math.abs(entry.box.height - first.height),
              );
              if (delta > 0.5) {
                entry.item.failures.push(`switch anchor differs by ${Math.round(delta * 10) / 10}px across views in ${base}`);
                entry.item.result = "FAIL";
              }
            }
          }
        }
        for (const item of measurements) {
          if (item.failures.length) item.result = "FAIL";
          else item.result = "pass";
        }
        const inkFailures = checkMarkInks(measurements);
        if (inkFailures.length) {
          for (const item of measurements) {
            const base = String(item.state || "").replace(/-(roots|themes)$/, "");
            if (base === "today" || base === "past" || base === "met" || base === "stale") {
              item.failures.push(...inkFailures);
              item.result = "FAIL";
            }
          }
        }

        // (h) Forced hover must never shift the fact's box; forced
        // :focus-visible must show an outline on the focused fact.
        // Nodes resolve through the DOM domain so CSS sees the same ids.
        const domRoot = await client.call("DOM.getDocument", { depth: 0, pierce: true });
        const forcePseudo = async (selector, pseudos) => {
          const found = await client.call("DOM.querySelector", { nodeId: domRoot.root.nodeId, selector });
          if (!found || !found.nodeId) throw new Error("no node for " + selector);
          await client.call("CSS.forcePseudoState", { nodeId: found.nodeId, forcedPseudoClasses: pseudos });
        };
        const hoverSelector = '[data-strip="hover"] .bob-day-strip-fact';
        const before = await client.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(hoverSelector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
        if (before) {
          await forcePseudo(hoverSelector, ["hover"]);
          const after = await client.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(hoverSelector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
          if (!after) {
            interactionChecks.push({ width, theme, label: "forced hover never shifts the fact", result: "FAIL", detail: "hover strip vanished" });
          } else {
            const shift = Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y), Math.abs(after.width - before.width), Math.abs(after.height - before.height));
            interactionChecks.push({ width, theme, label: "forced hover never shifts the fact", result: shift <= 0.5 ? "pass" : "FAIL", detail: `shift ${Math.round(shift * 10) / 10}px` });
          }
        } else {
          interactionChecks.push({ width, theme, label: "forced hover never shifts the fact", result: "FAIL", detail: "no hover strip rendered" });
        }
        const focusSelector = '[data-strip="focus"] .bob-day-strip-fact';
        const focusState = await client.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(focusSelector)}); if (!n) return null; n.focus(); const style = getComputedStyle(n); return { active: document.activeElement === n, outline: style.outlineWidth, role: n.getAttribute("role"), tab: n.getAttribute("tabindex") }; })()`);
        if (focusState && focusState.active) {
          await forcePseudo(focusSelector, ["focus-visible"]);
          const outlined = await client.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(focusSelector)}); return getComputedStyle(n).outlineWidth; })()`);
          const pass = focusState.role === "link" && outlined !== "0px";
          interactionChecks.push({ width, theme, label: "focus-visible shows an outline on the fact", result: pass ? "pass" : "FAIL", detail: `role=${focusState.role} tabindex=${focusState.tab} outline=${outlined}` });
        } else {
          interactionChecks.push({ width, theme, label: "focus-visible shows an outline on the fact", result: "FAIL", detail: "fact is not focusable" });
        }
        const switchSelector = '[data-strip="today"] .bob-day-strip-lanes';
        const switchState = await client.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(switchSelector)}); if (!n) return null; n.focus(); const style = getComputedStyle(n); return { active: document.activeElement === n, outline: style.outlineWidth, role: n.getAttribute("role"), tab: n.getAttribute("tabindex") }; })()`);
        if (switchState && switchState.active) {
          await forcePseudo(switchSelector, ["focus-visible"]);
          const outlined = await client.evaluate(`(() => { const n = document.querySelector(${JSON.stringify(switchSelector)}); return getComputedStyle(n).outlineWidth; })()`);
          const pass = switchState.role === "button" && outlined !== "0px";
          interactionChecks.push({ width, theme, label: "forced focus-visible on the switch shows an outline", result: pass ? "pass" : "FAIL", detail: `role=${switchState.role} tabindex=${switchState.tab} outline=${outlined}` });
        } else {
          interactionChecks.push({ width, theme, label: "forced focus-visible on the switch shows an outline", result: "FAIL", detail: "switch is not focusable" });
        }

        const screenshot = `day-strip-${width}-${theme}.png`;
        await capturePage(client, path.join(args.out, screenshot));
        matrix.push({ ...result, measurements, screenshot });
      }
    }
    const report = matrixMarkdown(matrix, browserVersion.product, revision, interactionChecks);
    fs.writeFileSync(path.join(args.out, "matrix-report.md"), report);
    const failures = matrix.flatMap((entry) => entry.measurements.filter((item) => item.result !== "pass").map((item) => `${entry.width}px ${entry.theme} ${item.state}: ${item.failures.join("; ")}`));
    const interactionFailures = interactionChecks.filter((item) => item.result !== "pass").map((item) => `${item.width}px ${item.theme} ${item.label}: ${item.detail}`);
    const overflow = matrix.filter((item) => item.pageScrollWidth > item.viewportWidth);
    if (process.env.DAYSTRIP_WIDTHS) {
      for (const entry of matrix) {
        for (const item of entry.measurements) {
          if ((item.state === "today" || item.state === "wide-values") && (entry.width === 540 || entry.width === 700)) {
            console.error(`${entry.width}px ${entry.theme} ${item.state}: facts=${JSON.stringify(item.factWidths)} rows=${item.factRows} strip=${item.stripHeight}px`);
          }
        }
      }
    }
    console.log(JSON.stringify({ output: args.out, html: htmlFile, chromium, browser: browserVersion.product, screenshots: matrix.map((item) => path.join(args.out, item.screenshot)), cells: matrix.reduce((sum, item) => sum + item.measurements.length, 0), failures: [...failures, ...interactionFailures], overflow: overflow.map((item) => `${item.width}px ${item.theme}`) }, null, 2));
    const allFailures = [...failures, ...interactionFailures];
    if (allFailures.length || overflow.length) throw new Error("Preview matrix failed its geometry or no-overflow checks; inspect matrix-report.md and screenshots.");
  } finally {
    if (client) client.socket.close();
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
