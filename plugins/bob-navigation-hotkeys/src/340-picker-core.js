class BulletPropertyPickerModal extends FilteredPickerModal {
  constructor(app, plugin, editor, cursor, lineText, config, context = {}) {
    super(app, taskCardNeutralStageOptions());

    this.plugin = plugin;
    this.editor = editor;
    this.cursor = cursor;
    this.lineText = lineText;
    this.config = config;
    this.propertyContext = context.propertyContext || {};
    this.filePath = context.filePath || "";
    this.taskSession = context.taskSession || null;
    this.linkSession = context.linkSession || null;
    this.bulletSubtitle = truncateBulletPropertySubtitle(lineText);
    this.stage = TASK_CARD_PENDING_STAGE;
    this.selectedPropertyItem = null;
    this.pendingTask = null;
    this.markedLines = new Set();
    this.taskItemsByLine = new Map();
    this.priorityRandom =
      typeof context.random === "function" ? context.random : Math.random;
    // The Task Card is this modal's home surface. A direct stage (the
    // `initialProperty: "dependsOn"` skip, the decay Less often picker) opens
    // its value stage without ever painting the card, so it has no card to
    // return to: Back, empty-Backspace and refused stages close it instead.
    this.directStage =
      Boolean(context.initialProperty) || context.directStage === true;
    this.hasTaskCard = !this.directStage;
    this.linkResolving = context.linkResolving === true;
    this.taskCardModel = null;
    this.taskCardSelectedRowId = "schedule";
    this.taskCardListEl = null;
    this.fixedValueBaseDate =
      context.baseDate instanceof Date
        ? getLocalDateStart(context.baseDate)
        : null;
    // Batch block-ID prompting state; populated only while the modal is
    // collecting block IDs for a pending multi-task apply (see commit flow).
    this.pendingBatch = null;
    this.pendingCountedDependency = null;
    this.pendingVaultSingle = null;
    this.pendingVaultCounted = null;
    this.blockIdMode = "single";
    this.blockIdContext = null;
    this.pendingScheduleReason = null;
    this.pendingCancel = null;
    this.pendingLaneRelease = null;
    this.pendingScheduleWorkLog = null;
    // Vault-wide Depends on stage (nav-stage) state: the sync pool built when
    // the local-task value stage opens, plus the property rows for the
    // `initialProperty` skip. `initialProperty: "dependsOn"` opens the
    // Depends on value stage straight from the cursor entry points.
    this.initialProperty = context.initialProperty || null;
    this.propertyItems = [];
    this.vaultStage = null;
    this.vaultStageRefreshId = 0;
    // Review-walk auto-advance (nav-gestures): the landing origin captured
    // when the card opened, the cursor line it was captured on, and that
    // line's text before any write. `reviewSettleDeferred` lets the cancel
    // route close the picker first and settle after its notice.
    this.reviewOrigin = context.reviewOrigin || null;
    this.reviewLineIndex = Number.isInteger(context.reviewLineIndex)
      ? context.reviewLineIndex
      : null;
    this.reviewBeforeLine =
      typeof context.reviewBeforeLine === "string"
        ? context.reviewBeforeLine
        : "";
    this.reviewSettleDeferred = false;
    this.valueBaseDate = this.fixedValueBaseDate || getLocalDateStart(new Date());
    // The Ctrl+Enter recommendation is previewed once when the picker opens
    // (what you see is what you get): the write reuses exactly this date and
    // offset. Only Ctrl+R and the stale-write path replace it.
    this.priorityRollRecommendation = null;
    this.priorityRollRecommendationReady = false;
    this.countedRollBatch = null;
    this.countedRollBatchReady = false;
    this.linkRollBatch = null;
    this.linkRollBatchReady = false;
    this.refreshPriorityRollRecommendation();
    this.refreshCountedRollBatch();
    this.refreshLinkRollBatch();
    if (!this.linkResolving) {
      this.refreshPropertyItems();
    }
    if (this.hasTaskCard) {
      this.showTaskCard({ rebuild: true });
    }
  }

}
