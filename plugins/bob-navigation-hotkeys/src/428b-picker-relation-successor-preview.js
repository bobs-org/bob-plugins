// Successor-label authoring preview (nav_authoring phase of
// plan:202611/starts_after_relation.md). Kept in its own fragment so the
// relation-label vocabulary stage stays under the 1000-line cap. Installed
// onto BulletPropertyPickerModal alongside the vocabulary mixin.
class BulletPropertyPickerRelationSuccessorPreviewMixin {
  relationSuccessorTargetState(targetRef) {
    try {
      const ref = targetRef || {};
      let rawLine = String(ref.rawLine || "");
      let text = String(ref.displayText || ref.text || "").trim();
      if (!rawLine) {
        const content = this.relationCancelContentForRef(ref);
        const lines = String(content || "").split(/\r?\n/);
        let line = Math.floor(numericOrDefault(ref.line, NaN));
        const blockId = normalizeBulletPropertyValue(ref.blockId || "");
        if (blockId) {
          const found = findTaskLineByTrailingBlockId(lines, blockId);
          if (found !== null) line = found;
        }
        if (Number.isInteger(line) && line >= 0 && line < lines.length) {
          rawLine = String(lines[line] || "");
        }
      }
      if (!text && rawLine) {
        try {
          text = cleanTaskDisplayText(rawLine) || "";
        } catch (_cleanError) {
          text = "";
        }
      }
      const status = rawLine ? relationCancelSourceStatus(rawLine) : null;
      let live = null;
      try {
        const stage = this.vaultStage;
        const map = stage && stage.todayMap instanceof Map ? stage.todayMap : null;
        const key = ref.path && ref.blockId
          ? relationStageRowKey(ref.path, ref.blockId)
          : null;
        if (map && key) live = map.has(key);
      } catch (_liveError) {
        live = null;
      }
      if (!text && !rawLine) return null;
      return Object.freeze({
        text: text || "that task",
        status,
        live,
      });
    } catch (_error) {
      return null;
    }
  }

  relationSuccessorPreviewFields(args = {}) {
    const normalized = args.normalized;
    const closeConfig = args.closeConfig || {};
    const sourceDetails = Array.isArray(args.sourceDetails) ? args.sourceDetails : [];
    const edgeTargets = Array.isArray(args.edgeTargets) ? args.edgeTargets : [];
    const labelTargets = Array.isArray(args.labelTargets) ? args.labelTargets : [];
    const linkedFrom = args.linkedFrom === true;
    const successorPolicy = closeConfig.successor || emptyRelationsCancelLabels();
    const successorKeys = relationSuccessorLabelsSet(successorPolicy);
    const configuredSuccessor = Boolean(
      normalized && successorKeys.has(relationCancelLabelKey(normalized)),
    );
    const successorInverse = normalized && !configuredSuccessor
      ? relationSuccessorInverseLabel(normalized, successorPolicy)
      : null;
    const successorSourceText = (sourceDetails[0] && sourceDetails[0].text) ||
      (linkedFrom
        ? (labelTargets[0] && (labelTargets[0].displayText || labelTargets[0].text))
        : (this.vaultStage && Array.isArray(this.vaultStage.sources) &&
          this.vaultStage.sources[0] &&
          (this.vaultStage.sources[0].displayText || this.vaultStage.sources[0].text))) ||
      "that task";
    const successorTargetState = edgeTargets[0]
      ? this.relationSuccessorTargetState(edgeTargets[0])
      : null;
    const successorTargetText = (successorTargetState && successorTargetState.text) ||
      (edgeTargets[0] &&
        (edgeTargets[0].displayText || edgeTargets[0].text)) ||
      "that task";
    let successorVerdict = null;
    let successorMessage = "";
    let successorHint = "";
    if (configuredSuccessor) {
      const verdict = relationSuccessorPreviewForAuthoring({
        sourceText: successorSourceText,
        targetText: successorTargetText,
        targetStatus: successorTargetState ? successorTargetState.status : null,
        targetLive: successorTargetState ? successorTargetState.live : null,
      });
      successorVerdict = verdict.verdict;
      successorMessage = verdict.message;
    } else if (successorInverse) {
      successorHint = relationSuccessorInverseHintCopy(
        normalized,
        successorSourceText,
        successorInverse,
      );
    }
    return Object.freeze({
      configuredSuccessor,
      successorInverse,
      successorVerdict,
      successorMessage,
      successorHint,
    });
  }
}
