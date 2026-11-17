import fs from "node:fs"

const peakFlow = fs.readFileSync(new URL("../peak_flow.yml", import.meta.url), "utf8")
const peakFlowLines = peakFlow.split("\n")

const buildPaths = Object.fromEntries(["build_1", "build_2", "build_3"].map((build) => {
  const start = peakFlowLines.indexOf(`  ${build}:`)
  const end = peakFlowLines.findIndex((line, index) => index > start && /^ {2}build_\d+:$/.test(line))
  const lines = peakFlowLines.slice(start, end === -1 ? undefined : end)

  return [build, lines.flatMap((line) => {
    const match = line.match(/^ {6}- "(.+)"$/)
    return match ? [match[1]] : []
  })]
}))

describe("peak_flow path filters", () => {
  it("declares ordered paths for every build", () => {
    expect(Object.keys(buildPaths)).toEqual(["build_1", "build_2", "build_3"])

    for (const paths of Object.values(buildPaths)) {
      expect(paths.length).toBeGreaterThan(0)
      expect(paths.every((path) => path.length > 0)).toBeTrue()
    }
  })

  it("keeps shared configuration changes eligible for every build", () => {
    for (const sharedPath of [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "eslint.config.js",
      "peak_flow.yml",
      "AGENTS.md"
    ]) {
      for (const paths of Object.values(buildPaths)) {
        expect(paths).toContain(sharedPath)
      }
    }
  })

  it("uses quoted negations after positive globs for isolated toolchain paths", () => {
    for (const paths of Object.values(buildPaths)) {
      expect(paths.some((path) => path.startsWith("!"))).toBeTrue()
      expect(paths.filter((path) => path.startsWith("!")).every((path) => path.startsWith("!scripts/"))).toBeTrue()
    }

    expect(buildPaths.build_1).toContain("!scripts/setup-android-emulator.js")
    expect(buildPaths.build_2).toContain("!scripts/setup-android-emulator.js")
    expect(buildPaths.build_3).toContain("!scripts/test-appium-web.js")
  })
})
