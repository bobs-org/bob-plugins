// Keep inbox indicator model (keep-indicator-view): pure view model for the
// `bob-keep-inbox` status-bar item. No Obsidian, no spawn, no vault access.
// Every function is pure and never throws; invalid input degrades to a
// hidden or unknown frame, never an exception.

const KEEP_INBOX_DEFAULT_TARGET = "gkeep_inbox.md";

function keepInboxAsString(value) {
  try {
    if (typeof value === "string") {
      return value;
    }
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return "";
  } catch (error) {
    return "";
  }
}

function keepInboxIsTopLevelTask(task) {
  try {
    if (!task || typeof task !== "object") {
      return false;
    }
    const indentation =
      typeof task.indentation === "string" ? task.indentation : "";
    return indentation === "";
  } catch (error) {
    return false;
  }
}

function keepInboxTaskPath(task) {
  try {
    if (!task || typeof task !== "object") {
      return "";
    }
    if (typeof task.path === "string" && task.path) {
      return task.path;
    }
    if (task.file && typeof task.file.path === "string") {
      return task.file.path;
    }
    return "";
  } catch (error) {
    return "";
  }
}

function keepInboxTaskSymbol(task) {
  try {
    if (!task || typeof task !== "object") {
      return "";
    }
    if (task.status && typeof task.status.symbol === "string") {
      return task.status.symbol;
    }
    if (typeof task.statusSymbol === "string") {
      return task.statusSymbol;
    }
    if (typeof task.symbol === "string") {
      return task.symbol;
    }
    return "";
  } catch (error) {
    return "";
  }
}

function keepInboxSamePath(left, right) {
  try {
    const a = keepInboxAsString(left).trim();
    const b = keepInboxAsString(right).trim();
    if (!a || !b) {
      return false;
    }
    if (a === b) {
      return true;
    }
    const norm = (value) =>
      String(value || "")
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .trim();
    return norm(a) === norm(b);
  } catch (error) {
    return false;
  }
}

// Inbox predicate: count open top-level Tasks-plugin tasks in one target
// note. Open means any status symbol but done (`x`/`X`) or cancelled (`-`),
// so Blocked (`?`), Next (`*`), and In Progress (`/`) count. Nested lines
// never count, even with `#task`; fenced lines never reach us because Tasks
// does not emit them. The footer now sums the same predicate over the inbox
// tree. Never throws.
function keepInboxOpenCount(tasks, path) {
  try {
    const target = keepInboxAsString(path).trim();
    if (!target || !Array.isArray(tasks)) {
      return 0;
    }
    let open = 0;
    for (const task of tasks) {
      try {
        if (!keepInboxIsTopLevelTask(task)) {
          continue;
        }
        if (!keepInboxSamePath(keepInboxTaskPath(task), target)) {
          continue;
        }
        const symbol = keepInboxTaskSymbol(task);
        if (!symbol) {
          continue;
        }
        if (symbol === "x" || symbol === "X" || symbol === "-") {
          continue;
        }
        open += 1;
      } catch (error) {
        // One bad row never breaks the count.
      }
    }
    return open;
  } catch (error) {
    return 0;
  }
}

// `bob gkeep status -f json` decoder for the footer. `schema_version: 1`
// decodes; anything else (old bob, non-JSON, missing bob, config-error
// documents without a Keep observation) is `unsupported` so the Keep
// segment hides and the inbox falls back. Never throws; never rejects.
function keepInboxDecodeStatus(stdout, stderr, exitCode) {
  const fail = (code, message) => ({
    ok: false,
    code,
    message,
    detail: keepInboxFirstLine(stderr),
  });
  try {
    let body = null;
    try {
      body = JSON.parse(String(stdout || ""));
    } catch (error) {
      return fail(
        "unsupported",
        "bob gkeep status returned invalid JSON.",
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return fail("unsupported", "bob gkeep status returned no report.");
    }
    if (body.schema_version !== 1) {
      return fail(
        "unsupported",
        "bob gkeep status is not schema_version 1.",
      );
    }
    if (body.ok === false) {
      const error =
        body.error && typeof body.error === "object" ? body.error : {};
      const kind =
        typeof error.kind === "string" && error.kind ? error.kind : "bob-error";
      const message =
        typeof error.message === "string" && error.message
          ? error.message
          : "bob gkeep status failed.";
      return {
        ok: false,
        code: kind === "config" ? "unsupported" : kind,
        message,
        detail: keepInboxFirstLine(stderr),
        report: body,
      };
    }
    if (body.ok !== true || typeof body.configured !== "boolean") {
      return fail("unsupported", "bob gkeep status returned no report.");
    }
    return { ok: true, report: body };
  } catch (error) {
    return fail("unsupported", "bob gkeep status could not be decoded.");
  }
}

function keepInboxFirstLine(stderr) {
  try {
    const text = String(stderr === undefined ? "" : stderr);
    const line = text
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean);
    return line || "";
  } catch (error) {
    return "";
  }
}

function keepInboxParseTime(value) {
  try {
    if (!value) {
      return null;
    }
    const date = new Date(String(value));
    const time = date.getTime();
    return Number.isFinite(time) ? date : null;
  } catch (error) {
    return null;
  }
}

function keepInboxNowMs(now) {
  try {
    if (now instanceof Date) {
      const time = now.getTime();
      return Number.isFinite(time) ? time : Date.now();
    }
    if (typeof now === "number" && Number.isFinite(now)) {
      return now;
    }
    if (typeof now === "string" && now) {
      const date = new Date(now);
      const time = date.getTime();
      if (Number.isFinite(time)) {
        return time;
      }
    }
    return Date.now();
  } catch (error) {
    return Date.now();
  }
}

const KEEP_INBOX_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function keepInboxPad2(value) {
  return String(value).padStart(2, "0");
}

function keepInboxClockText(date) {
  try {
    if (!(date instanceof Date)) {
      return "";
    }
    return (
      keepInboxPad2(date.getUTCHours()) +
      ":" +
      keepInboxPad2(date.getUTCMinutes())
    );
  } catch (error) {
    return "";
  }
}

function keepInboxFullDateText(date) {
  try {
    if (!(date instanceof Date)) {
      return "";
    }
    const month = KEEP_INBOX_MONTHS[date.getUTCMonth()] || "";
    const day = date.getUTCDate();
    return month + " " + day + ", " + keepInboxClockText(date);
  } catch (error) {
    return "";
  }
}

// Relative age for tooltips: `just now` (<1m), `N min ago`, `N h ago`,
// else `Oct 30, 18:02`. UTC keeps tests deterministic.
function keepInboxRelativeAge(checkedAt, nowMs) {
  try {
    const date = keepInboxParseTime(checkedAt);
    if (!date) {
      return "";
    }
    const diffMs = nowMs - date.getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) {
      return "just now";
    }
    const minute = 60 * 1000;
    const hour = 60 * minute;
    if (diffMs < minute) {
      return "just now";
    }
    if (diffMs < hour) {
      const minutes = Math.floor(diffMs / minute);
      return minutes <= 1 ? "1 min ago" : minutes + " min ago";
    }
    if (diffMs < 24 * hour) {
      const hours = Math.floor(diffMs / hour);
      return hours <= 1 ? "1 h ago" : hours + " h ago";
    }
    return keepInboxFullDateText(date);
  } catch (error) {
    return "";
  }
}

function keepInboxRelativeAgeLong(checkedAt, nowMs) {
  try {
    const short = keepInboxRelativeAge(checkedAt, nowMs);
    if (short === "just now") {
      return "just now";
    }
    if (/min ago$/.test(short)) {
      const n = short.split(" ")[0];
      return n === "1" ? "1 minute ago" : n + " minutes ago";
    }
    if (/ h ago$/.test(short)) {
      const n = short.split(" ")[0];
      return n === "1" ? "1 hour ago" : n + " hours ago";
    }
    return short;
  } catch (error) {
    return "";
  }
}

function keepInboxBreakdownParts(pull) {
  try {
    const parts = [];
    const safe = pull && typeof pull === "object" ? pull : {};
    const freshNew = Number(safe.new);
    const links = Number(safe.links);
    const revised = Number(safe.revised);
    const pending = Number(safe.pending);
    if (Number.isFinite(freshNew) && freshNew > 0) {
      parts.push(freshNew + " new");
    }
    if (Number.isFinite(links) && links > 0) {
      parts.push(
        links === 1 ? "1 link → reading queue" : links + " links → reading queue",
      );
    }
    if (Number.isFinite(revised) && revised > 0) {
      parts.push(revised + " revised");
    }
    if (Number.isFinite(pending) && pending > 0) {
      parts.push(pending + " archive-only");
    }
    return parts;
  } catch (error) {
    return [];
  }
}

function keepInboxStaysParts(stays) {
  try {
    const parts = [];
    const safe = stays && typeof stays === "object" ? stays : {};
    const pinned = Number(safe.pinned);
    const shared = Number(safe.shared);
    const empty = Number(safe.empty);
    if (Number.isFinite(pinned) && pinned > 0) {
      parts.push(
        pinned === 1 ? "1 pinned stays in Keep" : pinned + " pinned stay in Keep",
      );
    }
    if (Number.isFinite(shared) && shared > 0) {
      parts.push(
        shared === 1 ? "1 shared stays in Keep" : shared + " shared stay in Keep",
      );
    }
    if (Number.isFinite(empty) && empty > 0) {
      parts.push(
        empty === 1 ? "1 empty stays in Keep" : empty + " empty stay in Keep",
      );
    }
    return parts;
  } catch (error) {
    return [];
  }
}

function keepInboxHiddenView(paintKey) {
  return {
    visible: false,
    keep: {
      visible: false,
      tone: "hidden",
      icon: "",
      text: "",
      tooltip: "",
      aria: "",
    },
    connector: { visible: false },
    inbox: {
      visible: false,
      tone: "hidden",
      icon: "",
      text: "",
      tooltip: "",
      aria: "",
    },
    paintKey: paintKey || "hidden",
  };
}

function keepInboxHiddenInboxPart() {
  return {
    visible: false,
    tone: "hidden",
    icon: "",
    text: "",
    tooltip: "",
    aria: "",
  };
}

function keepInboxFinalizeView(view, keySuffix) {
  try {
    if (!view || typeof view !== "object") {
      return keepInboxHiddenView("hidden-empty");
    }
    const keep = view.keep && typeof view.keep === "object" ? view.keep : {};
    const inbox = view.inbox && typeof view.inbox === "object" ? view.inbox : {};
    view.keep = keep;
    view.inbox = inbox;
    view.connector = view.connector && typeof view.connector === "object"
      ? view.connector
      : {};
    view.connector.visible = Boolean(keep.visible && inbox.visible);
    if (!keep.visible && !inbox.visible) {
      return keepInboxHiddenView("hidden-empty");
    }
    view.visible = true;
    view.paintKey = keepInboxPaintKey(view);
    if (keySuffix) {
      view.paintKey = view.paintKey + "\0" + keySuffix;
    }
    return view;
  } catch (error) {
    return keepInboxHiddenView("hidden-error");
  }
}

// Pure view model implementing the plan's Visibility states and tooltip
// copy. Each segment shows only for a positive count (the Keep sign-in
// pill is the one count-less Keep state still painted), and the whole
// item hides when both segments are hidden. `status` is the last
// `bobSpawnJson` result (`{ok, report}`), a raw status report, or null
// before the first read. `inboxCount` is the inbox-tree total from the
// Tasks cache; `inboxNotes` is the per-note breakdown; `tasksReady`
// says the Tasks cache answered; bob's `inbox.open` is not read.
// `defaultTargetExists` covers the unsupported fallback; `enabled` is
// the session toggle (default on); `now` fixes relative ages in tests.
// Never throws.
function keepInboxViewModel(options = {}) {
  try {
    const opts = options && typeof options === "object" ? options : {};
    const enabled = opts.enabled !== false;
    if (!enabled) {
      return keepInboxHiddenView("hidden-disabled");
    }
    const rawStatus = opts.status === undefined ? null : opts.status;
    if (rawStatus === null || rawStatus === undefined) {
      return keepInboxHiddenView("hidden-noread");
    }
    let report = null;
    let unsupported = false;
    if (
      rawStatus &&
      typeof rawStatus === "object" &&
      ("ok" in rawStatus || "report" in rawStatus || "code" in rawStatus)
    ) {
      if (rawStatus.ok === true && rawStatus.report) {
        report = rawStatus.report;
      } else if (rawStatus.report && typeof rawStatus.report === "object") {
        // A config-error document still carries a report for the inbox
        // path, but the Keep segment hides as unsupported.
        report = rawStatus.report;
        unsupported = true;
      } else {
        unsupported = true;
      }
    } else if (rawStatus && typeof rawStatus === "object") {
      report = rawStatus;
    } else {
      return keepInboxHiddenView("hidden-bad-status");
    }
    if (unsupported || !report || typeof report !== "object") {
      return keepInboxUnsupportedView(opts);
    }
    if (report.schema_version !== 1) {
      return keepInboxUnsupportedView(opts);
    }
    if (report.configured === false) {
      return keepInboxHiddenView("hidden-unconfigured");
    }
    const keep = report.keep && typeof report.keep === "object" ? report.keep : {};
    const nowMs = keepInboxNowMs(opts.now);
    // Verified gates the Keep segment: never succeeded hides it.
    const verified = keep.verified === true;
    const state = typeof keep.state === "string" ? keep.state : "";
    if (!verified && state !== "ok") {
      // `unverified` (never succeeded): Keep hidden, inbox live.
      if (state === "" || state === "unverified") {
        return keepInboxInboxOnlyView(opts, "unverified");
      }
      // A failure before the first success also hides Keep.
      if (verified !== true) {
        return keepInboxInboxOnlyView(opts, "unverified");
      }
    }
    if (!verified) {
      return keepInboxInboxOnlyView(opts, "unverified");
    }
    // Verified Keep states below.
    if (state === "auth") {
      return keepInboxSigninView(opts);
    }
    const checkedAt = keep.checked_at || null;
    const checkedDate = keepInboxParseTime(checkedAt);
    const dayMs = 24 * 60 * 60 * 1000;
    const recent =
      checkedDate !== null &&
      Number.isFinite(nowMs - checkedDate.getTime()) &&
      nowMs - checkedDate.getTime() >= 0 &&
      nowMs - checkedDate.getTime() <= dayMs;
    if (state === "ok" && keep.stale !== true) {
      if (!recent) {
        return keepInboxInboxOnlyView(opts, "unknown");
      }
      const total = keep.pull && Number.isFinite(Number(keep.pull.total))
        ? Number(keep.pull.total)
        : null;
      if (total !== null && total > 0) {
        return keepInboxFreshView(opts, nowMs, keep);
      }
      return keepInboxInboxOnlyView(opts, "zero");
    }
    // Stale or failure states with a verified host.
    const total = keep.pull && Number.isFinite(Number(keep.pull.total))
      ? Number(keep.pull.total)
      : null;
    if (keep.stale === true && recent && total !== null && total > 0) {
      return keepInboxStaleView(opts, nowMs, keep);
    }
    return keepInboxInboxOnlyView(opts, "unknown");
  } catch (error) {
    return keepInboxHiddenView("hidden-error");
  }
}

function keepInboxUnsupportedView(opts) {
  try {
    const exists = opts.defaultTargetExists === true;
    if (!exists) {
      return keepInboxHiddenView("hidden-unsupported-missing");
    }
    const inbox = keepInboxInboxPart(opts);
    return keepInboxFinalizeView({
      visible: true,
      keep: {
        visible: false,
        tone: "hidden",
        icon: "",
        text: "",
        tooltip: "",
        aria: "",
      },
      connector: { visible: false },
      inbox: { visible: true, ...inbox },
      paintKey: "",
    });
  } catch (error) {
    return keepInboxHiddenView("hidden-error");
  }
}

function keepInboxInboxOnlyView(opts, reason) {
  try {
    const inbox = keepInboxInboxPart(opts);
    return keepInboxFinalizeView({
      visible: true,
      keep: {
        visible: false,
        tone: "hidden",
        icon: "",
        text: "",
        tooltip: "",
        aria: "",
      },
      connector: { visible: false },
      inbox: { visible: true, ...inbox },
      paintKey: "",
    }, reason);
  } catch (error) {
    return keepInboxHiddenView("hidden-error");
  }
}

function keepInboxInboxPart(opts) {
  try {
    if (opts.tasksReady !== true) {
      return keepInboxHiddenInboxPart();
    }
    const count = Number(opts.inboxCount);
    const open = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
    if (open <= 0) {
      return keepInboxHiddenInboxPart();
    }
    const taskWord = open === 1 ? "1 open task to triage" : open + " open tasks to triage";
    const aria = open === 1 ? "1 open task in the inbox" : open + " open tasks in the inbox";
    const lines = ["Inbox · " + taskWord];
    const rawNotes = Array.isArray(opts.inboxNotes) ? opts.inboxNotes.slice() : [];
    const notes = rawNotes.filter((note) => note && (note.path || note.label));
    notes.sort(keepInboxTreeNoteOrder);
    if (notes.length > 0) {
      const shown = notes.slice(0, 4);
      const rest = notes.length - shown.length;
      const parts = shown.map((note) => {
        let label = keepInboxAsString(note && note.label).trim();
        if (!label) {
          try {
            label = pomodoroHomeStem(note && note.path);
          } catch (error) {
            label = "";
          }
        }
        const n = Number(note && note.open);
        const countText = Number.isFinite(n) ? String(Math.floor(n)) : "0";
        return (label || "inbox") + " " + countText;
      });
      if (rest > 0) {
        parts.push("+" + rest + " more");
      }
      lines.push(parts.join(" · "));
      let stem = keepInboxAsString(notes[0] && notes[0].label).trim();
      if (!stem) {
        try {
          stem = pomodoroHomeStem(notes[0] && notes[0].path);
        } catch (error) {
          stem = "";
        }
      }
      lines.push("Click to open " + (stem || "the inbox"));
    } else {
      lines.push("Click to open the inbox");
    }
    return {
      visible: true,
      tone: "count",
      icon: "inbox",
      text: String(open),
      tooltip: lines.join("\n"),
      aria,
    };
  } catch (error) {
    return keepInboxHiddenInboxPart();
  }
}

function keepInboxCheckedLine(keep, nowMs) {
  try {
    const age = keepInboxRelativeAge(keep.checked_at, nowMs);
    if (!age) {
      return "";
    }
    if (age === "just now") {
      return "Checked just now";
    }
    return "Checked " + age;
  } catch (error) {
    return "";
  }
}

function keepInboxFreshView(opts, nowMs, keep) {
  try {
    const total = Number(keep.pull.total);
    const breakdown = keepInboxBreakdownParts(keep.pull).join(" · ");
    const stays = keepInboxStaysParts(keep.stays).join(" · ");
    const lines = ["Google Keep · " + total + " notes to pull"];
    if (breakdown) {
      lines.push(breakdown);
    }
    if (stays) {
      lines.push(stays);
    }
    const checked = keepInboxCheckedLine(keep, nowMs);
    if (checked) {
      lines.push(checked);
    }
    lines.push("Click to preview the pull · right-click for more");
    const tooltip = lines.join("\n");
    const ageLong = keepInboxRelativeAgeLong(keep.checked_at, nowMs);
    const aria = total === 1
      ? "1 Google Keep note to pull, checked " + ageLong
      : total + " Google Keep notes to pull, checked " + ageLong;
    const inbox = keepInboxInboxPart(opts);
    return keepInboxFinalizeView({
      visible: true,
      keep: {
        visible: true,
        tone: "fresh",
        icon: "lightbulb",
        text: String(total),
        tooltip,
        aria,
      },
      connector: { visible: true },
      inbox: { visible: true, ...inbox },
      paintKey: "",
    });
  } catch (error) {
    return keepInboxHiddenView("hidden-error");
  }
}

function keepInboxStaleView(opts, nowMs, keep) {
  try {
    const total = Number(keep.pull.total);
    const checkedDate = keepInboxParseTime(keep.checked_at);
    const asOf = checkedDate ? keepInboxClockText(checkedDate) : "";
    const firstLine = asOf
      ? "Google Keep · " + total + " notes to pull, as of " + asOf
      : "Google Keep · " + total + " notes to pull";
    const breakdown = keepInboxBreakdownParts(keep.pull).join(" · ");
    const lines = [firstLine];
    if (breakdown) {
      lines.push(breakdown);
    }
    const state = typeof keep.state === "string" ? keep.state : "";
    const errorDoc =
      keep.error && typeof keep.error === "object" ? keep.error : null;
    const nextDate = keepInboxParseTime(keep.next_check_at);
    const nextClock = nextDate ? keepInboxClockText(nextDate) : "";
    if (state === "ok") {
      lines.push("A pull changed Keep since this count · rechecking soon");
    } else if (state === "offline") {
      const sinceDate = keepInboxParseTime(
        (errorDoc && errorDoc.since) || null,
      );
      const sinceClock = sinceDate ? keepInboxClockText(sinceDate) : "";
      if (sinceClock && nextClock) {
        lines.push(
          "Offline since " + sinceClock + " · next try about " + nextClock,
        );
      } else if (sinceClock) {
        lines.push("Offline since " + sinceClock);
      } else if (nextClock) {
        lines.push("Offline · next try about " + nextClock);
      } else {
        lines.push("Offline · will retry soon");
      }
    } else if (state === "locked") {
      lines.push("Can't read the Keep token without a passphrase prompt");
      lines.push("Run bob gkeep list in a terminal once to unlock");
    } else if (state === "rate_limited") {
      if (nextClock) {
        lines.push("Google asked Bob to slow down · next check after " + nextClock);
      } else {
        lines.push("Google asked Bob to slow down");
      }
    } else if (state === "error") {
      const message = errorDoc && typeof errorDoc.message === "string"
        ? errorDoc.message.split("\n")[0].trim()
        : "";
      if (message) {
        lines.push("Keep check failed: " + message);
      } else {
        lines.push("Keep check failed");
      }
      lines.push("Run bob gkeep doctor");
    } else {
      const message = errorDoc && typeof errorDoc.message === "string"
        ? errorDoc.message.split("\n")[0].trim()
        : "";
      if (message) {
        lines.push("Keep check failed: " + message);
      }
      lines.push("Run bob gkeep doctor");
    }
    if (state !== "ok" && state !== "locked") {
      lines.push("Click to check now");
    } else if (state === "locked") {
      lines.push("Click to check now");
    } else {
      lines.push("Click to check now");
    }
    const tooltip = lines.join("\n");
    const ageLong = keepInboxRelativeAgeLong(keep.checked_at, nowMs);
    const aria = total === 1
      ? "1 Google Keep note to pull, as of " + ageLong
      : total + " Google Keep notes to pull, as of " + ageLong;
    const inbox = keepInboxInboxPart(opts);
    return keepInboxFinalizeView({
      visible: true,
      keep: {
        visible: true,
        tone: "stale",
        icon: "lightbulb",
        text: String(total),
        tooltip,
        aria,
      },
      connector: { visible: true },
      inbox: { visible: true, ...inbox },
      paintKey: "",
    });
  } catch (error) {
    return keepInboxHiddenView("hidden-error");
  }
}

function keepInboxSigninView(opts) {
  try {
    const tooltip = [
      "Google Keep sign-in expired",
      "Run bob gkeep login in a terminal",
      "Click for the Keep setup check",
    ].join("\n");
    const inbox = keepInboxInboxPart(opts);
    return keepInboxFinalizeView({
      visible: true,
      keep: {
        visible: true,
        tone: "signin",
        icon: "lightbulb-off",
        text: "",
        tooltip,
        aria: "Google Keep sign-in expired",
      },
      connector: { visible: true },
      inbox: { visible: true, ...inbox },
      paintKey: "",
    });
  } catch (error) {
    return keepInboxHiddenView("hidden-error");
  }
}

function keepInboxPaintKey(view) {
  try {
    if (!view || typeof view !== "object") {
      return "hidden";
    }
    if (!view.visible) {
      return "hidden";
    }
    const keep = view.keep || {};
    const inbox = view.inbox || {};
    const connector = view.connector || {};
    return [
      "1",
      keep.visible ? "1" : "0",
      keep.tone || "",
      keep.icon || "",
      keep.text || "",
      keep.tooltip || "",
      keep.aria || "",
      connector.visible ? "1" : "0",
      inbox.visible ? "1" : "0",
      inbox.tone || "",
      inbox.text || "",
      inbox.tooltip || "",
      inbox.aria || "",
    ].join("\0");
  } catch (error) {
    return "hidden-error";
  }
}
