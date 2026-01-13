# Changelog

## Unreleased
- Prevent system test shutdown timeouts by forcing HTTP server connections closed and shutting down the browser before the HTTP server.
- Document allowed args for system test selector helpers with shared JSDoc typedefs.
- Move JSDoc typedefs to follow imports per agent guidance.
- Mark optional args in JSDoc where needed.
- Allow dismissing notification messages after assertion with a `dismiss` arg.
- Wait for the matching flash notification to disappear when dismissed.
- Use notification `data-count` to track dismissals for `expectNotificationMessage`.
