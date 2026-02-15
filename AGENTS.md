# Agent Notes

- Avoid introducing a variable used only once; inline the value unless it improves readability or config reuse.
- Use the `gh` CLI for creating PRs when asked.
- When editing PR descriptions with `gh`, use proper line breaks instead of literal `\n` and keep bullets clean.
- Prefer `async () => await ...` for `awaitery` `timeout` callbacks when no functional difference.
- Run `npm run typecheck` after changing JS files.
- Run relevant checks for files that were changed or created.
- When bumping package versions, update both `package.json` and `spec/dummy/package.json`.
- Keep JSDoc `@typedef` blocks immediately after imports.
- Keep `if`/`else if` conditions on one line when they fit within 160 characters.
- Avoid putting condition logic inside assignment expressions; prefer explicit `if/else` branches.
