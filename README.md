# System testing

Rails inspired system testing for Expo apps.

## Install

```bash
npm install --save-dev system-testing
```

## Usage

```js
import retry from "awaitery/src/retry.js"
import SystemTest from "system-testing/src/system-test.js"
import wait from "awaitery/src/wait.js"
import waitFor from "awaitery/src/wait-for.js"

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

## Dummy Expo app

A ready-to-run Expo Router dummy app that uses `system-testing` lives in `spec/dummy`. Build the web bundle with `npm run export:web` and execute the sample system test with `npm run test:system` from that folder.
