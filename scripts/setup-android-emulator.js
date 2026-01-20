// @ts-check

import {spawn, spawnSync} from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const sdkRoot = ensureSdkRoot()
const {sdkmanagerPath, avdmanagerPath} = resolveCmdlineTools(sdkRoot)
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
  runWithYes(["--licenses"], {sudo: true})
  runSdkManager(packages, {sudo: true})
}

/** @returns {void} */
function ensureAvd() {
  const listResult = run(avdmanagerPath, ["list", "avd"], {env: sdkEnv()})
  const output = listResult.stdout

  if (output.includes(`Name: ${avdName}`)) {
    return
  }

  run(avdmanagerPath, ["create", "avd", "-n", avdName, "-k", systemImage, "-d", avdDevice], {
    env: sdkEnv(),
    input: "no\n"
  })
}

/** @returns {void} */
function startEmulator() {
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

  const child = spawn(emulatorPath, emulatorArgs, {
    env: sdkEnv(),
    stdio: "ignore",
    detached: true
  })

  child.unref()
}

/** @returns {void} */
function waitForDevice() {
  if (!fs.existsSync(adbPath)) {
    throw new Error(`adb not found at ${adbPath}`)
  }

  run(adbPath, ["wait-for-device"], {env: sdkEnv()})
}

/** @returns {void} */
function ensureBootCompleted() {
  if (!fs.existsSync(adbPath)) {
    throw new Error(`adb not found at ${adbPath}`)
  }

  const result = run(adbPath, ["shell", "getprop", "sys.boot_completed"], {env: sdkEnv()})
  const value = result.stdout.trim()

  if (value !== "1") {
    throw new Error(`Android boot did not complete. sys.boot_completed=${value}`)
  }
}

/**
 * @param {string[]} args
 * @param {{sudo: boolean}} options
 * @returns {void}
 */
function runSdkManager(args, {sudo}) {
  run(sdkmanagerPath, args, {sudo, env: sdkEnv()})
}

/**
 * @param {string[]} args
 * @param {{sudo: boolean}} options
 * @returns {void}
 */
function runWithYes(args, {sudo}) {
  const command = `${sudoPrefix({sudo})} "${sdkmanagerPath}" ${args.join(" ")}`
  const result = spawnSync("bash", ["-lc", `yes | ${command}`], {env: sdkEnv(), encoding: "utf-8"})

  if (result.status !== 0) {
    throw new Error(result.stderr || `sdkmanager failed with exit code ${result.status}`)
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{sudo?: boolean, env?: Record<string, string | undefined>, input?: string}} [options]
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function run(command, args, {sudo = false, env = process.env, input} = {}) {
  const fullCommand = sudo ? sudoPrefix({sudo: true}) : command
  const fullArgs = sudo ? [command, ...args] : args
  const result = spawnSync(fullCommand, fullArgs, {
    encoding: "utf-8",
    env,
    input,
    stdio: ["pipe", "pipe", "pipe"]
  })

  if (result.status !== 0) {
    throw new Error(result.stderr || `Command failed: ${fullCommand} ${fullArgs.join(" ")}`)
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
  ].filter(Boolean)

  return candidates.find((candidate) => fs.existsSync(candidate))
}

/** @returns {void} */
function installSdkPackages() {
  const packages = [
    "android-sdk",
    "android-sdk-platform-tools",
    "android-sdk-emulator",
    "android-sdk-build-tools",
    "android-sdk-cmdline-tools"
  ]

  run("apt-get", ["update"], {sudo: true})
  run("apt-get", ["install", "-y", ...packages], {sudo: true})
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
