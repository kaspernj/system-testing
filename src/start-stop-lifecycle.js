/**
 * @typedef {object} StartStopLifecycleArgs
 * @property {(args: {signal: AbortSignal, generation: StartStopLifecycleGeneration}) => Promise<void> | void} start Starts the managed resource with a cancellation signal.
 * @property {() => Promise<void> | void} stop Stops or cleans up the managed resource.
 */

/** @typedef {Readonly<{id: number}>} StartStopLifecycleGeneration */
/** @typedef {"idle" | "starting" | "running" | "stopping" | "cleanup-failed"} StartStopLifecycleState */

/** @returns {Error} */
function createAbortError() {
  const error = new Error("Lifecycle startup was stopped")
  error.name = "AbortError"
  return error
}

/**
 * @param {any} error
 * @param {Error} abortReason
 * @returns {boolean}
 */
function isAbortErrorForReason(error, abortReason) {
  return error === abortReason || (error?.name === "AbortError" && error.cause === abortReason)
}

/**
 * @param {any} startError
 * @param {any} cleanupError
 * @returns {AggregateError}
 */
function createStartCleanupError(startError, cleanupError) {
  return new AggregateError(
    [startError, cleanupError],
    "Lifecycle startup and cleanup both failed",
    {cause: startError}
  )
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
  _shutdownPromise = undefined
  /** @type {Promise<void> | undefined} */
  _queuedStartPromise = undefined
  /** @type {AbortController | undefined} */
  _startAbortController = undefined
  /** @type {StartStopLifecycleGeneration | undefined} */
  _activeGeneration = undefined
  /** @type {unknown} */
  _cleanupError = undefined
  _nextGenerationId = 1

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
    if (this._state === "cleanup-failed") {
      return Promise.reject(new Error("Lifecycle cleanup failed; call stop() to retry cleanup before starting", {cause: this._cleanupError}))
    }

    this._state = "starting"
    const abortController = new AbortController()
    const generation = Object.freeze({id: this._nextGenerationId})
    this._nextGenerationId += 1
    this._activeGeneration = generation
    this._startAbortController = abortController
    const startPromise = Promise.resolve().then(async () => await this._runStart({abortController, generation}))
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

    const generation = this._activeGeneration
    if (!generation) throw new Error(`Lifecycle is ${this._state} without an active generation`)

    this._state = "stopping"
    return this._trackShutdown(this._completeCleanup(generation))
  }

  /**
   * Reports that a resource has completed independently of an explicit stop.
   * Only the current running generation can be invalidated.
   * @param {StartStopLifecycleGeneration} generation
   * @returns {boolean}
   */
  notifyResourceStopped(generation) {
    if (this._state !== "running" || this._activeGeneration !== generation) return false

    this._activeGeneration = undefined
    this._cleanupError = undefined
    this._state = "idle"
    return true
  }

  /**
   * @param {{abortController: AbortController, generation: StartStopLifecycleGeneration}} args
   * @returns {Promise<void>}
   */
  async _runStart({abortController, generation}) {
    try {
      await this._startCallback({signal: abortController.signal, generation})
      if (abortController.signal.aborted) throw abortController.signal.reason

      this._state = "running"
    } catch (startError) {
      await this._cleanupFailedStart({generation, startError})
    } finally {
      if (this._startAbortController === abortController) {
        this._startAbortController = undefined
        this._startPromise = undefined
      }
    }
  }

  /**
   * @param {{generation: StartStopLifecycleGeneration, startError: any}} args
   * @returns {Promise<never>}
   */
  async _cleanupFailedStart({generation, startError}) {
    this._state = "stopping"
    const cleanupPromise = this._completeCleanup(generation)
    if (!this._shutdownPromise) this._trackShutdown(cleanupPromise)

    try {
      await cleanupPromise
    } catch (cleanupError) {
      throw createStartCleanupError(startError, cleanupError)
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
    return this._trackShutdown(Promise.resolve().then(async () => {
      try {
        await startPromise
      } catch (startError) {
        if (!isAbortErrorForReason(startError, abortError)) throw startError
      }
    }))
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

  /**
   * @param {StartStopLifecycleGeneration} generation
   * @returns {Promise<void>}
   */
  async _completeCleanup(generation) {
    try {
      await this._stopCallback()
    } catch (error) {
      this._cleanupError = error
      this._state = "cleanup-failed"
      throw error
    }

    if (this._activeGeneration === generation) this._activeGeneration = undefined
    this._cleanupError = undefined
    this._state = "idle"
  }

  /**
   * @param {Promise<void>} shutdownPromise
   * @returns {Promise<void>}
   */
  _trackShutdown(shutdownPromise) {
    this._shutdownPromise = shutdownPromise
    void shutdownPromise.then(
      () => this._clearShutdownPromise(shutdownPromise),
      () => this._clearShutdownPromise(shutdownPromise)
    )

    return shutdownPromise
  }

  /** @param {Promise<void>} shutdownPromise */
  _clearShutdownPromise(shutdownPromise) {
    if (this._shutdownPromise === shutdownPromise) this._shutdownPromise = undefined
  }
}
