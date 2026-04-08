import type { AppBindings } from './types'

export function debug(env: AppBindings, ...args: unknown[]): void {
  if (env.DEBUG === 'true') console.log(...args)
}
