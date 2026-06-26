#!/usr/bin/env node
// @ts-check

import {spawn} from "node:child_process"
import {
  ensureChromedriver,
  fetchKnownGoodVersions,
  getChromeVersion
} from "./test-appium-web.js"

const DEFAULT_CHROME_BINARY = process.env.SYSTEM_TEST_CHROME_BINARY ?? "/usr/bin/google-chrome"
const DEFAULT_PLATFORM = "linux64"

if (isEntrypoint(import.meta.url)) {
  await main()
}

/** @returns {Promise<void>} */
export async function main() {
  const chromeVersion = await getChromeVersion(DEFAULT_CHROME_BINARY)
  const knownGoodVersions = await fetchKnownGoodVersions()
  const chromedriverPath = await ensureChromedriver({
    browserVersion: chromeVersion,
    chromeForTestingVersions: knownGoodVersions,
    chromeBinary: DEFAULT_CHROME_BINARY,
    platform: DEFAULT_PLATFORM
  })

  console.log(`[default-checks] Using Chrome ${chromeVersion}`)
  console.log(`[default-checks] Using Chromedriver ${chromedriverPath}`)
  await runAllChecks(chromedriverPath)
}

/**
 * @param {string} chromedriverPath
 * @returns {Promise<void>}
 */
function runAllChecks(chromedriverPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "all-checks"], {
      env: {
        ...process.env,
        SYSTEM_TEST_CHROMEDRIVER_PATH: chromedriverPath
      },
      stdio: "inherit"
    })

    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Default checks exited from signal ${signal}`))
        return
      }

      if (code !== 0) {
        reject(new Error(`Default checks failed with exit code ${code}`))
        return
      }

      resolve()
    })
  })
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isEntrypoint(url) {
  return url === `file://${process.argv[1]}`
}
