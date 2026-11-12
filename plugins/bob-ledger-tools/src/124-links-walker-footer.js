// Read-only destination compass for the `n` bracket walk. Preview requests
// are generation-checked against the selected family, active file, and live
// editor document before they paint. Direction activation re-reads the same
// nav preview and then delegates to nav's existing [n / ]n commands.
const LINKS_WALKER_FOOTER_API_VERSION = 2;

function linksWalkerFooterLabel(link, direction) {
  const text = String(link && link.text ? link.text : "").trim();
  if (text !== "prev" && text !== "next") {
    return text.replace(/^[‹<>›]\s*/, "").replace(/\s*[‹<>›]$/, "").trim();
  }

  const targetPath = String(link && link.path ? link.path : "");
  const pathStem = targetPath.split("/").pop().replace(/\.md$/i, "");
  const target = String(link && link.target ? link.target : "");
  const targetStem = target.split(/[/#^]/)[0].split("/").pop().replace(/\.md$/i, "");
  const stem = pathStem || targetStem;
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

function linksWalkerFooterArm(link, direction) {
  if (!link) {
    return null;
  }
  const name = linksWalkerFooterLabel(link, direction);
  const exists = link.exists === true;
  const createEligible = link.exists === false && Boolean(link.path);
  const arrow = direction === "prev" ? "‹" : "›";
  const text = direction === "prev"
    ? `${arrow} ${name}${createEligible ? "+" : ""}`
    : `${name}${createEligible ? "+" : ""} ${arrow}`;
  const tooltip = createEligible
    ? `No ${name} note yet — ${direction === "prev" ? "[[" : "]]"} creates it\n${linksWalkerFooterPathTooltip(link)}`
    : linksWalkerFooterPathTooltip(link);
  return {
    direction,
    name,
    text,
    tooltip,
    enabled: exists || createEligible,
    createEligible,
    path: link.path || null,
    target: link.target || "",
    exists,
    sourceText: link.text || "",
  };
}

function linksWalkerFooterView(preview, options = {}) {
  try {
    if (options.state === "open-note") {
      return {
        visible: true,
        mode: "links",
        panel: "links",
        glyph: "⇄",
        dueText: "Links",
        contextText: "",
        linkState: "open-note",
        linkStatusText: "open a note",
        linkPrev: null,
        linkNext: null,
        detailText: "",
        hintText: "",
        groups: [],
        groupsText: "",
        meterText: "",
        tooltip: "⇄ Links · open a Markdown note to preview its prev / next links",
        ariaLabel: "Links · open a note",
      };
    }
    if (options.state === "unavailable" || !preview || preview.ok !== true) {
      return {
        visible: true,
        mode: "links",
        panel: "links",
        glyph: "⇄",
        dueText: "Links",
        contextText: "",
        linkState: "unavailable",
        linkStatusText: "links unavailable",
        linkPrev: null,
        linkNext: null,
        detailText: "",
        hintText: "",
        groups: [],
        groupsText: "",
        meterText: "",
        tooltip: "⇄ Links · update Bob Navigation Hotkeys to preview destinations",
        ariaLabel: "Links · links unavailable",
      };
    }

    let prev = linksWalkerFooterArm(preview.prev, "prev");
    let next = linksWalkerFooterArm(preview.next, "next");
    if (!prev && !next) {
      return {
        visible: true,
        mode: "links",
        panel: "links",
        glyph: "⇄",
        dueText: "Links",
        contextText: "",
        linkState: "empty",
        linkStatusText: "no ‹ / › links in this note",
        linkPrev: null,
        linkNext: null,
        detailText: "",
        hintText: "",
        groups: [],
        groupsText: "",
        meterText: "",
        tooltip: "⇄ Links · no ‹ / › links in this note",
        ariaLabel: "Links · no previous or next links in this note",
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

    const linkState = prev && next ? "both" : prev ? "prev-only" : "next-only";
    const statusText = prev && !next ? "no next" : !prev && next ? "no prev" : "";
    const arms = [prev, next].filter(Boolean);
    const summary = arms.map((arm) => arm.text).join(" · ");
    const tooltip = arms
      .map((arm) => `${arm.text}\n${arm.tooltip}`)
      .concat(statusText ? [statusText] : [])
      .join("\n");
    return {
      visible: true,
      mode: "links",
      panel: "links",
      glyph: "⇄",
      dueText: "Links",
      contextText: "",
      linkState,
      linkStatusText: statusText,
      linkPrev: prev,
      linkNext: next,
      detailText: "",
      hintText: "",
      groups: [],
      groupsText: "",
      meterText: "",
      tooltip: `⇄ Links · ${summary}${statusText ? ` · ${statusText}` : ""}\n${tooltip}`,
      ariaLabel: `Links · ${summary}${statusText ? ` · ${statusText}` : ""}`,
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
      view.linkStatusText,
      view.linkPrev && view.linkPrev.text,
      view.linkPrev && view.linkPrev.tooltip,
      view.linkNext && view.linkNext.text,
      view.linkNext && view.linkNext.tooltip,
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
      linksWalkerFooterPaint(
        plugin,
        linksWalkerFooterView(preview),
        source,
        preview && preview.ok === true ? preview : null,
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
    left.exists === right.exists
  );
}

function linksWalkerFooterActivate(plugin, direction) {
  try {
    if (direction !== "prev" && direction !== "next") {
      return false;
    }
    const route = walkerFooterWalkMode(plugin);
    const snapshot = plugin && plugin.linkWalkerFooterSnapshot;
    if (route.legacy || route.mode !== "n" || !snapshot) {
      return false;
    }
    const expected = snapshot.preview && snapshot.preview[direction];
    const arm = direction === "prev"
      ? plugin.freshnessFooterLastView && plugin.freshnessFooterLastView.linkPrev
      : plugin.freshnessFooterLastView && plugin.freshnessFooterLastView.linkNext;
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
    if (
      !latest || latest.ok !== true ||
      !linksWalkerFooterSameLink(expected, latest[direction])
    ) {
      linksWalkerFooterRequest(plugin);
      return false;
    }
    const commandId = direction === "prev"
      ? "bob-navigation-hotkeys:open-prev-link"
      : "bob-navigation-hotkeys:open-next-link";
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
