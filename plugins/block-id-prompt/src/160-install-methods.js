function installBlockIdPromptMixins(pluginClass, mixins) {
  const installedNames = new Set(
    Reflect.ownKeys(pluginClass.prototype).filter((name) => name !== "constructor"),
  );
  for (const Mixin of mixins) {
    const descriptors = Object.getOwnPropertyDescriptors(Mixin.prototype);
    const names = Reflect.ownKeys(descriptors).filter((name) => name !== "constructor");
    for (const name of names) {
      if (installedNames.has(name)) {
        throw new Error("Duplicate BlockIdPromptPlugin method: " + String(name));
      }
    }
    for (const name of names) {
      Object.defineProperty(pluginClass.prototype, name, descriptors[name]);
      installedNames.add(name);
    }
  }
}

installBlockIdPromptMixins(BlockIdPromptPlugin, [
  BlockIdPromptBlockIdSubmitMixin,
  BlockIdPromptPomodoroLinksMixin,
  BlockIdPromptTaskLinkOpenAndNoticesMixin,
  BlockIdPromptTargetPlansAndRewritesMixin,
  BlockIdPromptReferenceFilesMixin,
]);
