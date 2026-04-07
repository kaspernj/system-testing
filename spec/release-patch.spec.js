// @ts-check

describe("release-patch script", () => {
  /** @type {import("../scripts/release-patch.js")} */
  let releasePatchModule

  beforeEach(async () => {
    releasePatchModule = await import(`../scripts/release-patch.js?cacheBust=${Date.now()}`)
  })

  it("refreshes local master from origin before bumping and publishing", async () => {
    /** @type {Array<[string, string[]]>} */
    const commands = []
    const run = async (command, args = []) => {
      commands.push([command, args])
    }
    const updateLocalMasterFromOrigin = async () => {
      await run("git", ["fetch", "origin"])
      await run("git", ["checkout", "master"])
      await run("git", ["merge", "origin/master"])
    }

    await releasePatchModule.releasePatch({
      currentVersion: async () => "1.2.3",
      isNpmLoggedIn: async () => true,
      run,
      updateLocalMasterFromOrigin
    })

    expect(commands).toEqual([
      ["git", ["fetch", "origin"]],
      ["git", ["checkout", "master"]],
      ["git", ["merge", "origin/master"]],
      ["npm", ["version", "patch", "--no-git-tag-version"]],
      ["npm", ["install"]],
      ["git", ["add", "package.json", "package-lock.json"]],
      ["git", ["commit", "-m", "Release v1.2.3"]],
      ["git", ["push", "origin", "master"]],
      ["npm", ["publish"]]
    ])
  })

  it("runs npm login before releasing when npm is not authenticated", async () => {
    /** @type {Array<[string, string[]]>} */
    const commands = []
    const run = async (command, args = []) => {
      commands.push([command, args])
    }

    await releasePatchModule.releasePatch({
      currentVersion: async () => "1.2.3",
      isNpmLoggedIn: async () => false,
      run,
      updateLocalMasterFromOrigin: async () => {
        await run("git", ["fetch", "origin"])
      }
    })

    expect(commands[1]).toEqual(["npm", ["login"]])
  })
})
