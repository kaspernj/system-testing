# Dummy Expo app for system-testing

This folder contains a minimal Expo Router app wired to `system-testing` so you can exercise the framework locally.

## What’s inside
- Routes live in `app/` with a blank reset screen at `/blank` and a simple sign-in flow at `/`.
- `useSystemTest` is mounted in `app/_layout.js` so the app listens for `visit`/`dismissTo` commands and exposes the `systemTestingComponent` root wrapper expected by the framework.
- A sample system test is available at `tests/system-test.js`.

## Running locally
1) Install deps: `cd spec/dummy && npm install` (uses the local `system-testing` via `file:../..`).
2) Build the web bundle for static serving: `npm run export:web` (outputs to `spec/dummy/dist`).
3) Run the sample system test (serves `dist` via the built-in HTTP server): `npm run test:system`.

The test opens the exported web build in Chrome, clicks through the sign-in flow, and asserts that the demo notification shows up.
