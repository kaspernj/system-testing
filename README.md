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
    onInitialize: () => {
      // Reset any app state before tests run
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
- `onInitialize` runs once when the helper is ready; use it to reset globals/session.
- If you need scoundrel remote evaluation, wait for `systemTestBrowserHelper` and register your classes there, as shown in the commented snippet above.
- Add a root wrapper with `testID="systemTestingComponent"` (and optionally `data-focussed="true"`) around your app so the runner has a stable element to detect and scope selectors against.
- From your tests, use `await systemTest.getScoundrelClient()` to obtain the browser Scoundrel client for remote evaluation.

## Dummy Expo app

A ready-to-run Expo Router dummy app that uses `system-testing` lives in `spec/dummy`. Build the web bundle with `npm run export:web` and execute the sample system test with `npm run test:system` from that folder.
