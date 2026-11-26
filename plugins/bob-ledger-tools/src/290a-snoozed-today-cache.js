// --- Snoozed Today cache (planned-today) -----------------------------------
// Sibling to the ledger-derived Today cache in `290-plugin-today-and-location.js`.
// While Today holds dedicated Task Links under today's open Pomodoros, this
// cache holds the snoozed reader's `planned` set for today: resolved Asleep,
// Due, and Blocked rows in today's `## Snoozed` section
// (`docs/snooze.md`, "Rows, time, and identity"). Their union with Today is
// `planned-today` (`docs/plan.md`, "Snoozed forecast").
//
// Today stays ledger-derived: snoozed identities never enter `todayCache`
// (`decisions:today-is-read-from-the-ledger`). Planned-today applies only at
// review and lane-walk exclusion sites (`docs/freshness.md` §4,
// `docs/walks.md`); whole-lane NEXT/PENDING meters keep Today included.
//
// The pure classifier lives in the shared twin (`snoozeModel.classifyRows`);
// this fragment builds its per-row facts from Obsidian state (daily-note
// text, the Tasks cache, `getFirstLinkpathDest`, and the Today key set) and
// owns the cache lifecycle: rebuild, debounce, stale-generation discard,
// target-aware invalidation, midnight rollover, and minute transitions.

function emptySnoozedCache() {
  return {
    date: null,
    dailyPath: null,
    zone: null,
    nowMinutes: null,
    rows: [],
    byKey: new Map(),
    planned: [],
    blocked: [],
    nextWakeAt: null,
    detailsSignature: "",
  };
}

function snoozedNoteDateFromDailyPath(dailyPath) {
  const match = /(^|\/)(\d{4})\/(\d{4})(\d{2})(\d{2})\.md$/.exec(
    String(dailyPath || ""),
  );
  if (!match) {
    return null;
  }
  return `${match[2]}-${match[4]}-${match[5]}`;
}

function snoozedTodayTextFromClock(clock) {
  const date = clock instanceof Date ? clock : new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function snoozedNowMinutesFromClock(clock) {
  const date = clock instanceof Date ? clock : new Date();
  return date.getHours() * 60 + date.getMinutes();
}

function snoozedLocalZoneName() {
  try {
    const zone =
      typeof Intl !== "undefined" &&
      typeof Intl.DateTimeFormat === "function"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : null;
    return typeof zone === "string" && zone ? zone : "UTC";
  } catch (error) {
    return "UTC";
  }
}

// Today-style lookup key (`"<vault path with .md>#<block id>"`, no caret)
// so `isSnoozedToday(task)` reuses the exact `todayCacheKey` shape.
function snoozedCacheKey(task) {
  if (!task || typeof task !== "object") {
    return null;
  }
  const rawPath = planTaskPath(task);
  if (typeof rawPath !== "string" || !rawPath) {
    return null;
  }
  const blockId = planTaskBlockId(task);
  if (!blockId) {
    return null;
  }
  const path = /\.md$/i.test(rawPath) ? rawPath : `${rawPath}.md`;
  return `${path}#${blockId}`;
}

// Best-effort Event Task flag for cache facts. `bob snooze add` refuses
// Event targets, so a resolved snoozed row should never point at one;
// hand-authored rows that do are detected here by their MEET marker and
// classified `event_task` (ignored) instead of entering planned-today.
function snoozedIsEventTask(task) {
  try {
    const line =
      (task &&
        typeof task.originalMarkdown === "string" &&
        task.originalMarkdown) ||
      (task && typeof task.description === "string" && task.description) ||
      "";
    return /(^|\s)MEET(\s|$)/.test(line);
  } catch (error) {
    return false;
  }
}

// Build the `classifyRows` input plus per-row metadata from daily-note
// content and Obsidian state. `todayKeySet` holds Today-style keys
// (`"path.md#id"`, caretless); a snoozed identity whose caretless form is
// present has a live dedicated ledger link and classifies
// `already_linked`, never planned.
function snoozedBuildClassifyInput(options = {}) {
  const content = typeof options.content === "string" ? options.content : "";
  const dailyPath = typeof options.dailyPath === "string" ? options.dailyPath : "";
  const tasks = Array.isArray(options.tasks) ? options.tasks : [];
  const resolve =
    typeof options.resolve === "function" ? options.resolve : null;
  const todayKeySet =
    options.todayKeySet instanceof Set ? options.todayKeySet : new Set();
  const clock = options.clock instanceof Date ? options.clock : new Date();
  const zone =
    typeof options.zone === "string" && options.zone
      ? options.zone
      : snoozedLocalZoneName();
  const section =
    typeof snoozeParseSection === "function"
      ? snoozeParseSection(content)
      : null;
  const activeRows =
    section && Array.isArray(section.rows)
      ? section.rows.filter((row) => row && row.kind === "active")
      : [];
  const byPathBlock = new Map();
  const duplicates = new Set();
  for (const task of tasks) {
    if (!task || typeof task !== "object") {
      continue;
    }
    const rawPath = planTaskPath(task);
    if (typeof rawPath !== "string" || !rawPath) {
      continue;
    }
    const blockId = planTaskBlockId(task);
    if (!blockId) {
      continue;
    }
    const path = /\.md$/i.test(rawPath) ? rawPath : `${rawPath}.md`;
    const key = `${path}\u0000${blockId}`;
    if (byPathBlock.has(key)) {
      duplicates.add(key);
      continue;
    }
    byPathBlock.set(key, task);
  }
  const rows = [];
  const meta = [];
  for (const row of activeRows) {
    let resolution = "missing";
    let route = null;
    let fact = null;
    if (row && typeof row.target === "string" && row.blockId) {
      // An empty target is the daily note itself, mirroring
      // `todayResolveLinkKey`; only non-empty targets go through the
      // vault link resolver.
      let resolved = row.target === "" ? dailyPath : null;
      if (resolved === null && resolve) {
        try {
          const file = resolve(row.target, dailyPath);
          resolved =
            file && typeof file.path === "string" ? file.path : null;
        } catch (error) {
          resolved = null;
        }
      }
      if (typeof resolved === "string" && resolved) {
        const withExtension = /\.md$/i.test(resolved)
          ? resolved
          : `${resolved}.md`;
        const key = `${withExtension}\u0000${row.blockId || ""}`;
        if (duplicates.has(key)) {
          resolution = "ambiguous";
        } else if (byPathBlock.has(key)) {
          resolution = "found";
          route = withExtension;
          fact = byPathBlock.get(key);
        } else {
          resolution = "missing";
        }
      } else {
        resolution = "missing";
      }
    }
    let status = null;
    let isTask = false;
    let isEvent = false;
    let liveLink = false;
    if (fact) {
      const symbol = planTaskStatusSymbol(fact);
      status = typeof symbol === "string" && symbol ? symbol[0] : null;
      const statusType =
        fact.status && typeof fact.status === "object"
          ? fact.status.type
          : null;
      isTask = statusType !== "NON_TASK";
      isEvent = snoozedIsEventTask(fact);
      if (route && row.blockId && typeof snoozeIdentityKey === "function") {
        const identity = snoozeIdentityKey(route, row.blockId);
        const caretless =
          typeof identity === "string" ? identity.replace("#^", "#") : null;
        liveLink =
          typeof caretless === "string" && todayKeySet.has(caretless);
      }
    }
    rows.push({
      line: row.line,
      minutes: Number.isInteger(row.minutes) ? row.minutes : null,
      history: false,
      malformed: false,
      resolution,
      route,
      block: row.blockId,
      status,
      is_task: isTask,
      is_event: isEvent,
      live_link: liveLink,
    });
    meta.push({ row, route, fact, resolution });
  }
  return {
    section,
    rows,
    meta,
    classifierInput: {
      today: snoozedTodayTextFromClock(clock),
      note_date: snoozedNoteDateFromDailyPath(dailyPath) || "",
      now_minutes: snoozedNowMinutesFromClock(clock),
      zone,
      rows,
    },
    clockSnapshot: {
      date: snoozedTodayTextFromClock(clock),
      nowMinutes: snoozedNowMinutesFromClock(clock),
      zone,
    },
  };
}

function snoozedSnapshotRows(classified, meta, section) {
  const states = classified && Array.isArray(classified.rows)
    ? classified.rows
    : [];
  // Membership is the classifier's planned set only (Asleep, Due,
  // Blocked): ignored rows (Ready, history, duplicate, already-linked,
  // previous-day, …) are reported in `rows()` for provenance but never
  // enter the exclusion set.
  const plannedSet = new Set(
    classified && Array.isArray(classified.planned)
      ? classified.planned
      : [],
  );
  const rows = [];
  const byKey = new Map();
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index] || {};
    const item = meta[index] || {};
    const row = item.row || {};
    const key =
      state.identity && typeof state.identity === "string"
        ? state.identity.replace("#^", "#")
        : null;
    const snapshot = Object.freeze({
      key,
      identity: typeof state.identity === "string" ? state.identity : null,
      line: Number.isInteger(state.line) ? state.line : row.line || null,
      minutes: Number.isInteger(state.minutes) ? state.minutes : null,
      hhmm: typeof state.hhmm === "string" ? state.hhmm : null,
      target: typeof row.target === "string" ? row.target : null,
      blockId: typeof row.blockId === "string" ? row.blockId : null,
      route: typeof state.route === "string" ? state.route : null,
      state: typeof state.state === "string" ? state.state : "missing",
      history: false,
      wokeAt: null,
      children: Number.isInteger(row.children) ? row.children : 0,
      childrenText:
        typeof row.childrenText === "string" ? row.childrenText : "",
      source: typeof row.subtree === "string" ? row.subtree : "",
    });
    rows.push(snapshot);
    if (
      key &&
      typeof state.identity === "string" &&
      plannedSet.has(state.identity) &&
      !byKey.has(key)
    ) {
      byKey.set(key, snapshot);
    }
  }
  // Struck history rows are provenance, never membership, but the
  // `snoozed.rows()` surface reports them so readers never re-parse
  // Markdown for `woke_at`.
  if (section && Array.isArray(section.rows)) {
    for (const row of section.rows) {
      if (!row || row.kind !== "history") {
        continue;
      }
      const historySnapshot = Object.freeze({
        key: null,
        identity: null,
        line: row.line || null,
        minutes: Number.isInteger(row.minutes) ? row.minutes : null,
        hhmm: typeof row.hhmm === "string" ? row.hhmm : null,
        target: typeof row.target === "string" ? row.target : null,
        blockId: typeof row.blockId === "string" ? row.blockId : null,
        route: null,
        state: "woken",
        history: true,
        wokeAt: typeof row.wokeHhmm === "string" ? row.wokeHhmm : null,
        children: Number.isInteger(row.children) ? row.children : 0,
        childrenText:
          typeof row.childrenText === "string" ? row.childrenText : "",
        source: typeof row.subtree === "string" ? row.subtree : "",
      });
      rows.push(historySnapshot);
    }
  }
  rows.sort((left, right) => (left.line || 0) - (right.line || 0));
  return { rows: Object.freeze(rows), byKey };
}

function snoozedDetailsSignature(rows) {
  try {
    return JSON.stringify(
      (Array.isArray(rows) ? rows : []).map((row) => [
        row ? row.key : null,
        row ? row.identity : null,
        row ? row.state : null,
        row ? row.minutes : null,
        row ? row.wokeAt : null,
      ]),
    );
  } catch (error) {
    return "";
  }
}

class BobLedgerToolsSnoozedTodayMixin {
  snoozedRoutesInCache() {
    try {
      const cache = this.snoozedCache;
      const rows = cache && Array.isArray(cache.rows) ? cache.rows : [];
      const routes = new Set();
      for (const row of rows) {
        if (row && typeof row.route === "string" && row.route) {
          routes.add(row.route);
        }
      }
      return routes;
    } catch (error) {
      return new Set();
    }
  }

  snoozedAffectsPath(path) {
    try {
      const changed = typeof path === "string" ? path : "";
      if (!changed) {
        return false;
      }
      const daily =
        typeof this.currentTodayDailyPath === "function"
          ? this.currentTodayDailyPath(new Date())
          : null;
      if (daily && sameVaultPath(changed, daily)) {
        return true;
      }
      const cache = this.snoozedCache;
      if (
        cache &&
        typeof cache.dailyPath === "string" &&
        cache.dailyPath &&
        sameVaultPath(changed, cache.dailyPath)
      ) {
        return true;
      }
      const routes = this.snoozedRoutesInCache();
      const withExtension = /\.md$/i.test(changed) ? changed : `${changed}.md`;
      if (routes.has(withExtension) || routes.has(changed)) {
        return true;
      }
      if (this.todayCache && this.todayCache.idsByPath instanceof Map) {
        const ids =
          this.todayCache.idsByPath.get(withExtension) ||
          this.todayCache.idsByPath.get(changed);
        if (ids instanceof Set && ids.size > 0) {
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // Rebuild the cache from daily-note text. Returns true when planned
  // membership, history detail, or readiness changed; a membership
  // change refreshes every open Tasks query and the plan widgets even
  // when the Today key set is unchanged, because review, lane, and
  // dashboard readers branch on this set too.
  rebuildSnoozedCache(content, dailyPath, now = new Date(), options = {}) {
    if (!this.snoozedCache || !(this.snoozedCache.byKey instanceof Map)) {
      this.snoozedCache = emptySnoozedCache();
    }
    if (!(this.snoozedEnteredAt instanceof Map)) {
      this.snoozedEnteredAt = new Map();
    }
    const clock = now instanceof Date ? now : new Date();
    const wasReady = this.isSnoozedCacheReady(clock);
    const previous = this.snoozedCache;
    const previousPlanned = Array.isArray(previous.planned)
      ? previous.planned
      : [];
    const previousSignature =
      typeof previous.detailsSignature === "string"
        ? previous.detailsSignature
        : "";
    const previousDate = previous.date;
    const previousPath = previous.dailyPath;
    const zone =
      options && typeof options.zone === "string" && options.zone
        ? options.zone
        : snoozedLocalZoneName();
    let tasks = null;
    try {
      tasks = planBlockTasks(this.app);
    } catch (error) {
      tasks = null;
    }
    const todayKeySet = new Set(
      this.todayCache && this.todayCache.rank instanceof Map
        ? Array.from(this.todayCache.rank.keys())
        : [],
    );
    const built = snoozedBuildClassifyInput({
      content,
      dailyPath,
      tasks: Array.isArray(tasks) ? tasks : [],
      resolve: (target, daily) => this.resolveTodayLink(target, daily),
      todayKeySet,
      clock,
      zone,
    });
    let classified = null;
    try {
      classified = snoozeModel.classifyRows(built.classifierInput);
    } catch (error) {
      classified = { rows: [], planned: [], blocked: [], nextWakeAt: null };
    }
    const snapshot = snoozedSnapshotRows(classified, built.meta, built.section);
    const planned = Array.isArray(classified.planned)
      ? classified.planned.slice().sort()
      : [];
    const blocked = Array.isArray(classified.blocked)
      ? classified.blocked.slice().sort()
      : [];
    const nextWakeAt =
      classified && typeof classified.nextWakeAt === "string"
        ? classified.nextWakeAt
        : null;
    const detailsSignature = snoozedDetailsSignature(snapshot.rows);
    const dateOrPathChanged =
      previousDate !== built.clockSnapshot.date ||
      !sameVaultPath(previousPath || "", dailyPath);
    const plannedChanged =
      previousPlanned.length !== planned.length ||
      previousPlanned.some((key, index) => key !== planned[index]);
    const detailsChanged = detailsSignature !== previousSignature;
    if (!dateOrPathChanged && !wasReady) {
      // First build for an unchanged day still stamps entries below.
    }
    if (wasReady && !dateOrPathChanged) {
      const previousSet = new Set(previousPlanned);
      for (const key of planned) {
        if (!previousSet.has(key)) {
          this.snoozedEnteredAt.set(key, clock.getTime());
        }
      }
    } else {
      this.snoozedEnteredAt.clear();
      for (const key of planned) {
        this.snoozedEnteredAt.set(key, clock.getTime());
      }
    }
    for (const [key, stamped] of Array.from(this.snoozedEnteredAt.entries())) {
      if (!planned.includes(key) || clock.getTime() - stamped > 2000) {
        this.snoozedEnteredAt.delete(key);
      }
    }
    this.snoozedCache = {
      date: built.clockSnapshot.date,
      dailyPath,
      zone: built.clockSnapshot.zone,
      nowMinutes: built.clockSnapshot.nowMinutes,
      rows: snapshot.rows,
      byKey: snapshot.byKey,
      planned,
      blocked,
      nextWakeAt,
      detailsSignature,
    };
    if (typeof this.snoozedCacheGen === "number") {
      this.snoozedCacheGen += 1;
    } else {
      this.snoozedCacheGen = 1;
    }
    const becameReady = !wasReady && this.isSnoozedCacheReady(clock);
    const changed = plannedChanged || becameReady;
    if (changed || detailsChanged || dateOrPathChanged) {
      try {
        const workspace = this.app && this.app.workspace;
        if (plannedChanged || becameReady) {
          if (workspace && typeof workspace.trigger === "function") {
            workspace.trigger(TODAY_RELOAD_EVENT);
          }
          this.schedulePlanBlockRerender();
          this.scheduleFreshnessStatusBar();
          this.scheduleFreshnessMarksRefresh();
          if (typeof this.scheduleLiveWidgetRefresh === "function") {
            this.scheduleLiveWidgetRefresh();
          }
        }
      } catch (error) {
        // The cache is still correct; only the live refresh is skipped.
      }
    }
    // Rebuild first so the minute trigger only consults current row/task facts.
    // The CLI remains the sole writer for the daily note.
    if (typeof this.snoozeWakeTick === "function") {
      void this.snoozeWakeTick(clock);
    }
    return changed;
  }

  snoozedCacheStamp() {
    try {
      const cache = this.snoozedCache;
      if (!cache || !(cache.byKey instanceof Map)) {
        return JSON.stringify([null, null, null, null]);
      }
      return JSON.stringify([
        cache.date || null,
        cache.dailyPath || null,
        Array.isArray(cache.planned) ? cache.planned : [],
        cache.nextWakeAt || null,
      ]);
    } catch (error) {
      return JSON.stringify(["error", "error", "error", "error"]);
    }
  }

  isSnoozedCacheReady(now = new Date()) {
    try {
      const clock = now instanceof Date ? now : new Date();
      const expectedDate = snoozedTodayTextFromClock(clock);
      const expectedPath =
        typeof this.currentTodayDailyPath === "function"
          ? this.currentTodayDailyPath(clock)
          : null;
      if (!expectedPath) {
        return false;
      }
      const cache = this.snoozedCache;
      if (!cache || !(cache.byKey instanceof Map)) {
        return false;
      }
      if (cache.date !== expectedDate) {
        return false;
      }
      if (!sameVaultPath(cache.dailyPath || "", expectedPath)) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  // True only for today's live-or-blocked Snoozed rows (Asleep, Due,
  // Blocked). Missing, unresolved, ignored, and history inputs are
  // neutral, and an unavailable cache never invents membership.
  isSnoozedTodayTask(task) {
    try {
      const key = snoozedCacheKey(task);
      if (!key) {
        return false;
      }
      const cache = this.snoozedCache;
      if (!cache || !(cache.byKey instanceof Map)) {
        return false;
      }
      return cache.byKey.has(key);
    } catch (error) {
      return false;
    }
  }

  isPlannedTodayTask(task) {
    try {
      if (
        typeof this.isTodayTask === "function" &&
        this.isTodayTask(task) === true
      ) {
        return true;
      }
      return this.isSnoozedTodayTask(task);
    } catch (error) {
      return false;
    }
  }

  snoozedRows() {
    try {
      const cache = this.snoozedCache;
      if (!cache || !Array.isArray(cache.rows)) {
        return [];
      }
      return cache.rows.map((row) => ({ ...row }));
    } catch (error) {
      return [];
    }
  }

  snoozedPlannedKeys() {
    try {
      const cache = this.snoozedCache;
      return Array.isArray(cache.planned) ? cache.planned.slice() : [];
    } catch (error) {
      return [];
    }
  }

  snoozedNextWakeAt() {
    try {
      const cache = this.snoozedCache;
      return cache && typeof cache.nextWakeAt === "string"
        ? cache.nextWakeAt
        : null;
    } catch (error) {
      return null;
    }
  }

  snoozedCacheNeedsMinuteRefresh(now = new Date()) {
    try {
      const clock = now instanceof Date ? now : new Date();
      if (!this.isSnoozedCacheReady(clock)) {
        return true;
      }
      const cache = this.snoozedCache;
      return (
        !cache ||
        cache.nowMinutes !== snoozedNowMinutesFromClock(clock)
      );
    } catch (error) {
      return false;
    }
  }

  refreshSnoozedCacheFromDaily(now = new Date()) {
    const clock = now instanceof Date ? now : new Date();
    const dailyPath =
      typeof this.currentTodayDailyPath === "function"
        ? this.currentTodayDailyPath(clock)
        : null;
    if (!dailyPath) {
      return Promise.resolve(false);
    }
    const gen = (this.snoozedCacheGen = (this.snoozedCacheGen || 0) + 1);
    return Promise.resolve(this.readPlanBlockContent(dailyPath)).then(
      (content) => {
        if (gen !== this.snoozedCacheGen) {
          return false;
        }
        if (typeof content !== "string") {
          return this.rebuildSnoozedCache("", dailyPath, clock);
        }
        return this.rebuildSnoozedCache(content, dailyPath, clock);
      },
    );
  }

  scheduleSnoozedRefresh(now = new Date(), delayMs = 300) {
    try {
      if (
        this.snoozedRefreshTimer !== null &&
        this.snoozedRefreshTimer !== undefined
      ) {
        return false;
      }
      const clock = now instanceof Date ? now : new Date();
      const delay =
        Number.isInteger(delayMs) && delayMs >= 0 ? delayMs : 300;
      const schedule =
        typeof window !== "undefined" &&
        typeof window.setTimeout === "function"
          ? window.setTimeout
          : setTimeout;
      const clear =
        typeof window !== "undefined" &&
        typeof window.clearTimeout === "function"
          ? window.clearTimeout
          : clearTimeout;
      this.snoozedRefreshTimer = schedule(() => {
        this.snoozedRefreshTimer = null;
        try {
          void this.refreshSnoozedCacheFromDaily(clock);
        } catch (error) {
          // Best-effort refresh only.
        }
      }, delay);
      void clear;
      return true;
    } catch (error) {
      return false;
    }
  }

  cancelSnoozedRefresh() {
    try {
      if (
        this.snoozedRefreshTimer !== null &&
        this.snoozedRefreshTimer !== undefined &&
        typeof clearTimeout === "function"
      ) {
        clearTimeout(this.snoozedRefreshTimer);
      }
    } catch (error) {
      // Best-effort cleanup only.
    }
    this.snoozedRefreshTimer = null;
  }

  disposeSnoozedCache() {
    this.cancelSnoozedRefresh();
  }

  refreshSnoozedCacheForChangedFile(file, data, now = new Date()) {
    const clock = now instanceof Date ? now : new Date();
    const changedPath =
      file && typeof file.path === "string" ? file.path : null;
    if (!changedPath) {
      return false;
    }
    const daily =
      typeof this.currentTodayDailyPath === "function"
        ? this.currentTodayDailyPath(clock)
        : null;
    if (daily && sameVaultPath(changedPath, daily)) {
      if (typeof data === "string") {
        this.snoozedCacheGen = (this.snoozedCacheGen || 0) + 1;
        this.rebuildSnoozedCache(data, changedPath, clock);
        return true;
      }
      this.scheduleSnoozedRefresh(clock);
      return true;
    }
    if (this.snoozedAffectsPath(changedPath)) {
      this.scheduleSnoozedRefresh(clock);
      return true;
    }
    return false;
  }

  refreshSnoozedCacheForVaultEvent(file, oldPath, now = new Date()) {
    const clock = now instanceof Date ? now : new Date();
    const workspace = this.app && this.app.workspace;
    if (workspace && workspace.layoutReady === false) {
      return false;
    }
    const changedPath =
      file && typeof file.path === "string" ? file.path : null;
    const previousPath = typeof oldPath === "string" ? oldPath : null;
    if (
      (changedPath && this.snoozedAffectsPath(changedPath)) ||
      (previousPath && this.snoozedAffectsPath(previousPath))
    ) {
      this.scheduleSnoozedRefresh(clock);
      return true;
    }
    return false;
  }

  refreshSnoozedCacheForRollover(now = new Date()) {
    const clock = now instanceof Date ? now : new Date();
    const dailyPath =
      typeof this.currentTodayDailyPath === "function"
        ? this.currentTodayDailyPath(clock)
        : null;
    if (!dailyPath) {
      return false;
    }
    if (
      this.snoozedCache &&
      sameVaultPath(this.snoozedCache.dailyPath || "", dailyPath) &&
      this.snoozedCache.date === snoozedTodayTextFromClock(clock)
    ) {
      return false;
    }
    this.scheduleSnoozedRefresh(clock, 0);
    return true;
  }

  revalidateSnoozedCache(now = new Date()) {
    const clock = now instanceof Date ? now : new Date();
    const nowMs = clock.getTime();
    const workspace = this.app && this.app.workspace;
    if (workspace && workspace.layoutReady === false) {
      return false;
    }
    const last =
      typeof this.snoozedRevalidateAt === "number"
        ? this.snoozedRevalidateAt
        : 0;
    if (last && Math.abs(nowMs - last) < 1000) {
      return false;
    }
    this.snoozedRevalidateAt = nowMs;
    if (this.refreshSnoozedCacheForRollover(clock)) {
      return true;
    }
    if (!this.isSnoozedCacheReady(clock)) {
      void this.refreshSnoozedCacheFromDaily(clock);
      return true;
    }
    if (this.snoozedCacheNeedsMinuteRefresh(clock)) {
      this.scheduleSnoozedRefresh(clock);
      return true;
    }
    return false;
  }
}
