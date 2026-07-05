Make `clearAndSendKeys` clearing chord-free and verified: clear on both sides of the caret with per-character BACK_SPACE and DELETE presses instead of CTRL+A+BACKSPACE (which silently no-ops on some headless CI Chrome sessions while subsequent typing still lands) or END-based caret moves (which only reach the end of the current line in multiline textareas), verify the field is empty before typing, and throw with the expected and actual values when the replacement never reaches the field.

Hit-test `method: "actions"` / `method: "human"` clicks before performing them and fail with an `ElementClickInterceptedError`-style error when another element would receive the click, matching `element.click()` interception semantics instead of silently dropping the press on an overlay. Native Appium app sessions skip the DOM hit-test.

Add `clickAndWaitForEffect(elementOrIdentifier, expectedEffectCallback, args)` so callers can await a caller-observable effect of a click and re-click while the effect has not appeared, closing the silent-drop failure mode where a click reports success but the press effect never happens.

Clamp each `clickAndWaitForEffect` effect probe to the remaining overall `timeout` so a small overall budget is honored even when it is shorter than the per-click `effectTimeout`.
