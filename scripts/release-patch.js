#!/usr/bin/env node
import {execFile, spawn} from "node:child_process"
import {promisify} from "node:util"
import process from "node:process"

const execFileAsync = promisify(execFile)

/**
 * @param {string} command
 * @param {string[]} [args]
 * @returns {Promise<void>}
 */
export const run = (command, args = []) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {stdio: "inherit"})

  child.on("error", reject)
  child.on("close", (code) => {
    if (code === 0) {
      resolve()
    } else {
      reject(new Error(`Command failed (${code}): ${command}`))
    }
  })
})

/** @returns {Promise<boolean>} */
export const isNpmLoggedIn = async () => {
  try {
    await execFileAsync("npm", ["whoami"])
    return true
  } catch {
    return false
  }
}

/** @returns {Promise<void>} */
export const updateLocalMasterFromOrigin = async () => {
  await run("git", ["fetch", "origin"])
  await run("git", ["checkout", "master"])
  await run("git", ["merge", "origin/master"])
}

/** @returns {Promise<string>} */
export const currentVersion = async () => {
  const {stdout: versionStdout} = await execFileAsync("npm", ["pkg", "get", "version"], {encoding: "utf8"})
  return versionStdout.trim().replace(/"/g, "")
}

/**
 * @param {{
 *   currentVersion?: typeof currentVersion
 *   isNpmLoggedIn?: typeof isNpmLoggedIn
 *   run?: typeof run
 *   updateLocalMasterFromOrigin?: typeof updateLocalMasterFromOrigin
 * }} [dependencies]
 * @returns {Promise<void>}
 */
export const releasePatch = async (dependencies = {}) => {
  const currentVersionDependency = dependencies.currentVersion || currentVersion
  const isNpmLoggedInDependency = dependencies.isNpmLoggedIn || isNpmLoggedIn
  const runDependency = dependencies.run || run
  const updateLocalMasterFromOriginDependency = dependencies.updateLocalMasterFromOrigin || updateLocalMasterFromOrigin

  await updateLocalMasterFromOriginDependency()

  if (!await isNpmLoggedInDependency()) {
    await runDependency("npm", ["login"])
  }

  await runDependency("npm", ["version", "patch", "--no-git-tag-version"])
  await runDependency("npm", ["install"])
  await runDependency("npm", ["run", "all-checks"])

  const version = await currentVersionDependency()

  await runDependency("git", ["add", "package.json", "package-lock.json"])
  await runDependency("git", ["commit", "-m", `Release v${version}`])
  await runDependency("git", ["push", "origin", "master"])
  await runDependency("npm", ["publish"])
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await releasePatch()
}
