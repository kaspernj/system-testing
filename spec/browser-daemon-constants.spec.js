// @ts-check

import {resolveDaemonConnectHost} from "../src/browser-daemon-constants.js"

describe("resolveDaemonConnectHost", () => {
  it("reaches wildcard and unset binds over loopback", () => {
    expect(resolveDaemonConnectHost(undefined)).toEqual("127.0.0.1")
    expect(resolveDaemonConnectHost("0.0.0.0")).toEqual("127.0.0.1")
    expect(resolveDaemonConnectHost("::")).toEqual("127.0.0.1")
  })

  it("dials a concrete bind address directly", () => {
    expect(resolveDaemonConnectHost("127.0.0.1")).toEqual("127.0.0.1")
    expect(resolveDaemonConnectHost("10.0.0.5")).toEqual("10.0.0.5")
  })
})
