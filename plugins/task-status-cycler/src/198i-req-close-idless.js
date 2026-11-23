// Idless managed Done owners use the existing canonical line/digest identity
// only for the requirement audit. They never enter dependency recovery.

class TaskStatusCyclerReqCloseIdlessMixin {
  captureReqCloseOwnersAtEditorLine(editor, path, line, fallbackText = "") {
    const text = editor && typeof editor.getValue === "function"
      ? editor.getValue()
      : typeof fallbackText === "string" ? fallbackText : "";
    const identity = this.reqCloseIdentityForTaskLine(text, path, line);
    return this.captureReqCloseOwnersFromEditor(identity, editor, path, fallbackText);
  }

  reqCloseIdentityForTaskLine(contents, path, lineIndex) {
    if (typeof contents !== "string" || !path || !Number.isInteger(lineIndex)) return null;
    const task = taskReqNoteTasks(contents).find((row) => row.lineIndex === lineIndex);
    if (!task) return null;
    const owner = reqCloseCollectOwner(contents, path, task, reqCloseWriteDefaultSha256);
    if (!owner) return null;
    const lineText = taskReqLineSpans(contents)[lineIndex]?.text || "";
    const managed = closedTaskIdentity(path, lineText) || {};
    return {
      ...managed,
      path: String(path),
      line: owner.line,
      task_key: owner.task_key,
    };
  }

  async planAndApplyIdlessRequirementOnlyCard(context = {}) {
    const active = context && typeof context === "object" ? context : {};
    const empty = {
      version: 1,
      gated: true,
      predecessors: [],
      unblocked: [],
      keep_moving: [],
      still_blocked: [],
      daily_path: "",
      daily_content: null,
      failure: null,
    };
    const pickerApi = getSuccessorPickerApi(this.app);
    if (!pickerApi || Number(pickerApi.version) < 6) return empty;
    const owners = this.reqCloseOwnersForManagedDone(
      active.reqCloseOwners,
      [],
      { ...active, reqCloseOnly: true },
    );
    const reqCloseGroups = reqCloseGroupsFromOwners(owners);
    if (!reqCloseGroups.length) return empty;

    const cache = new Map();
    const openNotes = new Map();
    for (const path of new Set(owners.map((owner) => String(owner.path || "")).filter(Boolean))) {
      const text = await this.readSuccessorNoteText(path, active, cache);
      if (typeof text !== "string") return empty;
      openNotes.set(path, text);
    }
    const today = typeof active.today === "string" && active.today
      ? active.today
      : formatLocalDate();
    let dailyPath = typeof active.dailyPath === "string" && active.dailyPath
      ? active.dailyPath
      : "";
    if (!dailyPath) {
      try { dailyPath = todayDailyPath(this.app) || ""; } catch (_error) { dailyPath = ""; }
    }
    const openNotesObject = Object.fromEntries(openNotes);
    const picked = await this.pickSuccessorOfferChoices({
      plan: { still_blocked: [], offers: [] },
      offers: [],
      reqCloseGroups,
      identities: [],
      pickerApi,
      context: active,
      noteTexts: openNotesObject,
      tasks: [],
      today,
      dailyPath,
      dailyBefore: [],
      dailyAfter: [],
      dependencySnapshotAvailable: false,
      markUnblockedLine: this.getFreshnessMarkUnblockedLine(),
    });
    if (!picked.pickerOpened || !picked.choices) return empty;
    const choices = picked.choices;
    const requests = Array.isArray(choices.reqs) ? choices.reqs : null;
    const jumpKey = choices.jump && typeof choices.jump.key === "string"
      ? choices.jump.key
      : null;
    const reqJumpKey = owners.some((owner) => (owner.nodes || []).some((node) => node.key === jumpKey))
      ? jumpKey
      : null;
    if (requests === null && !reqJumpKey) return empty;

    const openOwnerBlocks = this.reqCloseExpectedOwnerPostimages(owners, openNotes);
    const freshNotes = new Map();
    for (const path of openNotes.keys()) {
      cache.delete(path);
      const text = await this.readSuccessorNoteText(path, active, cache);
      if (typeof text === "string") freshNotes.set(path, text);
    }
    const filtered = reqCloseRefuseStaleOwnerChoices({
      owners,
      requests,
      jumpKey: reqJumpKey,
      openBlocks: openOwnerBlocks,
      freshNotes,
    });
    const liveOwners = filtered.owners;
    let reqResult = null;
    if (liveOwners.length && (filtered.requests !== null || filtered.jumpKey)) {
      reqResult = await this.applyManagedReqCloseCard({
        owners: liveOwners,
        choices: {
          ...(filtered.requests !== null ? { reqs: filtered.requests } : {}),
          ...(filtered.jumpKey ? { jump: { key: filtered.jumpKey } } : {}),
        },
        notes: freshNotes,
        expectedNotes: freshNotes,
        expectedOwnerPostimages: this.reqCloseExpectedOwnerPostimages(liveOwners, freshNotes),
        identities: [],
        today,
        dailyPath,
        context: active,
        cache,
      });
      if (reqResult && Array.isArray(reqResult.outcomes) &&
          reqResult.outcomes.some((row) => row && row.verdict === "carry_pulled")) {
        reqResult = await this.finishManagedReqPullIn({
          result: reqResult,
          owners: liveOwners,
          identities: [],
          dailyPath,
          today,
          index: reqResult.index,
          completed: [],
          closing: null,
          context: active,
        });
      }
    }
    let jump = null;
    if (reqResult && reqResult.reqJump) {
      jump = await this.resolveManagedReqCloseLanding({
        owners,
        plan: reqResult,
        key: reqResult.reqJump,
        context: active,
        cache,
        dailyPath,
        routes: Array.isArray(reqResult.routes) ? reqResult.routes : [],
      });
      if (jump && jump.ok === false) {
        reqResult.failures = [
          ...(Array.isArray(reqResult.failures) ? reqResult.failures : []),
          { kind: "requirement_jump", code: jump.code, reason: jump.message },
        ];
        jump = null;
      } else if (jump && jump.ok === true) {
        jump = { ...jump, label: jump.description || "requirement" };
      }
    }
    return {
      version: 1,
      predecessors: [],
      unblocked: [],
      keep_moving: [],
      still_blocked: [],
      ...(reqResult && Array.isArray(reqResult.req_outcomes)
        ? { req_outcomes: reqResult.req_outcomes }
        : {}),
      ...(reqResult && Array.isArray(reqResult.met) ? { req_met: reqResult.met } : {}),
      ...(reqResult && Array.isArray(reqResult.restores) && reqResult.restores.length
        ? { undo: { restores: reqResult.restores } }
        : {}),
      failures: [
        ...filtered.failures,
        ...(reqResult && Array.isArray(reqResult.failures) ? reqResult.failures : []),
      ],
      ...(jump ? { jump } : {}),
      relation_picker_opened: false,
      daily_path: dailyPath,
      daily_content: null,
      failure: null,
    };
  }
}
