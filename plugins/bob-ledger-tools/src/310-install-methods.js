function installBobLedgerToolsMixins(pluginClass, mixins) {
  const installedNames = new Set(
    Reflect.ownKeys(pluginClass.prototype).filter((name) => name !== "constructor"),
  );
  for (const Mixin of mixins) {
    const descriptors = Object.getOwnPropertyDescriptors(Mixin.prototype);
    const names = Reflect.ownKeys(descriptors).filter((name) => name !== "constructor");
    for (const name of names) {
      if (installedNames.has(name)) {
        throw new Error("Duplicate BobLedgerToolsPlugin method: " + String(name));
      }
    }
    for (const name of names) {
      Object.defineProperty(pluginClass.prototype, name, descriptors[name]);
      installedNames.add(name);
    }
  }
}

installBobLedgerToolsMixins(BobLedgerToolsPlugin, [
  BobLedgerToolsPlanAndReadyMixin,
  BobLedgerToolsNoteReadyMixin,
  BobLedgerToolsDashboardMixin,
  BobLedgerToolsReadyNotesMixin,
  BobLedgerToolsHeadingReviewMixin,
  BobLedgerToolsFreshnessApiMixin,
  BobLedgerToolsStatsJournalMixin,
  BobLedgerToolsStatsDataMixin,
  BobLedgerToolsStatsCacheMixin,
  BobLedgerToolsStatsClockMixin,
  BobLedgerToolsReadingBoardDataMixin,
  BobLedgerToolsReadingBoardBlockMixin,
  BobLedgerToolsStatsBlockMixin,
  BobLedgerToolsStatsChartMixin,
  BobLedgerToolsStatsHomesMixin,
  BobLedgerToolsStatsPanelsMixin,
  BobLedgerToolsStatsLanesMixin,
  BobLedgerToolsDayStripMixin,
  BobLedgerToolsDayStripLanesMixin,
  BobLedgerToolsDayStripFenceMixin,
  BobLedgerToolsDayStripPlanHostMixin,
  BobLedgerToolsPeriodStripMixin,
  BobLedgerToolsFreshnessStatusMixin,
  BobLedgerToolsFreshnessMarkModelMixin,
  BobLedgerToolsFreshnessMarkRenderMixin,
  BobLedgerToolsTaskTagMarksMixin,
  BobLedgerToolsTaskTagTypeMixin,
  BobLedgerToolsPriorityMarksMixin,
  BobLedgerToolsMarkGateMixin,
  BobLedgerToolsDateMarksMixin,
  BobLedgerToolsDateMarksTasksMixin,
  BobLedgerToolsProgressMarksMixin,
  BobLedgerToolsLedgerTypeMarksMixin,
  BobLedgerToolsProgressMarksReadingMixin,
  BobLedgerToolsPomodoroHomeChipsMixin,
  BobLedgerToolsPomodoroHomeChipsReadingMixin,
  BobLedgerToolsPomodoroThemesMixin,
  BobLedgerToolsTaskThemeApiMixin,
  BobLedgerToolsTaskThemeEditorMixin,
  BobLedgerToolsTaskRootMarksMixin,
  BobLedgerToolsTaskThemeReadingMixin,
  BobLedgerToolsTaskThemeTasksMixin,
  BobLedgerToolsPomodoroThemeChipsMixin,
  BobLedgerToolsPomodoroThemeChipsReadingMixin,
  BobLedgerToolsDependencyModelMixin,
  BobLedgerToolsRelationLabelsMixin,
  BobLedgerToolsAttachmentsMixin,
  BobLedgerToolsRelationIndexMixin,
  BobLedgerToolsRelationModelMixin,
  BobLedgerToolsBlocksModelMixin,
  BobLedgerToolsBlockMarksMixin,
  BobLedgerToolsBlockMarksRenderMixin,
  BobLedgerToolsBlockMarksRuntimeMixin,
  BobLedgerToolsBlockMarksEditorMixin,
  BobLedgerToolsBlockMarksReadingDomMixin,
  BobLedgerToolsBlockMarksReadingMixin,
  BobLedgerToolsBlockMarkFoldsMixin,
  BobLedgerToolsUnblockedGlyphMixin,
  BobLedgerToolsFreesMarksMixin,
  BobLedgerToolsOffClockLinkChipsMixin,
  BobLedgerToolsOffClockLinkChipsReadingMixin,
  BobLedgerToolsDependencyRenderMixin,
  BobLedgerToolsBlocksRenderMixin,
  BobLedgerToolsRelationRenderMixin,
  BobLedgerToolsRelationMentionCardMixin,
  BobLedgerToolsCommandModeRefreshMixin,
  BobLedgerToolsKeepInboxMixin,
  BobLedgerToolsTodayLocationMixin,
  BobLedgerToolsTodayMarksMixin,
  BobLedgerToolsTodayMarksReadingMixin,
  BobLedgerToolsTodayMarksReadingClicksMixin,
  BobLedgerToolsTaskLinkMarksMixin,
  BobLedgerToolsTaskLinkMarksResolveMixin,
  BobLedgerToolsTaskLinkMarksReadingMixin,
  BobLedgerToolsGcalEventsMixin,
  BobLedgerToolsPeriodNotesMixin,
  BobLedgerToolsEventLinkTimesMixin,
  BobLedgerToolsEventLinkTimesReadingMixin,
  BobLedgerToolsVimSnippetsMixin,
]);
