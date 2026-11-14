/**
 * Next.js compiles instrumentation, route handlers, server components and the proxy
 * into separate module graphs inside one Node process, so a module-level singleton is
 * duplicated per graph. Anything that must be shared (boot state, log sink, slots,
 * token buckets) lives here, on `globalThis`, the same way the SQLite connection does.
 */
export function globalState<T>(key: string, init: () => T): T {
  const store = globalThis as typeof globalThis & { __hhState?: Map<string, unknown> };
  store.__hhState ??= new Map<string, unknown>();
  if (!store.__hhState.has(key)) store.__hhState.set(key, init());
  return store.__hhState.get(key) as T;
}

/** Test helper: drops every shared singleton except the ones created again by `init`. */
export function resetGlobalState(): void {
  const store = globalThis as typeof globalThis & { __hhState?: Map<string, unknown> };
  store.__hhState?.clear();
}