# System testing

Rails inspired system testing for Expo apps.

## Install

```bash
npm install --save-dev system-testing
```

## Choose the right layer

This package has three main entry points:

- `SystemTest`: full app-oriented system testing with selector helpers, app bootstrapping, WebSocket communication, screenshots, logs, and Scoundrel support.
- `Browser`: lower-level driver session for opening URLs, taking screenshots, and reading HTML/logs without the rest of the system-test flow.
- `system-testing` CLI browser daemon: a long-running named browser process that can be controlled from CLI commands or WebSocket messages.
- `useSystemTest*` hooks: browser-side integration that lets your app respond to `visit` / `dismissTo` commands from `SystemTest`.

Use `SystemTest` if you are testing your app. Use `Browser` if you just want a Selenium/Appium-backed browser session.

## Getting started

1. Add one of the browser-side hooks to your app:
   `useSystemTestExpo` for Expo Router, or `useSystemTest` / `useSystemTestReactNative` for your own navigation stack.
2. Wrap your app in a root element with `testID="systemTestingComponent"`.
3. Make sure your root test route renders an element with `testID="blankText"`, or change `SystemTest.rootPath`.
4. Start tests with `SystemTest.run(...)` for app flows, or instantiate `Browser` directly for ordinary browsing/capture.

Minimal app-side requirements:

```jsx
<View testID="systemTestingComponent" dataSet={{focussed: "true"}}>
  <Text testID="blankText">Blank</Text>
  {children}
</View>
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

### Driver selection

SystemTest uses Selenium by default. To use Appium instead, pass a driver config when creating the instance:

```js
await SystemTest.run({
  driver: {
    type: "appium",
    options: {
      serverArgs: {
        useDrivers: ["uiautomator2"],
        port: 4723
      },
      capabilities: {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:deviceName": "Android Emulator",
        "appium:app": "/path/to/app.apk"
      }
    }
  }
}, async (systemTest) => {
  await systemTest.findByTestID("loginScreen")
})
```

If you already run an Appium server, provide `serverUrl` instead of `serverArgs`. By default, `findByTestID` uses the Appium `accessibility id` strategy. To use CSS instead (for web contexts), set `options.testIdStrategy` to `"css"` and optionally `options.testIdAttribute` (defaults to `"data-testid"`).

For local or CI web runs against Chrome, `npm run test:appium:web` now resolves and downloads a matching Chrome for Testing `chromedriver` binary before it starts Appium. That keeps the Appium web path reproducible even when the installed Chrome patch version changes.

### Generic browser usage

`Browser` is the lower-level browser/session class behind `SystemTest`. Use it when you want driver-backed browsing, screenshots, logs, and HTML capture without the rest of the system-test bootstrapping.

```js
import {Browser} from "system-testing/build/index.js"

const browser = new Browser()

browser.getDriverAdapter().setBaseUrl("https://example.com")
await browser.getDriverAdapter().start()
await browser.setTimeouts(10000)

await browser.visit("/")

const html = await browser.getHTML()
const logs = await browser.getBrowserLogs()
const screenshot = await browser.takeScreenshot()

await browser.stopDriver()
```

If `visit()`/`dismissTo()` should drive in-app navigation through the browser-side helper instead of direct URL loads, inject a communicator when constructing `Browser`. Without one, it falls back to direct driver navigation, which makes it usable for ordinary website browsing as well.

Common `Browser` flow:

1. Create the browser with the desired driver config.
2. Set the base URL on the driver adapter.
3. Start the driver and set timeouts.
4. Call `visit()`.
5. Read `getHTML()`, `getBrowserLogs()`, `getCurrentUrl()`, or `takeScreenshot()`.
6. Call `stopDriver()` during teardown.

Useful browser methods:

- `visit(pathOrUrl)`: uses the helper communicator if present, otherwise loads directly through Selenium/Appium.
- `dismissTo(pathOrUrl)`: same fallback behavior as `visit()`.
- `getHTML()`: returns the current page source.
- `getBrowserLogs()`: returns collected browser logs, or Appium logcat output for Android native runs.
- `takeScreenshot()`: writes screenshot, HTML, and logs to disk and returns the artifact paths.

If you want app-level navigation instead of direct URL loads, keep `Browser` for the driver/session side and use one of the `useSystemTest*` hooks in the app so the communicator has something to talk to.

`react` and `expo-router` are optional peer dependencies. Install them only in apps that import the React/Expo hook helpers; CLI/browser-daemon consumers should not need React just to use `system-testing`.

### Browser daemon CLI

If you want an external agent to drive a reusable browser process, start the browser daemon:

```bash
npx system-testing browser my-browser
```

Optional arguments:

- `--port 1991`: use a fixed WebSocket port instead of an ephemeral one
- `--base-url https://example.com`: set the browser base URL so relative `visit` paths work
- `--driver selenium|appium`: choose the driver type
- `--debug`: enable browser debug logging

The process stays running until you stop it. On start it prints JSON with at least the browser `name`, `pid`, and `port`.

List running browser daemons:

```bash
npx system-testing browser-list
```

This prints one line per browser with the name and port. Use `--json` if you want machine-readable output.

Stop a running browser daemon:

```bash
npx system-testing browser-stop --name my-browser
```

If only one browser daemon is running, `browser-stop` can omit `--name`.

Send commands from the CLI:

```bash
npx system-testing browser-command --name my-browser --visit=https://example.com/path
npx system-testing browser-command --name my-browser --find-by-test-id saveButton
npx system-testing browser-command --name my-browser --find-by-test-id saveButton --timeout 15
npx system-testing browser-command --name my-browser --click='[data-testid="saveButton"]'
npx system-testing browser-command --name my-browser --get-html
npx system-testing browser-command --name my-browser --get-browser-logs
npx system-testing browser-command --name my-browser --take-screenshot
```

If only one browser daemon is running, `browser-command` can omit `--name`. Results are printed as JSON so automation tools can parse them easily.

CLI `--timeout` values are supported on navigation and selector-based commands. Bare numbers are interpreted as seconds, and explicit `ms` / `s` suffixes are also accepted.

Generic commands are also supported:

```bash
npx system-testing browser-command \
  --name my-browser \
  --command=interact \
  --selector='[data-testid="emailInput"]' \
  --method=sendKeys \
  --arg='user@example.com'
```

The browser daemon is intended for agent-style development workflows where an AI or script needs to open the app, inspect HTML, locate elements, click controls, and read logs while validating layout or behavior changes.

### Browser daemon WebSocket protocol

The daemon also accepts WebSocket commands on its configured port. Send JSON payloads like:

```json
{"type":"browser-command","command":"visit","url":"https://example.com/path"}
```

Another example:

```json
{"type":"browser-command","command":"findByTestID","args":{"testID":"saveButton"}}
```

The server responds with JSON:

```json
{"ok":true,"requestId":"...","type":"browser-command-result","result":{"ok":true}}
```

If the command fails:

```json
{"ok":false,"requestId":"...","type":"browser-command-result","error":"..."}
```

Supported daemon commands currently include:

- `visit`
- `dismissTo`
- `setBaseSelector`
- `getCurrentUrl`
- `getHTML`
- `getBrowserLogs`
- `takeScreenshot`
- `find`
- `findByTestID`
- `click`
- `waitForNoSelector`
- `expectNoElement`
- `interact`

### Using `useSystemTestExpo` in your Expo app

`useSystemTestExpo` wires your Expo app to the system-testing runner: it listens for WebSocket commands, initializes the browser helper, and lets tests navigate or reset state. Add it near the root layout of your Expo Router app (for example in `_layout.tsx` or a top-level provider component).

To enable system tests in native builds, set `EXPO_PUBLIC_SYSTEM_TEST=true` at build time (and optionally `EXPO_PUBLIC_SYSTEM_TEST_HOST` to reach the test runner from a device/emulator). For native Appium runs, set `SYSTEM_TEST_HOST=native` in the test environment and point Appium at your APK.

Minimal example:

```jsx
import {Stack} from "expo-router"
import useSystemTestExpo from "system-testing/build/use-system-test-expo.js"

export default function RootLayout() {
  const {enabled, systemTestBrowserHelper} = useSystemTestExpo({
    // Optional: inject your own helper instance instead of using the shared default
    // browserHelper: mySystemTestBrowserHelper,
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
- Pass `browserHelper` if you want to inject a prebuilt `SystemTestBrowserHelper`; otherwise the hook creates and enables a shared default instance.
- `onFirstInitialize` runs only on the first `initialize` command; use it for one-time setup.
- `onInitialize` is registered once when the helper is ready, but it runs on every `initialize` command (each `SystemTest.run`); use it to reset globals/session.
- If you need scoundrel remote evaluation, wait for `systemTestBrowserHelper` and register your classes there, as shown in the commented snippet above.
- Add a root wrapper with `testID="systemTestingComponent"` (and optionally `data-focussed="true"`) around your app so the runner has a stable element to detect and scope selectors against.
- From your tests, use `await systemTest.getScoundrelClient()` to obtain the browser Scoundrel client for remote evaluation.
- `useSystemTestExpo` calls `useRouter()` from `expo-router`.

### Using `useSystemTest` or `useSystemTestReactNative` without Expo Router

`useSystemTest` is the generic runtime-agnostic hook. Provide `onNavigate` and `onDismissTo` callbacks for your own navigation stack. `useSystemTestReactNative` is a convenience wrapper around the same generic API for non-Expo React Native apps.

Use these when:

- you are not using Expo Router
- you want to inject your own navigation behavior
- you want to share the same app-side helper integration across different routing setups

```js
import useSystemTestReactNative from "system-testing/build/use-system-test-react-native.js"

export default function App({navigation}) {
  useSystemTestReactNative({
    onDismissTo: ({path}) => {
      navigation.reset({
        index: 0,
        routes: [{name: path}]
      })
    },
    onNavigate: ({path}) => {
      navigation.navigate(path)
    }
  })

  return <Navigator />
}
```

The generic hook options are:

- `browserHelper`: inject an existing `SystemTestBrowserHelper` instance instead of using the shared default
- `onFirstInitialize`: one-time setup callback
- `onInitialize`: callback that runs on every `initialize` command
- `onNavigate`: handler for `visit(...)`
- `onDismissTo`: handler for `dismissTo(...)`

### Root path and `blankText`

`SystemTest.run()` visits `SystemTest.rootPath` (defaults to `/blank?systemTest=true`) and waits for an element with `testID="blankText"` inside the focused `systemTestingComponent`. If your app does not have a `/blank` route, set a custom root path and ensure the element exists on that screen.

Example setup:

```js
import SystemTest from "system-testing/build/system-test.js"

SystemTest.rootPath = "/?platform=web&systemTest=true"
```

```jsx
<View testID="systemTestingComponent" dataSet={{focussed: "true"}}>
  <Text testID="blankText">Blank</Text>
  {children}
</View>
```

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
- `visible` (boolean|null): require elements to be visible (`true`) or hidden (`false`), or disable visibility filtering with `null`.
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

A ready-to-run Expo Router dummy app that uses `system-testing` lives in `spec/dummy`.

Useful commands from the package root:

- `npm run export:web`: build the dummy Expo app for web
- `SYSTEM_TEST_HOST=dist npx jasmine spec/system-test.spec.js`: run the sample system specs against the exported bundle
- `SYSTEM_TEST_HOST=dist npx jasmine spec/system-test-logging.spec.js`: run the browser-log capture spec
