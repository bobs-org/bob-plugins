// Inbox route picker modal (route-core): asks where an inbox task goes as
// the last step before a Ctrl+Shift+P or Ctrl+Shift+Enter write. Built on
// `FilteredPickerModal` and reuses the Ctrl+Shift+M destination rows so the
// two pickers look like siblings. Resolves a promise exactly once with
// `{ kind: "move", file }`, `{ kind: "stay" }`, or `{ kind: "cancel" }`;
// closing without a choice means cancel. `↵` preflights the move first: a
// refusal keeps the picker open with a Notice so another destination can be
// chosen. `⇧↵` applies in place (stay) and `Esc` / `Ctrl+[` backs out.
// Uses the default `closeBeforeOpenItem: false` and closes itself after
// resolving. Registers in the shared `activeTaskMoveDestinationPicker`
// guard, so Ctrl+Shift+M and a second route cannot open on top of it.
class InboxRoutePickerModal extends FilteredPickerModal {
  constructor(app, plugin, options = {}) {
    const destinations = Array.isArray(options.destinations)
      ? options.destinations
      : [];
    const actionLabel = formatInboxRouteActionLabel(options.actionLabel);
    const backLabel = options.cancelLabel === "cancel" ? "cancel" : "back";
    super(app, {
      items: destinations,
      title: `Route out of ${options.inboxName || "inbox"}`,
      headerIcon: "inbox",
      inputLabel: "Filter route destinations",
      placeholder: "Where does this go? Filter areas and open projects",
      resultsLabel: "Route destinations",
      emptyText: "No matching areas or open projects",
      getSubtitle: () =>
        formatInboxRouteTaskSubtitle({
          taskText: options.taskText,
          count: options.count,
          actionLabel,
        }),
      filterItem: (entry, query) =>
        childNoteMatchesQuery(entry.file, entry.noteInfo, query),
      renderItem: (entry, rowEl, query) =>
        renderTypedNotePickerRow(entry.file, entry.noteInfo, rowEl, query),
      closeBeforeOpenItem: false,
      footerHints: [
        { keys: ["↵"], label: `move & ${actionLabel}` },
        { keys: ["⇧", "↵"], label: "keep in inbox" },
        { keys: ["esc"], label: backLabel },
      ],
      openItem: (entry) => this.chooseRouteDestination(entry),
    });
    this.inboxRoutePlugin = plugin;
    this.inboxRouteSettled = false;
    this.inboxRouteResolve = null;
    this.inboxRouteResult = new Promise((resolve) => {
      this.inboxRouteResolve = resolve;
    });
    this.inboxRoutePreflight =
      typeof options.preflight === "function" ? options.preflight : null;
  }

  waitForRoute() {
    return this.inboxRouteResult;
  }

  settleRoute(outcome) {
    if (this.inboxRouteSettled) {
      return;
    }
    this.inboxRouteSettled = true;
    let result = { kind: "cancel" };
    if (outcome && outcome.kind === "move" && outcome.file) {
      result = { kind: "move", file: outcome.file };
    } else if (outcome && outcome.kind === "stay") {
      result = { kind: "stay" };
    }
    try {
      this.inboxRouteResolve(result);
    } catch (error) {
      // The awaiting gate owns recovery; the resolve is best-effort.
    }
    if (this.pickerOpen) {
      try {
        this.close();
      } catch (error) {
        // Closing is best-effort after resolving.
      }
    }
  }

  async chooseRouteDestination(entry) {
    if (!entry || !entry.file) {
      return false;
    }
    let check = { ok: true, reason: null };
    try {
      if (this.inboxRoutePreflight) {
        check = (await this.inboxRoutePreflight(entry.file)) || check;
      }
    } catch (error) {
      check = { ok: false, reason: "Route preflight failed" };
    }
    if (!check || check.ok !== true) {
      new Notice(
        check && check.reason ? check.reason : "Destination is no longer eligible",
      );
      return false;
    }
    this.settleRoute({ kind: "move", file: entry.file });
    return true;
  }

  chooseRouteStay() {
    this.settleRoute({ kind: "stay" });
  }

  handleKeydown(event) {
    if (event && event.key === "Enter" && event.shiftKey === true) {
      event.preventDefault();
      event.stopPropagation();
      this.chooseRouteStay();
      return;
    }
    if (event && isCtrlKey(event, "[")) {
      event.preventDefault();
      event.stopPropagation();
      this.settleRoute({ kind: "cancel" });
      return;
    }
    super.handleKeydown(event);
  }

  onClose() {
    if (
      this.inboxRoutePlugin &&
      this.inboxRoutePlugin.activeTaskMoveDestinationPicker === this
    ) {
      this.inboxRoutePlugin.activeTaskMoveDestinationPicker = null;
    }
    this.settleRoute({ kind: "cancel" });
    super.onClose();
  }
}
