export const browserDaemonStopTimeoutMs = 10000
export const browserDaemonVerifyTimeoutMs = 1000

// Bind the daemon to loopback by default so its powerful commands (executeScript,
// addCookie, ...) are only reachable by local processes unless explicitly overridden.
export const browserDaemonDefaultHost = "127.0.0.1"

// Optional shared token. When set (CLI flag or this env var) the daemon rejects
// browser commands that do not present the matching token.
export const browserDaemonTokenEnvVar = "SYSTEM_TEST_BROWSER_TOKEN"
