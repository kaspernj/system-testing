#!/usr/bin/env node
// @ts-check

import {spawn} from "node:child_process"

const [command, ...args] = process.argv.slice(2)

if (!command) {
  console.error("Usage: run-with-heartbeat <command> [...args]")
  process.exit(1)
}

const intervalSeconds = Number.parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS ?? "30", 10)

if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
  throw new Error(`HEARTBEAT_INTERVAL_SECONDS must be a positive integer, got: ${process.env.HEARTBEAT_INTERVAL_SECONDS}`)
}

const label = process.env.HEARTBEAT_LABEL ?? [command, ...args].join(" ")
const heartbeat = setInterval(() => {
  console.log(`[heartbeat] ${label} still running`)
}, intervalSeconds * 1000)
const child = spawn(command, args, {
  env: process.env,
  stdio: "inherit"
})

child.on("error", (error) => {
  clearInterval(heartbeat)
  console.error(error)
  process.exit(1)
})

child.on("exit", (code, signal) => {
  clearInterval(heartbeat)

  if (signal) {
    console.error(`[heartbeat] ${label} exited from signal ${signal}`)
    process.exit(1)
  }

  process.exit(code ?? 1)
})
