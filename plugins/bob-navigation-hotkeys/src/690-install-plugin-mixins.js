function installBobNavigationHotkeysMixins(pluginClass, mixins) {
  const installedNames = new Set(
    Reflect.ownKeys(pluginClass.prototype).filter((name) => name !== "constructor"),
  );
  for (const Mixin of mixins) {
    const descriptors = Object.getOwnPropertyDescriptors(Mixin.prototype);
    const names = Reflect.ownKeys(descriptors).filter((name) => name !== "constructor");
    for (const name of names) {
      if (installedNames.has(name)) {
        throw new Error("Duplicate BobNavigationHotkeysPlugin method: " + String(name));
      }
    }
    for (const name of names) {
      Object.defineProperty(pluginClass.prototype, name, descriptors[name]);
      installedNames.add(name);
    }
  }
}

installBobNavigationHotkeysMixins(BobNavigationHotkeysPlugin, [
  BobNavigationHotkeysTransclusionLinkMixin,
  BobNavigationHotkeysQuickRollMixin,
  BobNavigationHotkeysQuickRollPreviewMixin,
  BobNavigationHotkeysLinkCommitLaneMixin,
  BobNavigationHotkeysLaneInboxRouteMixin,
  BobNavigationHotkeysLaneReviewMixin,
  BobNavigationHotkeysTaskLinkLaneMixin,
  BobNavigationHotkeysFreshnessDecayMixin,
  BobNavigationHotkeysChecklistWalkMixin,
  BobNavigationHotkeysReviewAdvanceMixin,
  BobNavigationHotkeysReviewDueRowMixin,
  BobNavigationHotkeysWalkLandingMixin,
  BobNavigationHotkeysLaneWalkMixin,
  BobNavigationHotkeysBracketRepeatMixin,
  BobNavigationHotkeysBracketModeIndicatorMixin,
  BobNavigationHotkeysSuccessorPickerMixin,
  BobNavigationHotkeysReviewMoveMixin,
  BobNavigationHotkeysReviewReturnMixin,
  BobNavigationHotkeysReviewJournalMixin,
  BobNavigationHotkeysDecayCancelMixin,
  BobNavigationHotkeysDecayCardWriterMixin,
  BobNavigationHotkeysPostCancelEffectsMixin,
  BobNavigationHotkeysCancelPropertyMixin,
  BobNavigationHotkeysAlbumSchemaFallbackMixin,
  BobNavigationHotkeysCountedRollMixin,
  BobNavigationHotkeysLinkRollScheduleMixin,
  BobNavigationHotkeysPropertyDependencyMixin,
  BobNavigationHotkeysProjectSubtreeMixin,
  BobNavigationHotkeysProjectSubtreeWritersMixin,
  BobNavigationHotkeysDependencyStageMixin,
  BobNavigationHotkeysBlocksFollowUpsMixin,
  BobNavigationHotkeysBlocksEditMixin,
  BobNavigationHotkeysBlocksApiMixin,
  BobNavigationHotkeysRelationCancelComposeMixin,
  BobNavigationHotkeysRelationCompleteComposeMixin,
  BobNavigationHotkeysRelationHandEditMixin,
  BobNavigationHotkeysRelationEditMixin,
  BobNavigationHotkeysRelationUnlinkMixin,
  BobNavigationHotkeysRelationFollowUpsMixin,
  BobNavigationHotkeysRelationStageMixin,
  BobNavigationHotkeysDependencyMirrorMixin,
  BobNavigationHotkeysJumpKeyMixin,
  BobNavigationHotkeysCountedTaskMoveMixin,
  BobNavigationHotkeysPomodoroSplitMixin,
  BobNavigationHotkeysTaskSplitMixin,
  BobNavigationHotkeysTaskUndoMixin,
  BobNavigationHotkeysVimJumpMixin,
  BobNavigationHotkeysLeafMixin,
  BobNavigationHotkeysPomodoroThemesManagerMixin,
  BobNavigationHotkeysRelationLabelsManagerMixin,
  BobNavigationHotkeysNotesMoveMixin,
  BobNavigationHotkeysCopyCardMixin,
  BobNavigationHotkeysMoveCommitMixin,
  BobNavigationHotkeysInboxRouteMixin,
  BobNavigationHotkeysProjectNoteMixin,
  BobNavigationHotkeysProjectConversionMixin,
  BobNavigationHotkeysProjectPromotionMixin,
  BobNavigationHotkeysProjectFileMixin,
  BobNavigationHotkeysGoToTaskUriMixin,
  BobNavigationHotkeysOpenNotesUriMixin,
  BobNavigationHotkeysRefPdfOpenMixin,
  BobNavigationHotkeysRefPdfTargetResolverMixin,
  BobNavigationHotkeysHighlightsHintsMixin,
  BobNavigationHotkeysTemplaterTriggerMixin,
  BobNavigationHotkeysImageZoomMixin,
  BobNavigationHotkeysLinkParseMixin,
  BobNavigationHotkeysParentChangeMixin,
  BobNavigationHotkeysNotebookCreateMixin,
]);
