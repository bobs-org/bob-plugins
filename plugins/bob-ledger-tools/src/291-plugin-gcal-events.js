// Google Calendar Event Tasks: create-triggered sync plus read-time painting.
// Bob owns the write; this plugin only starts `bob gcal sync` after Templater
// has finished today's note and paints the resulting Events section.

const GCAL_EVENTS_POLL_MS = 250;
const GCAL_EVENTS_WAIT_MS = 15000;
const GCAL_EVENTS_REFRESH_MS = 60000;
// The stamp records the last `bob gcal sync` run. Sync runs on demand,
// so age never paints it stale.
const GCAL_EVENTS_STAMP_STALE_AFTER_MINUTES = null;
const GCAL_EVENTS_STAMP_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GCAL_EVENTS_PALETTE = [
  "blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red",
];
let gcalEventsRefreshEffect = null;

function gcalEventsFindSection(lines, title) {
  if (!Array.isArray(lines)) return null;
  const wanted = String(title || "").trim().toLowerCase();
  let frontmatter = String(lines[0] || "").trim() === "---";
  let fence = null;
  const headings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || "");
    const trimmed = line.trim();
    if (frontmatter) {
      if (index > 0 && (trimmed === "---" || trimmed === "...")) frontmatter = false;
      continue;
    }
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }
    const heading = /^ {0,3}(#{2})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (!heading) continue;
    const headingTitle = heading[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
    headings.push({ line: index, title: headingTitle });
  }
  const index = headings.findIndex((heading) => heading.title.toLowerCase() === wanted);
  if (index < 0) return null;
  const start = headings[index].line + 1;
  const end = index + 1 < headings.length ? headings[index + 1].line : lines.length;
  return { headingLine: headings[index].line, start, end };
}

function gcalEventsHasPomodorosSection(source) {
  return Boolean(
    gcalEventsFindSection(
      String(source || "").replace(/\r\n/g, "\n").split("\n"),
      "Pomodoros",
    ),
  );
}

function gcalEventsTimeState(span, nowMinutes, isToday, isTask) {
  if (!isToday || !isTask || typeof span !== "string") return null;
  const match = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(span);
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  let end = Number(match[3]) * 60 + Number(match[4]);
  if (start > 1439 || end > 1439 || !Number.isFinite(nowMinutes)) return null;
  if (end < start) end += 1440;
  if (nowMinutes < start) return "future";
  if (nowMinutes < end) return "running";
  return "past";
}

function gcalEventsIsListItem(line) {
  const rest = String(line || "").replace(/^[ \t]+/, "");
  const marker = rest.charAt(0);
  if (marker === "-" || marker === "*" || marker === "+") {
    return rest.length === 1 || /[ \t]/.test(rest.charAt(1));
  }
  const digits = rest.match(/^\d+/);
  if (!digits) return false;
  const after = rest.slice(digits[0].length);
  return after.charAt(0) === "." || after.charAt(0) === ")"
    ? after.length === 1 || /[ \t]/.test(after.charAt(1))
    : false;
}

function gcalEventsIsAtxHeading(line) {
  return /^ {0,3}#{1,6}(?:[ \t]|$)/.test(String(line || ""));
}

function gcalEventsRecognizeStampLine(line) {
  if (gcalEventsIsListItem(line) || gcalEventsIsAtxHeading(line)) return false;
  const stripped = String(line || "").replace(/^[ \t]+/, "").replace(/^[*_]+/, "");
  return stripped.startsWith("↻");
}

function gcalEventsStampGlyphStart(line) {
  const raw = String(line || "");
  const prefix = raw.match(/^[ \t]*[*_]*/);
  const start = prefix ? prefix[0].length : 0;
  return raw.charAt(start) === "↻" ? start : Math.max(0, raw.indexOf("↻"));
}

function gcalEventsParseStampSynced(body) {
  let rest = String(body || "").trim();
  rest = rest.replace(/^[*_]+/, "").replace(/[*_]+$/, "").trim();
  if (rest.startsWith("↻")) rest = rest.slice("↻".length).trimStart();
  if (!rest.startsWith("synced")) return null;
  rest = rest.slice("synced".length).trimStart();
  let date = null;
  let hour;
  let minute;
  const dated = /^[A-Za-z]{3} (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/.exec(rest);
  const clock = /^(\d{2}):(\d{2})/.exec(rest);
  if (dated) {
    date = dated[1];
    hour = Number(dated[2]);
    minute = Number(dated[3]);
    rest = rest.slice(dated[0].length);
  } else if (clock) {
    hour = Number(clock[1]);
    minute = Number(clock[2]);
    rest = rest.slice(clock[0].length);
  } else {
    return null;
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  rest = rest.trimStart();
  if (!rest.startsWith("·")) return null;
  return { date, minutes: hour * 60 + minute };
}

function gcalEventsStampFromLine(line, index) {
  if (!gcalEventsRecognizeStampLine(line)) return null;
  const synced = gcalEventsParseStampSynced(line);
  if (!synced) return null;
  return { line: index, glyphStart: gcalEventsStampGlyphStart(line), synced };
}

function gcalEventsStampWhenText(stamp) {
  if (!stamp || !stamp.synced || !Number.isFinite(stamp.synced.minutes)) return "";
  const hour = Math.floor(stamp.synced.minutes / 60);
  const minute = stamp.synced.minutes % 60;
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (!stamp.synced.date) return clock;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stamp.synced.date);
  if (!match) return clock;
  const dt = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(dt.getTime())) return clock;
  return `${GCAL_EVENTS_STAMP_WEEKDAYS[dt.getDay()]} ${stamp.synced.date} ${clock}`;
}

function gcalEventsStampTitle(stamp, state) {
  const when = gcalEventsStampWhenText(stamp);
  if (state === "stale") return `No Google Calendar sync since ${when} · run bob gcal doctor`;
  return `Google Calendar · synced ${when}`;
}

function gcalEventsStampSyncedMs(synced, now) {
  if (!synced || !Number.isFinite(synced.minutes)) return null;
  const hour = Math.floor(synced.minutes / 60);
  const minute = synced.minutes % 60;
  if (synced.date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(synced.date);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, 0, 0).getTime();
  }
  const basis = now instanceof Date ? now : new Date();
  return new Date(basis.getFullYear(), basis.getMonth(), basis.getDate(), hour, minute, 0, 0).getTime();
}

function gcalEventsStampState(stamp, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const threshold = GCAL_EVENTS_STAMP_STALE_AFTER_MINUTES;
  if (threshold == null || opts.isToday !== true || !stamp || !stamp.synced) return "fresh";
  const syncedMs = gcalEventsStampSyncedMs(stamp.synced, now);
  if (syncedMs == null || syncedMs > now.getTime()) return "fresh";
  if ((now.getTime() - syncedMs) / 60000 > threshold) return "stale";
  return "fresh";
}

function gcalEventsScanMarkdown(lines, options = {}) {
  const source = Array.isArray(lines) ? lines : [];
  const opts = options && typeof options === "object" ? options : {};
  const section = gcalEventsFindSection(source, "Events");
  if (!section) return { section: null, rows: [], stamp: null };
  const rows = [];
  let stamp = null;
  let fence = null;
  for (let index = section.start; index < section.end; index += 1) {
    const line = String(source[index] || "");
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }
    if (!stamp) {
      const found = gcalEventsStampFromLine(line, index);
      if (found) stamp = found;
    }
    const prefix = /^[-*+]\s+(?:\[([ xX*?/-])\]\s+#task\s+)?\*\*(\d{4}-\d{4}|all day)\*\*/i.exec(line);
    if (!prefix) continue;
    const isTask = Boolean(prefix[1]);
    const time = prefix[2].toLowerCase();
    const tokenStart = prefix[0].indexOf("**");
    const timeStart = tokenStart + 2;
    const timeEnd = timeStart + time.length;
    const range = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(time);
    const startMinutes = range ? Number(range[1]) * 60 + Number(range[2]) : null;
    const endMinutes = range ? Number(range[3]) * 60 + Number(range[4]) : null;
    const tags = [];
    const tagPattern = /\*(maybe|free|day\s+\d+\s+of\s+\d+)\*/gi;
    let tagMatch;
    while ((tagMatch = tagPattern.exec(line))) {
      const innerOffset = tagMatch[0].indexOf(tagMatch[1]);
      tags.push({
        name: tagMatch[1].toLowerCase().replace(/\s+/g, " "),
        start: tagMatch.index + innerOffset,
        end: tagMatch.index + innerOffset + tagMatch[1].length,
      });
    }
    const badges = [];
    for (const badge of ["📅", "📹", "📍"]) {
      const at = line.indexOf(badge);
      if (at >= 0) badges.push({ badge, start: at, end: at + badge.length });
    }
    rows.push({
      line: index,
      kind: isTask ? "task" : "context",
      time,
      timeStart,
      timeEnd,
      startMinutes,
      endMinutes,
      state: gcalEventsTimeState(time, opts.nowMinutes, opts.isToday === true, isTask),
      tags,
      badges,
    });
  }
  return { section, rows, stamp };
}

function gcalEventsShouldSyncCreatedFile(enabled, file, app, now = new Date()) {
  try {
    return enabled === true && isTodayDailyFile(app, file, { now });
  } catch (error) {
    return false;
  }
}

async function gcalEventsWaitForPomodoros(read, options = {}) {
  if (typeof read !== "function") return false;
  const opts = options && typeof options === "object" ? options : {};
  const timeout = Number.isFinite(opts.timeoutMs) ? Math.max(0, opts.timeoutMs) : GCAL_EVENTS_WAIT_MS;
  const poll = Number.isFinite(opts.pollMs) ? Math.max(0, opts.pollMs) : GCAL_EVENTS_POLL_MS;
  const now = typeof opts.now === "function" ? opts.now : Date.now;
  const delayFn = typeof opts.delay === "function"
    ? opts.delay
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = now() + timeout;
  while (true) {
    try {
      const contents = await read();
      if (gcalEventsHasPomodorosSection(contents)) return true;
    } catch (error) {
      // Templater may still be creating the note; keep waiting until the bound.
    }
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await delayFn(Math.min(poll, remaining));
  }
}

function gcalEventsDecodeSync(stdout, stderr) {
  let body;
  try {
    body = JSON.parse(String(stdout || ""));
  } catch (error) {
    return { ok: false, code: "bad-json", message: "bob gcal sync returned invalid JSON.", detail: statsFirstLine(stderr) };
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.schema_version !== 1) {
    return { ok: false, code: "bad-shape", message: "bob gcal sync returned an unexpected JSON shape.", detail: statsFirstLine(stderr) };
  }
  if (body.ok === false) {
    const error = body.error && typeof body.error === "object" ? body.error : {};
    return {
      ok: false,
      code: typeof error.kind === "string" ? error.kind : "bob-error",
      message: typeof error.message === "string" ? error.message : "bob gcal sync failed.",
      detail: statsFirstLine(stderr),
    };
  }
  if (body.ok !== true || !["written", "unchanged", "waiting"].includes(body.status)) {
    return { ok: false, code: "bad-shape", message: "bob gcal sync returned an unexpected report.", detail: statsFirstLine(stderr) };
  }
  return { ok: true, report: body };
}

function ensureGcalEventsRefreshEffect() {
  if (gcalEventsRefreshEffect) return gcalEventsRefreshEffect;
  try {
    if (StateEffect && typeof StateEffect.define === "function") {
      gcalEventsRefreshEffect = StateEffect.define();
    }
  } catch (error) {
    gcalEventsRefreshEffect = null;
  }
  return gcalEventsRefreshEffect;
}

class BobLedgerToolsGcalEventsMixin {
  setupGcalEvents() {
    this.setupGcalSyncOnCreate();
    this.setupCalendarEventPainting();
  }

  setupGcalSyncOnCreate() {
    if (typeof this.gcalSyncOnCreateEnabled !== "boolean") this.gcalSyncOnCreateEnabled = true;
    if (!this.gcalSyncCreatedPaths) this.gcalSyncCreatedPaths = new Set();
    if (!this.gcalSyncNoticeDays) this.gcalSyncNoticeDays = new Set();
    try {
      this.addCommand({
        id: "toggle-gcal-sync-on-create",
        name: "Toggle Google Calendar sync on daily-note creation",
        callback: () => this.toggleGcalSyncOnCreate(),
      });
    } catch (error) {
      // The session toggle is best-effort on limited test hosts.
    }
    const workspace = this.app && this.app.workspace;
    if (!workspace || typeof workspace.onLayoutReady !== "function") return;
    workspace.onLayoutReady(() => {
      const vault = this.app && this.app.vault;
      if (!vault || typeof vault.on !== "function") return;
      this.registerEvent(vault.on("create", (file) => {
        if (!gcalEventsShouldSyncCreatedFile(this.gcalSyncOnCreateEnabled, file, this.app)) return;
        const key = String(file.path || "");
        if (!key || this.gcalSyncCreatedPaths.has(key)) return;
        this.gcalSyncCreatedPaths.add(key);
        void this.gcalSyncCreatedDailyNote(file);
      }));
    });
  }

  toggleGcalSyncOnCreate() {
    this.gcalSyncOnCreateEnabled = !this.gcalSyncOnCreateEnabled;
    try {
      new Notice(this.gcalSyncOnCreateEnabled ? "Calendar sync on daily-note creation on" : "Calendar sync on daily-note creation off");
    } catch (error) {}
    return this.gcalSyncOnCreateEnabled;
  }

  async gcalSyncCreatedDailyNote(file) {
    const vault = this.app && this.app.vault;
    const ready = await gcalEventsWaitForPomodoros(
      () => vault && typeof vault.read === "function" ? vault.read(file) : Promise.reject(new Error("Vault read unavailable")),
    );
    if (!ready) {
      console.warn("bob gcal sync skipped: today's note did not get a ## Pomodoros section within 15 seconds");
      return false;
    }
    if (!this.gcalSyncOnCreateEnabled) return false;
    const result = await bobSpawnJson(["gcal", "sync", "-q", "-f", "json"], gcalEventsDecodeSync, {
      commandLabel: "bob gcal sync",
      resolveBobPath: () => typeof this.apiStatsBobPath === "function" ? this.apiStatsBobPath() : { path: "bob", source: "path" },
      getVaultPath: () => this.statsVaultBasePath(),
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    if (result.ok) return true;
    if (result.exitCode === 1) {
      const day = formatLocalDate(new Date());
      if (!this.gcalSyncNoticeDays.has(day)) {
        this.gcalSyncNoticeDays.add(day);
        new Notice("Calendar sync failed · run `bob gcal doctor`");
      }
      return false;
    }
    console.info(`bob gcal sync skipped${result.exitCode === 2 ? " (setup or writer-host check)" : ""}: ${result.message || result.code}`);
    return false;
  }

  setupCalendarEventPainting() {
    if (typeof this.calendarEventsPaintEnabled !== "boolean") this.calendarEventsPaintEnabled = true;
    this.calendarEventReadingRoots = this.calendarEventReadingRoots || new Set();
    this.calendarEventRefreshTimer = null;
    this.setCalendarEventPaintGate();
    try {
      this.addCommand({
        id: "toggle-calendar-event-painting",
        name: "Toggle calendar event painting",
        callback: () => this.toggleCalendarEventPainting(),
      });
    } catch (error) {}
    try {
      const extension = this.createCalendarEventExtension();
      if (extension && typeof this.registerEditorExtension === "function") this.registerEditorExtension(extension);
    } catch (error) {}
    try {
      if (typeof this.registerMarkdownPostProcessor === "function") {
        this.registerMarkdownPostProcessor((el, ctx) => this.renderCalendarEventsIn(el, ctx), 55);
      }
    } catch (error) {}
    const workspace = this.app && this.app.workspace;
    if (workspace && typeof workspace.on === "function") {
      for (const event of ["active-leaf-change", "file-open"]) {
        try {
          this.registerEvent(workspace.on(event, () => this.calendarEventUpdateClockTimer()));
        } catch (error) {}
      }
    }
    try {
      if (typeof this.registerDomEvent === "function" && typeof document !== "undefined") {
        this.registerDomEvent(document, "visibilitychange", () => this.calendarEventUpdateClockTimer());
      }
    } catch (error) {}
    try {
      if (workspace && typeof workspace.onLayoutReady === "function") {
        workspace.onLayoutReady(() => this.calendarEventUpdateClockTimer());
      }
    } catch (error) {}
  }

  teardownCalendarEventPainting() {
    const timer = this.calendarEventRefreshTimer;
    if (timer === null || timer === undefined) return;
    const clear = typeof window !== "undefined" && window.clearInterval
      ? window.clearInterval.bind(window)
      : clearInterval;
    if (typeof clear === "function") clear(timer);
    this.calendarEventRefreshTimer = null;
  }

  setCalendarEventPaintGate() {
    try {
      const classes = typeof document !== "undefined" && document.body && document.body.classList;
      if (!classes) return false;
      if (this.calendarEventsPaintEnabled) classes.add("bob-calendar-events");
      else classes.remove("bob-calendar-events");
      return true;
    } catch (error) {
      return false;
    }
  }

  toggleCalendarEventPainting() {
    this.calendarEventsPaintEnabled = !this.calendarEventsPaintEnabled;
    this.setCalendarEventPaintGate();
    this.refreshCalendarEventPaint();
    try {
      new Notice(this.calendarEventsPaintEnabled ? "Calendar event painting on" : "Calendar event painting off");
    } catch (error) {}
    this.calendarEventUpdateClockTimer();
    return this.calendarEventsPaintEnabled;
  }

  calendarEventTodayIsVisible() {
    if (!this.calendarEventsPaintEnabled) return false;
    try {
      if (typeof document !== "undefined" && document.visibilityState && document.visibilityState !== "visible") return false;
      const file = getActiveFile(this.app);
      return isTodayDailyFile(this.app, file);
    } catch (error) {
      return false;
    }
  }

  calendarEventUpdateClockTimer() {
    const visible = this.calendarEventTodayIsVisible();
    if (visible && this.calendarEventRefreshTimer === null) {
      const set = typeof window !== "undefined" && window.setInterval ? window.setInterval.bind(window) : setInterval;
      this.calendarEventRefreshTimer = set(() => this.refreshCalendarEventPaint(), GCAL_EVENTS_REFRESH_MS);
      try {
        if (typeof this.registerInterval === "function") this.registerInterval(this.calendarEventRefreshTimer);
      } catch (error) {}
    } else if (!visible && this.calendarEventRefreshTimer !== null) {
      const clear = typeof window !== "undefined" && window.clearInterval ? window.clearInterval.bind(window) : clearInterval;
      clear(this.calendarEventRefreshTimer);
      this.calendarEventRefreshTimer = null;
    }
  }

  calendarEventMeetHue() {
    try {
      const value = this.pomodoroThemeHueFor("meet", "MEET");
      return value && GCAL_EVENTS_PALETTE.includes(value.hue) ? value.hue : null;
    } catch (error) {
      return null;
    }
  }

  createCalendarEventExtension() {
    try {
      if (!ViewPlugin || !Decoration || !RangeSetBuilder || !editorInfoField || !editorLivePreviewField) return null;
      const plugin = this;
      const viewPlugin = class {
        constructor(view) { this.decorations = plugin.buildCalendarEventDecorations(view); }
        update(update) {
          const refresh = ensureGcalEventsRefreshEffect();
          const requested = (update.transactions || []).some((transaction) =>
            (transaction.effects || []).some((effect) => refresh && effect && typeof effect.is === "function" && effect.is(refresh)),
          );
          if (update.docChanged || update.viewportChanged || requested) this.decorations = plugin.buildCalendarEventDecorations(update.view);
        }
      };
      return Prec.highest(ViewPlugin.fromClass(viewPlugin, { decorations: (value) => value.decorations }));
    } catch (error) {
      return null;
    }
  }

  buildCalendarEventDecorations(view) {
    try {
      if (!this.calendarEventsPaintEnabled || !view || !view.state || !Decoration || !RangeSetBuilder) return Decoration ? Decoration.none : null;
      let info;
      try { info = view.state.field(editorInfoField); } catch (error) { return Decoration.none; }
      if (!info || !info.file || !PLAN_DAILY_PATH_RE.test(String(info.file.path || ""))) return Decoration.none;
      try { if (!view.state.field(editorLivePreviewField)) return Decoration.none; } catch (error) { return Decoration.none; }
      const lines = view.state.doc.toString().split("\n");
      const today = isTodayDailyFile(this.app, info.file);
      const now = new Date();
      const scanned = gcalEventsScanMarkdown(lines, { isToday: today, nowMinutes: now.getHours() * 60 + now.getMinutes() });
      if (!scanned.rows.length && !scanned.stamp) return Decoration.none;
      const starts = [];
      let offset = 0;
      for (const line of lines) { starts.push(offset); offset += line.length + 1; }
      const decorations = [];
      const hue = this.calendarEventMeetHue();
      if (scanned.stamp && typeof Decoration.line === "function") {
        const state = gcalEventsStampState(scanned.stamp, { isToday: today, now });
        decorations.push({
          from: starts[scanned.stamp.line],
          to: starts[scanned.stamp.line],
          decoration: Decoration.line({
            class: "bob-calendar-sync-stamp",
            attributes: { "data-state": state, title: gcalEventsStampTitle(scanned.stamp, state) },
          }),
        });
      }
      for (const row of scanned.rows) {
        const base = starts[row.line];
        if (row.kind === "context" && typeof Decoration.line === "function") {
          decorations.push({ from: base, to: base, decoration: Decoration.line({ class: "bob-calendar-event-context" }) });
        }
        if (row.timeEnd > row.timeStart) {
          const attributes = { "data-time": row.time };
          if (row.state) attributes["data-state"] = row.state;
          if (row.state === "running" && hue) attributes["data-theme-hue"] = hue;
          decorations.push({ from: base + row.timeStart, to: base + row.timeEnd, decoration: Decoration.mark({ class: "bob-calendar-event-time", attributes }) });
        }
        for (const tag of row.tags) {
          decorations.push({ from: base + tag.start, to: base + tag.end, decoration: Decoration.mark({ class: "bob-calendar-event-tag", attributes: { "data-tag": tag.name } }) });
        }
        for (const badge of row.badges) {
          decorations.push({ from: base + badge.start, to: base + badge.end, decoration: Decoration.mark({ class: "bob-calendar-event-badge", attributes: { "data-badge": badge.badge } }) });
        }
      }
      decorations.sort((left, right) => left.from - right.from || left.to - right.to);
      const builder = new RangeSetBuilder();
      for (const item of decorations) builder.add(item.from, item.to, item.decoration);
      return builder.finish();
    } catch (error) {
      return Decoration ? Decoration.none : null;
    }
  }

  calendarEventSetReadingState(record, now = new Date()) {
    try {
      if (!record || !record.timeEl) return;
      const state = gcalEventsTimeState(record.time, now.getHours() * 60 + now.getMinutes(), isTodayDailyFile(this.app, { path: record.path }, { now }), record.isTask);
      if (state) record.timeEl.setAttribute("data-state", state);
      else record.timeEl.removeAttribute("data-state");
      if (state === "running") {
        const hue = this.calendarEventMeetHue();
        if (hue) record.timeEl.setAttribute("data-theme-hue", hue);
        else record.timeEl.removeAttribute("data-theme-hue");
      } else {
        record.timeEl.removeAttribute("data-theme-hue");
      }
    } catch (error) {}
  }

  calendarEventSetStampState(record, now = new Date()) {
    try {
      if (!record || !record.el) return;
      const state = gcalEventsStampState(record.stamp, {
        isToday: isTodayDailyFile(this.app, { path: record.path }, { now }),
        now,
      });
      record.el.classList.add("bob-calendar-sync-stamp");
      record.el.setAttribute("data-state", state);
      record.el.setAttribute("title", gcalEventsStampTitle(record.stamp, state));
    } catch (error) {}
  }

  calendarEventSourceLines(ctx) {
    try {
      const path = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      const workspace = this.app && this.app.workspace;
      if (!path || !workspace || typeof workspace.getLeavesOfType !== "function") return null;
      for (const leaf of workspace.getLeavesOfType("markdown") || []) {
        const view = leaf && leaf.view;
        const file = view && view.file;
        if (!file || file.path !== path) continue;
        if (view.editor && typeof view.editor.getValue === "function") {
          return String(view.editor.getValue() || "").replace(/\r\n/g, "\n").split("\n");
        }
        const cm = view.editor && view.editor.cm;
        if (cm && cm.state && cm.state.doc && typeof cm.state.doc.toString === "function") {
          return cm.state.doc.toString().split("\n");
        }
      }
    } catch (error) {}
    return null;
  }

  calendarEventStampParagraphInEvents(p, ctx) {
    try {
      if (ctx && typeof ctx.getSectionInfo === "function") {
        const info = ctx.getSectionInfo(p);
        const lines = this.calendarEventSourceLines(ctx);
        if (info && lines && Number.isInteger(info.lineStart)) {
          const scanned = gcalEventsScanMarkdown(lines);
          if (scanned.stamp && scanned.stamp.line === info.lineStart) return scanned.stamp;
          if (scanned.section && info.lineStart >= scanned.section.start && info.lineStart < scanned.section.end) {
            return gcalEventsStampFromLine(lines[info.lineStart], info.lineStart);
          }
          return null;
        }
      }
    } catch (error) {}
    if (!this.calendarEventFollowsEventsHeading(p)) return null;
    return gcalEventsStampFromLine(`*${String(p && p.textContent || "").trim()}*`, 0);
  }

  renderCalendarEventsIn(el, ctx) {
    try {
      const sourcePath = ctx && typeof ctx.sourcePath === "string" ? ctx.sourcePath : "";
      if (!this.calendarEventsPaintEnabled || !PLAN_DAILY_PATH_RE.test(sourcePath)) return;
      if (!this.calendarEventReadingRoots) this.calendarEventReadingRoots = new Set();
      const paragraphs = [];
      if (el && String(el.tagName || "").toUpperCase() === "P") paragraphs.push(el);
      const found = el && typeof el.querySelectorAll === "function" ? el.querySelectorAll("p") : [];
      for (const node of found || []) paragraphs.push(node);
      for (const p of paragraphs) {
        const text = String(p && p.textContent || "").trim();
        if (!text.startsWith("↻ synced")) continue;
        const stamp = this.calendarEventStampParagraphInEvents(p, ctx);
        if (!stamp) continue;
        const record = { kind: "stamp", path: sourcePath, el: p, stamp };
        this.calendarEventReadingRoots.add(record);
        this.calendarEventSetStampState(record);
        try {
          if (typeof MarkdownRenderChild === "function" && ctx && typeof ctx.addChild === "function") {
            const child = new MarkdownRenderChild(p);
            child.onunload = () => this.calendarEventReadingRoots.delete(record);
            ctx.addChild(child);
          }
        } catch (error) {}
      }
      const lists = el && typeof el.querySelectorAll === "function" ? el.querySelectorAll("ul, ol") : [];
      for (const list of lists || []) {
        if (!this.calendarEventListFollowsEventsHeading(list)) continue;
        for (const row of list.childNodes || []) {
          if (!row || String(row.tagName || "").toUpperCase() !== "LI") continue;
          const strongs = row.querySelectorAll ? row.querySelectorAll("strong") : [];
          const timeEl = [...(strongs || [])].find((node) => /^(?:\d{4}-\d{4}|all day)$/i.test(String(node.textContent || "").trim()));
          if (!timeEl) continue;
          const isTask = Boolean((row.querySelector && row.querySelector('input[type="checkbox"]')) || /task-list-item/.test(String(row.className || "")));
          const time = String(timeEl.textContent || "").trim().toLowerCase();
          if (row.classList) row.classList.toggle("bob-calendar-event-context", !isTask);
          if (timeEl.classList) timeEl.classList.add("bob-calendar-event-time");
          const italic = row.querySelectorAll ? row.querySelectorAll("em") : [];
          for (const tag of italic || []) {
            if (/^(?:maybe|free|day\s+\d+\s+of\s+\d+)$/i.test(String(tag.textContent || "").trim()) && tag.classList) tag.classList.add("bob-calendar-event-tag");
          }
          const links = row.querySelectorAll ? row.querySelectorAll("a") : [];
          for (const link of links || []) {
            if (/[📅📹📍]/.test(String(link.textContent || "")) && link.classList) link.classList.add("bob-calendar-event-badge");
          }
          const record = { path: sourcePath, time, isTask, timeEl };
          this.calendarEventReadingRoots.add(record);
          this.calendarEventSetReadingState(record);
          try {
            if (typeof MarkdownRenderChild === "function" && ctx && typeof ctx.addChild === "function") {
              const child = new MarkdownRenderChild(row);
              child.onunload = () => this.calendarEventReadingRoots.delete(record);
              ctx.addChild(child);
            }
          } catch (error) {}
        }
      }
    } catch (error) {
      // Reading view painting is best-effort and never writes the note.
    }
  }

  calendarEventFollowsEventsHeading(node) {
    try {
      let sibling = node && node.previousSibling;
      let guard = 0;
      while (sibling && guard < 100) {
        guard += 1;
        if (sibling.nodeType === 3 && !String(sibling.nodeValue || "").trim()) { sibling = sibling.previousSibling; continue; }
        const tag = String(sibling.tagName || "").toUpperCase();
        if (/^H[1-6]$/.test(tag)) return tag === "H2" && String(sibling.textContent || "").trim().replace(/\s+#+$/, "") === "Events";
        sibling = sibling.previousSibling;
      }
    } catch (error) {}
    return false;
  }

  calendarEventListFollowsEventsHeading(list) {
    return this.calendarEventFollowsEventsHeading(list);
  }

  refreshCalendarEventPaint() {
    try {
      const refresh = ensureGcalEventsRefreshEffect();
      const workspace = this.app && this.app.workspace;
      if (refresh && workspace && typeof workspace.getLeavesOfType === "function") {
        for (const leaf of workspace.getLeavesOfType("markdown") || []) {
          const view = leaf && leaf.view;
          const file = view && view.file;
          if (!isTodayDailyFile(this.app, file)) continue;
          const cm = view && view.editor && view.editor.cm;
          if (cm && typeof cm.dispatch === "function") cm.dispatch({ effects: refresh.of(null) });
        }
      }
      const now = new Date();
      for (const record of this.calendarEventReadingRoots || []) {
        if (record && record.kind === "stamp") {
          this.calendarEventSetStampState(record, now);
          continue;
        }
        if (isTodayDailyFile(this.app, { path: record.path }, { now })) this.calendarEventSetReadingState(record, now);
      }
    } catch (error) {}
  }
}
