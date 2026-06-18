import fs from "node:fs"

const [propertiesPath, timeoutMs] = process.argv.slice(2)

if (!propertiesPath) {
  throw new Error("Usage: set-gradle-wrapper-network-timeout.mjs <gradle-wrapper.properties> <timeout-ms>")
}
if (!timeoutMs || !/^[1-9]\d*$/.test(timeoutMs)) {
  throw new Error(`Expected timeout-ms to be a positive integer, got: ${String(timeoutMs)}`)
}

const originalProperties = fs.readFileSync(propertiesPath, "utf8")
const timeoutLine = `networkTimeout=${timeoutMs}`
const nextProperties = originalProperties.match(/^networkTimeout=/m)
  ? originalProperties.replace(/^networkTimeout=.*/m, timeoutLine)
  : `${originalProperties.replace(/\s*$/, "\n")}${timeoutLine}\n`

fs.writeFileSync(propertiesPath, nextProperties)
