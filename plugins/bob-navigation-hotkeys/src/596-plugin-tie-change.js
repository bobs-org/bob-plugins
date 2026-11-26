// Guarded pair-wise tie writer for the navigation relationship stages.
// Same-note LINKS and LINKED FROM edits ride the dependency writer's one
// editor transaction; cross-note relation work follows a successful
// dependency write.
function applyTieLinksToContent(content, filePath, tieLinks = {}, options = {}) {
  const path = normalizeVaultRelativePath(filePath || "");
  let nextContent = String(content || "");
  const result = {
    changed: false,
    added: 0,
    dropped: 0,
    mirrorDropped: 0,
    mirrorFailed: [],
    failed: [],
  };
  if (!path || !tieLinks || typeof tieLinks !== "object") {
    return Object.freeze({ ...result, nextContent });
  }
  const resolveLinkpath =
    typeof options.resolveLinkpath === "function" ? options.resolveLinkpath : null;
  const pairs = Array.isArray(tieLinks.pairs) ? tieLinks.pairs : [];
  for (const pair of pairs) {
    if (!pair || !pair.owner || !pair.other) continue;
    let absorbed = null;
    try {
      absorbed = absorbTiePairsFromContents({
        contents: new Map([[path, nextContent]]),
        pairs: [pair],
        paths: [path],
        resolveLinkpath,
        isWritable: (candidate) =>
          normalizeVaultRelativePath(candidate || "") === path,
      });
    } catch (_error) {
      absorbed = null;
    }
    if (!absorbed) {
      result.failed.push(path);
      continue;
    }
    nextContent = String(absorbed.contents.get(path) || nextContent);
    result.dropped += absorbed.dropped || 0;
    result.mirrorDropped += absorbed.mirrorDropped || 0;
    if ((absorbed.skipped || []).length > 0) result.failed.push(path);
  }

  const addition = tieLinks.add;
  if (
    addition &&
    addition.source &&
    addition.target &&
    normalizeVaultRelativePath(addition.source.path || "") === path &&
    normalizeVaultRelativePath(addition.target.path || "") === path
  ) {
    const sourceId = normalizeBulletPropertyValue(addition.source.blockId || "");
    const targetId = normalizeBulletPropertyValue(addition.target.blockId || "");
    const lines = nextContent.split(/\r?\n/);
    const sourceLine = sourceId
      ? findTaskLineByTrailingBlockId(lines, sourceId)
      : null;
    const targetLine = targetId
      ? findTaskLineByTrailingBlockId(lines, targetId)
      : null;
    if (sourceLine === null || targetLine === null) {
      result.failed.push(path);
    } else {
      const link =
        typeof addition.link === "string" && addition.link
          ? addition.link
          : relationLinkText({ note: "", blockId: targetId });
      const planned = planLinksEdit(nextContent, sourceLine, {
        add: [{ link, label: null }],
      });
      if (!planned || !planned.ok) {
        result.failed.push(path);
      } else {
        nextContent = planned.nextContent;
        result.added += (planned.report && planned.report.added.length) || 0;
        if (planned.changed) result.changed = true;

        if (loadRelationsLinkedFromLinesEnabled()) {
          const currentLines = nextContent.split(/\r?\n/);
          const currentTargetLine = findTaskLineByTrailingBlockId(
            currentLines,
            targetId,
          );
          const currentSourceLine = findTaskLineByTrailingBlockId(
            currentLines,
            sourceId,
          );
          if (currentTargetLine === null || currentSourceLine === null) {
            result.mirrorFailed.push(path);
          } else {
            const mirrorChildren = findLinkedFromChildren(
              currentLines,
              currentTargetLine,
            );
            const parsedMirror = mirrorChildren.map((index) =>
              parseLinkedFromLine(currentLines[index], {
                isDirectChildOfTask: true,
              }),
            );
            if (parsedMirror.some((entry) => entry.verdict === "malformed")) {
              result.mirrorFailed.push(path);
            } else {
              const vaultFiles =
                Array.isArray(options.vaultFiles) && options.vaultFiles.length > 0
                  ? options.vaultFiles
                  : [path];
              const existingMirror = mirrorChildren.flatMap((index) =>
                relationLinkedFromRows(
                  path,
                  currentLines[index],
                  resolveLinkpath,
                  vaultFiles,
                ),
              );
              const sourceIdentity = blocksIdentity(path, sourceId);
              const canonical = canonicalDependencyLink(
                { path, blockId: sourceId },
                path,
                vaultFiles,
              ).text;
              const desired = linkedFromDesiredAfterDelta(
                existingMirror,
                (entry) => ({ identity: entry.identity, link: entry.link }),
                [{ identity: sourceIdentity, link: canonical, label: null }],
                [],
              );
              const mirrorPlan = planLinkedFromLine(
                nextContent,
                currentTargetLine,
                desired,
              );
              if (!mirrorPlan.ok) {
                result.mirrorFailed.push(path);
              } else {
                nextContent = mirrorPlan.nextContent;
                if (mirrorPlan.changed) result.changed = true;
              }
            }
          }
        }
      }
    }
  }
  result.changed = result.changed || nextContent !== String(content || "");
  result.failed = [...new Set(result.failed)];
  result.mirrorFailed = [...new Set(result.mirrorFailed)];
  return Object.freeze({ ...result, nextContent });
}

function tieChangeDependencyConsequence(notice) {
  const parts = String(notice || "").split(" · ").slice(1);
  return parts
    .filter(
      (part) =>
        !part.includes("replaced the 🪢 link") &&
        !part.includes("🪢 link not removed (reconcile will fold it)"),
    )
    .join(" · ");
}

function tieChangeKeptRelationNotice(notice, plan) {
  const label = plan && typeof plan.keptRelationLabel === "string"
    ? plan.keptRelationLabel
    : "";
  if (!notice || !label) return notice;
  const phrase = `kept the "${label}" relation`;
  return String(notice).includes(phrase) ? notice : `${notice} · ${phrase}`;
}

function buildTieChangeNotice(
  plan,
  dependencyOutcome,
  linkSucceeded = true,
  linkMirrorFailed = false,
) {
  if (!plan) return null;
  if (plan.kind === "noop" || plan.kind === "refuse") return plan.notice || null;
  if (plan.dependency && plan.dependency.length > 0) {
    const adding = plan.dependency.some((edit) => (edit.add || []).length > 0);
    if (adding) {
      let notice =
        (dependencyOutcome && dependencyOutcome.notice) || plan.notice || null;
      if (plan.reversing && notice && !notice.startsWith("⇄ Reversed")) {
        notice = `⇄ Reversed · ${notice}`;
      }
      if (linkMirrorFailed && notice && !notice.includes("LINKED FROM not updated")) {
        notice = `${notice} · 🪢 LINKED FROM not updated`;
      }
      return tieChangeKeptRelationNotice(notice, plan);
    }
    const consequence = tieChangeDependencyConsequence(
      dependencyOutcome && dependencyOutcome.notice,
    );
    const parts = [plan.notice, consequence].filter(Boolean);
    if (!linkSucceeded && plan.plainAdd) parts.push("🪢 link not added");
    if (
      linkMirrorFailed &&
      !parts.some((part) => part.includes("LINKED FROM not updated"))
    ) {
      parts.push("🪢 LINKED FROM not updated");
    }
    return parts.join(" · ") || null;
  }
  if (!linkSucceeded && plan.plainAdd) {
    const suffix = linkMirrorFailed ? " · 🪢 LINKED FROM not updated" : "";
    return `${plan.notice || "🪢 Link updated"} · 🪢 link not added${suffix}`;
  }
  if (
    linkMirrorFailed &&
    plan.notice &&
    !plan.notice.includes("LINKED FROM not updated")
  ) {
    return `${plan.notice} · 🪢 LINKED FROM not updated`;
  }
  return plan.notice || (dependencyOutcome && dependencyOutcome.notice) || null;
}

function tieExpectedMap(expected) {
  if (expected instanceof Map) return new Map(expected);
  if (expected && typeof expected === "object") {
    return new Map(Object.entries(expected));
  }
  return new Map();
}

function tieNotesMapFromInput(notes) {
  if (notes instanceof Map) return new Map(notes);
  if (!notes || typeof notes !== "object") return new Map();
  return new Map(
    Object.entries(notes).map(([path, content]) => [
      normalizeVaultRelativePath(path),
      String(content || ""),
    ]),
  );
}

class BobNavigationHotkeysTieChangeMixin {
  async applyTieChange(owner, other, to, options = {}) {
    const rawOwner = owner && typeof owner === "object" ? owner : {};
    const rawOther = other && typeof other === "object" ? other : {};
    const ownerRef = {
      ...rawOwner,
      path: normalizeVaultRelativePath(rawOwner.path || ""),
      blockId: normalizeBulletPropertyValue(rawOwner.blockId || ""),
    };
    const otherRef = {
      ...rawOther,
      path: normalizeVaultRelativePath(rawOther.path || ""),
      blockId: normalizeBulletPropertyValue(rawOther.blockId || ""),
    };
    if (!ownerRef.path || !otherRef.path) {
      return Object.freeze({ ok: false, reason: "invalid-ref" });
    }
    if (!ownerRef.blockId || !otherRef.blockId) {
      const missing = !ownerRef.blockId ? ownerRef : otherRef;
      if (typeof options.promptBlockId === "function") {
        const resolved = await options.promptBlockId({
          owner: ownerRef,
          other: otherRef,
          missing,
          to,
          expected: options.expected,
        });
        if (resolved && resolved.blockId) {
          const nextOwner = !ownerRef.blockId
            ? { ...ownerRef, ...resolved }
            : ownerRef;
          const nextOther = ownerRef.blockId
            ? { ...otherRef, ...resolved }
            : otherRef;
          return this.applyTieChange(nextOwner, nextOther, to, {
            ...options,
            promptBlockId: null,
          });
        }
      }
      return Object.freeze({
        ok: false,
        reason: "target-needs-id",
        prompt: "block-id",
        missing: Object.freeze({ path: missing.path, line: missing.line || null }),
      });
    }

    const expected = tieExpectedMap(options.expected);
    const notes = tieNotesMapFromInput(options.notes);
    const paths = new Set([ownerRef.path, otherRef.path]);
    for (const path of expected.keys()) {
      const normalized = normalizeVaultRelativePath(path || "");
      if (normalized) paths.add(normalized);
    }
    const activeEditor = options.editor || null;
    for (const path of paths) {
      if (notes.has(path)) continue;
      let content = null;
      try {
        content = await this.readDependencyNoteContent(
          path,
          activeEditor && normalizeVaultRelativePath(options.editorPath || ownerRef.path) === path
            ? activeEditor
            : null,
          ownerRef.path,
        );
      } catch (_error) {
        content = null;
      }
      if (content === null || content === undefined) {
        return Object.freeze({ ok: false, reason: "target-not-found" });
      }
      notes.set(path, String(content || ""));
    }
    for (const [path, snapshot] of expected) {
      const normalized = normalizeVaultRelativePath(path || "");
      if (notes.has(normalized) && notes.get(normalized) !== String(snapshot || "")) {
        return Object.freeze({
          ok: false,
          reason: "changed — reopen",
          notice: "changed — reopen",
          stale: true,
        });
      }
    }

    const resolveLinkpath = this.dependencyLinkpathResolver();
    const vaultFiles = this.readDependencyVaultFileList() || [...notes.keys()];
    const planned = planTieChange({
      owner: ownerRef,
      other: otherRef,
      to,
      notes,
      resolve: { linkpath: resolveLinkpath, vaultFiles, today: options.today },
    });
    if (planned.kind === "refuse") {
      return Object.freeze({
        ok: false,
        reason: planned.reason,
        notice: planned.notice,
      });
    }
    if (planned.kind === "noop") {
      return Object.freeze({
        ok: true,
        reason: "unchanged",
        notice: planned.notice,
        tie: planned.tie,
      });
    }

    const expectedLive = new Map(notes);
    const pair = Object.freeze({ owner: ownerRef, other: otherRef });
    const plainSource = planned.to === "plain-out" ? ownerRef : otherRef;
    const plainTarget = planned.to === "plain-out" ? otherRef : ownerRef;
    const dependencyOutcomes = [];
    const operations = [...(planned.dependency || [])];
    if (planned.reversing) {
      operations.sort((left, right) =>
        Number((right.remove || []).length > 0) -
        Number((left.remove || []).length > 0),
      );
    }
    // Same-note reversal (§22 one-undo): both dependents share one editor
    // transaction. Cross-note keeps remove-then-add with the incomplete
    // suffix on partial failure.
    const sameNoteReversal = Boolean(
      planned.reversing &&
      operations.length === 2 &&
      ownerRef.path === otherRef.path &&
      operations.every((edit) => edit.dependent && edit.dependent.path === ownerRef.path),
    );
    let linkAdditionIntegrated = false;
    if (sameNoteReversal) {
      const first = operations[0];
      const second = operations[1];
      const firstLocated = tieFindTaskLine(notes, first.dependent.path, first.dependent.blockId);
      const secondLocated = tieFindTaskLine(notes, second.dependent.path, second.dependent.blockId);
      if (!notes.get(first.dependent.path) || firstLocated.reason || secondLocated.reason) {
        return Object.freeze({ ok: false, reason: "changed — reopen", notice: "changed — reopen", stale: true });
      }
      const firstWantsAdd = (first.add || []).length > 0;
      const secondWantsAdd = (second.add || []).length > 0;
      const combinedTieLinks = {
        pairs: (firstWantsAdd || secondWantsAdd) ? [pair] : [],
      };
      const firstDependentIsOwner =
        first.dependent.path === ownerRef.path && first.dependent.blockId === ownerRef.blockId;
      const combinedEditor =
        (activeEditor &&
        normalizeVaultRelativePath(options.editorPath || ownerRef.path) === first.dependent.path
          ? activeEditor
          : null) ||
        (typeof this.findRelationEditOpenEditor === "function"
          ? this.findRelationEditOpenEditor(first.dependent.path)
          : null) ||
        (typeof this.findBlocksEditOpenEditor === "function"
          ? this.findBlocksEditOpenEditor(first.dependent.path)
          : null);
      let combinedOutcome = null;
      if (firstDependentIsOwner) {
        combinedOutcome = await this.applyDependencyEdit({
          editor: combinedEditor,
          parentPath: first.dependent.path,
          parentLine: firstLocated.line,
          add: first.add || [],
          remove: first.remove || [],
          files: notes,
          expected: expectedLive,
          tieLinks: combinedTieLinks,
          today: options.today,
          secondDependent: {
            parentPath: second.dependent.path,
            parentLine: secondLocated.line,
            add: second.add || [],
            remove: second.remove || [],
          },
        });
      } else {
        // Primary is the other dependent; the owner edit rides as second.
        combinedOutcome = await this.applyDependencyEdit({
          editor: combinedEditor,
          parentPath: first.dependent.path,
          parentLine: firstLocated.line,
          add: first.add || [],
          remove: first.remove || [],
          files: notes,
          expected: expectedLive,
          tieLinks: combinedTieLinks,
          today: options.today,
          secondDependent: {
            parentPath: second.dependent.path,
            parentLine: secondLocated.line,
            add: second.add || [],
            remove: second.remove || [],
          },
        });
      }
      dependencyOutcomes.push(combinedOutcome);
      if (!combinedOutcome || combinedOutcome.ok !== true) {
        return Object.freeze({
          ...(combinedOutcome || {}),
          ok: false,
          reason: (combinedOutcome && combinedOutcome.reason) || "dependency-write-failed",
          notice: (combinedOutcome && combinedOutcome.notice) || planned.notice,
          partial: false,
        });
      }
    } else
    for (const edit of operations) {
      const dependent = edit.dependent;
      const dependentIsOwner =
        dependent.path === ownerRef.path && dependent.blockId === ownerRef.blockId;
      const current = notes.get(dependent.path);
      const located = tieFindTaskLine(notes, dependent.path, dependent.blockId);
      if (!current || located.reason) {
        return Object.freeze({ ok: false, reason: "changed — reopen", notice: "changed — reopen", stale: true });
      }
      const wantsAdd = (edit.add || []).length > 0;
      const tieLinks = {
        pairs: wantsAdd ? [pair] : [],
        ...(planned.plainAdd &&
        planned.plainAdd.path === dependent.path &&
        plainTarget.path === dependent.path
          ? {
              add: {
                source: plainSource,
                target: plainTarget,
                link: planned.plainAdd.link,
              },
            }
          : {}),
      };
      if (!tieLinks.add) delete tieLinks.add;

      let outcome = null;
      if (dependentIsOwner) {
        const editor =
          (activeEditor &&
          normalizeVaultRelativePath(options.editorPath || ownerRef.path) === dependent.path
            ? activeEditor
            : null) ||
          (typeof this.findRelationEditOpenEditor === "function"
            ? this.findRelationEditOpenEditor(dependent.path)
            : null) ||
          (typeof this.findBlocksEditOpenEditor === "function"
            ? this.findBlocksEditOpenEditor(dependent.path)
            : null);
        outcome = await this.applyDependencyEdit({
          editor,
          parentPath: dependent.path,
          parentLine: located.line,
          add: edit.add || [],
          remove: edit.remove || [],
          files: notes,
          expected: expectedLive,
          tieLinks,
          today: options.today,
        });
      } else {
        const targetChanges = wantsAdd ? [dependent] : [dependent];
        outcome = await this.applyBlocksEdit({
          sources: [ownerRef],
          add: wantsAdd ? targetChanges : [],
          remove: (edit.remove || []).length > 0 ? targetChanges : [],
          expected: expectedLive,
          tieLinks,
          today: options.today,
        });
      }
      dependencyOutcomes.push(outcome);
      if (!outcome || outcome.ok !== true) {
        const partial = dependencyOutcomes.length > 1;
        return Object.freeze({
          ...(outcome || {}),
          ok: false,
          reason: (outcome && outcome.reason) || "dependency-write-failed",
          notice: partial
            ? `${(outcome && outcome.notice) || planned.notice} · dependency reversal incomplete`
            : (outcome && outcome.notice) || planned.notice,
          partial,
        });
      }
      if (
        tieLinks.add &&
        tieLinks.add.target &&
        tieLinks.add.source.path === tieLinks.add.target.path
      ) {
        linkAdditionIntegrated = true;
      }
      if (operations.length > 1 || planned.plainAdd) {
        for (const path of paths) {
          let fresh = null;
          try {
            const editor =
              activeEditor &&
              normalizeVaultRelativePath(options.editorPath || ownerRef.path) === path
                ? activeEditor
                : null;
            fresh = await this.readDependencyNoteContent(
              path,
              editor,
              ownerRef.path,
            );
          } catch (_error) {
            fresh = null;
          }
          if (typeof fresh === "string") {
            notes.set(path, fresh);
            expectedLive.set(path, fresh);
          }
        }
      }
    }

    let linkOutcome = null;
    let linkSucceeded = true;
    if (planned.plainAdd && !linkAdditionIntegrated) {
      const source =
        planned.to === "plain-out" ? ownerRef : otherRef;
      const target = planned.to === "plain-out" ? otherRef : ownerRef;
      linkOutcome = await this.applyRelationEdit({
        sources: [source],
        add: [{ ...target, label: null }],
        direction: planned.to === "plain-out" ? "to" : "from",
        expected: expectedLive,
        today: options.today,
      });
      linkSucceeded = Boolean(
        linkOutcome &&
          linkOutcome.ok === true &&
          (linkOutcome.committed || []).includes(source.path),
      );
    } else if (planned.plainAdd && linkAdditionIntegrated) {
      const integrated = dependencyOutcomes.find(
        (outcome) => outcome && outcome.tieLinks,
      );
      linkSucceeded = Boolean(
        integrated &&
          !(integrated.tieLinks.failed || []).includes(planned.plainAdd.path),
      );
    }

    const dependencyOutcome = dependencyOutcomes[dependencyOutcomes.length - 1] || null;
    const linkMirrorFailed = Boolean(
      (dependencyOutcomes.some(
        (outcome) =>
          outcome &&
          outcome.tieLinks &&
          outcome.tieLinks.mirrorFailed &&
          outcome.tieLinks.mirrorFailed.length > 0,
      )) ||
        (linkOutcome &&
          linkOutcome.mirrorFailed &&
          linkOutcome.mirrorFailed.length > 0),
    );
    const notice = buildTieChangeNotice(
      planned,
      dependencyOutcome,
      linkSucceeded,
      linkMirrorFailed,
    );
    return Object.freeze({
      ...(dependencyOutcome || linkOutcome || {}),
      ok: true,
      reason: linkSucceeded ? (dependencyOutcome && dependencyOutcome.reason) || null : "partial",
      notice,
      tie: planned.tieAfter,
      dependencyOutcomes: Object.freeze(dependencyOutcomes),
      linkOutcome,
      linkSucceeded,
    });
  }
}
