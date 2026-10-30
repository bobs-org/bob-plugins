function addPickerRowClasses(rowEl, classes) {
  const list = Array.isArray(classes) ? classes : [classes];
  if (rowEl && rowEl.classList && typeof rowEl.classList.add === "function") {
    rowEl.classList.add(...list.filter(Boolean));
    return;
  }
  if (rowEl && typeof rowEl.addClass === "function") {
    list.filter(Boolean).forEach((cls) => rowEl.addClass(cls));
  }
}

function renderPomodoroBulletMovePickerRow(row, rowEl, query, themesApi) {
  const kind = row && row.kind ? row.kind : "invalid";
  addPickerRowClasses(rowEl, [
    "bob-cnp-pomodoro-row",
    `is-${kind}`,
    row && row.hidden ? "is-hidden-theme" : "",
  ]);

  const rowIcon = rowEl.createDiv({ cls: "bob-cnp-row-icon" });
  const iconName =
    kind === "new" || (kind === "recent" && row.operation === "new")
      ? "plus"
      : kind === "rename" || (kind === "recent" && row.operation === "rename")
        ? "pencil"
        : kind === "split"
          ? "split"
          : kind === "invalid"
            ? "circle-alert"
            : "timer";
  applyIcon(rowIcon, iconName);

  const textEl = rowEl.createDiv({ cls: "bob-cnp-row-text" });
  const titleEl = textEl.createDiv({ cls: "bob-cnp-row-title" });
  if (kind === "recent" || kind === "new" || kind === "rename") {
    const rename = kind === "rename" || (kind === "recent" && row.operation === "rename");
      titleEl.appendText(rename ? "Rename Pomodoro to " : "New Pomodoro ");
    renderNavigationPomodoroThemeSwatches(titleEl, themesApi, row.name);
    appendHighlighted(titleEl, row.name, query);
  } else {
    if (kind === "existing") {
      renderNavigationPomodoroThemeSwatches(
        titleEl,
        themesApi,
        row.entry && row.entry.name,
      );
    }
    appendHighlighted(titleEl, kind === "invalid" ? row.statusText : row.title, query);
  }
  const pathEl = textEl.createDiv({ cls: "bob-cnp-row-path" });
  appendHighlighted(
    pathEl,
    kind === "invalid" ? "Type a valid Pomodoro name" : row.meta,
    query,
  );

  const badgesEl = rowEl.createDiv({ cls: "bob-cnp-row-badges" });
  if (kind === "recent") {
    badgesEl.createDiv({
      cls: `bob-cnp-row-status is-recent-theme${row.hidden ? " is-hidden-theme" : ""}`,
      text: row.hidden ? "Hidden" : "Recent",
      attr: {
        title: row.hidden ? "Type hidden from Recent; Ctrl+D to unhide" : "Recent task type",
        "aria-label": row.hidden ? "Hidden type" : "Recent type",
      },
    });
    return;
  }
  if (kind === "new" || kind === "rename" || kind === "split") {
    const statusEl = badgesEl.createDiv({
      cls: "bob-cnp-row-status is-create",
    });
    appendHighlighted(statusEl, row.badge || "New", query);
    if (row.unconfigured) {
      badgesEl.createDiv({
        cls: "bob-cnp-row-status is-warning",
      text: "Not a configured type",
        attr: {
          title: "This name isn't in your configured types",
          "aria-label": "Not a configured type",
        },
      });
    }
    for (const similar of row.similarTo || []) {
      badgesEl.createDiv({
        cls: "bob-cnp-row-status is-similar-theme",
        text: `like ${similar}`,
        attr: { title: `Similar to ${similar}` },
      });
    }
    if (row.hiddenThemes && row.hiddenThemes.length > 0) {
      badgesEl.createDiv({
        cls: "bob-cnp-row-status is-hidden-theme",
        text: "Hidden · ^D unhide",
      });
    }
    return;
  }
  if (kind === "invalid") {
    const statusEl = badgesEl.createDiv({
      cls: "bob-cnp-row-status is-unavailable",
    });
    appendHighlighted(statusEl, "Not selectable", query);
    return;
  }
  if (!row.statusLabel) {
    return;
  }

  const statusClass =
    row.statusLabel === "Unscheduled" ? " is-status-unscheduled" : "";
  const statusEl = badgesEl.createDiv({
    cls: `bob-cnp-row-status${statusClass}`,
    attr: {
      "aria-label": row.statusLabel,
      title: row.statusLabel,
    },
  });
  appendHighlighted(
    statusEl,
    [row.statusEmoji, row.statusLabel].filter(Boolean).join(" "),
    query,
  );
}
