import {spawn} from "node:child_process"
import {setInterval} from "node:timers"

if (process.argv.includes("--descendant")) {
  process.on("SIGTERM", () => {})
  setInterval(() => {}, 1000)
} else {
  process.on("SIGTERM", () => {
    const descendant = spawn(process.execPath, [new URL(import.meta.url).pathname, "--descendant"], {
      stdio: "ignore"
    })

    process.stdout.write(`descendant:${descendant.pid}\n`, () => process.exit(0))
  })

  process.stdout.write("ready\n")
  setInterval(() => {}, 1000)
}
