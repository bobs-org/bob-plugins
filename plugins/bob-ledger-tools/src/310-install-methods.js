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
  BobLedgerToolsRelationIndexMixin,
  BobLedgerToolsRelationModelMixin,
  BobLedgerToolsBlocksModelMixin,
  BobLedgerToolsUnblockedGlyphMixin,
  BobLedgerToolsDependencyRenderMixin,
  BobLedgerToolsBlocksRenderMixin,
  BobLedgerToolsRelationRenderMixin,
  BobLedgerToolsRelationMentionCardMixin,
  BobLedgerToolsCommandModeRefreshMixin,
  BobLedgerToolsTodayLocationMixin,
  BobLedgerToolsTodayMarksMixin,
  BobLedgerToolsTodayMarksReadingMixin,
  BobLedgerToolsTodayMarksReadingClicksMixin,
  BobLedgerToolsVimSnippetsMixin,
]);
