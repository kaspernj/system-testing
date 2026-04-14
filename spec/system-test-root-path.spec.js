// @ts-check

import SystemTest from "../src/system-test.js"

describe("SystemTest root path", () => {
  it("propagates custom websocket ports into the browser URL", () => {
    spyOn(SystemTest.prototype, "startScoundrel").and.callFake(() => {})

    const systemTest = new SystemTest({
      clientWsPort: 4123,
      scoundrelPort: 5123
    })

    const rootPath = systemTest.getRootPath()
    const url = new URL(rootPath, "http://localhost")

    expect(url.searchParams.get("systemTestClientWsPort")).toBe("4123")
    expect(url.searchParams.get("systemTestScoundrelPort")).toBe("5123")
  })

  it("keeps explicit URL args authoritative when the same params are already set", () => {
    spyOn(SystemTest.prototype, "startScoundrel").and.callFake(() => {})

    const systemTest = new SystemTest({
      clientWsPort: 4123,
      scoundrelPort: 5123,
      urlArgs: {
        systemTestClientWsPort: 7001,
        systemTestScoundrelPort: 7002
      }
    })

    const rootPath = systemTest.getRootPath()
    const url = new URL(rootPath, "http://localhost")

    expect(url.searchParams.getAll("systemTestClientWsPort")).toEqual(["7001"])
    expect(url.searchParams.getAll("systemTestScoundrelPort")).toEqual(["7002"])
  })
  it("ignores the known Chrome password-field DOM warning in live browser errors", () => {
    spyOn(SystemTest.prototype, "startScoundrel").and.callFake(() => {})

    const systemTest = new SystemTest()

    expect(systemTest.shouldIgnoreError({
      value: ["[DOM] Password field is not contained in a form: (More info: https://goo.gl/9p2vKq) %o"]
    })).toBeTrue()
  })


  it("ignores the known Chrome password-field DOM warning when Chrome prefixes the URL", () => {
    spyOn(SystemTest.prototype, "startScoundrel").and.callFake(() => {})

    const systemTest = new SystemTest()

    expect(systemTest.shouldIgnoreError({
      value: ["http://127.0.0.1:8085/ - [DOM] Password field is not contained in a form: (More info: https://goo.gl/9p2vKq) %o"]
    })).toBeTrue()
  })

  it("does not ignore app errors that only mention the same phrase", () => {
    spyOn(SystemTest.prototype, "startScoundrel").and.callFake(() => {})

    const systemTest = new SystemTest()

    expect(systemTest.shouldIgnoreError({
      value: ["Password field is not contained in a form"]
    })).toBeFalse()
  })

})
