import {setInterval} from "node:timers"

process.on("SIGTERM", () => {
  process.stdout.write("term\n")
})

process.stdout.write("ready\n")
setInterval(() => {}, 1000)
