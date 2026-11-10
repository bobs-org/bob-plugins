Source-of-truth monorepo for bob (Bugyi's Obsidian) plugins, deployed to the vault
(in the ~/bob/ directory) via `bob plugins sync`. The `docs/` tree is mounted into
the Bob site; keep the inventory generated and run `npm run docs:check`.

Plugins with `src/fragments.json` use the committed source build. Edit their `src/`
fragments, run `npm run build`, and never hand-edit their generated `main.js`. The
manifest array is the source order; fragments share one script scope and each hand-edited
fragment must stay at or below 1000 lines. Run `npm run build:check` (also included
first in `npm test` and `npm run validate`) to verify generated entrypoints are current.
Plugins without `src/fragments.json` remain hand-edited in `main.js`.

After any changes to files in this repo, you MUST run `bob plugins sync` to sync the
repo changes to the vault.

If `bob plugins sync` refuses to overwrite another checkout's deploy, never pass `-F` on your own and do not ask Bryan yet. Run `git fetch` and `git log --oneline HEAD..@{upstream} -- plugins/<id>`. If the protected build has landed (the refusal names the commit when it is already fetched), follow "When sync refuses an overwrite" in `docs/develop/deployment.md`. No `-F`, no question. If it has not landed and the agent named in the refusal is still running (`sase agent list`), wait for it to land instead of forcing. Ask Bryan only when the build is unlanded and abandoned. The question must name what `-F` would remove from the vault: the deployed plugin version and the features or APIs it carries.
