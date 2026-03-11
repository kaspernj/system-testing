## Added

- add a reusable `Browser` session abstraction for direct Selenium/Appium browsing, screenshots, logs, and HTML capture
- add `useSystemTestExpo` and `useSystemTestReactNative` hook entry points alongside the generic `useSystemTest` API

## Changed

- refactor `SystemTest` to build on the shared browser/session layer
- move shared app-side hook behavior to `ShapeHook`-based system-test hook infrastructure
- expand README setup docs for browser usage, hook wiring, and first-run setup
