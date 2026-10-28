function leafSwitchApp(owner) {
  return owner && owner.app ? owner.app : owner;
}

function leafSwitchNotice(message, sticky = false) {
  try {
    new Notice(message, sticky ? 0 : undefined);
  } catch (error) {
    // Notices must never break navigation cleanup.
  }
}

function leafSwitchActiveLeaf(app) {
  const workspace = app && app.workspace;
  if (!workspace) {
    return null;
  }
  if (workspace.activeLeaf) {
    return workspace.activeLeaf;
  }
  try {
    return typeof workspace.getLeaf === "function" ? workspace.getLeaf(false) : null;
  } catch (error) {
    return null;
  }
}

function leafSwitchIsMarkdown(owner, file) {
  try {
    if (owner && typeof owner.isMarkdownFile === "function") {
      return owner.isMarkdownFile(file) === true;
    }
  } catch (error) {
    return false;
  }
  return Boolean(file && typeof file.path === "string" && /\.md$/i.test(file.path));
}

async function prepareActiveLeafSwitch(owner, targetFile, targetLeaf = null) {
  const app = leafSwitchApp(owner);
  const vault = app && app.vault;
  const leaf = targetLeaf || leafSwitchActiveLeaf(app);
  const view = leaf && leaf.view;
  const sourceFile = view && view.file;
  const sourcePath = sourceFile && sourceFile.path ? sourceFile.path : null;
  const targetPath = targetFile && targetFile.path ? targetFile.path : "<unknown>";
  let sourceText = null;

  if (sourcePath && sourcePath === targetPath) {
    return Object.freeze({ ok: true, sourcePath, sourceText, targetDiskText: null });
  }

  if (
    sourceFile &&
    sourcePath !== targetPath &&
    leafSwitchIsMarkdown(owner, sourceFile)
  ) {
    const editor = view.editor;
    if (
      !editor ||
      typeof editor.getValue !== "function" ||
      typeof view.save !== "function" ||
      !vault ||
      typeof vault.read !== "function"
    ) {
      leafSwitchNotice(`Could not save ${sourcePath} before switching notes; staying here`);
      return Object.freeze({ ok: false, sourcePath, sourceText: null, targetDiskText: null });
    }

    try {
      await view.save();
      const cancel = view.requestSave && view.requestSave.cancel;
      if (typeof cancel === "function") {
        cancel.call(view.requestSave);
      }
      const sourceDiskText = await vault.read(sourceFile);
      sourceText = editor.getValue();
      if (sourceDiskText !== sourceText) {
        leafSwitchNotice(`Could not save ${sourcePath} before switching notes; staying here`);
        return Object.freeze({ ok: false, sourcePath, sourceText: null, targetDiskText: null });
      }
    } catch (error) {
      leafSwitchNotice(`Could not save ${sourcePath} before switching notes; staying here`);
      return Object.freeze({ ok: false, sourcePath, sourceText: null, targetDiskText: null });
    }
  }

  let targetDiskText = null;
  if (vault && typeof vault.read === "function" && targetFile) {
    try {
      targetDiskText = await vault.read(targetFile);
    } catch (error) {
      leafSwitchNotice(`Could not read ${targetPath} before switching notes; staying here`);
      return Object.freeze({ ok: false, sourcePath, sourceText, targetDiskText: null });
    }
  }
  return Object.freeze({ ok: true, sourcePath, sourceText, targetDiskText });
}

function leafSwitchClobberMessage(context, targetFile) {
  const targetPath = targetFile && targetFile.path ? targetFile.path : "<unknown>";
  const sourcePath = context && context.sourcePath ? context.sourcePath : "<unknown>";
  return `bob: ${targetPath} opened with ${sourcePath}'s text — it may have been overwritten while switching notes. Walk stopped; see vault-git-sync docs, Clobbered notes`;
}

function checkLeafSwitchLanding(owner, targetFile, leaf, context) {
  if (!context || context.sourceText === null || !targetFile) {
    return true;
  }
  const app = leafSwitchApp(owner);
  const editor = leaf && leaf.view && leaf.view.editor;
  const landedText = editor && typeof editor.getValue === "function"
    ? editor.getValue()
    : null;
  if (
    typeof landedText === "string" &&
    context.targetDiskText !== context.sourceText &&
    landedText === context.sourceText
  ) {
    leafSwitchNotice(leafSwitchClobberMessage(context, targetFile), true);
    return false;
  }

  const checkDisk = async () => {
    try {
      const vault = app && app.vault;
      if (!vault || typeof vault.read !== "function") {
        return;
      }
      const currentDiskText = await vault.read(targetFile);
      if (
        context.targetDiskText !== context.sourceText &&
        currentDiskText === context.sourceText
      ) {
        leafSwitchNotice(leafSwitchClobberMessage(context, targetFile), true);
      }
    } catch (error) {
      // The delayed tripwire is best-effort and never rewrites either note.
    }
  };
  try {
    const schedule = typeof window !== "undefined" && window.setTimeout
      ? window.setTimeout.bind(window)
      : setTimeout;
    schedule(() => { void checkDisk(); }, 2500);
  } catch (error) {
    // A missing timer must not make a successful open fail.
  }
  return true;
}

async function openWithLeafSwitchGuard(owner, targetFile, leaf, openAction) {
  if (!leaf || typeof openAction !== "function") {
    return false;
  }
  const context = await prepareActiveLeafSwitch(owner, targetFile, leaf);
  if (!context.ok) {
    return false;
  }
  await openAction();
  return checkLeafSwitchLanding(owner, targetFile, leaf, context);
}
