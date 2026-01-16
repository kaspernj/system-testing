# System testing

Rails inspired system testing for Expo apps.

## Install

```bash
npm install --save-dev system-testing
```

## Usage

```js
import retry from "awaitery/build/retry.js"
import SystemTest from "system-testing/src/system-test.js"
import wait from "awaitery/build/wait.js"
import waitFor from "awaitery/build/wait-for.js"

import createUser from "@/src/testing/create-user.js"
import initialize from "@/src/initialize"
import Option from "@/src/models/option"

describe("Sign in page", () => {
  test("it navigates to the sign in page and signs in", async () => {
    await initialize()

    await SystemTest.run(async (systemTest) => {
      await createUser(userAttributes)

      await systemTest.visit("/")
      await systemTest.findByTestID("frontpageScreen", {useBaseSelector: false})
      await wait(250)

      await retry(async () => {
        await systemTest.click("[data-testid='signInButton']")
        await systemTest.findByTestID("app/sign-in")
      })

      await systemTest.interact("[data-testid='signInEmailInput']", "sendKeys", "user@example.com")
      await systemTest.interact("[data-testid='signInPasswordInput']", "sendKeys", "password")

      const emailInputValue = await systemTest.interact("[data-testid='signInEmailInput']", "getAttribute", "value")
      const passwordInputValue = await systemTest.interact("[data-testid='signInPasswordInput']", "getAttribute", "value")

      expect(emailInputValue).toEqual("user@example.com")
      expect(passwordInputValue).toEqual("password")

      await systemTest.click("[data-testid='signInSubmitButton']")
      await systemTest.expectNotificationMessage("You were signed in.")

      await waitFor(async () => {
        const optionUserID = await Option.findBy({key: "userID"})

        if (!optionUserID) {
          throw new Error("Option for user ID didn't exist")
        }

        expect(optionUserID.value()).toEqual("805")
      })
    })
  })
})
```

### Using `useSystemTest` in your Expo app

`useSystemTest` wires your Expo app to the system-testing runner: it listens for WebSocket commands, initializes the browser helper, and lets tests navigate or reset state. Add it near the root layout of your Expo Router app (for example in `_layout.tsx` or a top-level provider component).

Minimal example:

```jsx
import {Stack} from "expo-router"
import useSystemTest from "system-testing/build/use-system-test.js"

export default function RootLayout() {
  const {enabled, systemTestBrowserHelper} = useSystemTest({
    onFirstInitialize: () => {
      // One-time setup the first time the helper initializes
    },
    onInitialize: () => {
      // Reset any app state before each test run
    }
  })

  // Optionally register classes for remote eval once scoundrel is ready
  // useEffect(() => {
  //   if (systemTestBrowserHelper) {
  //     systemTestBrowserHelper.getScoundrel().registerClass("MyModel", MyModel)
  //   }
  // }, [systemTestBrowserHelper])

  return (
    <Stack screenOptions={{headerShown: false}}>
      <Stack.Screen name="(tabs)" />
    </Stack>
  )
}
```

Notes:
- The hook auto-connects when the page is opened with `?systemTest=true` (as the runner does).
- `onFirstInitialize` runs only on the first `initialize` command; use it for one-time setup.
- `onInitialize` is registered once when the helper is ready, but it runs on every `initialize` command (each `SystemTest.run`); use it to reset globals/session.
- If you need scoundrel remote evaluation, wait for `systemTestBrowserHelper` and register your classes there, as shown in the commented snippet above.
- Add a root wrapper with `testID="systemTestingComponent"` (and optionally `data-focussed="true"`) around your app so the runner has a stable element to detect and scope selectors against.
- From your tests, use `await systemTest.getScoundrelClient()` to obtain the browser Scoundrel client for remote evaluation.

### Base selector and focused container

System tests scope selectors to the active screen by default. The app marks the active layout container with `data-focussed="true"` on the element with `data-testid="systemTestingComponent"`. In the dummy app, the root layout wraps the navigator and sets `data-focussed="true"` once so the base selector stays stable across screens.

`SystemTest.find` and `SystemTest.findByTestID` use a base selector that targets the focused container:

```css
[data-testid='systemTestingComponent'][data-focussed='true']
```

This prevents tests from matching elements on inactive or background screens.

When to bypass base selector:
Some UI (modals, overlays, portals) can render outside the focused container. For those cases, use `useBaseSelector: false` so the selector is not scoped:

```js
await systemTest.findByTestID("scannerModeExitPinInput", {useBaseSelector: false})
```

Use `useBaseSelector: false` only for modal or overlay content. Keep the default scoping for regular screens to avoid false matches.

### Finder options

Most selector helpers accept the same options:

- `timeout` (number): override how long the lookup should wait.
- `visible` (boolean): require elements to be visible (`true`) or hidden (`false`).
- `useBaseSelector` (boolean): scope the selector to the focused container.

These options are supported by `find`, `findByTestID`, and `all`. `click` also accepts the same options when a selector string is used:

```js
await systemTest.click("[data-testid='signInButton']", {useBaseSelector: false, visible: true})
```

`interact` supports a selector object so you can pass finder options inline:

```js
await systemTest.interact({selector: "[data-testid='scanFooterMenuButton']", useBaseSelector: false}, "click")
```

### Reinitialize a system test

Some test failures can leave the app in a broken state (for example a crashed React tree or a stuck WebSocket session). In those cases, fully restart the SystemTest instance to restore a clean browser/app state before continuing.

```js
await systemTest.reinitialize()
```

This tears down the browser, servers, and sockets, then starts them again so subsequent steps run against a fresh app instance.

## Dummy Expo app

A ready-to-run Expo Router dummy app that uses `system-testing` lives in `spec/dummy`. Build the web bundle with `npm run export:web` and execute the sample system test with `npm run test:system` from that folder.
