// Cycle writes and delayed settle bridge (bob-cli-q4.9.1.4).
// Status changes stay on the current line during the cycle burst. One pending
// note settle follows the completed gesture, including counted ranges.
class TaskStatusCyclerCycleSettleMixin {
  writeCycledLocalTask(editor, view, taskStatus, nextSymbol) {
    const cycleFile = view && view.file ||
      (this.app.workspace && typeof this.app.workspace.getActiveFile === "function"
        ? this.app.workspace.getActiveFile()
        : null);
    const cyclePath = cycleFile && cycleFile.path;
    const activePath = cyclePath || "";
    const cycleIdentity = cyclePath
      ? closedTaskIdentity(cyclePath, taskStatus.lineText)
      : null;
    const reqCloseOwners = nextSymbol === "x" && cyclePath && editor &&
        typeof editor.getValue === "function"
      ? this.captureReqCloseOwnersAtEditorLine(editor, cyclePath, taskStatus.line, taskStatus.lineText)
      : [];
    const wrote = this.setActiveCheckboxStatus(editor, taskStatus, nextSymbol, {
      settlePolicy: TASK_SETTLE_WRITE_POLICY.deferred,
    });
    if (wrote && taskStatus.symbol === BLOCKED_TASK_STATUS_SYMBOL) {
      this.applyBlockedStatusRetirementInEditor(editor, taskStatus.line);
      void this.recoverProjectResidentsAfterPrjUnblock(editor, activePath);
    }
    // A cycle into Done joins the existing recover-and-link pass; a cycle into
    // Cancelled recovers only. Neither transition settles through the
    // immediate-close policy.
    if (wrote && (nextSymbol === "x" || nextSymbol === "-")) {
      if (cyclePath) {
        const identity = cycleIdentity;
        if (identity || (nextSymbol === "x" && reqCloseOwners.length > 0)) {
          const cycleContext = { activePath: cyclePath };
          if (nextSymbol === "x") cycleContext.reqCloseOwners = reqCloseOwners;
          if (editor && typeof editor.getValue === "function") {
            cycleContext.editor = editor;
          }
          void this.finalizeCycledClosedTasks(
            identity ? [{ identity, symbol: nextSymbol }] : [],
            cycleContext,
          );
        }
      }
    }
    if (wrote && cyclePath) {
      const identity = this.taskSettleIdentityAtEditorLine(
        editor,
        taskStatus.line,
      );
      this.scheduleTaskCycleSettle(editor, cyclePath, identity);
    }
    return wrote;
  }

  getCountedTaskCycleKeydownDirection(event) {
    return getOptionBracketTaskCycleDirection(event);
  }
}
