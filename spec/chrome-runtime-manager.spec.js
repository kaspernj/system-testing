// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {resolveChromeRuntime} from "../src/chrome-runtime-manager.js"

const VERSION = "131.0.6778.85"

/** @returns {any} Chrome-for-Testing downloads metadata fixture. */
function downloads() {
  return {
    channels: {
      Stable: {
        version: VERSION,
        downloads: {
          chromedriver: [{platform: "linux64", url: `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chromedriver-linux64.zip`}],
          "chrome-headless-shell": [{platform: "linux64", url: `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chrome-headless-shell-linux64.zip`}]
        }
      }
    }
  }
}

describe("resolveChromeRuntime", () => {
  it("uses and exactly validates explicit environment overrides before cache or network resolution", async () => {
    const calls = []
    const runtime = await resolveChromeRuntime({
      dependencies: {
        access: async () => {},
        env: {
          SYSTEM_TEST_CHROME_BINARY: "/overrides/chrome-headless-shell",
          SYSTEM_TEST_CHROMEDRIVER_PATH: "/overrides/chromedriver"
        },
        executableVersion: async (executablePath) => {
          calls.push(executablePath)
          return VERSION
        },
        platform: "linux"
      }
    })

    expect(runtime).toEqual({
      chromeBinaryPath: "/overrides/chrome-headless-shell",
      chromedriverPath: "/overrides/chromedriver",
      version: VERSION
    })
    expect(calls).toEqual(["/overrides/chrome-headless-shell", "/overrides/chromedriver"])
  })

  it("rejects explicit overrides that do not resolve to an exact pair", async () => {
    await expectAsync(resolveChromeRuntime({
      dependencies: {
        access: async () => {},
        env: {
          SYSTEM_TEST_CHROME_BINARY: "/overrides/chrome-headless-shell",
          SYSTEM_TEST_CHROMEDRIVER_PATH: "/overrides/chromedriver"
        },
        executableVersion: async (executablePath) => executablePath.endsWith("chromedriver") ? "130.0.6723.91" : VERSION,
        platform: "linux"
      }
    })).toBeRejectedWithError(/Chrome Headless Shell 131\.0\.6778\.85.*ChromeDriver 130\.0\.6723\.91/)
  })

  it("returns an exactly matching cached pair without using the network", async () => {
    const cachePath = "/cache/system-testing/chrome"
    const chromeBinaryPath = path.join(cachePath, VERSION, "chrome-headless-shell-linux64", "chrome-headless-shell")
    const chromedriverPath = path.join(cachePath, VERSION, "chromedriver-linux64", "chromedriver")
    const runtime = await resolveChromeRuntime({
      cachePath,
      dependencies: {
        access: async () => {},
        env: {},
        executableVersion: async () => VERSION,
        fetchJson: async () => { throw new Error("network should not be used") },
        platform: "linux",
        readFile: async () => JSON.stringify({version: VERSION})
      }
    })

    expect(runtime).toEqual({chromeBinaryPath, chromedriverPath, version: VERSION})
  })

  for (const override of ["chromeBinaryPath", "chromedriverPath"]) {
    it(`reuses the cached counterpart for a sequential ${override} override without using the network`, async () => {
      const cachePath = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-chrome-runtime-"))
      const explicitPath = `/overrides/${override}`
      const extractArchive = async (archivePath, destinationPath) => {
        const directory = archivePath.includes("headless-shell") ? "chrome-headless-shell-linux64" : "chromedriver-linux64"
        const executable = archivePath.includes("headless-shell") ? "chrome-headless-shell" : "chromedriver"
        await fs.mkdir(path.join(destinationPath, directory), {recursive: true})
        await fs.writeFile(path.join(destinationPath, directory, executable), "runtime")
        await fs.chmod(path.join(destinationPath, directory, executable), 0o755)
      }
      const options = {
        cachePath,
        [override]: explicitPath,
        dependencies: {
          access: async (filePath, mode) => filePath === explicitPath ? undefined : await fs.access(filePath, mode),
          download: async (url, destinationPath) => { await fs.writeFile(destinationPath, url) },
          env: {},
          executableVersion: async () => VERSION,
          extractArchive,
          fetchJson: async () => ({versions: [downloads().channels.Stable]}),
          platform: "linux"
        }
      }

      try {
        const first = await resolveChromeRuntime(options)
        const second = await resolveChromeRuntime({
          ...options,
          dependencies: {
            ...options.dependencies,
            fetchJson: async () => { throw new Error("network should not be used") }
          }
        })

        expect(second).toEqual(first)
        expect(second[override]).toEqual(explicitPath)
      } finally {
        await fs.rm(cachePath, {recursive: true, force: true})
      }
    })
  }

  it("publishes separately from a mismatched cached runtime after downloading both artifacts from one exact release", async () => {
    const downloadedUrls = []
    const removedPaths = []
    const renamedPaths = []
    const writtenPaths = []
    const runtime = await resolveChromeRuntime({
      cachePath: "/cache/system-testing/chrome",
      dependencies: {
        access: async () => {},
        download: async (url) => { downloadedUrls.push(url) },
        env: {},
        executableVersion: async (executablePath) => executablePath.includes("staging") ? VERSION : "130.0.6723.91",
        extractArchive: async () => {},
        fetchJson: async () => downloads(),
        mkdir: async () => {},
        platform: "linux",
        readFile: async () => JSON.stringify({version: VERSION}),
        rename: async (oldPath, newPath) => { renamedPaths.push([oldPath, newPath]) },
        rm: async (targetPath) => { removedPaths.push(targetPath) },
        writeFile: async (targetPath) => { writtenPaths.push(targetPath) }
      }
    })

    expect(runtime.version).toEqual(VERSION)
    expect(downloadedUrls).toEqual([
      `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chrome-headless-shell-linux64.zip`,
      `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chromedriver-linux64.zip`
    ])
    expect(removedPaths).not.toContain(path.join("/cache/system-testing/chrome", VERSION))
    expect(writtenPaths.some((targetPath) => path.basename(targetPath).startsWith(".resolved-"))).toBeTrue()
    expect(writtenPaths).not.toContain(path.join("/cache/system-testing/chrome", "resolved.json"))
    expect(renamedPaths.some(([oldPath, newPath]) => path.basename(oldPath).startsWith(".resolved-") && newPath === path.join("/cache/system-testing/chrome", "resolved.json"))).toBeTrue()
  })

  it("publishes concurrent resolutions without removing or replacing an in-use final runtime", async () => {
    const cachePath = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-chrome-runtime-"))
    const extractArchive = async (archivePath, destinationPath) => {
      const directory = archivePath.includes("headless-shell") ? "chrome-headless-shell-linux64" : "chromedriver-linux64"
      const executable = archivePath.includes("headless-shell") ? "chrome-headless-shell" : "chromedriver"
      await fs.mkdir(path.join(destinationPath, directory), {recursive: true})
      await fs.writeFile(path.join(destinationPath, directory, executable), "runtime")
      await fs.chmod(path.join(destinationPath, directory, executable), 0o755)
    }
    const options = {
      cachePath,
      dependencies: {
        download: async (url, destinationPath) => { await fs.writeFile(destinationPath, url) },
        env: {},
        executableVersion: async () => VERSION,
        extractArchive,
        fetchJson: async () => downloads(),
        platform: "linux"
      }
    }

    try {
      const [first, second] = await Promise.all([resolveChromeRuntime(options), resolveChromeRuntime(options)])

      expect(first.version).toEqual(VERSION)
      expect(second.version).toEqual(VERSION)
      const manifest = JSON.parse(await fs.readFile(path.join(cachePath, "resolved.json"), "utf8"))
      expect(manifest.version).toEqual(VERSION)
      expect([path.basename(path.dirname(path.dirname(first.chromeBinaryPath))), path.basename(path.dirname(path.dirname(second.chromeBinaryPath)))]).toContain(manifest.directory)
      expect((await fs.readdir(cachePath)).filter((entry) => entry.startsWith(".staging-") || entry.startsWith(".resolved-") || entry.startsWith(".publish-"))).toEqual([])
      await expectAsync(fs.readFile(first.chromeBinaryPath, "utf8")).toBeResolvedTo("runtime")
    } finally {
      await fs.rm(cachePath, {recursive: true, force: true})
    }
  })

  it("recovers from an invalid non-empty version directory without replacing it", async () => {
    const cachePath = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-chrome-runtime-"))
    const invalidVersionPath = path.join(cachePath, VERSION)
    const invalidFilePath = path.join(invalidVersionPath, "do-not-remove")
    const extractArchive = async (archivePath, destinationPath) => {
      const directory = archivePath.includes("headless-shell") ? "chrome-headless-shell-linux64" : "chromedriver-linux64"
      const executable = archivePath.includes("headless-shell") ? "chrome-headless-shell" : "chromedriver"
      await fs.mkdir(path.join(destinationPath, directory), {recursive: true})
      await fs.writeFile(path.join(destinationPath, directory, executable), "runtime")
      await fs.chmod(path.join(destinationPath, directory, executable), 0o755)
    }

    try {
      await fs.mkdir(invalidVersionPath)
      await fs.writeFile(invalidFilePath, "preserve me")
      await fs.writeFile(path.join(cachePath, "resolved.json"), JSON.stringify({version: VERSION}))

      const runtime = await resolveChromeRuntime({
        cachePath,
        dependencies: {
          download: async (url, destinationPath) => { await fs.writeFile(destinationPath, url) },
          env: {},
          executableVersion: async () => VERSION,
          extractArchive,
          fetchJson: async () => downloads(),
          platform: "linux"
        }
      })

      expect(path.dirname(path.dirname(runtime.chromeBinaryPath))).not.toEqual(invalidVersionPath)
      await expectAsync(fs.readFile(runtime.chromeBinaryPath, "utf8")).toBeResolvedTo("runtime")
      await expectAsync(fs.readFile(invalidFilePath, "utf8")).toBeResolvedTo("preserve me")
      const cachedRuntime = await resolveChromeRuntime({
        cachePath,
        dependencies: {
          env: {},
          executableVersion: async () => VERSION,
          fetchJson: async () => { throw new Error("network should not be used") },
          platform: "linux"
        }
      })
      expect(cachedRuntime).toEqual(runtime)
    } finally {
      await fs.rm(cachePath, {recursive: true, force: true})
    }
  })

  it("cleans staging and publication state when a publish is interrupted", async () => {
    const cachePath = await fs.mkdtemp(path.join(os.tmpdir(), "system-testing-chrome-runtime-"))

    try {
      await expectAsync(resolveChromeRuntime({
        cachePath,
        dependencies: {
          download: async () => { throw new Error("interrupted download") },
          env: {},
          fetchJson: async () => downloads(),
          platform: "linux"
        }
      })).toBeRejectedWithError(/interrupted download/)
      expect(await fs.readdir(cachePath)).toEqual([])
    } finally {
      await fs.rm(cachePath, {recursive: true, force: true})
    }
  })

  it("rejects malicious cached and remote versions before constructing runtime paths", async () => {
    const accessedPaths = []
    const cachePath = "/cache/system-testing/chrome"

    await expectAsync(resolveChromeRuntime({
      cachePath,
      dependencies: {
        access: async (filePath) => { accessedPaths.push(filePath) },
        env: {},
        fetchJson: async () => ({channels: {Stable: {...downloads().channels.Stable, version: "../../outside"}}}),
        platform: "linux",
        readFile: async () => JSON.stringify({version: "../../outside"})
      }
    })).toBeRejectedWithError(/version/i)
    expect(accessedPaths).toEqual([])
  })

  it("rejects a malicious runtime directory in the resolved manifest", async () => {
    const accessedPaths = []

    await expectAsync(resolveChromeRuntime({
      cachePath: "/cache/system-testing/chrome",
      dependencies: {
        access: async (filePath) => { accessedPaths.push(filePath) },
        env: {},
        fetchJson: async () => { throw new Error("stop after invalid manifest") },
        platform: "linux",
        readFile: async () => JSON.stringify({directory: "../../outside", version: VERSION})
      }
    })).toBeRejectedWithError(/stop after invalid manifest/)
    expect(accessedPaths).toEqual([])
  })

  for (const url of [
    `http://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chromedriver-linux64.zip`,
    `https://evil.example/chrome-for-testing-public/${VERSION}/linux64/chromedriver-linux64.zip`,
    `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/../chromedriver-linux64.zip`
  ]) {
    it(`rejects an unapproved artifact URL: ${url}`, async () => {
      const metadata = downloads()
      metadata.channels.Stable.downloads.chromedriver[0].url = url

      await expectAsync(resolveChromeRuntime({
        cachePath: "/cache/system-testing/chrome",
        dependencies: {
          env: {},
          fetchJson: async () => metadata,
          platform: "linux",
          readFile: async () => { throw Object.assign(new Error("missing"), {code: "ENOENT"}) }
        }
      })).toBeRejectedWithError(/approved Chrome-for-Testing HTTPS URL/)
    })
  }

  it("reports an actionable error when Chrome-for-Testing metadata cannot be loaded", async () => {
    await expectAsync(resolveChromeRuntime({
      cachePath: "/cache/system-testing/chrome",
      dependencies: {
        env: {},
        fetchJson: async () => { throw new Error("connection refused") },
        platform: "linux",
        readFile: async () => { throw Object.assign(new Error("missing"), {code: "ENOENT"}) }
      }
    })).toBeRejectedWithError(/Unable to resolve a matching Chrome Headless Shell and ChromeDriver pair.*connection refused/)
  })

  it("leaves unsupported platforms to Selenium Manager", async () => {
    expect(await resolveChromeRuntime({dependencies: {arch: "x64", env: {}, platform: "darwin"}})).toBeUndefined()
  })

  it("leaves unsupported Linux architectures to Selenium Manager", async () => {
    expect(await resolveChromeRuntime({dependencies: {arch: "arm64", env: {}, platform: "linux"}})).toBeUndefined()
  })
})
