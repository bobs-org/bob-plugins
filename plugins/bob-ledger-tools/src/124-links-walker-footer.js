// Read-only destination compass for the `n` bracket walk. Preview requests
// are generation-checked against the selected family, active file, and live
// editor document before they paint. Direction activation re-reads the same
// nav preview and then delegates to nav's existing [n / ]n commands.
const LINKS_WALKER_FOOTER_API_VERSION = 2;

function linksWalkerFooterStripNavGlyphs(text) {
  return String(text || "")
    .replace(/^(?:«|»|<<|>>)\s*/, "")
    .replace(/\s*(?:«|»|<<|>>)$/, "")
    .replace(/^[‹<>›]\s*/, "")
    .replace(/\s*[‹<>›]$/, "")
    .trim();
}

function linksWalkerFooterLabel(link, direction) {
  const text = String(link && link.text ? link.text : "").trim();
  const targetPath = String(link && link.path ? link.path : "");
  const pathStem = targetPath.split("/").pop().replace(/\.md$/i, "");
  const target = String(link && link.target ? link.target : "");
  const targetStem = target.split("#")[0].split("^")[0].split("/").pop().replace(/\.md$/i, "");
  const stem = pathStem || targetStem;
  const stripped = linksWalkerFooterStripNavGlyphs(text);
  if (stripped !== "prev" && stripped !== "next" && text !== "prev" && text !== "next") {
    return stripped || stem || (direction === "prev" ? "previous" : "next");
  }

  const daily = /^(\d{4})(\d{2})(\d{2})$/.exec(stem);
  if (daily) {
    const year = Number(daily[1]);
    const month = Number(daily[2]);
    const day = Number(daily[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      try {
        return new Intl.DateTimeFormat("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }).format(date).replace(",", "");
      } catch (error) {
        return `${daily[1]}-${daily[2]}-${daily[3]}`;
      }
    }
  }
  return stem || (direction === "prev" ? "previous" : "next");
}

function linksWalkerFooterPathContext(path) {
  const value = String(path || "");
  const slash = value.lastIndexOf("/");
  return slash < 0 ? "" : value.slice(0, slash);
}

function linksWalkerFooterPathTooltip(link) {
  if (!link || !link.path) {
    return "Target cannot be opened or created";
  }
  const target = String(link.target || "");
  const hash = target.indexOf("#");
  const subpath = hash >= 0 ? target.slice(hash) : "";
  return `${link.exists ? "Open" : "Create"}: ${link.path}${subpath}`;
}

function linksWalkerFooterIsAlbumType(value) {
  if (Array.isArray(value)) {
    return value.some(linksWalkerFooterIsAlbumType);
  }
  return typeof value === "string" && value.trim() === "[[album]]";
}

function linksWalkerFooterAlbumRecord(plugin, link) {
  const match = /^([^/]+)\/([^/]+\.md)$/i.exec(String(link && link.path || ""));
  if (!match) {
    return link;
  }
  try {
    const albumFile = plugin.app.vault.getAbstractFileByPath(`${match[1]}.md`);
    if (!albumFile || albumFile.extension !== "md") {
      return link;
    }
    const frontmatter = plugin.app.metadataCache.getFileCache(albumFile)?.frontmatter;
    if (!frontmatter || !linksWalkerFooterIsAlbumType(frontmatter.type)) {
      return link;
    }
    // The album card's title rule: title:, then H1, then alias, then stem.
    const title = String(typeof notebookHeaderNoteTitle === "function"
      ? notebookHeaderNoteTitle(albumFile.path, plugin.app.metadataCache, plugin.app.vault) || match[1]
      : frontmatter.title || match[1]);
    return {
      ...link,
      albumRecord: true,
      albumTitle: title.charAt(0).toUpperCase() + title.slice(1),
    };
  } catch (error) {
    return link;
  }
}

function linksWalkerFooterAlbumRecords(plugin, preview) {
  if (!preview || preview.ok !== true) {
    return preview;
  }
  return {
    ...preview,
    prev: linksWalkerFooterAlbumRecord(plugin, preview.prev),
    next: linksWalkerFooterAlbumRecord(plugin, preview.next),
  };
}

function linksWalkerFooterRecordWalk(walk) {
  if (!walk || !walk.album) return { dueText: "Links", tooltip: "", ariaLabel: "" };
  const albumName = [walk.album.emoji, walk.album.title].filter(Boolean).join(" ");
  const recordName = String(walk.title || walk.stem || "This record");
  if (walk.state === "ok" && Number.isInteger(walk.position) && Number.isInteger(walk.total)) {
    const field = String(walk.walkBy || (walk.group && walk.group.field) || "").trim();
    const order = field
      ? `by ${field}, then title · wraps around`
      : "alphabetical, wraps around";
    return {
      dueText: `Links ${walk.position}/${walk.total}`,
      tooltip: `${recordName} is ${walk.position} of ${walk.total} in ${albumName} · ${order}`,
      ariaLabel: `Links ${walk.position} of ${walk.total}`,
    };
  }
  if (walk.state === "syncing") {
    return {
      dueText: "Links ⟳",
      tooltip: `Record walk is syncing for ${recordName} in ${albumName}`,
      ariaLabel: "Links, record walk is syncing",
    };
  }
  return { dueText: "Links", tooltip: "", ariaLabel: "" };
}

function linksWalkerFooterSubscribeAlbum(plugin) {
  if (!plugin || typeof plugin.apiAlbumSubscribe !== "function") return () => {};
  try {
    const unsubscribe = plugin.apiAlbumSubscribe((state) => {
      if (typeof recordWalkClearSyncedEpisodes === "function") {
        recordWalkClearSyncedEpisodes(plugin, state);
      }
      linksWalkerFooterInvalidate(plugin);
      const route = walkerFooterWalkMode(plugin);
      if (!route.legacy && route.mode === "n") linksWalkerFooterRequest(plugin);
      else plugin.scheduleFreshnessStatusBar?.();
    });
    return typeof unsubscribe === "function" ? unsubscribe : () => {};
  } catch (_) {
    return () => {};
  }
}

function linksWalkerFooterArm(link, direction) {
  if (!link) {
    return null;
  }
  const name = linksWalkerFooterLabel(link, direction);
  const exists = link.exists === true;
  const albumRecord = link.albumRecord === true;
  const createEligible = link.exists === false && Boolean(link.path) && !albumRecord;
  const arrow = direction === "prev" ? "‹" : "›";
  const text = direction === "prev"
    ? `${arrow} ${name}${createEligible ? "+" : ""}`
    : `${name}${createEligible ? "+" : ""} ${arrow}`;
  const tooltip = albumRecord && !exists
    ? `Not there yet — the ${link.albumTitle || "album"} walk is syncing\n${link.path}`
    : createEligible
    ? `No ${name} note yet — ${direction === "prev" ? "[[" : "]]"} creates it\n${linksWalkerFooterPathTooltip(link)}`
    : linksWalkerFooterPathTooltip(link);
  return {
    direction,
    name,
    text,
    tooltip,
    enabled: exists || createEligible,
    createEligible,
    albumRecord,
    path: link.path || null,
    target: link.target || "",
    exists,
    sourceText: link.text || "",
  };
}

function linksWalkerFooterGroupName(link) {
  const short = linksWalkerFooterStripNavGlyphs(link && link.shortLabel);
  if (short) return short;
  const group = linksWalkerFooterStripNavGlyphs(link && link.groupLabel);
  if (group) return group;
  return linksWalkerFooterLabel(link, "next");
}

function linksWalkerFooterGroupLanding(link) {
  return linksWalkerFooterStripNavGlyphs(link && link.landingLabel);
}

function linksWalkerFooterGroupArm(link, direction) {
  if (!link) {
    return null;
  }
  const name = linksWalkerFooterGroupName(link);
  const exists = link.exists === true || link.state === "exists";
  const createEligible = !exists && (
    link.state === "creatable" || link.createEligible === true
  );
  const ghost = !exists && !createEligible;
  const wraps = link.wraps === true;
  const plus = createEligible ? "+" : "";
  // The footer paints the kit's skip mark beside the label (before a prev
  // label; after a next one, then ↺), so the text carries no « / ».
  const wrapText = wraps && direction === "next" ? " ↺" : "";
  const compactLabel = `${name}${plus}`;
  const groupLabel = linksWalkerFooterStripNavGlyphs(link && link.groupLabel);
  const label = groupLabel && groupLabel !== name ? `${groupLabel}${plus}` : compactLabel;
  const compactText = `${compactLabel}${wrapText}`;
  const text = `${label}${wrapText}`;
  const landing = linksWalkerFooterGroupLanding(link);
  const tooltip = ghost
    ? (link.ghostReason || `${name} is not in the vault`)
    : createEligible
    ? `${name} isn't created yet — ${direction === "prev" ? "[N" : "]N"} creates it\n${linksWalkerFooterPathTooltip(link)}`
    : landing && landing !== name
    ? `${linksWalkerFooterPathTooltip(link)}\n${landing}`
    : linksWalkerFooterPathTooltip(link);
  const ariaLabel = ghost
    ? `Previous group: ${name}, not in vault`.replace(/^Previous/, direction === "next" ? "Next" : "Previous")
    : createEligible
    ? `${direction === "prev" ? "Previous" : "Next"} group: ${name}, not created yet — activating creates it`
    : `${direction === "prev" ? "Open previous" : "Open next"} group: ${name}`;
  return {
    direction,
    group: true,
    name,
    groupLabel: groupLabel || name,
    label,
    compactLabel,
    wrapText,
    text,
    compactText,
    tooltip,
    ariaLabel,
    enabled: exists || createEligible || ghost,
    createEligible,
    ghost,
    wraps,
    path: link.path || null,
    target: link.target || "",
    exists,
    state: createEligible ? "creatable" : exists ? "exists" : "ghost",
    sourceText: link.text || "",
  };
}

function linksWalkerFooterHintNoun(group, groupNone) {
  const reason = groupNone && groupNone.reason;
  if (reason === "year" || reason === "all") {
    return null;
  }
  const noun = group && typeof group.noun === "string" ? group.noun.trim() : "";
  if (noun === "day") return "week";
  if (noun === "week") return "quarter";
  if (noun === "quarter") return "year";
  if (noun) return noun;
  return "group";
}

// `W47 6/7`; a one-member group is just its label (no `1/1`).
function linksWalkerFooterContextText(group) {
  if (!group || !Number.isInteger(group.position) || !Number.isInteger(group.size) || group.size <= 0) {
    return "";
  }
  const label = String(group.label || group.shortLabel || "").trim();
  if (!label) {
    return "";
  }
  return group.size === 1 ? label : `${label} ${group.position}/${group.size}`;
}

// True when a painted group arm already names the group a boundary hint
// would announce.
function linksWalkerFooterArmNames(arm, groupName) {
  const wanted = linksWalkerFooterStripNavGlyphs(groupName);
  return Boolean(arm && wanted && (arm.name === wanted || arm.groupLabel === wanted));
}

function linksWalkerFooterStatusView(linkState, statusText, tooltip, ariaLabel) {
  return {
    visible: true,
    mode: "links",
    panel: "links",
    glyph: "⇄",
    dueText: "Links",
    contextText: "",
    linkState,
    linkStatusText: statusText,
    linkPrev: null,
    linkNext: null,
    linkGroupPrev: null,
    linkGroupNext: null,
    detailText: "",
    hintText: "",
    groups: [],
    groupsText: "",
    meterText: "",
    tooltip,
    ariaLabel,
  };
}

function linksWalkerFooterView(preview, options = {}) {
  try {
    const walkDue = linksWalkerFooterRecordWalk(preview && preview.recordWalk);
    if (options.state === "open-note") {
      return linksWalkerFooterStatusView(
        "open-note",
        "open a note",
        "⇄ Links · open a Markdown note to preview its prev / next links",
        "Links · open a note",
      );
    }
    if (options.state === "unavailable" || !preview || preview.ok !== true) {
      return linksWalkerFooterStatusView(
        "unavailable",
        "links unavailable",
        "⇄ Links · update Bob Navigation Hotkeys to preview destinations",
        "Links · links unavailable",
      );
    }

    let prev = linksWalkerFooterArm(preview.prev, "prev");
    let next = linksWalkerFooterArm(preview.next, "next");
    const groupPrev = linksWalkerFooterGroupArm(preview.prevGroup, "prev");
    const groupNext = linksWalkerFooterGroupArm(preview.nextGroup, "next");
    const group = preview.group && typeof preview.group === "object" ? preview.group : null;
    const groupNone = preview.groupNone && typeof preview.groupNone === "object"
      ? preview.groupNone
      : null;
    if (!prev && !next && !groupPrev && !groupNext && walkDue.dueText === "Links") {
      const emptyTooltip = groupNone && groupNone.message
        ? `⇄ Links · ${groupNone.message}`
        : "⇄ Links · no ‹ / › links in this note";
      return {
        ...linksWalkerFooterStatusView(
          "empty",
          "no ‹ / › links in this note",
          emptyTooltip,
          "Links · no previous or next links in this note",
        ),
      };
    }

    if (prev && next && prev.name === next.name && prev.path !== next.path) {
      const prevContext = linksWalkerFooterPathContext(prev.path);
      const nextContext = linksWalkerFooterPathContext(next.path);
      if (prevContext) {
        prev = { ...prev, text: `‹ ${prevContext}/${prev.name}${prev.createEligible ? "+" : ""}` };
      }
      if (nextContext) {
        next = { ...next, text: `${nextContext}/${next.name}${next.createEligible ? "+" : ""} ›` };
      }
    }

    const hasSteps = Boolean(prev || next);
    const hasGroups = Boolean(groupPrev || groupNext);
    const linkState = hasSteps && prev && next
      ? "both"
      : hasSteps && prev
      ? "prev-only"
      : hasSteps && next
      ? "next-only"
      : hasGroups
      ? "group-only"
      : "empty";
    let statusText = prev && !next ? "no next" : !prev && next ? "no prev" : "";
    if (preview.groupConflict === "prev" || preview.groupConflict === "next") {
      const glyph = preview.groupConflict === "prev" ? "«" : "»";
      statusText = statusText
        ? `${statusText} · Two ${glyph} links on nav lines — keep one`
        : `Two ${glyph} links on nav lines — keep one`;
    }
    const contextText = linksWalkerFooterContextText(group);
    const hintNoun = (hasGroups || group)
      ? linksWalkerFooterHintNoun(group, groupNone)
      : null;
    let hintText = hintNoun ? `]} next ${hintNoun}` : "";
    let boundaryHint = "";
    // When the next group arm already names the group `]n` enters, the
    // boundary hint leaves the bar for the tooltip; the footer fit brings
    // it back only if that arm is shed.
    let boundaryHintText = "";
    if (group && group.atEnd === true && group.enteringNext) {
      boundaryHint = (groupNext && groupNext.wraps)
        ? `]n wraps to ${group.enteringNext}`
        : `]n enters ${group.enteringNext}`;
      if (linksWalkerFooterArmNames(groupNext, group.enteringNext)) boundaryHintText = boundaryHint;
      else hintText = boundaryHint;
    }
    let startHint = "";
    if (group && group.atStart === true && group.enteringPrev) {
      startHint = (groupPrev && groupPrev.wraps)
        ? `[n wraps to ${group.enteringPrev}`
        : `[n enters ${group.enteringPrev}`;
    }
    const arms = [groupPrev, prev, next, groupNext].filter(Boolean);
    const summary = arms.map((arm) => arm.text).join(" · ");
    const noneMessage = groupNone && groupNone.message ? groupNone.message : "";
    const extraTips = [statusText, boundaryHintText, startHint, noneMessage].filter(Boolean);
    const armsTooltip = arms
      .map((arm) => `${arm.text}\n${arm.tooltip}`)
      .concat(extraTips)
      .join("\n");
    const tooltip = walkDue.tooltip
      ? `⇄ Links · ${walkDue.tooltip}${armsTooltip ? `\n${armsTooltip}` : ""}`
      : `⇄ Links · ${[summary, hintText, statusText, noneMessage].filter(Boolean).join(" · ")}${armsTooltip ? `\n${armsTooltip}` : ""}`;
    const summaryText = [walkDue.ariaLabel, contextText, summary, hintText, statusText]
      .filter(Boolean)
      .join(" · ");
    return {
      visible: true,
      mode: "links",
      panel: "links",
      glyph: "⇄",
      dueText: walkDue.dueText,
      contextText,
      linkState,
      linkStatusText: statusText,
      linkPrev: prev,
      linkNext: next,
      linkGroupPrev: groupPrev,
      linkGroupNext: groupNext,
      detailText: "",
      hintText,
      boundaryHintText,
      groups: [],
      groupsText: "",
      meterText: "",
      tooltip,
      ariaLabel: summaryText ? `Links · ${summaryText}` : "Links · no previous or next links",
    };
  } catch (error) {
    return linksWalkerFooterView(null, { state: "unavailable" });
  }
}

function linksWalkerFooterSource(plugin) {
  try {
    const view = getActiveMarkdownView(plugin && plugin.app);
    const editor = view && view.editor;
    const file = view && view.file;
    if (
      !file ||
      file.extension !== "md" ||
      typeof file.path !== "string" ||
      !editor ||
      typeof editor.getValue !== "function"
    ) {
      return null;
    }
    const content = String(editor.getValue() || "");
    const doc = editor.cm && editor.cm.state && editor.cm.state.doc;
    return {
      path: file.path,
      content,
      revision: doc || content,
    };
  } catch (error) {
    return null;
  }
}

function linksWalkerFooterIsCurrent(plugin, generation, source) {
  try {
    if (plugin.linkWalkerFooterGeneration !== generation) {
      return false;
    }
    const route = walkerFooterWalkMode(plugin);
    if (route.legacy || route.mode !== "n") {
      return false;
    }
    const current = linksWalkerFooterSource(plugin);
    return Boolean(
      current &&
      current.path === source.path &&
      current.content === source.content &&
      current.revision === source.revision
    );
  } catch (error) {
    return false;
  }
}

function linksWalkerFooterPaint(plugin, view, source, preview, generation) {
  try {
    const el = plugin && plugin.freshnessStatusEl;
    if (!el) {
      return;
    }
    const paintKey = [
      "walker:n",
      view.linkState,
      view.dueText,
      view.contextText,
      view.hintText,
      view.boundaryHintText,
      view.linkStatusText,
      view.linkPrev && view.linkPrev.text,
      view.linkPrev && view.linkPrev.tooltip,
      view.linkNext && view.linkNext.text,
      view.linkNext && view.linkNext.tooltip,
      view.linkGroupPrev && view.linkGroupPrev.text,
      view.linkGroupPrev && view.linkGroupPrev.tooltip,
      view.linkGroupPrev && view.linkGroupPrev.state,
      view.linkGroupNext && view.linkGroupNext.text,
      view.linkGroupNext && view.linkGroupNext.tooltip,
      view.linkGroupNext && view.linkGroupNext.state,
      view.tooltip,
    ].join("\0");
    plugin.linkWalkerFooterSnapshot = source && preview
      ? { generation, source, preview }
      : null;
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

function linksWalkerFooterInvalidate(plugin) {
  if (!plugin) {
    return;
  }
  plugin.linkWalkerFooterGeneration =
    (Number(plugin.linkWalkerFooterGeneration) || 0) + 1;
  plugin.linkWalkerFooterSnapshot = null;
}

function linksWalkerFooterRequest(plugin) {
  const generation =
    (Number(plugin.linkWalkerFooterGeneration) || 0) + 1;
  plugin.linkWalkerFooterGeneration = generation;
  plugin.linkWalkerFooterSnapshot = null;
  const source = linksWalkerFooterSource(plugin);
  if (!source) {
    linksWalkerFooterPaint(
      plugin,
      linksWalkerFooterView(null, { state: "open-note" }),
      null,
      null,
      generation,
    );
    return;
  }

  let walkMode = null;
  try {
    const api = typeof plugin.dependencyNavApi === "function"
      ? plugin.dependencyNavApi()
      : null;
    walkMode = api && api.walkMode && typeof api.walkMode === "object"
      ? api.walkMode
      : null;
  } catch (error) {
    walkMode = null;
  }
  if (
    !walkMode ||
    Number(walkMode.version) < LINKS_WALKER_FOOTER_API_VERSION ||
    typeof walkMode.links !== "function"
  ) {
    linksWalkerFooterPaint(
      plugin,
      linksWalkerFooterView(null, { state: "unavailable" }),
      null,
      null,
      generation,
    );
    return;
  }

  Promise.resolve()
    .then(() => walkMode.links({ path: source.path, content: source.content }))
    .then((preview) => {
      if (!linksWalkerFooterIsCurrent(plugin, generation, source)) {
        return;
      }
      let recordWalk = null;
      if (preview && preview.ok === true && typeof recordWalkModel === "function") {
        const albumState = typeof plugin.albumReportState === "function"
          ? plugin.albumReportState() : null;
        recordWalk = recordWalkModel({
          path: source.path,
          sourceText: source.content,
          report: albumState?.report || null,
          metadataCache: plugin.app?.metadataCache,
          vault: plugin.app?.vault,
        });
        if (typeof recordWalkRequestSync === "function") recordWalkRequestSync(plugin, recordWalk);
      }
      const displayPreview = linksWalkerFooterAlbumRecords(plugin, { ...preview, recordWalk });
      linksWalkerFooterPaint(
        plugin,
        linksWalkerFooterView(displayPreview),
        source,
        displayPreview && displayPreview.ok === true ? displayPreview : null,
        generation,
      );
    })
    .catch(() => {
      if (!linksWalkerFooterIsCurrent(plugin, generation, source)) {
        return;
      }
      linksWalkerFooterPaint(
        plugin,
        linksWalkerFooterView(null, { state: "unavailable" }),
        source,
        null,
        generation,
      );
    });
}

function linksWalkerFooterSameLink(left, right) {
  return Boolean(
    left && right &&
    left.text === right.text &&
    left.target === right.target &&
    left.path === right.path &&
    left.exists === right.exists &&
    (left.state == null || right.state == null || left.state === right.state)
  );
}

function linksWalkerFooterActivate(plugin, direction, options = {}) {
  try {
    if (direction !== "prev" && direction !== "next") {
      return false;
    }
    const group = options && options.group === true;
    const route = walkerFooterWalkMode(plugin);
    const snapshot = plugin && plugin.linkWalkerFooterSnapshot;
    if (route.legacy || route.mode !== "n" || !snapshot) {
      return false;
    }
    const previewKey = group
      ? (direction === "prev" ? "prevGroup" : "nextGroup")
      : direction;
    const expected = snapshot.preview && snapshot.preview[previewKey];
    const lastView = plugin.freshnessFooterLastView;
    const arm = group
      ? (direction === "prev" ? lastView && lastView.linkGroupPrev : lastView && lastView.linkGroupNext)
      : (direction === "prev" ? lastView && lastView.linkPrev : lastView && lastView.linkNext);
    if (!expected || !arm || arm.enabled !== true) {
      return false;
    }
    if (!linksWalkerFooterIsCurrent(plugin, snapshot.generation, snapshot.source)) {
      linksWalkerFooterRequest(plugin);
      return false;
    }
    const api = typeof plugin.dependencyNavApi === "function"
      ? plugin.dependencyNavApi()
      : null;
    const walkMode = api && api.walkMode;
    if (
      !walkMode ||
      Number(walkMode.version) < LINKS_WALKER_FOOTER_API_VERSION ||
      typeof walkMode.links !== "function"
    ) {
      return false;
    }
    const latest = walkMode.links({
      path: snapshot.source.path,
      content: snapshot.source.content,
    });
    const latestStop = latest && latest[previewKey];
    if (
      !latest || latest.ok !== true ||
      !linksWalkerFooterSameLink(expected, latestStop)
    ) {
      linksWalkerFooterRequest(plugin);
      return false;
    }
    const commandId = group
      ? (direction === "prev"
        ? "bob-navigation-hotkeys:open-prev-group-link"
        : "bob-navigation-hotkeys:open-next-group-link")
      : (direction === "prev"
        ? "bob-navigation-hotkeys:open-prev-link"
        : "bob-navigation-hotkeys:open-next-link");
    const commands = plugin.app && plugin.app.commands;
    let commandExists = Boolean(
      commands && commands.commands && commands.commands[commandId],
    );
    if (!commandExists && commands && typeof commands.findCommand === "function") {
      commandExists = Boolean(commands.findCommand(commandId));
    }
    if (!commandExists || typeof commands.executeCommandById !== "function") {
      return false;
    }
    commands.executeCommandById(commandId);
    return true;
  } catch (error) {
    return false;
  }
}
