class BobNavigationHotkeysLinkParseMixin {

  findFirstRenderedLinkInLine(line, label) {
    let index = 0;

    while (index < line.length) {
      const wikiIndex = line.indexOf("[[", index);
      const markdownIndex = this.findNextMarkdownLinkStart(line, index);
      const nextIndex = this.minPositiveIndex(wikiIndex, markdownIndex);

      if (nextIndex === -1) {
        return null;
      }

      const link =
        nextIndex === wikiIndex
          ? this.parseWikiLinkAt(line, nextIndex)
          : this.parseMarkdownLinkAt(line, nextIndex);

      if (!link) {
        index = nextIndex + 1;
        continue;
      }

      if (link.renderedText.trim() === label) {
        return link;
      }

      index = link.endIndex;
    }

    return null;
  }

  minPositiveIndex(first, second) {
    if (first === -1) {
      return second;
    }
    if (second === -1) {
      return first;
    }
    return Math.min(first, second);
  }

  parseWikiLinkAt(line, startIndex, options = {}) {
    if (
      (line[startIndex - 1] === "!" && !options.allowTransclusion) ||
      !line.startsWith("[[", startIndex)
    ) {
      return null;
    }

    const endIndex = line.indexOf("]]", startIndex + 2);
    if (endIndex === -1) {
      return null;
    }

    const content = line.slice(startIndex + 2, endIndex);
    const aliasIndex = content.indexOf("|");
    const target = this.normalizeLinkTarget(
      aliasIndex === -1 ? content : content.slice(0, aliasIndex),
    );
    if (!target) {
      return null;
    }

    const renderedText =
      aliasIndex === -1
        ? this.basenameForRenderedWikiLink(target)
        : content.slice(aliasIndex + 1).trim();

    return {
      target,
      renderedText,
      endIndex: endIndex + 2,
    };
  }

  findNextMarkdownLinkStart(line, startIndex) {
    let index = startIndex;

    while (index < line.length) {
      index = line.indexOf("[", index);
      if (index === -1) {
        return -1;
      }

      if (
        line[index - 1] !== "!" &&
        line[index + 1] !== "[" &&
        line[index - 1] !== "["
      ) {
        return index;
      }

      index += 1;
    }

    return -1;
  }

  parseMarkdownLinkAt(line, startIndex) {
    if (line[startIndex - 1] === "!" || line[startIndex + 1] === "[") {
      return null;
    }

    const textEndIndex = this.findClosingBracket(line, startIndex);
    if (textEndIndex === -1 || line[textEndIndex + 1] !== "(") {
      return null;
    }

    const destinationStartIndex = textEndIndex + 2;
    const destinationEndIndex = this.findClosingParen(line, destinationStartIndex);
    if (destinationEndIndex === -1) {
      return null;
    }

    const target = this.extractMarkdownDestination(
      line.slice(destinationStartIndex, destinationEndIndex),
    );
    if (!target) {
      return null;
    }

    return {
      target,
      renderedText: line.slice(startIndex + 1, textEndIndex).trim(),
      endIndex: destinationEndIndex + 1,
    };
  }

  findClosingBracket(line, startIndex) {
    for (let index = startIndex + 1; index < line.length; index += 1) {
      if (line[index] === "\\") {
        index += 1;
        continue;
      }

      if (line[index] === "]") {
        return index;
      }
    }

    return -1;
  }

  findClosingParen(line, startIndex) {
    let depth = 1;

    for (let index = startIndex; index < line.length; index += 1) {
      if (line[index] === "\\") {
        index += 1;
        continue;
      }

      if (line[index] === "(") {
        depth += 1;
        continue;
      }

      if (line[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          return index;
        }
      }
    }

    return -1;
  }

  extractMarkdownDestination(destination) {
    const text = destination.trim();
    if (!text) {
      return null;
    }

    if (text.startsWith("<")) {
      const endIndex = text.indexOf(">");
      return endIndex === -1
        ? null
        : this.normalizeLinkTarget(text.slice(1, endIndex));
    }

    const titleMatch = text.match(/^(\S+)\s+["'(].*["')]$/);
    return this.normalizeLinkTarget(titleMatch ? titleMatch[1] : text);
  }

  async openResolvedLink(linkTarget, sourcePath, notFoundMessage) {
    const linkText = this.stripMarkdownExtension(this.normalizeLinkTarget(linkTarget));
    const resolvedFile = this.resolveLinkTargetFile(linkTarget, sourcePath);

    if (!resolvedFile) {
      new Notice(notFoundMessage);
      return false;
    }

    try {
      const activeView = this.getActiveMarkdownView();
      const isActiveFile =
        activeView &&
        activeView.file &&
        activeView.file.path === resolvedFile.path;

      if (typeof this.app.workspace.openLinkText === "function") {
        if (!isActiveFile) {
          const existingLeaf = this.findMarkdownLeafByPath(resolvedFile.path);
          if (
            existingLeaf &&
            (await this.activateWorkspaceLeaf(existingLeaf))
          ) {
            if (this.stripLinkSubpath(linkText) !== linkText) {
              await this.app.workspace.openLinkText(
                linkText,
                sourcePath,
                false,
              );
            }
            return true;
          }
        }

        await this.app.workspace.openLinkText(linkText, sourcePath, false);
      } else {
        return this.openMarkdownFileWithLeafReuse(
          resolvedFile,
          "Could not open note",
        );
      }
      return true;
    } catch (error) {
      new Notice("Could not open note");
      return false;
    }
  }

  resolveLinkTargetFile(linkTarget, sourcePath) {
    const linkText = this.stripMarkdownExtension(this.normalizeLinkTarget(linkTarget));
    const lookupText = this.stripLinkSubpath(linkText);
    if (!lookupText) {
      // A pure `#heading`/`#^blockid` link points at the current note. Resolve
      // it to the source file so Enter jumps in-file (Obsidian's own click
      // behavior). Degenerate `#`/`#^` are rejected by isSubpathOnlyLink.
      if (sourcePath && isSubpathOnlyLink(linkText)) {
        const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        return this.isMarkdownFile(sourceFile) ? sourceFile : null;
      }

      return null;
    }

    return (
      this.app.metadataCache.getFirstLinkpathDest(lookupText, sourcePath) ||
      null
    );
  }

  normalizeText(value) {
    if (typeof value === "string") {
      return value.trim();
    }

    if (value === null || value === undefined) {
      return "";
    }

    return String(value).trim();
  }

  normalizeLinkTarget(value) {
    let target = this.normalizeText(value);
    if (!target) {
      return "";
    }

    target = this.stripWrappingQuotes(target);
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1).trim();
    }

    return this.safeDecodeUri(target);
  }

  stripWrappingQuotes(value) {
    if (value.length < 2) {
      return value;
    }

    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1).trim();
    }

    return value;
  }

  safeDecodeUri(value) {
    try {
      return decodeURI(value);
    } catch (error) {
      return value;
    }
  }

  stripMarkdownExtension(linkText) {
    const subpathIndex = this.findSubpathIndex(linkText);
    const pathPart = subpathIndex === -1 ? linkText : linkText.slice(0, subpathIndex);
    const subpathPart = subpathIndex === -1 ? "" : linkText.slice(subpathIndex);

    return pathPart.replace(/\.md$/i, "") + subpathPart;
  }

  stripLinkSubpath(linkText) {
    const subpathIndex = this.findSubpathIndex(linkText);
    return subpathIndex === -1 ? linkText : linkText.slice(0, subpathIndex);
  }

  findSubpathIndex(linkText) {
    return findLinkSubpathIndex(linkText);
  }

  basenameForRenderedWikiLink(target) {
    const withoutSubpath = this.stripLinkSubpath(this.stripMarkdownExtension(target));
    const pathParts = withoutSubpath.split("/");
    return pathParts[pathParts.length - 1].trim();
  }

  getFenceOpening(line) {
    return getFenceOpening(line);
  }

  isClosingFence(line, openingFence) {
    return isClosingFence(line, openingFence);
  }

  capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
