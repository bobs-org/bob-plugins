// Relation-label stage controls mirrored from the Bob Mac Capture card.
class BulletPropertyPickerRelationLabelVocabularyMixin extends FilteredPickerModal {
  relationLabelsApi() {
    try {
      const plugins = this.app && this.app.plugins && this.app.plugins.plugins;
      const holder = plugins && plugins["bob-ledger-tools"];
      const api = holder && holder.api && holder.api.relationLabels;
      return api && Number(api.version) >= 1 ? api : null;
    } catch (_error) {
      return null;
    }
  }

  subscribeRelationLabelChanges() {
    this.clearRelationLabelSubscriptions();
    this.relationLabelSubscriptions = [];
    const refresh = () => {
      if (this.stage === "relation-label" && typeof this.renderResults === "function") {
        this.renderResults();
      }
    };
    try {
      const plugins = (this.app && this.app.plugins && this.app.plugins.plugins) || {};
      const holder = plugins["bob-ledger-tools"];
      const api = holder && holder.api;
      for (const source of [api && api.relationLabels, api && api.relationIndex]) {
        if (!source || typeof source.onChange !== "function") continue;
        const unsubscribe = source.onChange(refresh);
        if (typeof unsubscribe === "function") this.relationLabelSubscriptions.push(unsubscribe);
      }
    } catch (_error) {
      // The stage remains usable if an older provider cannot subscribe.
    }
  }

  clearRelationLabelSubscriptions() {
    const subscriptions = Array.isArray(this.relationLabelSubscriptions)
      ? this.relationLabelSubscriptions
      : [];
    this.relationLabelSubscriptions = [];
    for (const unsubscribe of subscriptions) {
      try {
        unsubscribe();
      } catch (_error) {
        // Unsubscribing is best-effort during stage teardown.
      }
    }
  }

  readRelationLabelSuggestions(prefix, options = {}) {
    try {
      const plugins = (this.app && this.app.plugins && this.app.plugins.plugins) || {};
      const holder = plugins["bob-ledger-tools"];
      const api = holder && holder.api;
      const labels = api && api.relationLabels;
      if (labels && Number(labels.version) >= 1 && typeof labels.rows === "function") {
        const rows = labels.rows(prefix || "", options || { hidden: "exclude" });
        if (rows && typeof rows.then === "function") return [];
        if (!Array.isArray(rows)) return [];
        return rows
          .filter((row) => row && row.name)
          .map((row) => ({
            key: String(row.key || normalizeRelationLabel(row.name).toLowerCase()),
            label: String(row.name),
            count: Math.max(0, Math.floor(numericOrDefault(row.count, 0))),
            hidden: row.hidden === true,
            inverse: typeof row.inverse === "string" ? row.inverse : null,
          }));
      }
      const index = api && api.relationIndex;
      if (!index || Number(index.version) < 1 || typeof index.labelSuggestions !== "function") return [];
      const rows = index.labelSuggestions(prefix || "");
      if (rows && typeof rows.then === "function" || !Array.isArray(rows)) return [];
      return rows
        .filter((row) => row && row.label)
        .map((row) => ({
          key: normalizeRelationLabel(row.label).toLowerCase(),
          label: String(row.label),
          count: Math.max(0, Math.floor(numericOrDefault(row.count, 0))),
          hidden: false,
          inverse: null,
        }))
        .slice(0, 12);
    } catch (_error) {
      return [];
    }
  }

  readRelationLabelHiddenCount() {
    try {
      const api = this.relationLabelsApi();
      return api && typeof api.hiddenCount === "function"
        ? Math.max(0, Math.floor(numericOrDefault(api.hiddenCount(), 0)))
        : 0;
    } catch (_error) {
      return 0;
    }
  }

  refreshRelationLabelHeader() {
    if (this.stage !== "relation-label") return;
    const count = this.readRelationLabelHiddenCount();
    this.title = `${this.relationLabelTitleBase || "🪢 Relation"}${count > 0 ? ` · ◌ ${count} hidden ⌃H` : ""}`;
    if (this.titleEl) this.titleEl.textContent = this.title;
  }

  relationLabelCloseNonce(preview) {
    if (!preview) return "";
    if (preview.expectedCloseEffects) return JSON.stringify(preview.expectedCloseEffects);
    if (preview.expected) return JSON.stringify(preview.expected);
    return "";
  }

  relationLabelCloseCounts(preview) {
    const cancelCount = preview && Array.isArray(preview.cancels) ? preview.cancels.length : 0;
    const completeCount = preview && Array.isArray(preview.completes)
      ? preview.completes.length
      : 0;
    return {
      cancelCount,
      completeCount,
      closeCount: cancelCount + completeCount,
    };
  }

  getRelationLabelFooterHints() {
    const raw = this.getRawQuery ? String(this.getRawQuery() || "") : "";
    const item = (this.visibleItems || [])[this.selectedIndex] || null;
    const preview = item && (item.closePreview || item.cancelPreview);
    const counts = this.relationLabelCloseCounts(preview);
    const nonce = this.relationLabelCloseNonce(preview);
    const confirming = counts.closeCount >= 2 && nonce &&
      this.relationCancelConfirmNonce === nonce;
    const noSelection = !item || item.typed === true || item.plain === true || this.selectedIndex === 0;
    let tabLabel = "accept top match";
    if (!noSelection) tabLabel = "accept selected";
    else if (this.relationLabelTabNoMatch === true) tabLabel = "no match";
    const hideLabel = noSelection
      ? raw.trim()
        ? this.relationLabelOneOff === true ? "keep visible" : "one-off"
        : "type a label first"
      : item.hidden === true ? "unhide" : "hide";
    return [
      { keys: ["⇥"], label: tabLabel },
      { keys: ["⌃D"], label: hideLabel },
      { keys: ["⌃H"], label: this.relationLabelShowHidden === true ? "hide list" : `Hidden ${this.readRelationLabelHiddenCount()}` },
      { keys: ["⌃R"], label: "rename selected" },
      {
        keys: ["↵"],
        label: relationCloseFooterEnterLabel({
          disabled: Boolean(item && item.disabled),
          confirming,
          cancelCount: counts.cancelCount,
          completeCount: counts.completeCount,
          relabel: this.relationLabelMode === "relabel",
        }),
      },
      { keys: ["esc"], label: "back to list" },
    ];
  }

  moveRelationLabelSelection(delta) {
    const items = Array.isArray(this.visibleItems) ? this.visibleItems : [];
    if (items.length === 0) return;
    let index = this.selectedIndex;
    for (let step = 0; step < items.length; step += 1) {
      index = (index + delta + items.length) % items.length;
      if (items[index] && items[index].nonSelectable !== true) {
        if (index !== this.selectedIndex) {
          this.relationCancelConfirmNonce = null;
          this.relationCancelExpected = null;
          this.relationCloseExpected = null;
        }
        this.selectedIndex = index;
        this.relationLabelTabNoMatch = false;
        this.renderResults();
        return;
      }
    }
  }

  relationLabelSelectKey(key) {
    const items = this.getRelationLabelPreviewItems();
    const index = items.findIndex((row) => row && row.key === key && row.typed !== true);
    if (index !== this.selectedIndex) {
      this.relationCancelConfirmNonce = null;
      this.relationCancelExpected = null;
      this.relationCloseExpected = null;
    }
    this.selectedIndex = index >= 0 ? index : 0;
  }

  async toggleRelationLabelVisibility(item) {
    if (!item || item.kind !== "relation-label" || !item.key || item.typed === true) return false;
    const key = String(item.key);
    if (this.relationLabelWrites.has(key)) return false;
    const previous = this.relationLabelGhosts.get(key);
    const hidden = item.hidden !== true;
    const label = String(item.label || "");
    this.relationLabelGhosts.set(key, { hidden });
    this.relationLabelSelectKey(key);
    this.renderResults();
    this.relationLabelWrites.add(key);
    let result;
    try {
      const api = this.relationLabelsApi();
      const write = hidden ? api && api.hide : api && api.unhide;
      result = typeof write === "function"
        ? await write(label)
        : { ok: false, message: "Bob Ledger Tools api.relationLabels is required." };
    } catch (_error) {
      result = { ok: false, message: "Could not update relation-label suggestions." };
    } finally {
      this.relationLabelWrites.delete(key);
    }
    if (!result || result.ok !== true) {
      if (previous) this.relationLabelGhosts.set(key, previous);
      else this.relationLabelGhosts.delete(key);
      this.relationLabelSelectKey(key);
      this.renderResults();
      new Notice((result && result.message) || "Could not update relation-label suggestions.");
      return false;
    }
    this.relationLabelSelectKey(key);
    this.renderResults();
    return true;
  }

  relationCancelLabelsConfig() {
    try {
      if (
        this.plugin &&
        typeof this.plugin.loadRelationsCancelLabels === "function"
      ) {
        return this.plugin.loadRelationsCancelLabels();
      }
      return loadRelationsCancelLabels();
    } catch (_error) {
      return emptyRelationsCancelLabels();
    }
  }

  relationCloseLabelsConfig() {
    try {
      if (
        this.plugin &&
        typeof this.plugin.loadRelationsCloseLabels === "function"
      ) {
        return this.plugin.loadRelationsCloseLabels();
      }
      if (
        this.plugin &&
        typeof this.plugin.loadRelationsCancelLabels === "function"
      ) {
        return Object.freeze({
          cancel: this.plugin.loadRelationsCancelLabels(),
          complete: emptyRelationsCancelLabels(),
          warnings: Object.freeze([]),
        });
      }
      return loadRelationsCloseLabels();
    } catch (_error) {
      return emptyRelationsCloseLabels();
    }
  }

  relationCancelContentForRef(ref) {
    const path = normalizeVaultRelativePath((ref && ref.path) || "");
    if (
      path && path === normalizeVaultRelativePath(this.filePath || "") &&
      typeof this.getEditorContent === "function"
    ) {
      return String(this.getEditorContent() || "");
    }
    const files = this.vaultStage && this.vaultStage.files;
    if (path && files instanceof Map && files.has(path)) {
      return String(files.get(path) || "");
    }
    return String((ref && ref.rawLine) || "");
  }

  relationCancelPreviewForLabel(label, targetOverrides = new Map()) {
    const normalized = normalizeRelationLabel(String(label || ""));
    const closeConfig = this.relationCloseLabelsConfig();
    const config = closeConfig.cancel || this.relationCancelLabelsConfig();
    const configuredKeys = relationCancelLabelsSet(config);
    const linkedFrom = this.isLinkedFromSession();
    const labelTargets = Array.isArray(this.relationLabelTargets)
      ? this.relationLabelTargets
      : [];
    const sourceRefs = linkedFrom
      ? labelTargets
      : this.relationStageSourceRefs();
    const edgeTargets = linkedFrom
      ? this.relationStageSourceRefs(targetOverrides).slice(0, 1)
      : labelTargets.map((target) => {
          const key = `${normalizeVaultRelativePath(target.path || "")}\x00${target.line}`;
          const extra = targetOverrides instanceof Map ? targetOverrides.get(key) : null;
          return {
            ...target,
            blockId: (extra && extra.blockId) || target.blockId || target.existingBlockId || null,
          };
        });
    for (const target of edgeTargets) {
      if (target && normalized) target.label = normalized;
    }
    const listed =
      this.plugin && typeof this.plugin.readDependencyVaultFileList === "function"
        ? this.plugin.readDependencyVaultFileList()
        : this.vaultStage && this.vaultStage.files instanceof Map
          ? [...this.vaultStage.files.keys()]
          : [];
    const vaultFiles = (Array.isArray(listed) ? listed : []).map((entry) =>
      typeof entry === "string" ? { path: entry } : entry,
    );
    const resolveLinkpath =
      this.plugin && typeof this.plugin.dependencyLinkpathResolver === "function"
        ? this.plugin.dependencyLinkpathResolver()
        : null;
    const completeKeys = relationCompleteLabelsSet(closeConfig.complete);
    const policySources = [];
    const sourceDetails = [];
    let relabelAway = false;
    let relabelAwayDone = false;

    for (const sourceRef of sourceRefs) {
      const sourcePath = normalizeVaultRelativePath((sourceRef && sourceRef.path) || "");
      const content = this.relationCancelContentForRef(sourceRef);
      const lines = content.split(/\r?\n/);
      let sourceLine = Math.floor(numericOrDefault(sourceRef && sourceRef.line, 0));
      const blockId = normalizeBulletPropertyValue((sourceRef && sourceRef.blockId) || "");
      if (blockId) {
        const found = findTaskLineByTrailingBlockId(lines, blockId);
        if (found !== null) sourceLine = found;
      }
      if (sourceLine < 0 || sourceLine >= lines.length) sourceLine = 0;
      const rawLine = String(lines[sourceLine] || (sourceRef && sourceRef.rawLine) || "");
      const liveSource = {
        ...sourceRef,
        path: sourcePath,
        line: sourceLine,
        blockId: blockId || getTrailingBlockId(rawLine) || null,
        rawLine,
      };
      const children = rawLine && isObsidianTaskAtLine(content, sourceLine)
        ? findLinksChildren(lines, sourceLine)
        : [];
      const existingRows = children.flatMap((index) =>
        relationLinksRows(sourcePath, lines[index], resolveLinkpath, vaultFiles),
      );
      const validTargets = edgeTargets.filter(
        (target) => target && target.path && target.blockId,
      );
      const links = validTargets.map((target) =>
        storedRelationLinkForTarget(existingRows, target, sourcePath, vaultFiles),
      );
      const report = this.relationLabelMode === "relabel"
        ? { added: [], relabeled: links, unchanged: [] }
        : { added: links, relabeled: [], unchanged: [] };
      const edges = deriveRelationCancelEdges({
        report,
        existingRows,
        liveAdd: this.relationLabelMode === "relabel" ? [] : validTargets,
        liveRelabel: this.relationLabelMode === "relabel" ? validTargets : [],
        sourcePath,
        vaultFiles,
      });
      const policySource = relationCancelPolicySourceFromLine(
        liveSource,
        rawLine,
        edges,
      );
      policySources.push(policySource);
      const status = relationCancelSourceStatus(rawLine);
      const projectOpenTasks = policySource.isProject
        ? collectProjectNoteTaskRows(content).residents.length
        : null;
      sourceDetails.push({
        text: cleanTaskDisplayText(rawLine) || sourceRef.displayText || "task",
        path: sourcePath,
        line: sourceLine,
        blockId: policySource.blockId,
        status,
        projectOpenTasks,
      });
      if (
        this.relationLabelMode === "relabel" &&
        status === "-" &&
        normalized &&
        !configuredKeys.has(relationCancelLabelKey(normalized))
      ) {
        const targetIdentities = new Set(
          validTargets.map((target) => blocksIdentity(target.path, target.blockId)),
        );
        relabelAway = relabelAway || existingRows.some(
          (row) => targetIdentities.has(row.identity) &&
            configuredKeys.has(relationCancelLabelKey(row.label)),
        );
      }
      if (
        this.relationLabelMode === "relabel" &&
        (status === "x" || status === "X") &&
        normalized &&
        !completeKeys.has(relationCancelLabelKey(normalized))
      ) {
        const targetIdentities = new Set(
          validTargets.map((target) => blocksIdentity(target.path, target.blockId)),
        );
        relabelAwayDone = relabelAwayDone || existingRows.some(
          (row) => targetIdentities.has(row.identity) &&
            completeKeys.has(relationCancelLabelKey(row.label)),
        );
      }
    }

    const api = relationTaskStatusCyclerApi(this.plugin && this.plugin.app);
    const closingPlans = policySources.map((source) =>
      planRelationClosingSource({
        cancelLabels: config,
        completeLabels: closeConfig.complete,
        trigger: RELATION_CANCEL_EXPLICIT_TRIGGER,
        cyclerApiAvailable: relationCompleteCyclerApiAvailable(api),
        source,
      }),
    );
    const plan = {
      sources: closingPlans.map((entry) => entry.cancel).filter(Boolean),
      cancels: closingPlans.map((entry) => entry.cancel).filter((entry) => entry && entry.cancels),
      refusals: closingPlans.map((entry) => entry.cancelRefusal).filter(Boolean),
    };
    const completePlan = {
      sources: closingPlans.map((entry) => entry.complete).filter(Boolean),
      completes: closingPlans.map((entry) => entry.complete).filter((entry) => entry && entry.completes),
      refusals: closingPlans.map((entry) => entry.completeRefusal).filter(Boolean),
    };
    const sources = plan.sources.map((source, index) => ({
      ...source,
      ...(sourceDetails[index] || {}),
    }));
    const completeSources = completePlan.sources.map((source, index) => ({
      ...source,
      ...(sourceDetails[index] || {}),
    }));
    const cancels = sources.filter((source) => source.cancels === true);
    const completes = completeSources.filter((source) => source.completes === true);
    let refusal = null;
    if (plan.refusals.length > 0) {
      const refused = sources.find((source) => source.refusal);
      refusal = refused && refused.verdict === "recurring"
        ? `“${refused.text}” repeats — cancel it with Obsidian Tasks first`
        : (refused && refused.refusal && refused.refusal.message) || "This relation cannot be committed";
    }
    let completeRefusal = null;
    if (completePlan.refusals.length > 0) {
      const refused = completeSources.find((source) => source.refusal);
      if (refused && refused.verdict === "recurring") {
        completeRefusal = `“${refused.text}” repeats — complete it in Obsidian so Tasks writes the next one`;
      } else if (refused && refused.verdict === "cycler_api") {
        completeRefusal = "Update Task Status Cycler to complete from a link";
      } else {
        completeRefusal = (refused && refused.refusal && refused.refusal.message) ||
          "This relation cannot be committed";
      }
    }
    const expected = summarizeRelationCancelEffects(
      plan,
      formatBulletPropertyDate(new Date()),
    );
    const expectedCloseEffects = summarizeRelationCloseEffects(
      plan.sources,
      completePlan,
      expected.day,
    );
    this.relationCloseExpected = expectedCloseEffects;
    const inverseLabel = normalized && !configuredKeys.has(relationCancelLabelKey(normalized))
      ? relationCancelInverseLabel(normalized, config)
      : null;
    const completeInverse = normalized && !completeKeys.has(relationCancelLabelKey(normalized))
      ? relationCompleteInverseLabel(normalized, closeConfig.complete)
      : null;
    const targetForInverse = linkedFrom
      ? sourceDetails[0] && sourceDetails[0].text
      : labelTargets[0] && (labelTargets[0].displayText || labelTargets[0].text);
    const completeTargetForInverse = linkedFrom
      ? (this.vaultStage && Array.isArray(this.vaultStage.sources) && this.vaultStage.sources[0]
        && (this.vaultStage.sources[0].displayText || this.vaultStage.sources[0].text)) || "this"
      : labelTargets[0] && (labelTargets[0].displayText || labelTargets[0].text);
    const cancelledTarget = edgeTargets.find((target) => {
      const raw = String((target && target.rawLine) || "");
      return relationCancelSourceStatus(raw) === "-";
    });
    const targetCancelledCaveat = cancelledTarget
      ? `“${cancelledTarget.displayText || cancelledTarget.text || "that task"}” is Cancelled`
      : "";
    return Object.freeze({
      configured: Boolean(normalized && configuredKeys.has(relationCancelLabelKey(normalized))),
      configuredComplete: Boolean(normalized && completeKeys.has(relationCancelLabelKey(normalized))),
      sources: Object.freeze(sources),
      cancels: Object.freeze(cancels),
      refusal,
      staysCancelled: relabelAway,
      staysDone: relabelAwayDone,
      completes: Object.freeze(completes),
      completeSources: Object.freeze(completeSources),
      completeRefusal,
      expectedCloseEffects,
      targetCancelledCaveat,
      inverseHint: inverseLabel
        ? `“${normalized}” never cancels · to retire “${targetForInverse || "that task"}”, use ⇧L`
        : completeInverse
          ? `“${normalized}” never completes · to finish “${completeTargetForInverse || "that task"}”, use ${linkedFrom ? "l" : "⇧L"} with “${completeInverse}”`
          : "",
      expected,
    });
  }

  relationCancelStayHintForItem(item) {
    if (!item || item.stageSection !== "current") return "";
    const close = this.relationCloseLabelsConfig();
    const cancelKeys = relationCancelLabelsSet(close.cancel || this.relationCancelLabelsConfig());
    const completeKeys = relationCompleteLabelsSet(close.complete);
    const label = this.isLinkedFromSession()
      ? item.storedLabel || item.label
      : item.label;
    const key = relationCancelLabelKey(label);
    const sources = this.isLinkedFromSession() ? [item] : this.relationStageSourceRefs();
    for (const source of sources) {
      const rawLine = this.relationCancelContentForRef(source).split(/\r?\n/)[
        Math.max(0, Math.floor(numericOrDefault(source.line, 0)))
      ] || source.rawLine || "";
      const status = relationCancelSourceStatus(rawLine);
      if (cancelKeys.has(key) && status === "-") {
        return "⊘ Stays Cancelled · reopen with Alt+]";
      }
      if (completeKeys.has(key) && (status === "x" || status === "X")) {
        return "stays Done · reopen with Alt+[";
      }
    }
    return "";
  }

  relationLabelLiveContext(item, preview) {
    const linkedFrom = this.isLinkedFromSession();
    const sources = this.vaultStage && Array.isArray(this.vaultStage.sources)
      ? this.vaultStage.sources
      : [];
    const targets = Array.isArray(this.relationLabelTargets)
      ? this.relationLabelTargets
      : [];
    const sourceRef = linkedFrom ? targets[0] : sources[0];
    const source = preview && preview.completes && preview.completes[0]
      ? preview.completes[0].text
      : preview && preview.cancels && preview.cancels[0]
        ? preview.cancels[0].text
        : (sourceRef && (sourceRef.displayText || sourceRef.text)) || "This task";
    const sourcePath = normalizeVaultRelativePath((sourceRef && sourceRef.path) || "");
    const activePath = normalizeVaultRelativePath(this.filePath || "");
    const sourceText = sourcePath && sourcePath !== activePath
      ? `${source} (${dependencyStageBasenameOf(sourcePath)})`
      : source;
    const firstTarget = targets[0];
    const targetText = linkedFrom
      ? "this"
      : targets.length > 1
        ? `${(firstTarget && (firstTarget.displayText || firstTarget.text || firstTarget.blockId)) || "that task"} +${targets.length - 1} more`
        : (firstTarget && (firstTarget.displayText || firstTarget.text || firstTarget.blockId)) || "that task";
    const label = item && item.plain
      ? ""
      : (item && item.label) || (this.getRawQuery ? this.getRawQuery() : "");
    return { sourceText, targetText, label: String(label || "").trim() };
  }

  getRelationLabelSubtitle() {
    const item = (this.visibleItems || [])[this.selectedIndex] || null;
    const label = item && !item.plain
      ? item.label
      : this.getRawQuery ? this.getRawQuery() : "";
    const preview = item && item.cancelPreview
      ? item.cancelPreview
      : this.relationCancelPreviewForLabel(label);
    const context = this.relationLabelLiveContext(item, preview);
    return relationStageLiveSentence(context.sourceText, context.label, context.targetText);
  }

  renderPickerSubtitle(element) {
    if (this.stage !== "relation-label") return false;
    const item = (this.visibleItems || [])[this.selectedIndex] || null;
    const label = item && !item.plain
      ? item.label
      : this.getRawQuery ? this.getRawQuery() : "";
    const preview = item && (item.closePreview || item.cancelPreview)
      ? (item.closePreview || item.cancelPreview)
      : this.relationCancelPreviewForLabel(label);
    const completes = preview && Array.isArray(preview.completes) ? preview.completes : [];
    const cancels = preview && Array.isArray(preview.cancels) ? preview.cancels : [];
    if (completes.length === 0 && cancels.length === 0) {
      return false;
    }
    const context = this.relationLabelLiveContext(item, preview);
    const completeCue = completes.length > 0 && cancels.length === 0;
    element.empty();
    element.createSpan({
      cls: completeCue ? "bob-cnp-relation-complete-mark" : "bob-cnp-relation-cancel-mark",
      text: completeCue ? "✓ " : "⊘ ",
    });
    element.createSpan({
      cls: completeCue ? "bob-cnp-relation-complete-source" : "bob-cnp-relation-cancel-source",
      text: context.sourceText,
    });
    element.createSpan({
      cls: completeCue
        ? "bob-cnp-relation-complete-sentence-tail"
        : "bob-cnp-relation-cancel-sentence-tail",
      text: ` — ${context.label} → ${context.targetText}`,
    });
    return true;
  }

  refreshRelationConsequenceStrip() {
    if (!this.isRelationStage() && this.stage !== "relation-label") {
      if (this.consequenceStripEl) this.consequenceStripEl.setText("");
      return;
    }
    const el = this.ensureRelationConsequenceStrip();
    if (!el) return;
    const item = (this.visibleItems || [])[this.selectedIndex] || null;
    if (this.stage === "relation-label") {
      const preview = item && (item.closePreview || item.cancelPreview)
        ? (item.closePreview || item.cancelPreview)
        : item && item.label
          ? this.relationCancelPreviewForLabel(item.label)
          : null;
      const counts = this.relationLabelCloseCounts(preview);
      const nonce = this.relationLabelCloseNonce(preview);
      const confirmBanner = nonce && this.relationCancelConfirmNonce === nonce
        ? relationCloseConfirmBanner(counts.cancelCount, counts.completeCount)
        : "";
      const text = relationLabelCancelConsequenceStrip(item, {
        preview,
        confirmBanner,
      });
      const completeCue = counts.completeCount > 0 && counts.cancelCount === 0;
      const cancelCue = counts.cancelCount > 0 && counts.completeCount === 0;
      el.empty();
      el.createSpan({
        cls: completeCue
          ? "bob-cnp-consequence-strip-text bob-cnp-relation-complete-effects"
          : cancelCue
            ? "bob-cnp-consequence-strip-text bob-cnp-relation-cancel-effects"
            : "bob-cnp-consequence-strip-text",
        text,
      });
      if (!confirmBanner && preview && preview.targetCancelledCaveat) {
        el.createSpan({
          cls: "bob-cnp-relation-complete-caveat",
          text: ` · ${preview.targetCancelledCaveat}`,
        });
      }
      return;
    }
    const text = relationStageConsequenceStrip(item, {
      marked: this.getMarkedTaskItems(),
      direction: this.relationStageDirection,
      cancelStayHint: this.relationCancelStayHintForItem(item),
    });
    el.empty();
    el.createSpan({ cls: "bob-cnp-consequence-strip-text", text });
  }

  getRelationLabelPreviewItems() {
    const raw = this.getRawQuery ? String(this.getRawQuery() || "") : "";
    if (raw !== this.relationLabelLastQuery) {
      this.relationLabelLastQuery = raw;
      this.relationLabelGhosts = new Map();
      this.relationLabelOneOff = false;
      this.relationLabelTabNoMatch = false;
      this.relationCancelConfirmNonce = null;
      this.relationCancelExpected = null;
      this.relationCloseExpected = null;
      this.selectedIndex = 0;
    }
    const typed = normalizeRelationLabel(raw);
    const closeConfig = this.relationCloseLabelsConfig();
    const config = closeConfig.cancel || this.relationCancelLabelsConfig();
    const completeConfig = closeConfig.complete || emptyRelationsCancelLabels();
    const configuredComplete = relationCompleteLabelsSet(completeConfig);
    const suggestions = mergeRelationCompleteLabelSuggestions(
      mergeRelationCancelLabelSuggestions(
        this.readRelationLabelSuggestions(raw, { hidden: "include" }),
        config,
        raw,
      ),
      completeConfig,
      raw,
    );
    const ghosts = this.relationLabelGhosts instanceof Map
      ? this.relationLabelGhosts
      : new Map();
    const effective = suggestions.map((row) => {
      const ghost = ghosts.get(row.key);
      return ghost
        ? { ...row, hidden: ghost.hidden, ghost: true }
        : { ...row, ghost: false };
    });
    this.relationLabelTopMatchKey = (effective.find((row) => row.hidden !== true && row.ghost !== true) || {}).key || "";
    const out = [];
    const decorate = (item) => {
      if (!item || item.kind !== "relation-label" || item.plain || !item.label) return Object.freeze(item);
      const configuredCancel = item.configuredCancel === true ||
        relationCancelLabelsSet(config).has(relationCancelLabelKey(item.label));
      const completeLabel = item.configuredComplete === true ||
        configuredComplete.has(relationCancelLabelKey(item.label));
      const inverse = relationCancelInverseLabel(item.label, config) ||
        relationCompleteInverseLabel(item.label, completeConfig);
      const preview = configuredCancel || completeLabel || inverse
        ? this.relationCancelPreviewForLabel(item.label)
        : null;
      const disabledReason = configuredCancel && preview && preview.refusal
        ? preview.refusal
        : completeLabel && preview && preview.completeRefusal
          ? preview.completeRefusal
          : "";
      return Object.freeze({
        ...item,
        configuredCancel,
        configuredComplete: completeLabel,
        cancelPreview: preview,
        closePreview: preview,
        disabled: item.disabled === true || Boolean(disabledReason),
        disabledReason: disabledReason || item.disabledReason || "",
      });
    };
    if (!raw.trim()) {
      out.push(Object.freeze({
        kind: "relation-label",
        label: null,
        typed: false,
        plain: true,
        displayText: "Plain link (no relation)",
        searchText: "",
        oneOff: false,
      }));
    } else if (typed) {
      const key = relationCancelLabelKey(typed);
      const existing = suggestions.find((row) => relationCancelLabelKey(row.key) === key) || null;
      const labelValue = existing ? existing.label : typed;
      const hidden = existing ? existing.hidden === true : false;
      const warning = Boolean(this.relationLabelOneOff && existing && !hidden && existing.count > 0);
      out.push(decorate({
        kind: "relation-label",
        key,
        label: labelValue,
        typed: !existing,
        existing: Boolean(existing),
        count: existing ? existing.count : 0,
        hidden,
        configuredCancel: existing && existing.configuredCancel === true,
        configuredComplete: existing && existing.configuredComplete === true,
        oneOff: this.relationLabelOneOff === true,
        warning,
        warningText: warning
          ? `⚠ Capturing also hides “${labelValue}” (${existing.count} links) from suggestions. Existing links keep their label.`
          : "",
        displayText: labelValue,
        searchText: labelValue,
      }));
    } else {
      return Object.freeze([Object.freeze({
        kind: "relation-label-invalid",
        label: null,
        reason: describeRelationLabelRefusal(raw) || "That relation cannot be used",
        displayText: describeRelationLabelRefusal(raw) || "That relation cannot be used",
        searchText: "",
        disabled: true,
      })]);
    }
    const typedKey = typed ? relationCancelLabelKey(typed) : "";
    const visibleRows = effective.filter((row) => row.hidden !== true && relationCancelLabelKey(row.key) !== typedKey);
    const hiddenRows = effective.filter((row) => row.hidden === true && relationCancelLabelKey(row.key) !== typedKey);
    const visibleLimit = 12
      + (Array.isArray(config && config.keys) ? config.keys.length : 0)
      + (Array.isArray(completeConfig && completeConfig.keys) ? completeConfig.keys.length : 0);
    const toItem = (row) => decorate({
      kind: "relation-label",
      key: row.key,
      label: row.label,
      count: Math.max(0, Math.floor(numericOrDefault(row.count, 0))),
      inverse: row.inverse || null,
      hidden: row.hidden === true,
      ghost: row.ghost === true,
      configuredCancel: row.configuredCancel === true,
      configuredComplete: row.configuredComplete === true,
      typed: false,
      displayText: row.label,
      searchText: row.label,
    });
    for (const row of visibleRows) {
      out.push(toItem(row));
      if (out.length >= visibleLimit) break;
    }
    if (this.relationLabelShowHidden === true && hiddenRows.length > 0 && out.length < 13) {
      out.push(Object.freeze({
        kind: "relation-label-heading",
        displayText: "Hidden",
        searchText: "",
        nonSelectable: true,
      }));
      for (const row of hiddenRows) {
        out.push(toItem(row));
        if (out.length >= 24) break;
      }
    } else if (this.relationLabelShowHidden !== true) {
      for (const row of hiddenRows.filter((entry) => entry.ghost)) {
        out.push(toItem(row));
        if (out.length >= 24) break;
      }
    }
    const selectedIndex = Math.max(0, Math.min(this.selectedIndex || 0, out.length - 1));
    const selected = out[selectedIndex];
    this.relationCloseExpected =
      selected && selected.closePreview
        ? selected.closePreview.expectedCloseEffects || null
        : null;
    if (selected && selected.kind === "relation-label" && !selected.plain && !selected.cancelPreview) {
      out[selectedIndex] = decorate({
        ...selected,
        cancelPreview: this.relationCancelPreviewForLabel(selected.label),
      });
    }
    return Object.freeze(out);
  }

  handleRelationLabelKeydown(event) {
    if (
      !event || typeof event.key !== "string" || event.isComposing === true || event.keyCode === 229 ||
      this.stage !== "relation-label"
    ) return false;
    const noMetaAlt = event.metaKey !== true && event.altKey !== true;
    if (event.key === "Escape" && noMetaAlt && event.ctrlKey !== true) {
      if (!this.relationCancelConfirmNonce) return false;
      event.preventDefault();
      event.stopPropagation();
      this.relationCancelConfirmNonce = null;
      this.relationCancelExpected = null;
      this.relationCloseExpected = null;
      if (typeof this.renderResults === "function") this.renderResults();
      return true;
    }
    if (event.key === "Tab" && noMetaAlt && event.ctrlKey !== true) {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey === true) return true;
      if (this.opening) return true;
      const selected = (this.visibleItems || [])[this.selectedIndex];
      let index = this.selectedIndex;
      if (!selected || selected.typed === true || selected.plain === true || this.selectedIndex === 0) {
        const top = selected && selected.key === this.relationLabelTopMatchKey && selected.hidden !== true
          ? 0
          : (this.visibleItems || []).findIndex((row, rowIndex) =>
            rowIndex > 0 && row && row.kind === "relation-label" && row.hidden !== true && row.ghost !== true,
          );
        if (top < 0) {
          this.relationLabelTabNoMatch = true;
          this.renderResults();
          return true;
        }
        index = top;
      }
      this.relationLabelTabNoMatch = false;
      void this.openItemAtIndex(index);
      return true;
    }
    if (event.key.toLowerCase() === "r" && event.ctrlKey === true && noMetaAlt && event.shiftKey !== true) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat !== true) {
        const item = (this.visibleItems || [])[this.selectedIndex] || null;
        this.openRelationLabelRenameForStage(item);
      }
      return true;
    }
    if (
      event.key === "ArrowDown" ||
      (event.key.toLowerCase() === "n" && event.ctrlKey === true && noMetaAlt && event.shiftKey !== true)
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.moveRelationLabelSelection(1);
      return true;
    }
    if (
      event.key === "ArrowUp" ||
      (event.key.toLowerCase() === "p" && event.ctrlKey === true && noMetaAlt && event.shiftKey !== true)
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.moveRelationLabelSelection(-1);
      return true;
    }
    if (event.key === "|" && noMetaAlt && event.ctrlKey !== true) {
      event.preventDefault();
      event.stopPropagation();
      if (String(this.getRawQuery ? this.getRawQuery() : "").trim()) {
        this.relationLabelOneOff = true;
        this.relationLabelTabNoMatch = false;
        this.renderResults();
      }
      return true;
    }
    if (event.key.toLowerCase() === "d" && event.ctrlKey === true && noMetaAlt && event.shiftKey !== true) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat === true) return true;
      const item = (this.visibleItems || [])[this.selectedIndex] || null;
      if (this.selectedIndex === 0 || !item || item.typed === true || item.plain === true) {
        if (String(this.getRawQuery ? this.getRawQuery() : "").trim()) {
          this.relationLabelOneOff = !this.relationLabelOneOff;
          this.renderResults();
        }
        return true;
      }
      if (!item.nonSelectable) void this.toggleRelationLabelVisibility(item);
      return true;
    }
    if (event.key.toLowerCase() === "h" && event.ctrlKey === true && noMetaAlt && event.shiftKey !== true) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat !== true) {
        this.relationLabelShowHidden = this.relationLabelShowHidden !== true;
        this.selectedIndex = 0;
        this.relationLabelTabNoMatch = false;
        this.renderResults();
      }
      return true;
    }
    return false;
  }
}
