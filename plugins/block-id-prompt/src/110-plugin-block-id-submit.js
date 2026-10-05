class BlockIdPromptBlockIdSubmitMixin {
  async submitBlockId(source, newId) {
    if (source.kind === "direct-add") {
      return this.submitDirectBlockAdd(source, newId);
    }

    if (source.kind === "direct-rename") {
      return this.submitDirectBlockRename(source, newId);
    }

    if (source.kind === "link-task-complete") {
      return this.submitLinkTaskBlockId(source, newId);
    }

    if (source.kind === "link-task-pomodoro") {
      return this.submitPomodoroTaskLinkBlockId(source, newId);
    }

    return this.submitLinkedBlockId(source, newId);
  }

  async submitLinkedBlockId(source, newId) {
    if (!this.sourceMarkerStillPresent(source)) {
      return false;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Block ID rename blocked: target note could not be resolved");
      return false;
    }

    if (newId !== source.oldId) {
      const duplicateMatches = blockTokenMatches(destination.content, newId);
      if (duplicateMatches.length > 0) {
        new Notice(`Block ID '${newId}' already exists in ${destination.file.path}`);
        return false;
      }
    }

    const oldMatches = blockTokenMatches(destination.content, source.oldId);
    if (oldMatches.length !== 1) {
      new Notice(
        `Block ID rename blocked: old ID was not found exactly once in ${destination.file.path}`,
      );
      return false;
    }

    const plan = await this.buildReferenceRewritePlan(source, destination, newId);
    if (!plan) {
      return false;
    }

    if (plan.unsupportedCount > 0) {
      new Notice(
        `Block ID rename blocked: ${plan.unsupportedCount} old ${pluralize(
          plan.unsupportedCount,
          "link",
          "links",
        )} could not be rewritten safely`,
      );
      return false;
    }

    if (!(await this.applyReferenceRewritePlan(plan, source))) {
      return true;
    }

    if (
      !(await this.renameDestinationBlock(
        destination.file,
        source,
        source.oldId,
        newId,
        plan.destinationContentAfterReferences,
      ))
    ) {
      return true;
    }

    if (newId === source.oldId) {
      new Notice(
        `Updated ${plan.editCount} ${pluralize(plan.editCount, "link", "links")}`,
      );
    } else {
      new Notice(
        `Renamed block ID and updated ${plan.editCount} ${pluralize(
          plan.editCount,
          "link",
          "links",
        )}`,
      );
    }

    return true;
  }

  async submitDirectBlockRename(source, newId) {
    if (!this.directRenameSourceStillPresent(source)) {
      return false;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Block ID rename blocked: target note could not be resolved");
      return false;
    }

    if (newId !== source.oldId) {
      const duplicateMatches = blockTokenMatches(destination.content, newId);
      if (duplicateMatches.length > 0) {
        new Notice(`Block ID '${newId}' already exists in ${destination.file.path}`);
        return false;
      }
    }

    const oldMatches = blockTokenMatches(destination.content, source.oldId);
    if (oldMatches.length !== 1) {
      new Notice(
        `Block ID rename blocked: old ID was not found exactly once in ${destination.file.path}`,
      );
      return false;
    }

    const plan = await this.buildReferenceRewritePlan(
      source,
      destination,
      newId,
      { requireSourceMarker: false },
    );
    if (!plan) {
      return false;
    }

    if (plan.unsupportedCount > 0) {
      new Notice(
        `Block ID rename blocked: ${plan.unsupportedCount} old ${pluralize(
          plan.unsupportedCount,
          "link",
          "links",
        )} could not be rewritten safely`,
      );
      return false;
    }

    if (!(await this.applyReferenceRewritePlan(plan, source))) {
      return true;
    }

    if (
      !(await this.renameDestinationBlock(
        destination.file,
        source,
        source.oldId,
        newId,
        plan.destinationContentAfterReferences,
      ))
    ) {
      return true;
    }

    if (newId === source.oldId) {
      new Notice(
        `Updated ${plan.editCount} ${pluralize(plan.editCount, "link", "links")}`,
      );
    } else {
      new Notice(
        `Renamed block ID and updated ${plan.editCount} ${pluralize(
          plan.editCount,
          "link",
          "links",
        )}`,
      );
    }

    return true;
  }

  submitDirectBlockAdd(source, newId) {
    if (!this.directAddSourceStillPresent(source)) {
      return false;
    }

    const content = source.editor.getValue();
    const duplicateMatches = blockTokenMatches(content, newId);
    if (duplicateMatches.length > 0) {
      new Notice(`Block ID '${newId}' already exists in ${source.sourcePath}`);
      return false;
    }

    this.suppressEditorScans();
    if (source.addMode === "append") {
      source.editor.replaceRange(
        ` ^${newId}`,
        { line: source.line, ch: source.startCh },
        { line: source.line, ch: source.endCh },
      );
    } else {
      source.editor.replaceRange(
        `\n^${newId}`,
        { line: source.line, ch: source.startCh },
        { line: source.line, ch: source.endCh },
      );
    }

    new Notice("Added block ID");
    return true;
  }

  async submitLinkTaskBlockId(source, newId) {
    if (!this.sourceMarkerStillPresent(source)) {
      return false;
    }

    const destination = await this.readDestinationForValidation(source);
    if (!destination || destination.content === null) {
      new Notice("Task link blocked: target note could not be resolved");
      return false;
    }

    const duplicateMatches = blockTokenMatches(destination.content, newId);
    if (duplicateMatches.length > 0) {
      new Notice(`Block ID '${newId}' already exists in ${destination.file.path}`);
      return false;
    }

    if (!this.taskLineStillPresent(destination.content, source.task, destination.file.path)) {
      return false;
    }

    const activationEligible = sourceQualifiesForPomodoroActivation(source);
    const plan = planTargetTaskUpdate(destination.content, source.task.line, {
      newBlockId: newId,
      activationEligible,
      now: this.now(),
      stampLine: this.getFreshnessStampLine(),
      freshDateText: this.getFreshnessDateText(),
    });
    if (!plan) {
      new Notice(`Task link stopped: selected task changed in ${destination.file.path}`);
      return false;
    }

    if (
      !(await this.applyTargetTaskPlan(destination.file, source, plan, destination.content))
    ) {
      return false;
    }

    const completionSource = this.adjustSourceForPlan(source, destination.file.path, plan);
    const completion = this.completeTaskSourceLink(
      completionSource,
      newId,
      destination.file.path,
    );
    if (!completion) {
      const parts = activationPartialFailureParts(plan);
      new Notice(
        `Task block ID added${parts.length ? ` and ${parts.join(", ")}` : ""}, but the source link changed before completion`,
      );
      return true;
    }

    new Notice(
      `Added block ID and linked task${activationSuccessSuffix(plan)}${this.futureLinkCleanupNoticeSuffix(completion.removedCount)}`,
    );
    return true;
  }

}
