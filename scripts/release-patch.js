#!/usr/bin/env node
import {execFile, spawn} from "node:child_process"
import {promisify} from "node:util"

const execFileAsync = promisify(execFile)

const run = (command, args = []) => new Promise((resolve, reject) => {
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

const isNpmLoggedIn = async () => {
  try {
    await execFileAsync("npm", ["whoami"])
    return true
  } catch {
    return false
  }
}

if (!await isNpmLoggedIn()) {
  await run("npm", ["login"])
}

await run("npm", ["version", "patch", "--no-git-tag-version"])
await run("npm", ["install"])
await run("npm", ["run", "all-checks"])

const {stdout: versionStdout} = await execFileAsync("npm", ["pkg", "get", "version"], {encoding: "utf8"})
const version = versionStdout.trim().replace(/"/g, "")
await run("git", ["add", "package.json", "package-lock.json"])
await run("git", ["commit", "-m", `Release v${version}`])
await run("npm", ["publish"])
