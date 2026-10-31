// Lane inbox routing (route-core): Alt+N on an inbox task asks where the
// task goes as the last step before it writes. Armed only when
// `computeInboxRouteContext` arms it (inbox note plus an open #task, never
// Task Link sessions — the caller only routes the on-task path). Refusals
// come first and never prompt; a Pending release keeps its Work Log prompt
// first and Esc there cancels with no route prompt. `promptInboxRoute`
// opens after the action's own prompts and right before the write; Esc
// cancels the whole gesture with nothing written; on success the helper
// settles `route` and on move failure the lane outcome plus the partial
// notice separately. Never throws.
class BobNavigationHotkeysLaneInboxRouteMixin {
  // Ask where an inbox task goes before an Alt+N write. Resolves
  // `{ kind: "move", path, name, expected, startLine, additionalTaskCount }`,
  // `{ kind: "stay" }` (today's in-place write), `{ kind: "cancel" }`
  // (nothing is written), or `{ kind: "none" }` (not armed: behave as
  // today). An internal error resolves `none`. Never throws.
  async promptLaneInboxRoute(options = {}) {
    try {
      const cm =
        options.cm && typeof options.cm.getValue === "function"
          ? options.cm
          : null;
      const filePath =
        typeof options.filePath === "string" ? options.filePath : "";
      const content = String(options.content || "");
      const cursor =
        options.cursor && typeof options.cursor === "object"
          ? options.cursor
          : null;
      if (!cm || !filePath || !cursor || !Number.isInteger(cursor.line)) {
        return { kind: "none" };
      }
      const mode = String(options.mode || "");
      if (mode !== "commit" && mode !== "release") {
        return { kind: "none" };
      }
      const additional = Math.max(
        0,
        Math.floor(numericOrDefault(options.additionalTaskCount, 0)),
      );
      let session = null;
      try {
        session = discoverCountedObsidianTaskTargets(
          content,
          cursor.line,
          additional,
        );
      } catch (error) {
        session = null;
      }
      if (!session || session.valid !== true) {
        return { kind: "none" };
      }
      let armed = null;
      try {
        armed = this.computeInboxRouteContext({
          filePath,
          content,
          cursor,
          taskSession: additional > 0 ? session : null,
        });
      } catch (error) {
        armed = null;
      }
      if (!armed) {
        return { kind: "none" };
      }
      let expected = null;
      try {
        expected = captureInboxRouteExpected(
          discoverMovableObsidianTaskTargets(content, cursor.line, additional)
            .targets,
        );
      } catch (error) {
        expected = null;
      }
      if (!expected || expected.length === 0) {
        return { kind: "none" };
      }
      let route = null;
      try {
        route = await this.promptInboxRoute({
          editor: cm,
          sourcePath: filePath,
          startLine: cursor.line,
          additionalTaskCount: additional,
          actionLabel: formatLaneRouteActionLabel(mode),
          cancelLabel: "cancel",
          reservedBlockIds: new Set(),
        });
      } catch (error) {
        return { kind: "none" };
      }
      if (route && route.kind === "move" && route.path) {
        return {
          kind: "move",
          path: route.path,
          name: String(route.name || ""),
          expected,
          startLine: cursor.line,
          additionalTaskCount: additional,
        };
      }
      if (route && route.kind === "stay") {
        return {
          kind: "stay",
          expected,
          startLine: cursor.line,
          additionalTaskCount: additional,
        };
      }
      if (route && route.kind === "cancel") {
        return { kind: "cancel" };
      }
      return { kind: "cancel" };
    } catch (error) {
      return { kind: "none" };
    }
  }

  // Commit the routed move after the lane write. On success one composed
  // toast (the lane text, then the move notice); on a walk origin it settles
  // `{ kind: "route" }` once, otherwise it shows the notice. When the lane
  // committed but the move failed, settle (or show) today's `lane` outcome
  // with the plain lane text, then show the move notice on its own. Never
  // throws.
  async finishLaneInboxRoute(options = {}) {
    const laneNoticeText = String(options.laneNoticeText || "");
    const handledRefs = Array.isArray(options.handledRefs)
      ? options.handledRefs
      : [];
    const settle =
      typeof options.settle === "function" ? options.settle : null;
    const filePath =
      typeof options.filePath === "string" ? options.filePath : "";
    const gate =
      options.gate && typeof options.gate === "object" ? options.gate : null;
    try {
      let inboxName = "inbox";
      try {
        inboxName =
          getVaultPathBasenameWithoutExtension(filePath) || "inbox";
      } catch (error) {
        inboxName = "inbox";
      }
      let move = null;
      try {
        move = await this.commitInboxRoute({
          editor: options.cm,
          sourcePath: filePath,
          startLine:
            gate && Number.isInteger(gate.startLine) ? gate.startLine : null,
          additionalTaskCount:
            gate && Number.isInteger(gate.additionalTaskCount)
              ? gate.additionalTaskCount
              : 0,
          expected: gate && Array.isArray(gate.expected) ? gate.expected : [],
          destinationPath: gate ? gate.path : "",
        });
      } catch (error) {
        move = null;
      }
      if (move && move.ok === true) {
        const composed = laneNoticeText
          ? `${laneNoticeText}\n${String(move.notice || "")}`.trim()
          : String(move.notice || "");
        const refs = Array.isArray(move.handledRefs) ? move.handledRefs : [];
        if (settle) {
          settle({ kind: "route", handledRefs: refs, notice: composed });
        } else {
          new Notice(composed);
        }
        return true;
      }
      const partial =
        move && move.notice
          ? String(move.notice)
          : `Not moved · still in ${inboxName}`;
      if (settle) {
        settle({ kind: "lane", handledRefs, notice: laneNoticeText });
      } else {
        new Notice(laneNoticeText);
      }
      new Notice(partial);
      return true;
    } catch (error) {
      try {
        if (settle) {
          settle({ kind: "lane", handledRefs, notice: laneNoticeText });
        } else if (laneNoticeText) {
          new Notice(laneNoticeText);
        }
      } catch (ignoredError) {
        // Notices are best-effort.
      }
      return true;
    }
  }
}
