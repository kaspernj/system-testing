#!/usr/bin/env node
// @ts-check

import {execFile, spawn} from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"

const execFileAsync = promisify(execFile)

/**
 * @typedef {{
 *   version: string,
 *   downloads?: {
 *     chromedriver?: Array<{
 *       platform: string,
 *       url: string
 *     }>
 *   }
 * }} ChromeForTestingVersion
 */

/**
 * @typedef {{
 *   downloadUrl: string,
 *   version: string
 * }} ChromedriverDownload
 */

const DEFAULT_CHROME_BINARY = process.env.SYSTEM_TEST_CHROME_BINARY ?? "/usr/bin/google-chrome"
const DEFAULT_PLATFORM = "linux64"
const CHROMEDRIVER_CACHE_DIR = path.join(process.cwd(), "tmp", "appium-web-chromedriver")

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

  await run("npm", ["run", "export:web"])

  const capabilities = buildAppiumWebCapabilities({
    chromeBinary: DEFAULT_CHROME_BINARY,
    chromedriverPath
  })

  await run("npm", ["test"], {
    env: {
      ...process.env,
      SYSTEM_TEST_HOST: "dist",
      SYSTEM_TEST_DRIVER: "appium",
      SYSTEM_TEST_APPIUM_DRIVERS: "chromium",
      SYSTEM_TEST_APPIUM_TEST_ID_STRATEGY: "css",
      SYSTEM_TEST_APPIUM_CAPABILITIES: JSON.stringify(capabilities)
    }
  })
}

/**
 * @param {string} chromeBinary
 * @returns {Promise<string>}
 */
export async function getChromeVersion(chromeBinary) {
  const {stdout} = await execFileAsync(chromeBinary, ["--product-version"], {encoding: "utf8"})
  return stdout.trim()
}

/** @returns {Promise<ChromeForTestingVersion[]>} */
export async function fetchKnownGoodVersions() {
  const response = await fetch("https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json")

  if (!response.ok) {
    throw new Error(`Unable to fetch Chrome for Testing versions: ${response.status} ${response.statusText}`)
  }

  /** @type {{versions: ChromeForTestingVersion[]}} */
  const payload = await response.json()
  return payload.versions
}

/**
 * @param {{
 *   browserVersion: string,
 *   chromeForTestingVersions: ChromeForTestingVersion[],
 *   chromeBinary: string,
 *   platform: string
 * }} options
 * @returns {Promise<string>}
 */
export async function ensureChromedriver({browserVersion, chromeForTestingVersions, chromeBinary, platform}) {
  const download = resolveChromedriverDownload({
    browserVersion,
    chromeForTestingVersions,
    platform
  })
  const chromedriverPath = path.join(CHROMEDRIVER_CACHE_DIR, "chromedriver-linux64", "chromedriver")
  const metadataPath = path.join(CHROMEDRIVER_CACHE_DIR, "metadata.json")

  if (fs.existsSync(chromedriverPath) && fs.existsSync(metadataPath)) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"))

    if (metadata.version === download.version && metadata.chromeBinary === chromeBinary) {
      return chromedriverPath
    }
  }

  fs.rmSync(CHROMEDRIVER_CACHE_DIR, {recursive: true, force: true})
  fs.mkdirSync(CHROMEDRIVER_CACHE_DIR, {recursive: true})

  const archivePath = path.join(CHROMEDRIVER_CACHE_DIR, "chromedriver.zip")
  const response = await fetch(download.downloadUrl)

  if (!response.ok) {
    throw new Error(`Unable to download ChromeDriver ${download.version}: ${response.status} ${response.statusText}`)
  }

  const archiveBuffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(archivePath, archiveBuffer)
  await execFileAsync("unzip", ["-o", archivePath, "-d", CHROMEDRIVER_CACHE_DIR], {encoding: "utf8"})
  fs.chmodSync(chromedriverPath, 0o755)
  fs.writeFileSync(metadataPath, JSON.stringify({
    chromeBinary,
    chromeVersion: browserVersion,
    version: download.version
  }, null, 2))

  return chromedriverPath
}

/**
 * @param {{
 *   browserVersion: string,
 *   chromeForTestingVersions: ChromeForTestingVersion[],
 *   platform: string
 * }} options
 * @returns {ChromedriverDownload}
 */
export function resolveChromedriverDownload({browserVersion, chromeForTestingVersions, platform}) {
  const parsedBrowserVersion = parseVersion(browserVersion)
  const exactMatch = findDownload({
    platform,
    version: browserVersion,
    versions: chromeForTestingVersions
  })

  if (exactMatch) {
    return exactMatch
  }

  const sameBuildCandidates = chromeForTestingVersions
    .filter((entry) => hasMatchingSegments(entry.version, parsedBrowserVersion, 3))
    .map((entry) => buildDownloadCandidate(entry, parsedBrowserVersion, platform))
    .filter(Boolean)
    .sort(compareDownloadCandidates)

  if (sameBuildCandidates.length > 0) {
    return sameBuildCandidates[0].download
  }

  const sameMajorCandidates = chromeForTestingVersions
    .filter((entry) => hasMatchingSegments(entry.version, parsedBrowserVersion, 1))
    .map((entry) => buildDownloadCandidate(entry, parsedBrowserVersion, platform))
    .filter(Boolean)
    .sort(compareDownloadCandidates)

  if (sameMajorCandidates.length > 0) {
    return sameMajorCandidates[0].download
  }

  throw new Error(`Unable to find a ChromeDriver download matching Chrome ${browserVersion} for platform ${platform}`)
}

/**
 * @param {{
 *   chromeBinary: string,
 *   chromedriverPath: string
 * }} options
 * @returns {Record<string, unknown>}
 */
export function buildAppiumWebCapabilities({chromeBinary, chromedriverPath}) {
  return {
    platformName: "linux",
    browserName: "chrome",
    "appium:automationName": "Chromium",
    "appium:autodownloadEnabled": false,
    "appium:executable": chromedriverPath,
    "goog:chromeOptions": {
      binary: chromeBinary,
      args: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
    }
  }
}

/**
 * @param {string} version
 * @returns {number[]}
 */
export function parseVersion(version) {
  const segments = version.split(".").map((segment) => Number.parseInt(segment, 10))

  if (segments.some((segment) => Number.isNaN(segment))) {
    throw new Error(`Invalid version: ${version}`)
  }

  return segments
}

/**
 * @param {{
 *   platform: string,
 *   version: string,
 *   versions: ChromeForTestingVersion[]
 * }} options
 * @returns {ChromedriverDownload | undefined}
 */
function findDownload({platform, version, versions}) {
  const entry = versions.find((candidate) => candidate.version === version)
  const downloadUrl = entry?.downloads?.chromedriver?.find((download) => download.platform === platform)?.url

  if (!downloadUrl) return undefined

  return {
    downloadUrl,
    version: entry.version
  }
}

/**
 * @param {string} version
 * @param {number[]} parsedBrowserVersion
 * @param {string} platform
 * @returns {{distance: number, download: ChromedriverDownload, parsedVersion: number[]} | undefined}
 */
function buildDownloadCandidate(version, parsedBrowserVersion, platform) {
  const download = findDownload({
    platform,
    version: version.version,
    versions: [version]
  })

  if (!download) return undefined

  const parsedVersion = parseVersion(version.version)
  return {
    distance: calculateVersionDistance(parsedVersion, parsedBrowserVersion),
    download,
    parsedVersion
  }
}

/**
 * @param {{distance: number, parsedVersion: number[]}} left
 * @param {{distance: number, parsedVersion: number[]}} right
 * @returns {number}
 */
function compareDownloadCandidates(left, right) {
  if (left.distance !== right.distance) return left.distance - right.distance

  return compareVersions(right.parsedVersion, left.parsedVersion)
}

/**
 * @param {number[]} left
 * @param {number[]} right
 * @returns {number}
 */
function compareVersions(left, right) {
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const leftSegment = left[index] ?? 0
    const rightSegment = right[index] ?? 0

    if (leftSegment !== rightSegment) return leftSegment - rightSegment
  }

  return 0
}

/**
 * @param {number[]} left
 * @param {number[]} right
 * @returns {number}
 */
function calculateVersionDistance(left, right) {
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const leftSegment = left[index] ?? 0
    const rightSegment = right[index] ?? 0

    if (leftSegment !== rightSegment) {
      return Math.abs(leftSegment - rightSegment)
    }
  }

  return 0
}

/**
 * @param {string} version
 * @param {number[]} parsedBrowserVersion
 * @param {number} segmentCount
 * @returns {boolean}
 */
function hasMatchingSegments(version, parsedBrowserVersion, segmentCount) {
  const parsedVersion = parseVersion(version)

  for (let index = 0; index < segmentCount; index += 1) {
    if (parsedVersion[index] !== parsedBrowserVersion[index]) return false
  }

  return true
}

/**
 * @param {string} importMetaUrl
 * @returns {boolean}
 */
function isEntrypoint(importMetaUrl) {
  const currentPath = fileURLToPath(importMetaUrl)
  const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined
  return currentPath === entryPath
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{env?: Record<string, string | undefined>}} [options]
 * @returns {Promise<void>}
 */
function run(command, args, {env = process.env} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: "inherit"
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`))
      }
    })
  })
}
