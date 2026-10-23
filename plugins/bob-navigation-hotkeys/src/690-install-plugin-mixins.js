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
  BobNavigationHotkeysLaneReviewMixin,
  BobNavigationHotkeysTaskLinkLaneMixin,
  BobNavigationHotkeysFreshnessDecayMixin,
  BobNavigationHotkeysChecklistWalkMixin,
  BobNavigationHotkeysReviewAdvanceMixin,
  BobNavigationHotkeysSuccessorPickerMixin,
  BobNavigationHotkeysReviewMoveMixin,
  BobNavigationHotkeysReviewReturnMixin,
  BobNavigationHotkeysReviewJournalMixin,
  BobNavigationHotkeysDecayCancelMixin,
  BobNavigationHotkeysCancelPropertyMixin,
  BobNavigationHotkeysCountedRollMixin,
  BobNavigationHotkeysLinkRollScheduleMixin,
  BobNavigationHotkeysPropertyDependencyMixin,
  BobNavigationHotkeysProjectSubtreeMixin,
  BobNavigationHotkeysProjectSubtreeWritersMixin,
  BobNavigationHotkeysDependencyStageMixin,
  BobNavigationHotkeysBlocksFollowUpsMixin,
  BobNavigationHotkeysBlocksEditMixin,
  BobNavigationHotkeysBlocksApiMixin,
  BobNavigationHotkeysRelationEditMixin,
  BobNavigationHotkeysRelationFollowUpsMixin,
  BobNavigationHotkeysRelationStageMixin,
  BobNavigationHotkeysDependencyMirrorMixin,
  BobNavigationHotkeysJumpKeyMixin,
  BobNavigationHotkeysCountedTaskMoveMixin,
  BobNavigationHotkeysVimJumpMixin,
  BobNavigationHotkeysLeafMixin,
  BobNavigationHotkeysNotesMoveMixin,
  BobNavigationHotkeysMoveCommitMixin,
  BobNavigationHotkeysInboxRouteMixin,
  BobNavigationHotkeysProjectNoteMixin,
  BobNavigationHotkeysProjectConversionMixin,
  BobNavigationHotkeysProjectFileMixin,
  BobNavigationHotkeysGoToTaskUriMixin,
  BobNavigationHotkeysOpenNotesUriMixin,
  BobNavigationHotkeysRefPdfOpenMixin,
  BobNavigationHotkeysTemplaterTriggerMixin,
  BobNavigationHotkeysImageZoomMixin,
  BobNavigationHotkeysLinkParseMixin,
]);
