// Shared data-only closing preview for phase .7. Callers pass the complete
// pending edge sets so mixed actions and Linked-from use the same planner.
class BulletPropertyPickerRelationClosePreviewMixin {
  relationClosePreviewForChanges(args = {}) {
    const loaded = args.closeLabels || this.relationCloseLabelsConfig();
    const cancelLabels = args.cancelLabels !== undefined
      ? args.cancelLabels
      : loaded.cancel;
    const completeLabels = args.completeLabels !== undefined
      ? args.completeLabels
      : loaded.complete;
    const trigger = args.trigger || RELATION_CANCEL_EXPLICIT_TRIGGER;
    const day = args.date || formatBulletPropertyDate(new Date());
    const sources = Array.isArray(args.sources) ? args.sources : [];
    const add = Array.isArray(args.add) ? args.add : [];
    const remove = Array.isArray(args.remove) ? args.remove : [];
    const relabel = Array.isArray(args.relabel)
      ? args.relabel
      : args.relabel && typeof args.relabel === "object"
        ? Object.entries(args.relabel).map(([path, label]) => ({ target: path, label }))
        : [];
    const vaultEntries =
      this.plugin && typeof this.plugin.readDependencyVaultFileList === "function"
        ? this.plugin.readDependencyVaultFileList()
        : this.vaultStage && this.vaultStage.files instanceof Map
          ? [...this.vaultStage.files.keys()]
          : [];
    const vaultFiles = (Array.isArray(vaultEntries) ? vaultEntries : []).map((entry) =>
      typeof entry === "string" ? { path: entry } : entry,
    );
    const resolveLinkpath =
      this.plugin && typeof this.plugin.dependencyLinkpathResolver === "function"
        ? this.plugin.dependencyLinkpathResolver()
        : null;
    const api = relationTaskStatusCyclerApi(this.plugin && this.plugin.app);
    const plans = [];
    for (const sourceRef of sources) {
      const path = normalizeVaultRelativePath(sourceRef && sourceRef.path);
      const content = this.relationCancelContentForRef({ ...sourceRef, path });
      const lines = content.split(/\r?\n/);
      let line = Math.floor(numericOrDefault(sourceRef && sourceRef.line, NaN));
      const blockId = normalizeBulletPropertyValue(sourceRef && sourceRef.blockId);
      if (blockId) {
        const found = findTaskLineByTrailingBlockId(lines, blockId);
        if (found !== null) line = found;
      }
      if (!Number.isInteger(line) || line < 0 || line >= lines.length) {
        return Object.freeze({ ok: false, reason: "source-not-found" });
      }
      const rawLine = String(lines[line] || "");
      const children = findLinksChildren(lines, line);
      const existingRows = children.flatMap((index) =>
        relationLinksRows(path, lines[index], resolveLinkpath, vaultFiles),
      );
      const normalizeTarget = (entry) => {
        const raw = entry && entry.target ? { ...entry.target, label: entry.label } : entry;
        const targetPath = normalizeVaultRelativePath(raw && raw.path);
        const targetContent = this.relationCancelContentForRef({ ...raw, path: targetPath });
        const targetLines = targetContent.split(/\r?\n/);
        let targetLine = Math.floor(numericOrDefault(raw && raw.line, NaN));
        const targetId = normalizeBulletPropertyValue(raw && (raw.blockId || raw.existingBlockId));
        if (targetId) {
          const found = findTaskLineByTrailingBlockId(targetLines, targetId);
          if (found !== null) targetLine = found;
        }
        if (!Number.isInteger(targetLine) || targetLine < 0 || targetLine >= targetLines.length) {
          return null;
        }
        return Object.freeze({
          ...raw,
          path: targetPath,
          line: targetLine,
          blockId: getTrailingBlockId(targetLines[targetLine]) || targetId,
          rawLine: targetLines[targetLine],
          description: relationNoticeNameFromLine(targetLines[targetLine]),
        });
      };
      const liveAdd = add.map(normalizeTarget).filter(Boolean);
      const liveRemove = remove.map(normalizeTarget).filter(Boolean);
      const liveRelabel = relabel.map(normalizeTarget).filter(Boolean);
      const planned = planLinksEdit(content, line, {
        add: liveAdd.map((target) => ({
          link: storedRelationLinkForTarget(existingRows, target, path, vaultFiles),
          label: target.label,
        })),
        remove: liveRemove.map((target) =>
          storedRelationLinkForTarget(existingRows, target, path, vaultFiles),
        ),
        relabel: liveRelabel.map((target) => ({
          link: storedRelationLinkForTarget(existingRows, target, path, vaultFiles),
          label: target.label,
        })),
      });
      if (!planned.ok) return Object.freeze({ ok: false, reason: planned.reason });
      const edges = deriveRelationCancelEdges({
        report: planned.report,
        existingRows,
        liveAdd,
        liveRelabel,
        sourcePath: path,
        vaultFiles,
      });
      const policySource = relationCancelPolicySourceFromLine(
        {
          path,
          line,
          blockId: getTrailingBlockId(rawLine) || blockId,
        },
        rawLine,
        edges,
      );
      plans.push(
        planRelationClosingSource({
          cancelLabels,
          completeLabels,
          trigger,
          cyclerApiAvailable: relationCompleteCyclerApiAvailable(api),
          source: policySource,
        }),
      );
    }
    const cancelSources = plans.map((entry) => entry.cancel).filter(Boolean);
    const completeSources = plans.map((entry) => entry.complete).filter(Boolean);
    const cancelRefusals = plans.map((entry) => entry.cancelRefusal).filter(Boolean);
    const completeRefusals = plans.map((entry) => entry.completeRefusal).filter(Boolean);
    const cancelPlan = {
      sources: cancelSources,
      cancels: cancelSources.filter((entry) => entry.cancels),
      refusals: cancelRefusals,
    };
    const completePlan = {
      sources: completeSources,
      completes: completeSources.filter((entry) => entry.completes),
      refusals: completeRefusals,
    };
    const gate = relationCloseCommitGate({
      cancelSourcePlans: cancelSources,
      cancelRefusals,
      completePlan,
      day,
    });
    this.relationCloseExpected = gate.closeEffects;
    return Object.freeze({
      ok: true,
      cancel: Object.freeze(cancelPlan),
      complete: Object.freeze(completePlan),
      cancelEffects: gate.cancelEffects,
      closeEffects: gate.closeEffects,
      expected: gate.closeEffects,
      expectedCloseEffects: gate.closeEffects,
      expectedCancelEffects: gate.cancelEffects,
      refusal: gate.ok ? null : Object.freeze({ reason: gate.reason, notice: gate.notice }),
    });
  }
}
