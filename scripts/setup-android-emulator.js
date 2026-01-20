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
const systemImage = process.env.ANDROID_SYSTEM_IMAGE ?? "system-images;android-33;google_apis;x86_64"
const avdDevice = process.env.ANDROID_AVD_DEVICE ?? "pixel_5"
const packages = [
  "platform-tools",
  "platforms;android-33",
  "emulator",
  systemImage
]
const useSudoForEmulator = true

if (!fs.existsSync(emulatorPath)) {
  ensurePackages()
}

ensurePackages()
ensureAvd()
startEmulator()
waitForDevice()
ensureBootCompleted()

/** @returns {void} */
function ensurePackages() {
  console.log("[android] Ensuring SDK packages")
  runWithYes(["--licenses"], {sudo: true})
  runSdkManager(packages, {sudo: true})
}

/** @returns {void} */
function ensureAvd() {
  console.log(`[android] Ensuring AVD ${avdName}`)
  const listResult = run(avdmanagerPath, ["list", "avd"], {env: sdkEnv(), captureOutput: true})
  const output = listResult.stdout ?? ""

  if (output.includes(`Name: ${avdName}`)) {
    console.log(`[android] AVD ${avdName} already exists`)
    return
  }

  console.log(`[android] Creating AVD ${avdName}`)
  run(avdmanagerPath, ["create", "avd", "-n", avdName, "-k", systemImage, "-d", avdDevice], {
    env: sdkEnv(),
    input: "no\n"
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
  const args = useSudoForEmulator ? [emulatorPath, ...emulatorArgs] : emulatorArgs
  const child = spawn(command, args, {
    env: sdkEnv(),
    stdio: "inherit",
    detached: true
  })

  child.unref()
}

/** @returns {void} */
function waitForDevice() {
  console.log("[android] Waiting for adb device")
  if (!fs.existsSync(adbPath)) {
    throw new Error(`adb not found at ${adbPath}`)
  }

  run(adbPath, ["wait-for-device"], {env: sdkEnv(), sudo: useSudoForEmulator})
}

/** @returns {void} */
function ensureBootCompleted() {
  console.log("[android] Checking boot completion")
  if (!fs.existsSync(adbPath)) {
    throw new Error(`adb not found at ${adbPath}`)
  }

  const result = run(adbPath, ["shell", "getprop", "sys.boot_completed"], {env: sdkEnv(), sudo: useSudoForEmulator, captureOutput: true})
  const value = result.stdout.trim()

  if (value !== "1") {
    throw new Error(`Android boot did not complete. sys.boot_completed=${value}`)
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
  const command = `${sudoPrefix({sudo})} "${sdkmanagerPath}" ${args.join(" ")}`
  console.log(`[android] yes | ${command}`)
  const result = spawnSync("bash", ["-lc", `yes | ${command}`], {
    env: sdkEnv(),
    encoding: "utf-8",
    stdio: "inherit"
  })

  if (result.status !== 0) {
    throw new Error(`sdkmanager failed with exit code ${result.status}`)
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{sudo?: boolean, env?: Record<string, string | undefined>, input?: string, captureOutput?: boolean}} [options]
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function run(command, args, {sudo = false, env = process.env, input, captureOutput = false} = {}) {
  const fullCommand = sudo ? sudoPrefix({sudo: true}) : command
  const fullArgs = sudo ? [command, ...args] : args
  console.log(`[android] ${fullCommand} ${fullArgs.join(" ")}`)
  /** @type {import("node:child_process").StdioOptions} */
  const stdio = captureOutput ? ["pipe", "pipe", "inherit"] : ["pipe", "inherit", "inherit"]
  const result = spawnSync(fullCommand, fullArgs, {
    encoding: "utf-8",
    env,
    input,
    stdio
  })

  if (result.status !== 0) {
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
    ANDROID_SDK_ROOT: sdkRoot
  }
}

/** @returns {string} */
function ensureSdkRoot() {
  const resolved = resolveSdkRoot()

  if (resolved) return resolved

  installSdkPackages()

  const resolvedAfterInstall = resolveSdkRoot()

  if (resolvedAfterInstall) return resolvedAfterInstall

  throw new Error("Android SDK root not found. Set ANDROID_SDK_ROOT or ANDROID_HOME.")
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
  run("curl", ["-fsSL", toolsUrl, "-o", downloadPath], {sudo: false})
  run("mkdir", ["-p", extractPath], {sudo: false})
  run("unzip", ["-q", downloadPath, "-d", extractPath], {sudo: false})
  run("mkdir", ["-p", cmdlineRoot], {sudo: true})
  run("rm", ["-rf", path.join(cmdlineRoot, "latest")], {sudo: true})
  run("mv", [path.join(extractPath, "cmdline-tools"), path.join(cmdlineRoot, "latest")], {sudo: true})
}
