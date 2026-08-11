import {currentUserOwnership, useSudoForEmulator} from "../scripts/android-emulator-permissions.js"

describe("Android emulator permissions", () => {
  it("runs the emulator as the build user", () => {
    expect(useSudoForEmulator).toBeFalse()
  })

  it("resolves ownership to the invoking user and group", () => {
    expect(currentUserOwnership({getuid: () => 123, getgid: () => 456})).toBe("123:456")
  })

  it("does not try to change ownership when already running as root", () => {
    expect(currentUserOwnership({getuid: () => 0, getgid: () => 0})).toBeUndefined()
  })
})
