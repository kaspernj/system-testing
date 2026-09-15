/**
 * @typedef {object} StartStopLifecycleArgs
 * @property {(args: {signal: AbortSignal}) => Promise<void> | void} start Starts the managed resource with a cancellation signal.
 * @property {() => Promise<void> | void} stop Stops or cleans up the managed resource.
 */

/** @typedef {"idle" | "starting" | "running" | "stopping"} StartStopLifecycleState */

/** @returns {Error} */
function createAbortError() {
  const error = new Error("Lifecycle startup was stopped")
  error.name = "AbortError"
  return error
}

/**
 * Coordinates single-flight startup and shutdown callbacks.
 */
export default class StartStopLifecycle {
  /** @type {StartStopLifecycleState} */
  _state = "idle"
  /** @type {Promise<void> | undefined} */
  _startPromise = undefined
  /** @type {Promise<void> | undefined} */
  _stopPromise = undefined
  /** @type {Promise<void> | undefined} */
  _shutdownPromise = undefined
  /** @type {Promise<void> | undefined} */
  _queuedStartPromise = undefined
  /** @type {AbortController | undefined} */
  _startAbortController = undefined

  /** @param {StartStopLifecycleArgs} args */
  constructor({start, stop}) {
    this._startCallback = start
    this._stopCallback = stop
  }

  /** @returns {StartStopLifecycleState} */
  get state() { return this._state }

  /** @returns {boolean} */
  isRunning() { return this._state === "running" }

  /** @returns {Promise<void>} */
  start() { return this.ensureRunning() }

  /** @returns {Promise<void>} */
  ensureRunning() {
    if (this._state === "running") return Promise.resolve()
    if (this._state === "starting") {
      if (!this._startPromise) throw new Error("Lifecycle is starting without a startup promise")

      return this._startPromise
    }
    if (this._state === "stopping") return this._startAfterShutdown()

    this._state = "starting"
    const abortController = new AbortController()
    this._startAbortController = abortController
    const startPromise = Promise.resolve().then(async () => await this._runStart(abortController))
    this._startPromise = startPromise

    return startPromise
  }

  /** @returns {Promise<void>} */
  stop() {
    if (this._state === "idle") return Promise.resolve()
    if (this._state === "stopping") {
      if (!this._shutdownPromise) throw new Error("Lifecycle is stopping without a shutdown promise")

      return this._shutdownPromise
    }
    if (this._state === "starting") return this._stopPendingStart()

    this._state = "stopping"
    return this._trackStop(this._invokeStop())
  }

  /**
   * @param {AbortController} abortController
   * @returns {Promise<void>}
   */
  async _runStart(abortController) {
    try {
      await this._startCallback({signal: abortController.signal})
      if (abortController.signal.aborted) throw abortController.signal.reason

      this._state = "running"
    } catch (startError) {
      await this._cleanupFailedStart(startError)
    } finally {
      if (this._startAbortController === abortController) {
        this._startAbortController = undefined
        this._startPromise = undefined
      }
    }
  }

  /**
   * @param {any} startError
   * @returns {Promise<never>}
   */
  async _cleanupFailedStart(startError) {
    this._state = "stopping"
    const cleanupPromise = this._invokeStop()

    if (!this._shutdownPromise) {
      this._shutdownPromise = cleanupPromise
      void cleanupPromise.then(
        () => this._finishAutomaticShutdown(cleanupPromise),
        () => this._finishAutomaticShutdown(cleanupPromise)
      )
    }

    let cleanupFailed = false
    let cleanupError
    try {
      await cleanupPromise
    } catch (error) {
      cleanupFailed = true
      cleanupError = error
    }

    if (cleanupFailed) {
      throw new AggregateError(
        [startError, cleanupError],
        "Lifecycle startup and cleanup both failed",
        {cause: startError}
      )
    }

    throw startError
  }

  /** @returns {Promise<void>} */
  _stopPendingStart() {
    const abortController = this._startAbortController
    const startPromise = this._startPromise
    if (!abortController || !startPromise) throw new Error("Lifecycle is starting without an active startup")

    this._state = "stopping"
    const abortError = createAbortError()
    abortController.abort(abortError)
    const stopPromise = Promise.resolve().then(async () => {
      try {
        await startPromise
      } catch (startError) {
        if (startError !== abortError) throw startError
      }
    })

    return this._trackStop(stopPromise)
  }

  /** @returns {Promise<void>} */
  _startAfterShutdown() {
    if (this._queuedStartPromise) return this._queuedStartPromise
    if (!this._shutdownPromise) throw new Error("Lifecycle is stopping without a shutdown promise")

    const shutdownPromise = this._shutdownPromise
    /** @type {Promise<void>} */
    let queuedStartPromise
    queuedStartPromise = shutdownPromise.then(
      () => {
        if (this._queuedStartPromise === queuedStartPromise) this._queuedStartPromise = undefined
        return this.ensureRunning()
      },
      (error) => {
        if (this._queuedStartPromise === queuedStartPromise) this._queuedStartPromise = undefined
        throw error
      }
    )
    this._queuedStartPromise = queuedStartPromise

    return queuedStartPromise
  }

  /** @returns {Promise<void>} */
  _invokeStop() { return Promise.resolve().then(async () => await this._stopCallback()) }

  /**
   * @param {Promise<void>} stopPromise
   * @returns {Promise<void>}
   */
  _trackStop(stopPromise) {
    this._stopPromise = stopPromise
    this._shutdownPromise = stopPromise
    void stopPromise.then(
      () => this._finishStop(stopPromise),
      () => this._finishStop(stopPromise)
    )

    return stopPromise
  }

  /** @param {Promise<void>} cleanupPromise */
  _finishAutomaticShutdown(cleanupPromise) {
    if (this._shutdownPromise !== cleanupPromise || this._stopPromise) return

    this._shutdownPromise = undefined
    this._state = "idle"
  }

  /** @param {Promise<void>} stopPromise */
  _finishStop(stopPromise) {
    if (this._stopPromise !== stopPromise) return

    this._stopPromise = undefined
    if (this._shutdownPromise === stopPromise) this._shutdownPromise = undefined
    this._state = "idle"
  }
}
