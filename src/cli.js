#!/usr/bin/env node

import BrowserCommandClient from "./browser-command-client.js"
import BrowserProcess from "./browser-process.js"
import BrowserRegistry from "./browser-registry.js"
import {parseArgv, resolveBrowserCommand} from "./cli-helpers.js"

/** @returns {void} */
function printHelp() {
  console.log(`Usage:
  system-testing browser <name> [--port 1991] [--base-url https://example.com]
  system-testing browser-list
  system-testing browser-command [--name my-browser] [--port 1991] --visit=https://example.com
  system-testing browser-command [--name my-browser] --find-by-test-id someID [--timeout 15]
  system-testing browser-command [--name my-browser] --take-screenshot
`)
}

/**
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
async function main(argv) {
  const parsed = parseArgv(argv)
  const mainCommand = parsed._[0]

  if (!mainCommand || parsed.flags.help) {
    printHelp()
    return
  }

  if (mainCommand === "browser") {
    const name = parsed._[1]

    if (!name) {
      throw new Error("browser requires a name")
    }

    const browserProcess = new BrowserProcess({
      baseUrl: parsed.flags["base-url"],
      browserArgs: {
        driver: parsed.flags.driver ? {type: parsed.flags.driver} : undefined
      },
      debug: parsed.flags.debug === true || parsed.flags.debug === "true",
      name,
      port: parsed.flags.port ? Number(parsed.flags.port) : 0
    })

    await browserProcess.start()
    console.log(JSON.stringify({name, pid: process.pid, port: browserProcess.port}))
    await new Promise(() => {})
  } else if (mainCommand === "browser-list") {
    const entries = await BrowserRegistry.list()

    if (parsed.flags.json) {
      console.log(JSON.stringify(entries, null, 2))
      return
    }

    for (const entry of entries) {
      console.log(`${entry.name}\t${entry.port}\tpid=${entry.pid}`)
    }
  } else if (mainCommand === "browser-command") {
    const client = new BrowserCommandClient({
      name: parsed.flags.name,
      port: parsed.flags.port ? Number(parsed.flags.port) : undefined
    })
    const {args, command} = resolveBrowserCommand(parsed.flags)
    const result = await client.send({args, command, type: "browser-command"})

    console.log(JSON.stringify(result, null, 2))
  } else {
    throw new Error(`Unknown command: ${mainCommand}`)
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
