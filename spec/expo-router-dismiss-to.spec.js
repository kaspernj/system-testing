// @ts-check

import {dismissExpoRouterToPath} from "../src/expo-router-dismiss-to.js"

describe("dismissExpoRouterToPath", () => {
  it("waits for the existing Expo stack reset before dismissing to the requested path", async () => {
    /** @type {string[]} */
    const calls = []
    /** @type {(() => void) | undefined} */
    let emitStateChange
    const unsubscribe = jasmine.createSpy("unsubscribe")
    const router = {
      canDismiss: () => true,
      dismissAll: jasmine.createSpy("dismissAll").and.callFake(() => {
        calls.push("dismissAll")
      }),
      dismissTo: jasmine.createSpy("dismissTo").and.callFake((path) => {
        calls.push(`dismissTo:${path}`)
      })
    }
    const navigation = {
      addListener: jasmine.createSpy("addListener").and.callFake((eventName, callback) => {
        expect(eventName).toEqual("state")
        emitStateChange = callback
        return unsubscribe
      }),
      canGoBack: () => true
    }

    const dismissPromise = dismissExpoRouterToPath({
      navigationContainerRef: {current: navigation},
      path: "/blank?systemTest=true",
      routerRef: {current: router}
    })

    expect(calls).toEqual(["dismissAll"])
    expect(emitStateChange).toEqual(jasmine.any(Function))

    if (!emitStateChange) throw new Error("State-change callback was not registered")
    emitStateChange()
    await dismissPromise

    expect(calls).toEqual(["dismissAll", "dismissTo:/blank?systemTest=true"])
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("does not clear the stack when the current Expo route cannot dismiss", async () => {
    const router = {
      canDismiss: () => false,
      dismissAll: jasmine.createSpy("dismissAll"),
      dismissTo: jasmine.createSpy("dismissTo")
    }

    await dismissExpoRouterToPath({
      navigationContainerRef: {current: {canGoBack: () => false}},
      path: "/blank?systemTest=true",
      routerRef: {current: router}
    })

    expect(router.dismissAll).not.toHaveBeenCalled()
    expect(router.dismissTo).toHaveBeenCalledOnceWith("/blank?systemTest=true")
  })

  it("does not wait for a stack reset when nested navigation can go back but the Expo stack cannot dismiss", async () => {
    const router = {
      canDismiss: () => false,
      dismissAll: jasmine.createSpy("dismissAll").and.throwError("dismissAll should not be called"),
      dismissTo: jasmine.createSpy("dismissTo")
    }

    await dismissExpoRouterToPath({
      navigationContainerRef: {current: {canGoBack: () => true}},
      path: "/blank?systemTest=true",
      routerRef: {current: router}
    })

    expect(router.dismissAll).not.toHaveBeenCalled()
    expect(router.dismissTo).toHaveBeenCalledOnceWith("/blank?systemTest=true")
  })

  it("throws when clearing stale stack screens fails", async () => {
    const error = new Error("dismissAll failed")
    const unsubscribe = jasmine.createSpy("unsubscribe")
    const router = {
      canDismiss: () => true,
      dismissAll: jasmine.createSpy("dismissAll").and.throwError(error),
      dismissTo: jasmine.createSpy("dismissTo")
    }

    await expectAsync(
      dismissExpoRouterToPath({
        navigationContainerRef: {current: {
          addListener: () => unsubscribe,
          canGoBack: () => true
        }},
        path: "/blank?systemTest=true",
        routerRef: {current: router}
      })
    ).toBeRejectedWith(error)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("throws when dismissing to the requested path fails", async () => {
    const error = new Error("dismissTo failed")
    const router = {
      canDismiss: () => false,
      dismissAll: jasmine.createSpy("dismissAll"),
      dismissTo: jasmine.createSpy("dismissTo").and.throwError(error)
    }

    await expectAsync(
      dismissExpoRouterToPath({
        navigationContainerRef: {current: {canGoBack: () => false}},
        path: "/blank?systemTest=true",
        routerRef: {current: router}
      })
    ).toBeRejectedWith(error)
  })

  it("dismisses to the requested path with the current router after the stack reset", async () => {
    /** @type {(() => void) | undefined} */
    let emitStateChange
    const oldRouter = {
      canDismiss: () => true,
      dismissAll: jasmine.createSpy("oldDismissAll"),
      dismissTo: jasmine.createSpy("oldDismissTo")
    }
    const currentRouter = {
      canDismiss: () => true,
      dismissAll: jasmine.createSpy("currentDismissAll"),
      dismissTo: jasmine.createSpy("currentDismissTo")
    }
    const routerRef = {current: oldRouter}

    const dismissPromise = dismissExpoRouterToPath({
      navigationContainerRef: {current: {
        addListener: (_eventName, callback) => {
          emitStateChange = callback
          return () => {}
        },
        canGoBack: () => true
      }},
      path: "/blank?systemTest=true",
      routerRef
    })

    expect(oldRouter.dismissAll).toHaveBeenCalledTimes(1)
    routerRef.current = currentRouter
    if (!emitStateChange) throw new Error("State-change callback was not registered")
    emitStateChange()
    await dismissPromise

    expect(oldRouter.dismissTo).not.toHaveBeenCalled()
    expect(currentRouter.dismissTo).toHaveBeenCalledOnceWith("/blank?systemTest=true")
  })
})
