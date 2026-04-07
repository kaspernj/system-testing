# Agent Notes

- Avoid introducing a variable used only once; inline the value unless it improves readability or config reuse.
- Use the `gh` CLI for creating PRs when asked.
- When editing PR descriptions with `gh`, use proper line breaks instead of literal `\n` and keep bullets clean.
- Prefer `async () => await ...` for `awaitery` `timeout` callbacks when no functional difference.
- Run `npm run typecheck` after changing JS files.
- Run relevant checks for files that were changed or created.
- When bumping package versions, update both `package.json` and `spec/dummy/package.json`.
- Keep JSDoc `@typedef` blocks immediately after imports.
- Keep single-tag JSDoc blocks on one line when they fit (for example `/** @returns {string | undefined} */`).
- Keep `if`/`else if` conditions on one line when they fit within 160 characters.
- Avoid putting condition logic inside assignment expressions; prefer explicit `if/else` branches.
- In system tests, when the next step is `interact(...)`, prefer selector-based `interact("[data-testid='...']", ...)` calls over finding a throwaway element handle first so retry/error handling stays active.
- In system tests, if a spec needs the click-clear-sendKeys input flow, add or use a shared package helper on `Browser`/`SystemTest` (for example `clearAndSendKeys(...)`) instead of open-coding that sequence in individual specs.
- In system tests, if a spec needs to scroll an offscreen element into view, add or use a shared package helper on `Browser`/`SystemTest` (for example `scrollIntoView(...)` / `scrollTestIdIntoView(...)`) instead of project-local DOM query wrappers.
- For per-example browser cleanup such as auth reset, prefer lifecycle support in `SystemTest.run(...)` / `useSystemTest*` (for example `onTeardown`) over putting destructive cleanup into app bootstrap callbacks like `onInitialize`.
