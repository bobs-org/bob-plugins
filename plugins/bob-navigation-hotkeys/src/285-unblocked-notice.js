// Unblocked successor notice card (plan:202610/successor_offers.md §12.6,
// `nav_card`). Pure model plus the `bob-nh-notice is-unblock` fragment and
// the additive `api.notice` factory (v2 adds keep-moving rows, §12.15).
// Nothing here reads the vault; the cycler passes the shared snake_case
// notice model and this file renders it.
const UNBLOCKED_NOTICE_MAX_TEXT_LENGTH = 48;

const UNBLOCKED_NOTICE_NOT_LINKED_REASONS = Object.freeze({
  already_planned: "already planned",
  not_planned_today: "not planned today",
  breaker: "not linked · more than 5",
  not_selected: "not pulled in",
  no_destination: "no open Pomodoro",
  project_task: "project task",
  project_member: "project member",
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

// Keep-moving rows (§12.15) name the lane a pick lands in. `/` is Pending
// here (never "In Progress"), and the raw symbol is never shown.
const KEEP_MOVING_LANE_BY_SYMBOL = Object.freeze({
  " ": "Ready",
  "*": "Next",
  "/": "Pending",
  "?": "Blocked",
});

function keepMovingRowLane(row) {
  const symbol = row && row.status_symbol;
  if (typeof symbol === "string" && KEEP_MOVING_LANE_BY_SYMBOL[symbol]) {
    return KEEP_MOVING_LANE_BY_SYMBOL[symbol];
  }
  const named = unblockedNoticeText(row && row.status_name);
  return named === "In Progress" ? "Pending" : named;
}

// ‹N› for a keep-moving row: the offer's project note, else the row's own
// note (a keep-moving row is always a resident of N).
function keepMovingProjectName(row) {
  const offer = row && row.offer && typeof row.offer === "object" ? row.offer : null;
  return (
    unblockedShortNoteName(offer && offer.project) ||
    unblockedShortNoteName(row && row.note_path) ||
    "project"
  );
}

function keepMovingProjectNames(rows) {
  const names = [];
  for (const row of rows) {
    const name = row.keepMovingProject || "project";
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

// `keeps ‹N› moving` / `keeps 2 projects moving` (§12.15 copy table).
function keepMovingSuffix(rows) {
  const names = keepMovingProjectNames(rows);
  return names.length === 1
    ? `keeps ‹${names[0]}› moving`
    : `keeps ${names.length} projects moving`;
}

// `Keep ‹N› moving` / `Keep 2 projects moving`.
function keepMovingTitle(rows) {
  const names = keepMovingProjectNames(rows);
  return names.length === 1
    ? `Keep ‹${names[0]}› moving`
    : `Keep ${names.length} projects moving`;
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

function unblockedPullInSummary(model, linked, recovered) {
  const source = model && (model.pull_in || model.pullIn);
  const hasCurrentReasons = recovered.some((row) =>
    ["not_selected", "no_destination"].includes(row.notLinked),
  );
  if ((!source || typeof source !== "object") && !hasCurrentReasons) {
    return null;
  }
  const offersValue = source && (
    source.offer_count ?? source.offerCount ??
    (typeof source.offers === "number" ? source.offers : undefined) ??
    (Array.isArray(source.offers) ? source.offers.length : undefined)
  );
  const offerCount = Number.isFinite(Number(offersValue))
    ? Math.max(0, Math.floor(Number(offersValue)))
    : Math.max(linked.length, recovered.filter((row) => row.notLinked === "not_selected").length + linked.length);
  const pulledIn = linked.length;
  const notPulledIn = Math.max(
    recovered.filter((row) => row.notLinked === "not_selected").length,
    offerCount - pulledIn,
  );
  const noDestination = recovered.filter((row) => row.notLinked === "no_destination").length;
  const destinations = [];
  for (const row of linked) {
    const name = unblockedEntryDisplayName(row.entryName);
    if (name && !destinations.includes(name)) destinations.push(name);
  }
  return Object.freeze({
    offerCount,
    pulledIn,
    notPulledIn,
    noDestination,
    destinations: Object.freeze(destinations),
    current: Boolean((source && source.supported === true) || hasCurrentReasons),
  });
}

function unblockedEntryDisplayName(entryName) {
  const name = unblockedNoticeText(entryName);
  return name || "today";
}

// ⏭ forms for a notice whose rows are all keep-moving picks (§12.15 copy
// table). Never uses 🔓 or the word "unblocked".
function keepMovingFallbackText(linked) {
  const suffix = keepMovingSuffix(linked);
  if (linked.length === 1) {
    const row = linked[0];
    const name = unblockedEntryDisplayName(row.entryName);
    if (row.entryCreated) {
      const nextUp = row.nextUp ? " (next up)" : "";
      return `⏭ Next in new ${name} session${nextUp}: ${truncateUnblockedText(row.text)} · ${suffix}`;
    }
    return `⏭ Next in ${name}: ${truncateUnblockedText(row.text)} · ${suffix}`;
  }
  const names = [];
  for (const row of linked) {
    const name = unblockedEntryDisplayName(row.entryName);
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names.length === 1
    ? `⏭ ${linked.length} linked → ${names[0]} · ${suffix}`
    : `⏭ ${linked.length} linked · ${names.join(", ")} · ${suffix}`;
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
  if (summary.onlyKeepMoving && linked.length > 0) {
    return keepMovingFallbackText(linked);
  }
  if (summary.onlyRelation) {
    return relationNoticeFallbackText(
      summary.relationLinked,
      summary.relationHeld,
      summary.relationUncertainty,
    ) || "🪢";
  }
  if (summary.pullIn && summary.pullIn.current) {
    const destinationText = summary.pullIn.destinations.length > 0
      ? ` → ${summary.pullIn.destinations.join(", ")}`
      : "";
    const notPulled = summary.pullIn.notPulledIn > 0
      ? ` · ${summary.pullIn.notPulledIn} not pulled in`
      : "";
    const noDestination = summary.pullIn.noDestination > 0
      ? ` · ${summary.pullIn.noDestination} no open Pomodoro${summary.pullIn.noDestination === 1 ? "" : "s"}`
      : "";
    return `🔓 ${summary.pullIn.pulledIn} pulled in${notPulled}${noDestination}${destinationText}`;
  }
  if (summary.isBreaker) {
    return `🔓 ${summary.total} unblocked · not linked (more than 5)`;
  }
  if (linked.length === 1) {
    const row = linked[0];
    const name = unblockedEntryDisplayName(row.entryName);
    const projectEmpty = row.projectEmpty ? " · project has no open tasks" : "";
    if (row.entryCreated) {
      const nextUp = row.nextUp ? " (next up)" : "";
      return `🔓 Next in new ${name} session${nextUp}: ${truncateUnblockedText(row.text)}${projectEmpty}`;
    }
    return `🔓 Next in ${name}: ${truncateUnblockedText(row.text)}${projectEmpty}`;
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
      const projectEmpty = linked.every((row) => row.projectEmpty)
        ? " · project has no open tasks"
        : "";
      return `🔓 ${linked.length} linked → ${names[0]}: ${texts.join(", ")}${tail}${projectEmpty}`;
    }
    const projectEmpty = linked.every((row) => row.projectEmpty)
      ? " · project has no open tasks"
      : "";
    return `🔓 ${linked.length} linked · ${names.join(", ")}${projectEmpty}`;
  }
  if (recovered.length > 0) {
    const first = recovered[0];
    const lane = unblockedNoticeText(first.lane);
    const projectRows = recovered.filter((row) => row.projectEmpty);
    if (
      projectRows.length === 1 &&
      first.hideRemoved &&
      first.previousStatusSymbol === first.statusSymbol
    ) {
      return `🔓 Surfaced: ${truncateUnblockedText(first.text)}${lane ? ` (${lane})` : ""} · project has no open tasks`;
    }
    const projectEmpty = first.projectEmpty ? " · project has no open tasks" : "";
    return `🔓 Unblocked: ${truncateUnblockedText(first.text)}${lane ? ` (${lane})` : ""}${projectEmpty}`;
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
    const hasProjectStillBlocked = stillBlocked.some(
      (row) => unblockedNoticeText(row.trigger) === "project_empty",
    );
    // Keep-moving rows (notice v2, §12.15) arrive in their own array. Only
    // picked rows (with a `link`) are reported: an unpicked keep-moving offer
    // recovered nothing, so it stays silent.
    const keepMovingSource = unblockedNoticeList(model.keep_moving).filter(
      (row) => row && typeof row === "object" && row.link && typeof row.link === "object",
    );
    const relationSource = collectRelationNoticeRows(model);
    const relationHeldSource = collectRelationHeldRows(model);
    const relationUncertainty = relationNoticeUncertaintyLine(model);
    if (
      unblocked.length === 0 &&
      keepMovingSource.length === 0 &&
      relationSource.length === 0 &&
      relationHeldSource.length === 0 &&
      !relationUncertainty &&
      !hasFailure &&
      !hasProjectStillBlocked
    ) {
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
        trigger: unblockedNoticeText(row.trigger),
        projectEmpty: unblockedNoticeText(row.trigger) === "project_empty",
        previousStatusSymbol: unblockedNoticeText(row.previous_status_symbol),
        statusSymbol: unblockedNoticeText(row.status_symbol),
        hideRemoved: row.hide_removed === true,
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
    const keepMoving = keepMovingSource.map((row) => {
      const link = row.link;
      return Object.freeze({
        note_path: unblockedNoticeText(row.note_path),
        block_id: unblockedNoticeText(row.block_id),
        text: truncateUnblockedText(row.text),
        fullText: unblockedNoticeText(row.text),
        inbox: row.inbox === true,
        lane: keepMovingRowLane(row),
        trigger: "last_planned",
        projectEmpty: false,
        keepMoving: true,
        keepMovingProject: keepMovingProjectName(row),
        previousStatusSymbol: unblockedNoticeText(row.previous_status_symbol),
        statusSymbol: unblockedNoticeText(row.status_symbol),
        hideRemoved: false,
        entryName: unblockedNoticeText(link.entry_name),
        entryCreated: link.entry_created === true,
        nextUp: link.next_up === true,
        blockIdCreated: link.block_id_created === true,
        blockLink: unblockedNoticeText(link.block_link),
      });
    });

    const still = stillBlocked.map((row) => {
      const waitsOn = Math.max(
        0,
        Math.floor(numericOrDefault(row.waits_on, 0)),
      );
      const reason = unblockedNoticeText(row.reason);
      const scheduled = unblockedNoticeText(row.scheduled);
      const projectEmpty = unblockedNoticeText(row.trigger) === "project_empty";
      let reasonSuffix = "";
      if (["project", "project_dependency", "project_schedule"].includes(reason)) {
        reasonSuffix = scheduled
          ? `· project until ${formatUnblockedScheduledDate(scheduled)}`
          : "· blocked by project";
      } else if (reason === "scheduled" && scheduled) {
        reasonSuffix = `· waits until ${formatUnblockedScheduledDate(scheduled)}`;
      } else {
        reasonSuffix = `· waits on ${waitsOn} more`;
      }
      const suffix = `${projectEmpty ? "· no open tasks " : ""}${reasonSuffix}`;
      return Object.freeze({
        note_path: unblockedNoticeText(row.note_path),
        block_id: unblockedNoticeText(row.block_id),
        text: truncateUnblockedText(row.text),
        fullText: unblockedNoticeText(row.text),
        inbox: row.inbox === true,
        trigger: unblockedNoticeText(row.trigger),
        projectEmpty,
        suffix,
      });
    });

    const relationLinked = relationSource.map(mapRelationNoticeLinkedRow);
    const relationHeld = relationHeldSource.map((row) =>
      mapRelationHeldNoticeRow(row, formatUnblockedScheduledDate(row.scheduled)),
    );
    // Keep-moving and relation picks count as linked in every summary.
    const allLinked = [...linked, ...relationLinked, ...keepMoving];
    const onlyKeepMoving =
      keepMoving.length > 0 &&
      linked.length === 0 &&
      relationLinked.length === 0 &&
      recovered.length === 0 &&
      stillBlocked.length === 0;
    const onlyRelation =
      (relationLinked.length > 0 || relationHeld.length > 0 || Boolean(relationUncertainty)) &&
      keepMoving.length === 0 &&
      linked.length === 0 &&
      recovered.length === 0 &&
      stillBlocked.length === 0;
    const breakerCount = recovered.filter(
      (row) => row.notLinked === "breaker",
    ).length;
    const isBreaker =
      allLinked.length === 0 &&
      recovered.length > 0 &&
      breakerCount === recovered.length;

    const pullIn = unblockedPullInSummary(model, allLinked, recovered);

    const total = unblocked.length + still.length;
    // Relation picks count as linked; keep-moving rows render last (§12.15, §12.18).
    const ordered = Object.freeze([
      ...linked.map((row) => ({ kind: "linked", row })),
      ...relationLinked.map((row) => ({ kind: "linked", row })),
      ...recovered.map((row) => ({ kind: "recovered", row })),
      ...still.map((row) => ({ kind: "stillBlocked", row })),
      ...keepMoving.map((row) => ({ kind: "linked", row })),
    ]);
    const visibleRows = ordered.slice(0, 3);
    const moreCount = Math.max(0, ordered.length - visibleRows.length);

    let countPill = "";
    if (pullIn && pullIn.current && !onlyKeepMoving && !onlyRelation) {
      const destinationText = pullIn.destinations.length > 0
        ? ` → ${pullIn.destinations.join(", ")}`
        : "";
      const noDestination = pullIn.noDestination > 0
        ? ` · ${pullIn.noDestination} no open Pomodoro${pullIn.noDestination === 1 ? "" : "s"}`
        : "";
      countPill = `${pullIn.pulledIn} pulled in${pullIn.notPulledIn > 0 ? ` · ${pullIn.notPulledIn} not pulled in` : ""}${noDestination}${destinationText}`;
    } else if (isBreaker) {
      countPill = `${unblocked.length} · not linked`;
    } else if (allLinked.length > 0) {
      const names = [];
      for (const row of allLinked) {
        const name = unblockedEntryDisplayName(row.entryName);
        if (!names.includes(name)) {
          names.push(name);
        }
      }
      const created = allLinked.some((row) => row.entryCreated);
      if (names.length === 1) {
        countPill = created
          ? `${allLinked.length} → new ${names[0]} session`
          : `${allLinked.length} → ${names[0]}`;
      } else {
        countPill = `${allLinked.length} linked`;
      }
      if (allLinked.some((row) => row.nextUp)) {
        countPill += " · next up";
      }
    } else if (unblocked.length > 0) {
      countPill = `${unblocked.length}`;
    }

    const defaultReceipt = predecessors.length === 1
      ? `✓ ${truncateUnblockedText(predecessors[0].text)}`
      : predecessors.length > 1 ? `✓ ${predecessors.length} tasks` : "✓ done";
    const receipt = onlyRelation
      ? relationNoticeReceiptFromRows(relationLinked, relationHeld, predecessors) || defaultReceipt
      : defaultReceipt;

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
    const minted = allLinked.filter((row) => row.blockIdCreated);
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
    if (allLinked.length > 0) {
      chips.push(Object.freeze({ text: "Alt+N releases", tone: "muted" }));
    }

    const summary = {
      linked: allLinked,
      onlyKeepMoving,
      onlyRelation,
      relationLinked,
      relationHeld,
      relationUncertainty,
      recovered,
      predecessors,
      pullIn,
      failure: hasFailure ? failure : null,
      isBreaker,
      showLegacyBreaker: isBreaker && !(pullIn && pullIn.current),
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
      pullIn,
      keepMoving: Object.freeze(keepMoving),
      keepMovingOnly: onlyKeepMoving,
      relationLinked: Object.freeze(relationLinked),
      relationHeld: Object.freeze(relationHeld),
      relationOnly: onlyRelation,
      relationUncertainty,
      glyph: onlyRelation ? RELATION_COPY_GLYPH : onlyKeepMoving ? "⏭" : "🔓",
      showLegacyBreaker: isBreaker && !(pullIn && pullIn.current),
      failure: hasFailure ? Object.freeze(failure) : null,
      dailyPath,
      countPill,
      receipt,
      chips: Object.freeze(chips),
      text,
      title: onlyRelation
        ? relationNoticeTitleFromRows(relationLinked, relationHeld) || "Relation"
        : onlyKeepMoving
          ? keepMovingTitle(keepMoving)
          : ordered.length > 0 && ordered.every((entry) => entry.row.projectEmpty)
            ? "Project empty"
            : "Unblocked",
      durationMs,
    });
  } catch (error) {
    return null;
  }
}

async function openUnblockedRowTarget(app, row, dailyPath) {
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
    const targetFile =
      app.vault && typeof app.vault.getAbstractFileByPath === "function"
        ? app.vault.getAbstractFileByPath(notePath)
        : null;
    const leaf = workspace.activeLeaf || workspace.getLeaf(false);
    if (!targetFile || !leaf) {
      return false;
    }
    const sourcePath = unblockedNoticeText(dailyPath);
    return await openWithLeafSwitchGuard(app, targetFile, leaf, () =>
      workspace.openLinkText(linkText, sourcePath || ""),
    );
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
        return handler(event);
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
  const keepMovingOnly = model.keepMovingOnly === true;
  const relationOnly = model.relationOnly === true;
  const card = root.createDiv({
    cls: `bob-nh-notice is-unblock${keepMovingOnly ? " is-keep-moving" : ""}${relationOnly ? " is-relation" : ""}`,
    attr: { "aria-label": model.text },
  });
  const headerEl = card.createDiv({ cls: "bob-nh-notice-header" });
  const iconEl = headerEl.createSpan({ cls: "bob-nh-notice-icon" });
  iconEl.createSpan({
    cls: "bob-nh-notice-glyph",
    text: model.glyph || (keepMovingOnly ? "⏭" : "🔓"),
    attr: { "aria-hidden": "true" },
  });
  headerEl.createSpan({ cls: "bob-nh-notice-level", text: model.title || "Unblocked" });
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

  if (model.showLegacyBreaker === true || (model.showLegacyBreaker === undefined && model.isBreaker)) {
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
          cls: `bob-nh-unblock-row is-linked is-clickable${row.keepMoving ? " is-keep-moving" : ""}${row.relation ? " is-relation" : ""}`,
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
        if (row.projectEmpty) {
          rowEl.createSpan({
            cls: "bob-nh-notice-chip is-muted",
            text: "no open tasks",
          });
        }
        if (row.keepMoving && !keepMovingOnly) {
          rowEl.createSpan({
            cls: "bob-nh-notice-chip is-keep-moving",
            text: keepMovingSuffix([row]),
          });
        }
        if (row.relation && !relationOnly) {
          rowEl.createSpan({
            cls: "bob-nh-notice-chip is-relation",
            text: relationCopyChip(row.relationLabel, row.relationTarget),
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
        if (row.projectEmpty) {
          rowEl.createSpan({
            cls: "bob-nh-notice-chip is-muted",
            text: "no open tasks",
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

  const mutedRelation = relationOnly && model.relationHeld && model.relationHeld[0] &&
    !(model.visibleRows && model.visibleRows.length)
    ? model.relationHeld[0].notice : "";
  for (const text of [mutedRelation, model.relationUncertainty].filter(Boolean)) {
    card.createDiv({ cls: "bob-nh-notice-reason" }).createSpan({
      cls: "bob-nh-notice-reason-text",
      text,
    });
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

// Additive `api.notice` factory (v3: `keep_moving` plus `relation_successors`,
// §12.13/§12.18). Kept here (rather than inline in 480) so
// `480-review-jump-and-nav-api.js` stays under the 1000-line fragment limit.
// The api itself stays `version: 3`; this member carries its own version like
// `reviewWalk`. v1/v2 callers pass models without relation rows and render
// exactly as before.
function createNoticeApi(plugin) {
  const app =
    plugin && typeof plugin === "object" ? plugin.app : undefined;
  return Object.freeze({
    version: 3,
    showUnblocked: (model) => showUnblockedNotice(app, model),
  });
}
