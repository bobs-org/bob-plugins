---
title: "Migrate dependency lines"
description: "Preview and safely apply the legacy dependency-line migration."
---

The migration script folds legacy R8 dependency children (sole-link
`![[…]]` bullets) and legacy-label `🔗` or
`DEPENDENCIES` rows into one canonical
`⛓️ **DEPENDS ON:**` line per dependent. For open dependents it
projects `[dependsOn::]` and `[id::]` fields; it also
adopts field-only lines. The task-dependency contract defines line grammar
and link form.

The default is a dry run. Point it at a vault directory, inspect the plan,
then pass `--write` to perform a preflight and update Markdown
files. A write is refused when any resolution is ambiguous.

```bash
node scripts/migrate-dependency-lines.mjs --vault /path/to/synthetic-vault
node scripts/migrate-dependency-lines.mjs --vault /path/to/synthetic-vault --write
```

The script skips `.git`, `.obsidian`, conflict and
generated directories, templates, and the `done` archive. Its
planner does not change task statuses; reconciliation remains the status
hooks' responsibility.

## Related

- [Task dependencies](https://bobs-org.github.io/task-dependencies/) — the canonical dependency contract.
- [BLOCKS dependency mirrors](https://bobs-org.github.io/reference/plugins/blocks-mirrors/) — the generated reverse view.
- [Validation](validation.md) — test and repository checks.
