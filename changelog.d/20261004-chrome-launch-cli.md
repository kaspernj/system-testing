## Added

- add `--chrome-binary <path>`, `--chromedriver <path>`, and repeatable `--chrome-arg <arg>` flags to `system-testing browser` so the CLI can point at a specific Chrome binary, chromedriver, and extra Chrome arguments (for example `--chrome-arg=--ignore-certificate-errors`)
- document the new launch flags in the browser CLI help and add unit coverage for resolving them and for parsing `--`-prefixed Chrome arguments passed with the `=` form

## Changed

- enable `jsdoc/reject-any-type` for `src/cli.js` and `src/cli-helpers.js` and type the CLI flag parsing and browser-driver option resolution without `any`
