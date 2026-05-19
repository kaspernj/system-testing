// @ts-check

import {isSystemTestEnabled, resetSystemTestEnabledForTests} from "../src/use-system-test.js"

const originalLocation = globalThis.location
const originalSystemTestEnv = process.env.EXPO_PUBLIC_SYSTEM_TEST
const originalSystemTestHostEnv = process.env.EXPO_PUBLIC_SYSTEM_TEST_HOST

describe("useSystemTest enablement", () => {
  afterEach(() => {
    resetSystemTestEnabledForTests()
    restoreLocation()
    restoreEnv("EXPO_PUBLIC_SYSTEM_TEST", originalSystemTestEnv)
    restoreEnv("EXPO_PUBLIC_SYSTEM_TEST_HOST", originalSystemTestHostEnv)
  })

  it("stays enabled after a system-test URL navigates to a normal route", () => {
    setLocationHref("http://localhost:5001/blank?systemTest=true")

    expect(isSystemTestEnabled()).toBeTrue()

    setLocationHref("http://localhost:5001/projects/1/edit")

    expect(isSystemTestEnabled()).toBeTrue()
  })

  it("stays disabled when no system-test URL or environment flag has been seen", () => {
    setLocationHref("http://localhost:5001/projects/1/edit")
    delete process.env.EXPO_PUBLIC_SYSTEM_TEST
    delete process.env.EXPO_PUBLIC_SYSTEM_TEST_HOST

    expect(isSystemTestEnabled()).toBeFalse()
  })
})

/**
 * Sets the global browser location used by the hook auto-detection code.
 * @param {string} href Browser URL to expose.
 * @returns {void} Nothing.
 */
function setLocationHref(href) {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: {href}
  })
}

/** @returns {void} */
function restoreLocation() {
  if (originalLocation === undefined) {
    delete globalThis.location
    return
  }

  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: originalLocation
  })
}

/**
 * Restores an environment variable to its original value.
 * @param {string} key Environment variable name.
 * @param {string | undefined} value Original value.
 * @returns {void} Nothing.
 */
function restoreEnv(key, value) {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
