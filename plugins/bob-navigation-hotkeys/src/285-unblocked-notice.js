// Unblocked successor notice card (plan:202610/successor_links.md §12.6,
// `nav_card`). Pure model plus the `bob-nh-notice is-unblock` fragment and
// the additive `api.notice` v1 factory. Nothing here reads the vault; the
// cycler passes the shared snake_case notice model and this file renders it.
const UNBLOCKED_NOTICE_MAX_TEXT_LENGTH = 48;

const UNBLOCKED_NOTICE_NOT_LINKED_REASONS = Object.freeze({
  already_planned: "already planned",
  not_planned_today: "not planned today",
  breaker: "not linked · more than 5",
  project_task: "project task",
  hidden: "hidden",
  disabled: "linking off",
  failed: "couldn't link",
  cancelled: "cancelled",
});

const UNBLOCKED_NOTICE_STATUS_NAMES = Object.freeze({
  " ": "Ready",
  "*": "Next",
  "/": "In Progress",
  "?": "Blocked",
});

const UNBLOCKED_NOTICE_MONTHS = Object.freeze([
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
]);

function truncateUnblockedText(text) {
  const source = String(text === null || text === undefined ? "" : text);
  if (source.length <= UNBLOCKED_NOTICE_MAX_TEXT_LENGTH) {
    return source;
  }
  return `${source.slice(0, UNBLOCKED_NOTICE_MAX_TEXT_LENGTH - 1).trimEnd()}…`;
}

function unblockedNoticeText(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function unblockedNoticeList(value) {
  return Array.isArray(value) ? value : [];
}

function unblockedRowLane(row) {
  const named = unblockedNoticeText(row && row.status_name);
  if (named) {
    return named;
  }
  const symbol = row && row.status_symbol;
  if (typeof symbol === "string" && UNBLOCKED_NOTICE_STATUS_NAMES[symbol]) {
    return UNBLOCKED_NOTICE_STATUS_NAMES[symbol];
  }
  return "";
}

// `2026-10-13` → `Oct 13`. Falls back to the raw text when it is not a
// plain ISO date, so a malformed fixture can never break the card.
function formatUnblockedScheduledDate(value) {
  const text = unblockedNoticeText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return text;
  }
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return text;
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return text;
  }
  return `${UNBLOCKED_NOTICE_MONTHS[month - 1]} ${day}`;
}

function unblockedNoticeReasonText(notLinked) {
  const key = unblockedNoticeText(notLinked);
  if (!key) {
    return "";
  }
  if (UNBLOCKED_NOTICE_NOT_LINKED_REASONS[key]) {
    return UNBLOCKED_NOTICE_NOT_LINKED_REASONS[key];
  }
  return key;
}

function unblockedPredecessorPath(row, predecessors) {
  if (row && Array.isArray(row.unblocked_by) && row.unblocked_by.length > 0) {
    const first = unblockedNoticeText(row.unblocked_by[0] && row.unblocked_by[0].note_path);
    if (first) {
      return first;
    }
  }
  if (Array.isArray(predecessors) && predecessors.length > 0) {
    return unblockedNoticeText(predecessors[0] && predecessors[0].note_path);
  }
  return "";
}

function unblockedShortNoteName(notePath) {
  const path = unblockedNoticeText(notePath);
  if (!path) {
    return "";
  }
  const base = path.split("/").pop();
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

function unblockedEntryDisplayName(entryName) {
  const name = unblockedNoticeText(entryName);
  return name || "today";
}

// Plain-text fallback and card aria-label. Follows the §12.6 notice-text
// table: one linked, several linked (one entry / several entries), created
// continuation, breaker, recovered-only, and partial failure.
function unblockedFallbackText(summary) {
  const linked = summary.linked || [];
  const recovered = summary.recovered || [];
  const predecessors = summary.predecessors || [];
  const predText =
    predecessors.length === 1
      ? truncateUnblockedText(predecessors[0].text || "")
      : predecessors.length > 1
        ? `${predecessors.length} tasks`
        : "task";
  if (summary.failure) {
    const count = summary.failure.count;
    const reason = unblockedNoticeText(summary.failure.reason);
    const noun = count === 1 ? "successor" : "successors";
    return `⚠ Closed ${predText} — couldn't link ${count} ${noun}${reason ? ` (${reason})` : ""}`;
  }
  if (summary.isBreaker) {
    return `🔓 ${summary.total} unblocked · not linked (more than 5)`;
  }
  if (linked.length === 1) {
    const row = linked[0];
    const name = unblockedEntryDisplayName(row.entryName);
    if (row.entryCreated) {
      const nextUp = row.nextUp ? " (next up)" : "";
      return `🔓 Next in new ${name} session${nextUp}: ${truncateUnblockedText(row.text)}`;
    }
    return `🔓 Next in ${name}: ${truncateUnblockedText(row.text)}`;
  }
  if (linked.length > 1) {
    const names = [];
    for (const row of linked) {
      const name = unblockedEntryDisplayName(row.entryName);
      if (!names.includes(name)) {
        names.push(name);
      }
    }
    if (names.length === 1) {
      const texts = linked
        .slice(0, 2)
        .map((row) => truncateUnblockedText(row.text));
      const tail = linked.length > 2 ? `, +${linked.length - 2}` : "";
      return `🔓 ${linked.length} linked → ${names[0]}: ${texts.join(", ")}${tail}`;
    }
    return `🔓 ${linked.length} linked · ${names.join(", ")}`;
  }
  if (recovered.length > 0) {
    const first = recovered[0];
    const lane = unblockedNoticeText(first.lane);
    return `🔓 Unblocked: ${truncateUnblockedText(first.text)}${lane ? ` (${lane})` : ""}`;
  }
  return "🔓 Unblocked";
}

// Validates and normalizes the shared §12.5 notice model. Returns a frozen
// view, or null when there is nothing to show (no unblocked rows and no
// failure). Never throws.
function buildUnblockedNoticeModel(model, options = {}) {
  try {
    if (!model || typeof model !== "object") {
      return null;
    }
    const predecessors = unblockedNoticeList(model.predecessors)
      .map((entry) => ({
        note_path: unblockedNoticeText(entry && entry.note_path),
        block_id: unblockedNoticeText(entry && entry.block_id),
        text: unblockedNoticeText(entry && entry.text),
      }))
      .filter((entry) => entry.text);
    const unblocked = unblockedNoticeList(model.unblocked).filter(
      (row) => row && typeof row === "object",
    );
    const stillBlocked = unblockedNoticeList(model.still_blocked).filter(
      (row) => row && typeof row === "object",
    );
    const failure =
      model.failure && typeof model.failure === "object"
        ? {
            count: Math.max(
              0,
              Math.floor(numericOrDefault(model.failure.count, 0)),
            ),
            reason: unblockedNoticeText(model.failure.reason),
          }
        : null;
    const hasFailure = failure !== null && failure.count > 0;
    if (unblocked.length === 0 && !hasFailure) {
      return null;
    }
    const dailyPath = unblockedNoticeText(model.daily_path);
    const dailyContent =
      typeof model.daily_content === "string" ? model.daily_content : null;

    const linked = [];
    const recovered = [];
    for (const row of unblocked) {
      const link =
        row.link && typeof row.link === "object" ? row.link : null;
      const base = {
        note_path: unblockedNoticeText(row.note_path),
        block_id: unblockedNoticeText(row.block_id),
        text: truncateUnblockedText(row.text),
        fullText: unblockedNoticeText(row.text),
        inbox: row.inbox === true,
        lane: unblockedRowLane(row),
      };
      if (link) {
        linked.push(
          Object.freeze({
            ...base,
            entryName: unblockedNoticeText(link.entry_name),
            entryCreated: link.entry_created === true,
            nextUp: link.next_up === true,
            blockIdCreated: link.block_id_created === true,
            blockLink: unblockedNoticeText(link.block_link),
          }),
        );
      } else {
        recovered.push(
          Object.freeze({
            ...base,
            notLinked: unblockedNoticeText(row.not_linked),
            reason: unblockedNoticeReasonText(row.not_linked),
          }),
        );
      }
    }
    const still = stillBlocked.map((row) => {
      const waitsOn = Math.max(
        0,
        Math.floor(numericOrDefault(row.waits_on, 0)),
      );
      const reason = unblockedNoticeText(row.reason);
      const scheduled = unblockedNoticeText(row.scheduled);
      const suffix =
        reason === "scheduled" && scheduled
          ? `· waits until ${formatUnblockedScheduledDate(scheduled)}`
          : `· waits on ${waitsOn} more`;
      return Object.freeze({
        note_path: unblockedNoticeText(row.note_path),
        block_id: unblockedNoticeText(row.block_id),
        text: truncateUnblockedText(row.text),
        fullText: unblockedNoticeText(row.text),
        inbox: row.inbox === true,
        suffix,
      });
    });

    const breakerCount = recovered.filter(
      (row) => row.notLinked === "breaker",
    ).length;
    const isBreaker =
      linked.length === 0 &&
      recovered.length > 0 &&
      breakerCount === recovered.length;

    const total = unblocked.length + still.length;
    const ordered = Object.freeze([
      ...linked.map((row) => ({ kind: "linked", row })),
      ...recovered.map((row) => ({ kind: "recovered", row })),
      ...still.map((row) => ({ kind: "stillBlocked", row })),
    ]);
    const visibleRows = ordered.slice(0, 3);
    const moreCount = Math.max(0, ordered.length - visibleRows.length);

    let countPill = "";
    if (isBreaker) {
      countPill = `${unblocked.length} · not linked`;
    } else if (linked.length > 0) {
      const names = [];
      for (const row of linked) {
        const name = unblockedEntryDisplayName(row.entryName);
        if (!names.includes(name)) {
          names.push(name);
        }
      }
      const created = linked.some((row) => row.entryCreated);
      if (names.length === 1) {
        countPill = created
          ? `${linked.length} → new ${names[0]} session`
          : `${linked.length} → ${names[0]}`;
      } else {
        countPill = `${linked.length} linked`;
      }
      if (linked.some((row) => row.nextUp)) {
        countPill += " · next up";
      }
    } else if (unblocked.length > 0) {
      countPill = `${unblocked.length}`;
    }

    const receipt =
      predecessors.length === 1
        ? `✓ ${truncateUnblockedText(predecessors[0].text)}`
        : predecessors.length > 1
          ? `✓ ${predecessors.length} tasks`
          : "✓ done";

    const app =
      options && typeof options === "object" ? options.app : undefined;
    let planChip = "";
    try {
      planChip =
        typeof dailyContent === "string"
          ? getCancelPlanBudgetChip(app, dailyContent)
          : "";
    } catch (error) {
      planChip = "";
    }
    const minted = linked.filter((row) => row.blockIdCreated);
    let addedChip = "";
    if (minted.length === 1 && minted[0].block_id) {
      addedChip = `added ^${minted[0].block_id}`;
    } else if (minted.length > 1) {
      addedChip = `added ${minted.length} block IDs`;
    }
    const chips = [];
    if (planChip) {
      chips.push(Object.freeze({ text: planChip, tone: "info" }));
    }
    if (addedChip) {
      chips.push(Object.freeze({ text: addedChip, tone: "ok" }));
    }
    if (linked.length > 0) {
      chips.push(Object.freeze({ text: "Alt+N releases", tone: "muted" }));
    }

    const summary = {
      linked,
      recovered,
      predecessors,
      failure: hasFailure ? failure : null,
      isBreaker,
      total: unblocked.length,
    };
    const text = unblockedFallbackText(summary);
    const durationMs = Math.min(
      10000,
      6000 + 1000 * Math.max(0, Math.min(3, ordered.length) - 1),
    );
    return Object.freeze({
      predecessors: Object.freeze(predecessors),
      linked: Object.freeze(linked),
      recovered: Object.freeze(recovered),
      stillBlocked: Object.freeze(still),
      rows: ordered,
      visibleRows: Object.freeze(visibleRows),
      moreCount,
      isBreaker,
      failure: hasFailure ? Object.freeze(failure) : null,
      dailyPath,
      countPill,
      receipt,
      chips: Object.freeze(chips),
      text,
      durationMs,
    });
  } catch (error) {
    return null;
  }
}

function openUnblockedRowTarget(app, row, dailyPath) {
  try {
    const workspace = app && app.workspace;
    if (!workspace || typeof workspace.openLinkText !== "function") {
      return false;
    }
    const notePath = unblockedNoticeText(row && row.note_path);
    if (!notePath) {
      return false;
    }
    const blockId = unblockedNoticeText(row && row.block_id);
    const linkText = blockId ? `${notePath}#^${blockId}` : notePath;
    const sourcePath = unblockedNoticeText(dailyPath);
    if (sourcePath) {
      workspace.openLinkText(linkText, sourcePath);
    } else {
      workspace.openLinkText(linkText, "");
    }
    return true;
  } catch (error) {
    return false;
  }
}

function attachUnblockedRowClick(rowEl, handler) {
  try {
    if (!rowEl || typeof handler !== "function") {
      return;
    }
    rowEl.unblockedClick = handler;
    if (typeof rowEl.addEventListener === "function") {
      rowEl.addEventListener("click", (event) => {
        try {
          if (
            event &&
            typeof event.stopPropagation === "function"
          ) {
            event.stopPropagation();
          }
        } catch (error) {
          // A click must never fail on propagation.
        }
        handler(event);
      });
    }
  } catch (error) {
    // Click wiring never breaks rendering.
  }
}

function renderUnblockedNoticeFragment(view, root, options = {}) {
  const settings =
    options && typeof options === "object" ? options : {};
  let model = view;
  if (
    model &&
    typeof model === "object" &&
    !Array.isArray(model.rows) &&
    Array.isArray(model.unblocked)
  ) {
    model = buildUnblockedNoticeModel(model, settings);
  }
  if (!model || typeof model !== "object" || !Array.isArray(model.rows)) {
    return null;
  }
  const app = settings.app;
  const card = root.createDiv({
    cls: "bob-nh-notice is-unblock",
    attr: { "aria-label": model.text },
  });
  const headerEl = card.createDiv({ cls: "bob-nh-notice-header" });
  const iconEl = headerEl.createSpan({ cls: "bob-nh-notice-icon" });
  iconEl.createSpan({
    cls: "bob-nh-notice-glyph",
    text: "🔓",
    attr: { "aria-hidden": "true" },
  });
  headerEl.createSpan({ cls: "bob-nh-notice-level", text: "Unblocked" });
  if (model.countPill) {
    headerEl.createSpan({
      cls: "bob-nh-notice-count",
      text: model.countPill,
    });
  }
  headerEl.createSpan({
    cls: "bob-nh-notice-receipt",
    text: model.receipt,
  });

  if (model.isBreaker) {
    const reasonEl = card.createDiv({ cls: "bob-nh-notice-reason" });
    reasonEl.createSpan({
      cls: "bob-nh-notice-reason-text",
      text: "More than 5 at once — link the ones you want with Ctrl+Shift+Enter",
    });
  }

  if (Array.isArray(model.visibleRows) && model.visibleRows.length > 0) {
    const rowsEl = card.createDiv({ cls: "bob-nh-unblock-rows" });
    for (const entry of model.visibleRows) {
      const kind = entry && entry.kind;
      const row = entry && entry.row;
      if (!row) {
        continue;
      }
      if (kind === "linked") {
        const rowEl = rowsEl.createDiv({
          cls: "bob-nh-unblock-row is-linked is-clickable",
        });
        rowEl.createSpan({
          cls: "bob-nh-unblock-glyph",
          text: "＋",
          attr: { "aria-hidden": "true" },
        });
        rowEl.createSpan({
          cls: "bob-nh-unblock-text",
          text: row.text,
        });
        if (row.lane) {
          rowEl.createSpan({
            cls: "bob-nh-notice-chip is-ok",
            text: row.lane,
          });
        }
        const extra = [];
        const firstPred = unblockedPredecessorPath(
          { note_path: row.note_path, unblocked_by: [] },
          model.predecessors,
        );
        if (row.note_path && firstPred && row.note_path !== firstPred) {
          extra.push(`↗ ${unblockedShortNoteName(row.note_path)}`);
        }
        if (row.inbox) {
          extra.push("inbox");
        }
        if (row.entryCreated || row.nextUp) {
          const name = unblockedEntryDisplayName(row.entryName);
          extra.push(
            row.entryCreated
              ? `→ new ${name}${row.nextUp ? " · next up" : ""}`
              : `→ ${name}${row.nextUp ? " · next up" : ""}`,
          );
        }
        for (const chip of extra) {
          rowEl.createSpan({
            cls: "bob-nh-notice-chip is-muted",
            text: chip,
          });
        }
        const target = { note_path: row.note_path, block_id: row.block_id };
        const dailyPath = model.dailyPath;
        attachUnblockedRowClick(rowEl, () =>
          openUnblockedRowTarget(app, target, dailyPath),
        );
      } else if (kind === "recovered") {
        const rowEl = rowsEl.createDiv({
          cls: "bob-nh-unblock-row is-muted is-clickable",
        });
        rowEl.createSpan({
          cls: "bob-nh-unblock-glyph",
          text: "🔓",
          attr: { "aria-hidden": "true" },
        });
        rowEl.createSpan({
          cls: "bob-nh-unblock-text",
          text: row.text,
        });
        if (row.lane) {
          rowEl.createSpan({
            cls: "bob-nh-notice-chip is-muted",
            text: row.lane,
          });
        }
        if (row.reason) {
          rowEl.createSpan({
            cls: "bob-nh-notice-chip is-muted",
            text: row.reason,
          });
        }
        if (row.inbox) {
          rowEl.createSpan({
            cls: "bob-nh-notice-chip is-muted",
            text: "inbox",
          });
        }
        const target = { note_path: row.note_path, block_id: row.block_id };
        const dailyPath = model.dailyPath;
        attachUnblockedRowClick(rowEl, () =>
          openUnblockedRowTarget(app, target, dailyPath),
        );
      } else {
        const rowEl = rowsEl.createDiv({
          cls: "bob-nh-unblock-row is-muted",
        });
        rowEl.createSpan({
          cls: "bob-nh-unblock-glyph",
          text: "🔒",
          attr: { "aria-hidden": "true" },
        });
        rowEl.createSpan({
          cls: "bob-nh-unblock-text",
          text: row.text,
        });
        rowEl.createSpan({
          cls: "bob-nh-unblock-suffix",
          text: row.suffix,
        });
      }
    }
    if (model.moreCount > 0) {
      rowsEl.createDiv({
        cls: "bob-nh-unblock-more",
        text: `+${model.moreCount} more`,
      });
    }
  }

  if (model.failure) {
    const failureEl = card.createDiv({ cls: "bob-nh-notice-reason" });
    const count = model.failure.count;
    const noun = count === 1 ? "successor" : "successors";
    const reason = model.failure.reason
      ? ` (${model.failure.reason})`
      : "";
    failureEl.createSpan({
      cls: "bob-nh-notice-reason-text",
      text: `⚠ Couldn't link ${count} ${noun}${reason}`,
    });
  }

  if (Array.isArray(model.chips) && model.chips.length > 0) {
    const chipsEl = card.createDiv({ cls: "bob-nh-notice-chips" });
    for (const chip of model.chips) {
      chipsEl.createSpan({
        cls: `bob-nh-notice-chip is-${chip.tone}`,
        text: chip.text,
      });
    }
  }

  return card;
}

function showUnblockedNotice(app, model, options = {}) {
  const settings =
    options && typeof options === "object" ? options : {};
  const view = buildUnblockedNoticeModel(model, { app });
  if (!view) {
    return false;
  }
  const fallbackText =
    typeof view.text === "string" ? view.text : "🔓 Unblocked";
  const noticeOptions = { ...settings, app, duration: view.durationMs };
  try {
    if (typeof document === "undefined") {
      showBulletPropertyNotice(fallbackText, noticeOptions);
      return true;
    }
    const fragment = document.createDocumentFragment();
    if (!fragment || typeof fragment.createDiv !== "function") {
      showBulletPropertyNotice(fallbackText, noticeOptions);
      return true;
    }
    const card = renderUnblockedNoticeFragment(view, fragment, { app });
    if (!card) {
      showBulletPropertyNotice(fallbackText, noticeOptions);
      return true;
    }
    showBulletPropertyNotice(fragment, noticeOptions);
    return true;
  } catch (error) {
    try {
      showBulletPropertyNotice(fallbackText, noticeOptions);
      return true;
    } catch (fallbackError) {
      return false;
    }
  }
}

// Additive `api.notice` v1 factory. Kept here (rather than inline in 480)
// so `480-review-jump-and-nav-api.js` stays under the 1000-line fragment
// limit. The api itself stays `version: 3`; this member carries its own
// version like `reviewWalk`.
function createNoticeApi(plugin) {
  const app =
    plugin && typeof plugin === "object" ? plugin.app : undefined;
  return Object.freeze({
    version: 1,
    showUnblocked: (model) => showUnblockedNotice(app, model),
  });
}
