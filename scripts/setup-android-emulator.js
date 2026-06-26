// @ts-check

import {spawn, spawnSync} from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const sdkRoot = ensureSdkRoot()
console.log(`[android] Using SDK root: ${sdkRoot}`)
const {sdkmanagerPath, avdmanagerPath} = ensureCmdlineTools(sdkRoot)
console.log(`[android] sdkmanager: ${sdkmanagerPath}`)
console.log(`[android] avdmanager: ${avdmanagerPath}`)
const emulatorPath = path.join(sdkRoot, "emulator", "emulator")
const adbPath = path.join(sdkRoot, "platform-tools", "adb")
const avdName = process.env.ANDROID_AVD_NAME ?? "system-test-android"
const emulatorLogPath = process.env.ANDROID_EMULATOR_LOG_PATH ?? path.join(process.cwd(), "tmp", "android", `${avdName}-emulator.log`)
const systemImage = process.env.ANDROID_SYSTEM_IMAGE ?? "system-images;android-33;google_apis;x86_64"
const avdDevice = process.env.ANDROID_AVD_DEVICE ?? "pixel_5"
const avdHome = process.env.ANDROID_AVD_HOME ?? "/tmp/android-avd"
const ndkVersion = process.env.ANDROID_NDK_VERSION
const extraPackages = process.env.ANDROID_SDK_PACKAGES
  ? process.env.ANDROID_SDK_PACKAGES.split(",").map((value) => value.trim()).filter(Boolean)
  : []
const packages = [
  "platform-tools",
  "platforms;android-33",
  "platforms;android-36",
  "emulator",
  systemImage,
  ...(ndkVersion ? [`ndk;${ndkVersion}`] : []),
  ...extraPackages
]
const useSudoForEmulator = true
const useSudoForAdb = false
const stage = process.env.ANDROID_EMULATOR_STAGE ?? "full"

if (stage === "stop") {
  stopEmulator()
} else {
  if (!fs.existsSync(emulatorPath) && stage !== "start") {
    ensurePackages()
  }

  if (stage !== "start") {
    ensurePackages()
    ensureWritableSdkRoot()
    ensureAvd()
  }

  if (stage !== "install") {
    if (!fs.existsSync(adbPath)) {
      ensurePackages()
    }
    ensureAdbServer()
    prepareEmulatorStart()
    startEmulator()
    waitForDevice()
    ensureBootCompleted()
  }
}

/** @returns {void} */
function ensurePackages() {
  console.log("[android] Ensuring SDK packages")
  runWithYes(["--licenses"], {sudo: true})
  runSdkManager(packages, {sudo: true})
}

/** @returns {void} */
function ensureWritableSdkRoot() {
  run("chmod", ["-R", "777", sdkRoot], {sudo: true})
  const sdkHome = process.env.ANDROID_SDK_HOME ?? path.join(sdkRoot, ".android")
  run("chmod", ["-R", "777", sdkHome], {sudo: true})
}

/** @returns {void} */
function ensureAvd() {
  console.log(`[android] Ensuring AVD ${avdName}`)
  run("mkdir", ["-p", avdHome], {sudo: useSudoForEmulator})
  run("chmod", ["-R", "777", avdHome], {sudo: useSudoForEmulator})
  const listResult = run(avdmanagerPath, ["list", "avd"], {
    env: sdkEnv(),
    captureOutput: true,
    sudo: useSudoForEmulator
  })
  const output = listResult.stdout ?? ""

  if (output.includes(`Name: ${avdName}`)) {
    console.log(`[android] AVD ${avdName} already exists`)
    return
  }

  console.log(`[android] Creating AVD ${avdName}`)
  run(avdmanagerPath, ["create", "avd", "-n", avdName, "-k", systemImage, "-d", avdDevice], {
    env: sdkEnv(),
    input: "no\n",
    sudo: useSudoForEmulator
  })
}

/** @returns {void} */
function startEmulator() {
  console.log(`[android] Starting emulator ${avdName}`)
  if (!fs.existsSync(emulatorPath)) {
    throw new Error(`Emulator binary not found at ${emulatorPath}`)
  }

  const emulatorArgs = [
    "-avd",
    avdName,
    "-no-window",
    "-no-audio",
    "-gpu",
    "swiftshader_indirect",
    "-no-snapshot-save",
    "-no-boot-anim"
  ]

  const command = useSudoForEmulator ? "sudo" : emulatorPath
  const args = useSudoForEmulator ? buildSudoArgs(emulatorPath, emulatorArgs, sdkEnv()) : emulatorArgs
  fs.mkdirSync(path.dirname(emulatorLogPath), {recursive: true})
  const emulatorLogFd = fs.openSync(emulatorLogPath, "a")

  console.log(`[android] Emulator output: ${emulatorLogPath}`)
  try {
    const child = spawn(command, args, {
      env: sdkEnv(),
      stdio: ["ignore", emulatorLogFd, emulatorLogFd],
      detached: true
    })

    child.unref()
  } finally {
    fs.closeSync(emulatorLogFd)
  }
}

/** @returns {void} */
function prepareEmulatorStart() {
  console.log(`[android] Preparing clean emulator start for ${avdName}`)
  stopEmulator()
}

/** @returns {void} */
function stopEmulator() {
  console.log(`[android] Stopping emulator ${avdName}`)
  stopConnectedEmulatorsForAvd()
  stopEmulatorProcessesForAvd()
  sleep(2)
  clearAvdLocks()
  stopAdbServer()
}

/** @returns {void} */
function stopConnectedEmulatorsForAvd() {
  for (const device of connectedEmulatorDevicesForAvd()) {
    console.log(`[android] Stopping connected emulator ${device} for ${avdName}`)
    run(adbPath, ["-s", device, "emu", "kill"], {env: sdkEnv(), sudo: useSudoForAdb, allowFailure: true})
  }
}

/** @returns {void} */
function stopEmulatorProcessesForAvd() {
  const pattern = `${escapeRegex(emulatorPath)}.*-avd ${escapeRegex(avdName)}`
  console.log(`[android] Stopping emulator processes matching ${pattern}`)
  run("pkill", ["-f", pattern], {sudo: true, allowFailure: true})
}

/** @returns {void} */
function clearAvdLocks() {
  const avdPath = path.join(avdHome, `${avdName}.avd`)

  if (!fs.existsSync(avdPath)) return

  const lockPaths = fs.readdirSync(avdPath)
    .filter((entry) => entry.endsWith(".lock"))
    .map((entry) => path.join(avdPath, entry))

  if (lockPaths.length === 0) return

  console.log(`[android] Removing stale AVD locks for ${avdName}`)
  run("rm", ["-rf", ...lockPaths], {sudo: useSudoForEmulator})
}

/** @returns {void} */
function waitForDevice() {
  console.log("[android] Waiting for adb device")
  if (!fs.existsSync(adbPath)) {
    throw new Error(`adb not found at ${adbPath}`)
  }

  const startTime = Date.now()
  const timeoutMs = 120000

  while (true) {
    const devices = connectedEmulatorDevices()

    if (devices.length > 0) {
      console.log(`[android] Connected adb emulator device: ${devices[0]}`)
      return
    }

    const elapsedMs = Date.now() - startTime

    if (elapsedMs >= timeoutMs) {
      throw new Error(`Android emulator device was not visible to adb after ${Math.round(timeoutMs / 1000)}s`)
    }

    sleep(2)
  }
}

/** @returns {void} */
function ensureBootCompleted() {
  console.log("[android] Checking boot completion")
  if (!fs.existsSync(adbPath)) {
    throw new Error(`adb not found at ${adbPath}`)
  }

  const startTime = Date.now()
  const timeoutMs = 300000

  while (true) {
    const result = run(adbPath, ["shell", "getprop", "sys.boot_completed"], {env: sdkEnv(), sudo: useSudoForAdb, captureOutput: true})
    const value = result.stdout.trim()

    if (value === "1") {
      console.log("[android] Boot completed")
      return
    }

    const elapsedMs = Date.now() - startTime

    if (elapsedMs >= timeoutMs) {
      throw new Error(`Android boot did not complete after ${Math.round(timeoutMs / 1000)}s. sys.boot_completed=${value}`)
    }

    console.log("[android] Waiting for boot completion")
    sleep(5)
  }
}

/** @returns {void} */
/**
 * @param {string[]} args
 * @param {{sudo: boolean}} options
 * @returns {void}
 */
function runSdkManager(args, {sudo}) {
  console.log(`[android] sdkmanager ${args.join(" ")}`)
  run(sdkmanagerPath, args, {sudo, env: sdkEnv()})
}

/**
 * @param {string[]} args
 * @param {{sudo: boolean}} options
 * @returns {void}
 */
function runWithYes(args, {sudo}) {
  const fullCommand = sudo ? sudoPrefix({sudo: true}) : sdkmanagerPath
  const fullArgs = sudo ? buildSudoArgs(sdkmanagerPath, args, sdkEnv()) : args
  const quotedCommand = [fullCommand, ...fullArgs].map((part) => `'${part.replaceAll("'", "'\\''")}'`).join(" ")

  console.log(`[android] ${fullCommand} ${fullArgs.join(" ")} < yes`)
  const result = spawnSync("sh", ["-c", `yes | ${quotedCommand}`], {
    env: sdkEnv(),
    encoding: "utf-8",
    stdio: ["ignore", "inherit", "inherit"]
  })

  if (result.status !== 0) {
    throw new Error(`sdkmanager failed with exit code ${result.status}`)
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{sudo?: boolean, env?: Record<string, string | undefined>, input?: string, captureOutput?: boolean, allowFailure?: boolean, timeoutMs?: number}} [options]
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function run(command, args, {sudo = false, env = process.env, input, captureOutput = false, allowFailure = false, timeoutMs} = {}) {
  const fullCommand = sudo ? sudoPrefix({sudo: true}) : command
  const fullArgs = sudo ? buildSudoArgs(command, args, env) : args
  console.log(`[android] ${fullCommand} ${fullArgs.join(" ")}`)
  /** @type {import("node:child_process").StdioOptions} */
  const stdio = captureOutput ? ["pipe", "pipe", "inherit"] : ["pipe", "inherit", "inherit"]
  const result = spawnSync(fullCommand, fullArgs, {
    encoding: "utf-8",
    env,
    input,
    killSignal: "SIGKILL",
    stdio,
    timeout: timeoutMs
  })

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`Command failed: ${fullCommand} ${fullArgs.join(" ")}`)
  }

  return result
}

/**
 * @param {{sudo: boolean}} options
 * @returns {string}
 */
function sudoPrefix({sudo}) {
  if (!sudo || process.getuid?.() === 0) return ""
  return "sudo"
}

/** @returns {Record<string, string | undefined>} */
function sdkEnv() {
  return {
    ...process.env,
    ANDROID_SDK_ROOT: sdkRoot,
    ANDROID_SDK_HOME: process.env.ANDROID_SDK_HOME ?? sdkRoot,
    ANDROID_AVD_HOME: avdHome,
  }
}

/** @returns {string} */
function ensureSdkRoot() {
  const preferredRoot = getPreferredSdkRoot()

  if (preferredRoot) {
    ensureSdkRootDir(preferredRoot)
    return preferredRoot
  }

  const resolved = resolveSdkRoot()

  if (resolved) return resolved

  installSdkPackages()

  const resolvedAfterInstall = resolveSdkRoot()

  if (resolvedAfterInstall) return resolvedAfterInstall

  throw new Error("Android SDK root not found. Set ANDROID_SDK_ROOT or ANDROID_HOME.")
}

/** @returns {string | undefined} */
function getPreferredSdkRoot() {
  return process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME
}

/**
 * @param {string} root
 * @returns {void}
 */
function ensureSdkRootDir(root) {
  if (fs.existsSync(root)) {
    run("chmod", ["-R", "777", root], {sudo: true})
    const sdkHome = process.env.ANDROID_SDK_HOME ?? path.join(root, ".android")
    run("chmod", ["-R", "777", sdkHome], {sudo: true})
    return
  }

  run("mkdir", ["-p", root], {sudo: true})
  const sdkHome = process.env.ANDROID_SDK_HOME ?? path.join(root, ".android")
  run("mkdir", ["-p", sdkHome], {sudo: true})
  run("chmod", ["-R", "777", root], {sudo: true})
}

/** @returns {string | undefined} */
function resolveSdkRoot() {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    "/usr/lib/android-sdk",
    "/usr/local/android-sdk",
    "/opt/android-sdk"
  ].filter((candidate) => typeof candidate === "string")

  return candidates.find((candidate) => fs.existsSync(candidate))
}

/** @returns {void} */
function installSdkPackages() {
  console.log("[android] Installing SDK packages via apt")
  run("mkdir", ["-p", "/usr/lib/android-sdk"], {sudo: true})
  const packages = [
    "android-sdk",
    "android-sdk-platform-tools",
    "android-sdk-build-tools",
    "openjdk-17-jdk",
    "curl",
    "unzip"
  ]

  run("apt-get", ["update"], {sudo: true})
  run("apt-get", ["install", "-y", ...packages], {sudo: true})
}

/**
 * @param {string} groupName
 * @returns {string | undefined}
 */
/**
 * @param {string} root
 * @returns {{sdkmanagerPath: string, avdmanagerPath: string}}
 */
function ensureCmdlineTools(root) {
  try {
    return resolveCmdlineTools(root)
  } catch {
    console.log("[android] cmdline-tools missing, downloading")
    installCmdlineTools(root)
  }

  return resolveCmdlineTools(root)
}

/**
 * @param {string} root
 * @returns {{sdkmanagerPath: string, avdmanagerPath: string}}
 */
function resolveCmdlineTools(root) {
  const cmdlineRoot = path.join(root, "cmdline-tools")

  if (!fs.existsSync(cmdlineRoot)) {
    throw new Error(`Android cmdline-tools directory not found at ${cmdlineRoot}`)
  }

  const versions = fs.readdirSync(cmdlineRoot)
  const ordered = versions.includes("latest") ? ["latest", ...versions.filter((version) => version !== "latest")] : versions

  for (const version of ordered) {
    const sdkmanagerPath = path.join(cmdlineRoot, version, "bin", "sdkmanager")
    const avdmanagerPath = path.join(cmdlineRoot, version, "bin", "avdmanager")

    if (fs.existsSync(sdkmanagerPath) && fs.existsSync(avdmanagerPath)) {
      return {sdkmanagerPath, avdmanagerPath}
    }
  }

  throw new Error(`Android cmdline-tools missing sdkmanager/avdmanager under ${cmdlineRoot}`)
}

/**
 * @param {string} root
 * @returns {void}
 */
function installCmdlineTools(root) {
  console.log("[android] Installing cmdline-tools")
  const toolsUrl = "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  const downloadPath = "/tmp/android-cmdline-tools.zip"
  const extractPath = "/tmp/android-cmdline-tools"
  const cmdlineRoot = path.join(root, "cmdline-tools")

  run("rm", ["-rf", extractPath], {sudo: true})
  run("rm", ["-f", downloadPath], {sudo: true})
  run("curl", [
    "--http1.1",
    "--retry",
    "3",
    "--retry-all-errors",
    "--retry-delay",
    "2",
    "--connect-timeout",
    "30",
    "-fsSL",
    toolsUrl,
    "-o",
    downloadPath
  ], {sudo: false})
  run("mkdir", ["-p", extractPath], {sudo: false})
  run("unzip", ["-q", downloadPath, "-d", extractPath], {sudo: false})
  run("mkdir", ["-p", cmdlineRoot], {sudo: true})
  run("rm", ["-rf", path.join(cmdlineRoot, "latest")], {sudo: true})
  run("mv", [path.join(extractPath, "cmdline-tools"), path.join(cmdlineRoot, "latest")], {sudo: true})
}

/** @returns {void} */
function ensureAdbServer() {
  console.log("[android] Starting adb server")
  run(adbPath, ["start-server"], {env: sdkEnv(), sudo: useSudoForAdb})
}

/** @returns {void} */
function stopAdbServer() {
  if (!fs.existsSync(adbPath)) return

  console.log("[android] Stopping adb server")
  run(adbPath, ["kill-server"], {env: sdkEnv(), sudo: useSudoForAdb, allowFailure: true, timeoutMs: 10000})
  console.log("[android] adb server stop requested")
}

/** @returns {string[]} */
function connectedEmulatorDevicesForAvd() {
  return connectedEmulatorDevices().filter((device) => emulatorDeviceAvdName(device) === avdName)
}

/** @returns {string[]} */
function connectedEmulatorDevices() {
  if (!fs.existsSync(adbPath)) return []

  const result = run(adbPath, ["devices"], {env: sdkEnv(), sudo: useSudoForAdb, captureOutput: true, allowFailure: true})

  if (result.status !== 0) return []

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.match(/^(emulator-\d+)\s+device$/)?.[1])
    .filter((device) => typeof device === "string")
}

/**
 * @param {string} device
 * @returns {string | undefined}
 */
function emulatorDeviceAvdName(device) {
  const result = run(adbPath, ["-s", device, "emu", "avd", "name"], {
    env: sdkEnv(),
    sudo: useSudoForAdb,
    captureOutput: true,
    allowFailure: true
  })

  if (result.status !== 0) return undefined

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line !== "OK")
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * @param {number} seconds
 * @returns {void}
 */
function sleep(seconds) {
  run("sleep", [String(seconds)])
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function buildSudoArgs(command, args, env) {
  const envArgs = buildEnvArgs(env)
  const baseArgs = envArgs.length > 0 ? ["env", ...envArgs, command, ...args] : [command, ...args]

  return ["-E", ...baseArgs]
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function buildEnvArgs(env) {
  const keys = ["ANDROID_SDK_ROOT", "ANDROID_SDK_HOME", "ANDROID_AVD_HOME", "HOME"]

  return keys
    .map((key) => (env[key] ? `${key}=${env[key]}` : undefined))
    .filter((value) => typeof value === "string")
}
