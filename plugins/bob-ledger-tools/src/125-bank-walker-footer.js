// Bank walker-footer panel for family `b` (plan 202611/bank_walk_family_b.md,
// phase footer). One immutable snapshot drives the scope word, day arms,
// cursor-row money, and the honest account meter. Clicks run nav commands;
// this fragment never writes the vault and never spawns `bob`.

const BANK_WALKER_FOOTER_METER_RANK = Object.freeze({
  balanced: -1,
  untracked: 0,
  unverified: 1,
  stale: 2,
  gap: 3,
  delta: 4,
});

function bankWalkerFooterIsoDays(fromIso, toIso) {
  try {
    const from = String(fromIso || "");
    const to = String(toIso || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return null;
    }
    const start = Date.parse(from + "T00:00:00Z");
    const end = Date.parse(to + "T00:00:00Z");
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }
    return Math.round((end - start) / 86400000);
  } catch (error) {
    return null;
  }
}

function bankWalkerFooterAccountStatus(account, today) {
  const label = (account && (account.label || account.alias)) || "Account";
  const status = account && typeof account.status === "string"
    ? account.status
    : "unverified";
  let meter = status;
  let rank = BANK_WALKER_FOOTER_METER_RANK[status];
  if (!Number.isInteger(rank)) {
    rank = 1;
  }
  if (status === "balanced") {
    meter = "✓ balanced";
  } else if (status === "delta") {
    const cents = account && account.delta_cents;
    const amount = Number.isSafeInteger(cents) ? bankFormatCents(Math.abs(cents)) : null;
    meter = amount ? `Δ ${String(amount).replace(/^\+/, "")}` : "Δ";
  } else if (status === "gap") {
    meter = "gap";
  } else if (status === "stale") {
    const days = bankWalkerFooterIsoDays(account && account.balance_asof, today);
    meter = Number.isInteger(days) && days > 0 ? `stale ${days}d` : "stale";
  }
  return {
    status,
    meter,
    rank,
    line: `${label} ${meter}`,
  };
}

function bankWalkerFooterMeterFromReport(report, options = {}) {
  try {
    const current = Number.isInteger(options.currentGeneration)
      ? options.currentGeneration
      : 0;
    const resultGen = Number.isInteger(options.resultGeneration)
      ? options.resultGeneration
      : 0;
    if (resultGen < current) {
      return { text: "", state: "stale-generation", lines: [] };
    }
    const accounts = Array.isArray(report && report.accounts) ? report.accounts : [];
    const tracked = accounts.filter((account) => (
      account &&
      account.kind !== "cash" &&
      account.status !== "untracked"
    ));
    if (tracked.length === 0) {
      return { text: "", state: "empty", lines: [] };
    }
    const today = typeof (report && report.today) === "string"
      ? report.today
      : (typeof options.today === "string" ? options.today : "");
    const lines = [];
    let worst = null;
    let allBalanced = true;
    for (const account of tracked) {
      const info = bankWalkerFooterAccountStatus(account, today);
      lines.push(info.line);
      if (info.status !== "balanced") {
        allBalanced = false;
      }
      if (!worst || info.rank > worst.rank) {
        worst = info;
      }
    }
    if (!worst) {
      return { text: "", state: "empty", lines };
    }
    if (allBalanced) {
      return { text: "✓ balanced", state: "ok", lines };
    }
    return { text: worst.meter, state: worst.status, lines };
  } catch (error) {
    return { text: "", state: "error", lines: [] };
  }
}

function bankWalkerFooterArm(plan, direction, scope) {
  try {
    if (!plan || plan.kind !== "jump" || !plan.entry) {
      return null;
    }
    if (direction !== "prev" && direction !== "next") {
      return null;
    }
    const short = plan.entry.short || plan.entry.label || "";
    if (!short) {
      return null;
    }
    const wrapped = plan.wrapped === true;
    const name = wrapped ? `↻ ${short}` : short;
    const text = direction === "prev" ? `‹ ${name}` : `${name} ›`;
    const count = Number.isInteger(plan.dayTotal)
      ? plan.dayTotal
      : (Number.isInteger(plan.entry.dayTotal) ? plan.entry.dayTotal : null);
    const countBit = Number.isInteger(count)
      ? (scope === "waiting"
        ? `, ${count} waiting`
        : `, ${count} ${count === 1 ? "row" : "rows"}`)
      : "";
    const long = plan.entry.label || short;
    const ariaLabel = `${direction === "prev" ? "Previous" : "Next"} bank day: ${long}${countBit}`;
    return {
      direction,
      name,
      text,
      tooltip: ariaLabel,
      ariaLabel,
      enabled: true,
      createEligible: false,
      wrapped,
      date: plan.entry.date || null,
    };
  } catch (error) {
    return null;
  }
}

function bankWalkerFooterScopeWord(scope) {
  return scope === "waiting" ? "WAITING" : "ALL";
}

function bankWalkerFooterTooltip(snapshot, options, fields) {
  const waiting = fields.waiting;
  const rows = fields.rows;
  const waitingDays = Number.isInteger(snapshot.counts && snapshot.counts.waitingDays)
    ? snapshot.counts.waitingDays
    : (Array.isArray(snapshot.days) ? snapshot.days.length : 0);
  const lines = [];
  if (fields.empty) {
    lines.push("No bank rows yet — bob bank import adds them");
  } else if (fields.scope === "waiting") {
    lines.push(
      `WAITING — ${waiting} ${waiting === 1 ? "row waits" : "rows wait"} across ${waitingDays} ${waitingDays === 1 ? "day" : "days"}; ]b walks them oldest first, and every row once none wait`,
    );
  } else {
    lines.push(`ALL — nothing waits; ]b walks all ${rows} ${rows === 1 ? "row" : "rows"}`);
  }
  const entry = fields.entry;
  if (entry) {
    const amount = entry.amountText || "";
    const payee = entry.payee || "";
    const loc = entry.path && Number.isInteger(entry.line)
      ? `${entry.path}:${entry.line}`
      : "";
    const money = [amount, payee].filter(Boolean).join(" ");
    lines.push([money, loc].filter(Boolean).join(" · "));
  }
  if (fields.scope === "waiting" && Array.isArray(snapshot.days) && snapshot.days.length) {
    lines.push(
      snapshot.days.map((day) => `${day.label} ${day.count}`).join(" · "),
    );
  }
  const meterLines = fields.meter && Array.isArray(fields.meter.lines)
    ? fields.meter.lines
    : [];
  for (const line of meterLines) {
    if (line) {
      lines.push(line);
    }
  }
  lines.push("]] / [[ step · ]} / [{ jump days · Ctrl+Enter files a waiting row");
  return lines.filter(Boolean).join("\n");
}

function bankWalkerFooterView(snapshot, options = {}) {
  try {
    if (Number.isInteger(options.navVersion) && options.navVersion < 4) {
      return freshnessFooterHiddenView();
    }
    if (options.hidden === true) {
      return freshnessFooterHiddenView();
    }
    if (!snapshot || snapshot.available !== true) {
      return freshnessFooterHiddenView();
    }
    const counts = snapshot.counts && typeof snapshot.counts === "object"
      ? snapshot.counts
      : {};
    const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
    const waiting = Number.isInteger(counts.waiting) ? counts.waiting : 0;
    const rows = Number.isInteger(counts.rows)
      ? counts.rows
      : (waiting > 0 ? waiting : entries.length);
    const scope = snapshot.scope === "waiting" || snapshot.scope === "all"
      ? snapshot.scope
      : (waiting > 0 ? "waiting" : "all");
    const hue = typeof options.hue === "string" && options.hue
      ? options.hue
      : "magenta";
    const located = options.located && typeof options.located === "object"
      ? options.located
      : null;
    const onMember = Boolean(located && located.member && located.entry);
    const inBank = Boolean(located && located.inBank === true);
    const entry = onMember ? located.entry : null;
    const meter = options.meter && typeof options.meter === "object"
      ? options.meter
      : null;
    const meterText = meter && typeof meter.text === "string" ? meter.text : "";
    const empty = rows <= 0 && waiting <= 0 && entries.length === 0;
    const scopeWord = bankWalkerFooterScopeWord(scope);
    const arms = options.arms && typeof options.arms === "object"
      ? options.arms
      : {};
    const linkPrev = inBank && !empty ? (arms.prev || null) : null;
    const linkNext = inBank && !empty ? (arms.next || null) : null;

    let dueText = "";
    let contextText = "";
    let detailText = "";
    let detailCompactText = "";
    let hintText = "";
    let groups = [];
    let inflow = false;

    if (empty) {
      dueText = "No bank rows";
      hintText = "bob bank import";
    } else if (onMember && entry) {
      const total = scope === "waiting"
        ? waiting
        : (Number.isInteger(entry.total) ? entry.total : entries.length);
      const rank = Number.isInteger(entry.rank) ? entry.rank : null;
      dueText = rank !== null
        ? `${scopeWord} ${rank}/${total}`
        : `${scopeWord} ${total}`;
      const dayLabel = entry.label || "";
      const dayRank = Number.isInteger(entry.dayRank) ? entry.dayRank : null;
      const dayTotal = Number.isInteger(entry.dayTotal) ? entry.dayTotal : null;
      contextText = dayRank !== null && dayTotal !== null
        ? `${dayLabel} ${dayRank}/${dayTotal}`
        : dayLabel;
      const amount = entry.amountText || "";
      const payee = typeof entry.payee === "string" ? entry.payee : "";
      detailText = [amount, payee].filter(Boolean).join(" ");
      detailCompactText = amount;
      hintText = scope === "waiting" ? "Ctrl+Enter file" : "]} next day";
      inflow = entry.inflow === true || (Number.isSafeInteger(entry.cents) && entry.cents > 0);
    } else if (inBank) {
      const total = scope === "waiting" ? waiting : rows;
      dueText = `${scopeWord} ${total}`;
      const date = located && typeof located.date === "string" ? located.date : null;
      const day = date && Array.isArray(snapshot.days)
        ? snapshot.days.find((item) => item && item.date === date)
        : null;
      contextText = day && day.label
        ? day.label
        : (date ? (bankWalkLongDayLabel(date) || date) : "");
      hintText = scope === "waiting" ? "]] next waiting" : "]] next row";
    } else {
      const total = scope === "waiting" ? waiting : rows;
      dueText = `${scopeWord} ${total}`;
      const daily = options.dailyEntry && typeof options.dailyEntry.label === "string"
        ? options.dailyEntry.label
        : "";
      contextText = daily
        ? `]] ${daily}`
        : (scope === "waiting" ? "]] oldest" : "]] latest day");
      if (scope === "waiting" && Array.isArray(snapshot.days)) {
        groups = snapshot.days.map((day) => ({
          key: day.date,
          label: day.label,
          count: String(day.count),
        }));
      }
    }

    const groupsText = groups
      .map((group) => `${group.label} ${group.count}`)
      .join(" · ");
    const tooltip = bankWalkerFooterTooltip(snapshot, options, {
      scope,
      waiting,
      rows,
      empty,
      entry,
      meter,
    });
    return {
      visible: true,
      panel: "bank",
      mode: "bank",
      glyph: "$",
      hue,
      scope,
      generation: Number.isInteger(snapshot.generation) ? snapshot.generation : 0,
      walk: scope === "waiting" ? waiting : rows,
      commitments: 0,
      dueText,
      contextText,
      detailText,
      detailCompactText,
      hintText,
      groups,
      groupsText,
      meterText: empty ? "" : meterText,
      meterTone: empty ? "" : (meter && meter.state === "ok" ? "ok" : (meterText ? "warn" : "")),
      inflow,
      linkPrev,
      linkNext,
      tooltip,
      ariaLabel: freshnessFooterJoin([
        dueText,
        contextText,
        detailText,
        groupsText,
        meterText,
        hintText,
      ]),
      current: entry
        ? {
          key: entry.key || null,
          rank: entry.rank,
          total: entry.total,
          path: entry.path,
          line: entry.line,
        }
        : null,
      action: "jump",
      answer: null,
    };
  } catch (error) {
    return freshnessFooterHiddenView();
  }
}

function walkerFooterPushBankAttention(plugin, route, snapshot) {
  try {
    const api = plugin && typeof plugin.dependencyNavApi === "function"
      ? plugin.dependencyNavApi()
      : null;
    const walkMode = api && api.walkMode;
    if (
      !walkMode ||
      Number(walkMode.version) < 4 ||
      typeof walkMode.setAttention !== "function"
    ) {
      return;
    }
    if (!route || route.legacy || route.mode === "b") {
      walkMode.setAttention("b", null);
      return;
    }
    if (!snapshot || snapshot.available !== true) {
      walkMode.setAttention("b", null);
      return;
    }
    const waiting = snapshot.counts && Number.isInteger(snapshot.counts.waiting)
      ? snapshot.counts.waiting
      : 0;
    if (waiting <= 0) {
      walkMode.setAttention("b", null);
      return;
    }
    const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
    const oldest = entries.find((entry) => entry && entry.waiting) || entries[0];
    const oldestLabel = oldest && oldest.label ? oldest.label : "";
    const label = oldestLabel
      ? `Bank: ${waiting} waiting · oldest ${oldestLabel} — click to show`
      : `Bank: ${waiting} waiting — click to show`;
    walkMode.setAttention("b", { tier: "waiting", label });
  } catch (_error) {
    // A stale or throwing nav listener never blocks footer painting.
  }
}

function bankWalkerFooterCommandExists(plugin, commandId) {
  try {
    const commands = plugin && plugin.app && plugin.app.commands;
    if (commands && commands.commands && commands.commands[commandId]) {
      return true;
    }
    if (commands && typeof commands.findCommand === "function") {
      return Boolean(commands.findCommand(commandId));
    }
  } catch (error) {
    return false;
  }
  return false;
}

function bankWalkerFooterActivate(plugin, direction) {
  try {
    if (direction !== "prev" && direction !== "next") {
      return false;
    }
    const route = walkerFooterWalkMode(plugin);
    if (route.legacy || route.mode !== "b") {
      return false;
    }
    const commandId = direction === "prev"
      ? "bob-navigation-hotkeys:jump-to-prev-bank-day"
      : "bob-navigation-hotkeys:jump-to-next-bank-day";
    if (!bankWalkerFooterCommandExists(plugin, commandId)) {
      return false;
    }
    const commands = plugin.app && plugin.app.commands;
    if (!commands || typeof commands.executeCommandById !== "function") {
      return false;
    }
    commands.executeCommandById(commandId);
    return true;
  } catch (error) {
    return false;
  }
}

function bankWalkerFooterNavVersion(plugin) {
  try {
    const api = plugin && typeof plugin.dependencyNavApi === "function"
      ? plugin.dependencyNavApi()
      : null;
    const version = api && api.walkMode ? Number(api.walkMode.version) : 0;
    return Number.isFinite(version) ? version : 0;
  } catch (error) {
    return 0;
  }
}

function bankWalkerFooterCachedList(plugin) {
  try {
    if (typeof plugin.bankCacheGet !== "function") {
      return null;
    }
    const key = typeof bankCacheKey === "function"
      ? bankCacheKey(["bank", "list"])
      : null;
    if (!key) {
      return null;
    }
    const cached = plugin.bankCacheGet(key);
    if (!cached || !cached.report) {
      return null;
    }
    return cached;
  } catch (error) {
    return null;
  }
}

function bankWalkerFooterRequestList(plugin, generation) {
  try {
    if (
      plugin.bankWalkerFooterMeterWanted === generation &&
      plugin.bankWalkerFooterMeterPending
    ) {
      return;
    }
    if (typeof plugin.apiBankFetch !== "function") {
      return;
    }
    plugin.bankWalkerFooterMeterWanted = generation;
    plugin.bankWalkerFooterMeterPending = true;
    Promise.resolve(plugin.apiBankFetch({ command: "list" }))
      .then((result) => {
        if (plugin.bankWalkerFooterMeterWanted !== generation) {
          return;
        }
        plugin.bankWalkerFooterMeterPending = false;
        if (result && result.report) {
          const resultGen = Number.isInteger(result.generation)
            ? result.generation
            : generation;
          const heldGen = plugin.bankWalkerFooterMeterResult
            && Number.isInteger(plugin.bankWalkerFooterMeterResult.generation)
            ? plugin.bankWalkerFooterMeterResult.generation
            : 0;
          if (resultGen >= heldGen) {
            plugin.bankWalkerFooterMeterResult = {
              report: result.report,
              generation: resultGen,
            };
          }
        }
        try {
          const route = walkerFooterWalkMode(plugin);
          if (route.legacy || route.mode !== "b") {
            return;
          }
          if (typeof plugin.updateFreshnessStatusBar === "function") {
            plugin.updateFreshnessStatusBar();
          }
        } catch (error) {
          // A late fetch never throws into the data service.
        }
      })
      .catch(() => {
        if (plugin.bankWalkerFooterMeterWanted === generation) {
          plugin.bankWalkerFooterMeterPending = false;
        }
      });
  } catch (error) {
    plugin.bankWalkerFooterMeterPending = false;
  }
}

function bankWalkerFooterTakeMeter(plugin) {
  try {
    const current = plugin && Number.isInteger(plugin.bankVaultGeneration)
      ? plugin.bankVaultGeneration
      : 0;
    const held = plugin && plugin.bankWalkerFooterMeterResult;
    if (held && held.report && (held.generation || 0) >= current) {
      return bankWalkerFooterMeterFromReport(held.report, {
        currentGeneration: current,
        resultGeneration: held.generation || 0,
      });
    }
    const cached = bankWalkerFooterCachedList(plugin);
    if (cached && (cached.generation || 0) >= current) {
      return bankWalkerFooterMeterFromReport(cached.report, {
        currentGeneration: current,
        resultGeneration: cached.generation || 0,
      });
    }
    const stale = Boolean(
      (held && held.report && (held.generation || 0) < current) ||
      (cached && (cached.generation || 0) < current),
    );
    bankWalkerFooterRequestList(plugin, current);
    return {
      text: "",
      state: stale ? "stale-generation" : "pending",
      lines: [],
    };
  } catch (error) {
    return { text: "", state: "error", lines: [] };
  }
}

function bankWalkerFooterPaint(plugin, view, generation) {
  try {
    const el = plugin && plugin.freshnessStatusEl;
    if (!el) {
      return;
    }
    const paintKey = [
      "walker:b",
      generation,
      view && view.visible ? "1" : "0",
      view && view.dueText,
      view && view.contextText,
      view && view.detailText,
      view && view.hintText,
      view && view.groupsText,
      view && view.meterText,
      view && view.linkPrev && view.linkPrev.text,
      view && view.linkNext && view.linkNext.text,
      view && view.tooltip,
      view && view.hue,
      view && view.scope,
    ].join("\0");
    if (paintKey === plugin.freshnessFooterPaintKey && plugin.freshnessFooterParts) {
      return;
    }
    plugin.freshnessFooterLastView = view;
    plugin.freshnessFooterPaintKey = paintKey;
    plugin.freshnessFooterParts = freshnessFooterPaint(el, view);
  } catch (error) {
    // The status bar is best-effort and must never disrupt navigation.
  }
}

function bankWalkerFooterRequest(plugin) {
  try {
    if (typeof Platform !== "undefined" && Platform && Platform.isMobile === true) {
      bankWalkerFooterPaint(plugin, freshnessFooterHiddenView(), "mobile");
      return;
    }
    const navVersion = bankWalkerFooterNavVersion(plugin);
    if (!(navVersion >= 4)) {
      bankWalkerFooterPaint(plugin, freshnessFooterHiddenView(), "old-nav");
      return;
    }
    let snapshot = null;
    try {
      const api = typeof plugin.bankWalkApi === "function" ? plugin.bankWalkApi() : null;
      snapshot = api && typeof api.snapshot === "function" ? api.snapshot() : null;
    } catch (error) {
      snapshot = null;
    }
    if (!snapshot || snapshot.available !== true) {
      bankWalkerFooterPaint(
        plugin,
        freshnessFooterHiddenView(),
        snapshot && snapshot.reason ? snapshot.reason : "indexing",
      );
      return;
    }
    const cursor = typeof plugin.freshnessFooterCursor === "function"
      ? plugin.freshnessFooterCursor(false)
      : null;
    let located = null;
    let anchor = null;
    let prevPlan = null;
    let nextPlan = null;
    try {
      const api = plugin.bankWalkApi();
      located = typeof api.locate === "function"
        ? api.locate(snapshot, cursor)
        : bankWalkLocate(snapshot, cursor);
      anchor = typeof api.anchor === "function" ? api.anchor() : null;
      const plan = typeof api.plan === "function"
        ? (options) => api.plan(snapshot, options)
        : (options) => bankWalkPlan(snapshot, options);
      const planOpts = {
        dayJump: true,
        cursor: cursor && typeof cursor.path === "string"
          ? { path: cursor.path, line0: cursor.line0 }
          : null,
        anchor,
      };
      prevPlan = plan({ ...planOpts, direction: -1 });
      nextPlan = plan({ ...planOpts, direction: 1 });
    } catch (error) {
      located = located || null;
    }
    const inBank = Boolean(located && located.inBank === true);
    const arms = {
      prev: inBank ? bankWalkerFooterArm(prevPlan, "prev", snapshot.scope) : null,
      next: inBank ? bankWalkerFooterArm(nextPlan, "next", snapshot.scope) : null,
    };
    const meter = bankWalkerFooterTakeMeter(plugin);
    let hue = "magenta";
    try {
      if (typeof plugin.bankCardRootHue === "function") {
        hue = plugin.bankCardRootHue("bank.md") || "magenta";
      }
    } catch (error) {
      hue = "magenta";
    }
    let dailyEntry = null;
    try {
      const dailyDate = cursor ? bankWalkDailyDateFromPath(cursor.path) : null;
      if (dailyDate && !inBank && Array.isArray(snapshot.days)) {
        const day = snapshot.days.find((item) => item && item.date === dailyDate);
        if (day) {
          dailyEntry = { date: day.date, label: day.label };
        }
      }
    } catch (error) {
      dailyEntry = null;
    }
    const view = bankWalkerFooterView(snapshot, {
      located,
      arms,
      meter,
      hue,
      dailyEntry,
      navVersion,
    });
    bankWalkerFooterPaint(plugin, view, snapshot.generation);
  } catch (error) {
    try {
      bankWalkerFooterPaint(plugin, freshnessFooterHiddenView(), "error");
    } catch (ignored) {
      // The status bar never throws.
    }
  }
}
