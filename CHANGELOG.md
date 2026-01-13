# Changelog

## Unreleased
- Prevent system test shutdown timeouts by forcing HTTP server connections closed and shutting down the browser before the HTTP server.
- Convert patch release script to Node and add `release:patch` npm script.
- Run release patch commands with direct TTY handling for npm 2FA prompts.
- Run release patch commands with direct TTY handling for npm 2FA prompts.
- Document allowed args for system test selector helpers with shared JSDoc typedefs.
- Move JSDoc typedefs to follow imports per agent guidance.
- Mark optional args in JSDoc where needed.
- Allow dismissing notification messages after assertion with a `dismiss` arg.
- Wait for the matching flash notification to disappear when dismissed.
- Use notification `data-count` to track dismissals for `expectNotificationMessage`.
- Read notification message text from `textContent` when available for DOM consistency.
- Read notification message text via DOM `textContent` script lookup.
- Make notification system test elements clickable for dismissal behavior.
- Pin notification test container to the viewport for reliable clicks.
- Only poll visible notification messages in `expectNotificationMessage`.
- Document `FindArgs.visible` as a boolean-only option.
