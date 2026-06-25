// @ts-check

import {dismissExpoRouterToPath} from "../src/expo-router-dismiss-to.js"

describe("dismissExpoRouterToPath", () => {
  it("clears existing Expo stack screens before dismissing to the requested path", () => {
    /** @type {string[]} */
    const calls = []
    const router = {
      dismissAll: jasmine.createSpy("dismissAll").and.callFake(() => {
        calls.push("dismissAll")
      }),
      dismissTo: jasmine.createSpy("dismissTo").and.callFake((path) => {
        calls.push(`dismissTo:${path}`)
      })
    }

    dismissExpoRouterToPath({
      navigationContainerRef: {current: {canGoBack: () => true}},
      path: "/blank?systemTest=true",
      router
    })

    expect(calls).toEqual(["dismissAll", "dismissTo:/blank?systemTest=true"])
  })

  it("does not clear the stack when the current Expo route cannot go back", () => {
    const router = {
      dismissAll: jasmine.createSpy("dismissAll"),
      dismissTo: jasmine.createSpy("dismissTo")
    }

    dismissExpoRouterToPath({
      navigationContainerRef: {current: {canGoBack: () => false}},
      path: "/blank?systemTest=true",
      router
    })

    expect(router.dismissAll).not.toHaveBeenCalled()
    expect(router.dismissTo).toHaveBeenCalledOnceWith("/blank?systemTest=true")
  })

  it("throws when clearing stale stack screens fails", () => {
    const error = new Error("dismissAll failed")
    const router = {
      dismissAll: jasmine.createSpy("dismissAll").and.throwError(error),
      dismissTo: jasmine.createSpy("dismissTo")
    }

    expect(() => {
      dismissExpoRouterToPath({
        navigationContainerRef: {current: {canGoBack: () => true}},
        path: "/blank?systemTest=true",
        router
      })
    }).toThrow(error)
  })

  it("throws when dismissing to the requested path fails", () => {
    const error = new Error("dismissTo failed")
    const router = {
      dismissAll: jasmine.createSpy("dismissAll"),
      dismissTo: jasmine.createSpy("dismissTo").and.throwError(error)
    }

    expect(() => {
      dismissExpoRouterToPath({
        navigationContainerRef: {current: {canGoBack: () => false}},
        path: "/blank?systemTest=true",
        router
      })
    }).toThrow(error)
  })
})
