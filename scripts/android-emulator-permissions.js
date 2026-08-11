// @ts-check

export const useSudoForEmulator = false

/**
 * @param {{getuid?: () => number, getgid?: () => number}} [processApi]
 * @returns {string | undefined}
 */
export function currentUserOwnership(processApi = process) {
  if (!processApi.getuid || !processApi.getgid || processApi.getuid() === 0) return undefined

  return `${processApi.getuid()}:${processApi.getgid()}`
}
