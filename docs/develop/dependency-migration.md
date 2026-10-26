---
title: "Migrate dependency lines"
description: "The retired legacy dependency-line migration and why it is gone."
---

The dependency-line migration script is retired. It folded legacy R8
dependency children (sole-link `![[…]]` bullets) and legacy-label `🔗`
or `DEPENDENCIES` rows into one canonical `⛓️ **DEPENDS ON:**` line per
dependent. It ran against the vault on 2026-10-02 and left zero legacy
children.

Navigation and the status hooks now read dependency edges only from the
managed Depends-On line. Child links outside that line are ordinary
task content, so there is nothing left to migrate. The script and its
tests were removed together with the R8 readers.

## Related

- [Task dependencies](https://bobs-org.github.io/task-dependencies/) — the canonical dependency contract, including reader retirement.
- [BLOCKS dependency mirrors](https://bobs-org.github.io/reference/plugins/blocks-mirrors/) — the generated reverse view.
- [Validation](validation.md) — test and repository checks.
