import childProcess from "node:child_process"
import fs from "node:fs"
import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {randomUUID} from "node:crypto"
import {promisify} from "node:util"
import extractZip from "extract-zip"

/**
 * @typedef {object} ChromeRuntime
 * @property {string} chromeBinaryPath Chrome Headless Shell executable path.
 * @property {string} chromedriverPath ChromeDriver executable path.
 * @property {string} version Exact shared runtime version.
 */

/**
 * @typedef {object} ChromeRuntimeDependencies
 * @property {(filePath: string, mode?: number) => Promise<void>} [access] Filesystem access check.
 * @property {string} [arch] Node architecture name.
 * @property {(url: string, destinationPath: string) => Promise<void>} [download] Archive downloader.
 * @property {Record<string, string | undefined>} [env] Environment variables.
 * @property {(executablePath: string) => Promise<string>} [executableVersion] Executable version reader.
 * @property {(archivePath: string, destinationPath: string) => Promise<void>} [extractArchive] Zip extractor.
 * @property {(url: string) => Promise<any>} [fetchJson] JSON downloader.
 * @property {(path: string, options?: {recursive?: boolean}) => Promise<string | undefined>} [mkdir] Directory creator.
 * @property {string} [platform] Node platform name.
 * @property {(path: string, encoding: "utf8") => Promise<string>} [readFile] Text file reader.
 * @property {(oldPath: string, newPath: string) => Promise<void>} [rename] Filesystem rename operation.
 * @property {(path: string, options?: {force?: boolean, recursive?: boolean}) => Promise<void>} [rm] Filesystem removal operation.
 * @property {(path: string, data: string) => Promise<void>} [writeFile] Text file writer.
 */

/**
 * @typedef {object} ResolveChromeRuntimeOptions
 * @property {string} [cachePath] Runtime cache root.
 * @property {ChromeRuntimeDependencies} [dependencies] Overrides for isolated tests.
 * @property {string} [chromeBinaryPath] Explicit Chrome binary override.
 * @property {string} [chromedriverPath] Explicit ChromeDriver override.
 */

const LAST_KNOWN_GOOD_VERSIONS_URL = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json"
const KNOWN_GOOD_VERSIONS_URL = "https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json"
const VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/
const RUNTIME_DIRECTORY_PATTERN = /^runtime-(\d+\.\d+\.\d+\.\d+)-[0-9a-f-]{36}$/
const execFile = promisify(childProcess.execFile)

/**
 * @param {unknown} version
 * @returns {string} Validated exact release version.
 */
function validatedVersion(version) {
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) throw new Error(`Invalid Chrome-for-Testing version: ${String(version)}`)

  return version
}

/**
 * @param {string} cachePath
 * @param {string} childPath
 * @returns {string} A path proven to be contained by the cache root.
 */
function containedCachePath(cachePath, childPath) {
  const resolvedCachePath = path.resolve(cachePath)
  const resolvedChildPath = path.resolve(childPath)

  if (resolvedChildPath !== resolvedCachePath && !resolvedChildPath.startsWith(`${resolvedCachePath}${path.sep}`)) {
    throw new Error(`Chrome runtime path escapes cache root: ${resolvedChildPath}`)
  }

  return resolvedChildPath
}

/**
 * @param {unknown} url
 * @param {string} version
 * @param {"chrome-headless-shell" | "chromedriver"} artifact
 * @returns {string} Validated download URL.
 */
function validatedArtifactUrl(url, version, artifact) {
  const expectedPaths = [
    `/chrome-for-testing-public/${version}/linux64/${artifact}-linux64.zip`,
    `/edgedl/chrome/chrome-for-testing/${version}/linux64/${artifact}-linux64.zip`
  ]
  let parsedUrl

  try {
    parsedUrl = new URL(/** @type {string} */ (url))
  } catch {
    throw new Error(`Artifact URL is not an approved Chrome-for-Testing HTTPS URL: ${String(url)}`)
  }

  const approvedOrigin = parsedUrl.origin === "https://storage.googleapis.com" || parsedUrl.origin === "https://edgedl.me.gvt1.com"
  if (typeof url !== "string" || url.includes("/../") || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash || !approvedOrigin || !expectedPaths.includes(parsedUrl.pathname)) {
    throw new Error(`Artifact URL is not an approved Chrome-for-Testing HTTPS URL: ${String(url)}`)
  }

  return url
}

/**
 * @param {string} executablePath
 * @returns {Promise<string>} Exact executable version.
 */
async function defaultExecutableVersion(executablePath) {
  const {stdout, stderr} = await execFile(executablePath, ["--version"])
  const match = `${stdout}\n${stderr}`.match(/\b\d+\.\d+\.\d+\.\d+\b/)

  if (!match) throw new Error(`Could not determine the version of ${executablePath}`)

  return match[0]
}

/**
 * @param {string} url
 * @returns {Promise<any>} Parsed JSON response.
 */
async function defaultFetchJson(url) {
  const response = await fetch(url)

  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)

  return await response.json()
}

/**
 * @param {string} url
 * @param {string} destinationPath
 * @returns {Promise<void>}
 */
async function defaultDownload(url, destinationPath) {
  const response = await fetch(url)

  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)

  await fsPromises.writeFile(destinationPath, Buffer.from(await response.arrayBuffer()))
}

/**
 * @param {string} archivePath
 * @param {string} destinationPath
 * @returns {Promise<void>}
 */
async function defaultExtractArchive(archivePath, destinationPath) {
  await extractZip(archivePath, {dir: destinationPath})
}

/**
 * @param {ChromeRuntimeDependencies} overrides
 * @returns {Required<ChromeRuntimeDependencies>} Dependencies with production defaults.
 */
function dependenciesWithDefaults(overrides) {
  return {
    access: fsPromises.access,
    arch: process.arch,
    download: defaultDownload,
    env: process.env,
    executableVersion: defaultExecutableVersion,
    extractArchive: defaultExtractArchive,
    fetchJson: defaultFetchJson,
    mkdir: fsPromises.mkdir,
    platform: process.platform,
    readFile: fsPromises.readFile,
    rename: fsPromises.rename,
    rm: fsPromises.rm,
    writeFile: fsPromises.writeFile,
    ...overrides
  }
}

/**
 * @param {string} cachePath
 * @param {string} version
 * @returns {ChromeRuntime}
 */
function cachedRuntime(cachePath, version) {
  return cachedRuntimeInDirectory(cachePath, version, version)
}

/**
 * @param {string} cachePath
 * @param {string} version
 * @param {unknown} directory
 * @returns {ChromeRuntime}
 */
function cachedRuntimeInDirectory(cachePath, version, directory) {
  const validatedRuntimeVersion = validatedVersion(version)
  const match = typeof directory === "string" ? directory.match(RUNTIME_DIRECTORY_PATTERN) : undefined

  if (directory !== validatedRuntimeVersion && (!match || match[1] !== validatedRuntimeVersion)) {
    throw new Error(`Invalid Chrome runtime directory: ${String(directory)}`)
  }

  const versionPath = containedCachePath(cachePath, path.join(cachePath, /** @type {string} */ (directory)))
  return {
    chromeBinaryPath: containedCachePath(cachePath, path.join(versionPath, "chrome-headless-shell-linux64", "chrome-headless-shell")),
    chromedriverPath: containedCachePath(cachePath, path.join(versionPath, "chromedriver-linux64", "chromedriver")),
    version: validatedRuntimeVersion
  }
}

/**
 * @param {string} cachePath
 * @param {string} version
 * @param {string} directory
 * @param {ReturnType<typeof dependenciesWithDefaults>} dependencies
 * @returns {Promise<void>}
 */
async function writeResolvedManifest(cachePath, version, directory, dependencies) {
  const temporaryPath = containedCachePath(cachePath, path.join(cachePath, `.resolved-${process.pid}-${randomUUID()}.json`))

  try {
    await dependencies.writeFile(temporaryPath, JSON.stringify({version, directory}))
    await dependencies.rename(temporaryPath, containedCachePath(cachePath, path.join(cachePath, "resolved.json")))
  } finally {
    await dependencies.rm(temporaryPath, {force: true})
  }
}

/**
 * @param {ChromeRuntime} runtime
 * @param {ReturnType<typeof dependenciesWithDefaults>} dependencies
 * @returns {Promise<ChromeRuntime>} Validated runtime.
 */
async function validateRuntime(runtime, dependencies) {
  await dependencies.access(runtime.chromeBinaryPath, fs.constants.X_OK)
  await dependencies.access(runtime.chromedriverPath, fs.constants.X_OK)
  const chromeVersion = await dependencies.executableVersion(runtime.chromeBinaryPath)
  const chromedriverVersion = await dependencies.executableVersion(runtime.chromedriverPath)

  if (chromeVersion !== chromedriverVersion) {
    throw new Error(`Chrome Headless Shell ${chromeVersion} does not exactly match ChromeDriver ${chromedriverVersion}`)
  }

  if (runtime.version && chromeVersion !== runtime.version) {
    throw new Error(`Cached Chrome runtime ${chromeVersion} does not match recorded version ${runtime.version}`)
  }

  return {...runtime, version: chromeVersion}
}

/**
 * Lazily resolves an exact Chrome Headless Shell and ChromeDriver pair for Linux.
 * Other platforms are left to selenium-webdriver's Selenium Manager fallback.
 * @param {ResolveChromeRuntimeOptions} [options]
 * @returns {Promise<ChromeRuntime | undefined>}
 */
export async function resolveChromeRuntime(options = {}) {
  const dependencies = dependenciesWithDefaults(options.dependencies ?? {})

  if (dependencies.platform !== "linux" || dependencies.arch !== "x64") return undefined

  const explicitChromeBinaryPath = options.chromeBinaryPath ?? dependencies.env.SYSTEM_TEST_CHROME_BINARY
  const explicitChromedriverPath = options.chromedriverPath ?? dependencies.env.SYSTEM_TEST_CHROMEDRIVER_PATH

  if (explicitChromeBinaryPath && explicitChromedriverPath) {
    return await validateRuntime({chromeBinaryPath: explicitChromeBinaryPath, chromedriverPath: explicitChromedriverPath, version: ""}, dependencies)
  }

  const cachePath = options.cachePath ?? dependencies.env.SYSTEM_TEST_CHROME_RUNTIME_CACHE_PATH ?? path.join(os.homedir(), ".cache", "system-testing", "chrome")

  try {
    const {version, directory} = JSON.parse(await dependencies.readFile(containedCachePath(cachePath, path.join(cachePath, "resolved.json")), "utf8"))
    const manifestRuntime = cachedRuntimeInDirectory(cachePath, validatedVersion(version), directory ?? version)
    return await validateRuntime({
      chromeBinaryPath: explicitChromeBinaryPath ?? manifestRuntime.chromeBinaryPath,
      chromedriverPath: explicitChromedriverPath ?? manifestRuntime.chromedriverPath,
      version: manifestRuntime.version
    }, dependencies)
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EACCES") throw error
  }

  try {
    let release

    if (explicitChromeBinaryPath || explicitChromedriverPath) {
      const explicitVersion = await dependencies.executableVersion(/** @type {string} */ (explicitChromeBinaryPath ?? explicitChromedriverPath))
      const metadata = await dependencies.fetchJson(KNOWN_GOOD_VERSIONS_URL)
      release = metadata.versions.find((/** @type {any} */ candidate) => candidate.version === explicitVersion)
      if (!release) throw new Error(`Chrome-for-Testing has no release for explicit version ${explicitVersion}`)
    } else {
      release = (await dependencies.fetchJson(LAST_KNOWN_GOOD_VERSIONS_URL)).channels.Stable
    }

    const version = validatedVersion(release?.version)
    const chromeDownload = Array.isArray(release?.downloads?.["chrome-headless-shell"]) ? release.downloads["chrome-headless-shell"].find((/** @type {any} */ download) => download.platform === "linux64") : undefined
    const chromedriverDownload = Array.isArray(release?.downloads?.chromedriver) ? release.downloads.chromedriver.find((/** @type {any} */ download) => download.platform === "linux64") : undefined

    if (!chromeDownload || !chromedriverDownload) throw new Error(`Chrome-for-Testing release ${version} has no linux64 runtime pair`)

    const chromeDownloadUrl = validatedArtifactUrl(chromeDownload.url, version, "chrome-headless-shell")
    const chromedriverDownloadUrl = validatedArtifactUrl(chromedriverDownload.url, version, "chromedriver")
    const runtimeDirectory = `runtime-${version}-${randomUUID()}`
    const finalPath = containedCachePath(cachePath, path.join(cachePath, runtimeDirectory))
    const stagingPath = containedCachePath(cachePath, path.join(cachePath, `.staging-${version}-${process.pid}-${randomUUID()}`))

    await dependencies.mkdir(cachePath, {recursive: true})

    try {
      try {
        const winner = await validateRuntime(cachedRuntime(cachePath, version), dependencies)
        await writeResolvedManifest(cachePath, version, version, dependencies)
        return winner
      } catch {
        // Preserve a valid legacy version directory and publish elsewhere when it is invalid.
      }

      await dependencies.mkdir(stagingPath, {recursive: true})
      const chromeArchivePath = path.join(stagingPath, "chrome-headless-shell.zip")
      const chromedriverArchivePath = path.join(stagingPath, "chromedriver.zip")
      await dependencies.download(chromeDownloadUrl, chromeArchivePath)
      await dependencies.download(chromedriverDownloadUrl, chromedriverArchivePath)
      await dependencies.extractArchive(chromeArchivePath, stagingPath)
      await dependencies.extractArchive(chromedriverArchivePath, stagingPath)
      await dependencies.rm(chromeArchivePath, {force: true})
      await dependencies.rm(chromedriverArchivePath, {force: true})

      const stagingRuntime = {
        chromeBinaryPath: containedCachePath(cachePath, path.join(stagingPath, "chrome-headless-shell-linux64", "chrome-headless-shell")),
        chromedriverPath: containedCachePath(cachePath, path.join(stagingPath, "chromedriver-linux64", "chromedriver")),
        version
      }
      await validateRuntime({
        chromeBinaryPath: explicitChromeBinaryPath ?? stagingRuntime.chromeBinaryPath,
        chromedriverPath: explicitChromedriverPath ?? stagingRuntime.chromedriverPath,
        version
      }, dependencies)
      await dependencies.rename(stagingPath, finalPath)
      await writeResolvedManifest(cachePath, version, runtimeDirectory, dependencies)
      const publishedRuntime = cachedRuntimeInDirectory(cachePath, version, runtimeDirectory)

      return {
        chromeBinaryPath: explicitChromeBinaryPath ?? publishedRuntime.chromeBinaryPath,
        chromedriverPath: explicitChromedriverPath ?? publishedRuntime.chromedriverPath,
        version
      }
    } finally {
      await dependencies.rm(stagingPath, {recursive: true, force: true})
    }
  } catch (error) {
    const resolutionError = /** @type {Error & {cause: unknown}} */ (new Error(`Unable to resolve a matching Chrome Headless Shell and ChromeDriver pair: ${error instanceof Error ? error.message : String(error)}`))
    resolutionError.cause = error
    throw resolutionError
  }
}
