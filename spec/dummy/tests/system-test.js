import path from "node:path"
import {fileURLToPath} from "node:url"

import SystemTest from "../../src/system-test.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Ensure the HTTP server serves spec/dummy/dist
process.chdir(path.resolve(__dirname, ".."))

async function main() {
  process.env.SYSTEM_TEST_HOST ||= "dist"

  const systemTest = SystemTest.current()

  await systemTest.start()

  try {
    await SystemTest.run(async (runningSystemTest) => {
      await runningSystemTest.visit("/")
      await runningSystemTest.findByTestID("frontpageScreen", {useBaseSelector: false})

      await runningSystemTest.click("[data-testid='signInButton']")
      await runningSystemTest.findByTestID("signInEmailInput")

      await runningSystemTest.interact("[data-testid='signInEmailInput']", "sendKeys", "user@example.com")
      await runningSystemTest.interact("[data-testid='signInPasswordInput']", "sendKeys", "password")

      await runningSystemTest.click("[data-testid='signInSubmitButton']")
      await runningSystemTest.expectNotificationMessage("You were signed in.")
    })
  } finally {
    await systemTest.stop()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
