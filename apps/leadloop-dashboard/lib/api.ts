const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? 'http://localhost:8787'

/**
 * Typed fetch wrapper for calling the LeadLoop Worker API.
 * Automatically attaches the Supabase access token.
 */
export async function workerFetch<T = unknown>(
  path: string,
  options: {
    method?: string
    body?: unknown
    token: string
  }
): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? `API error ${res.status}`)
  }

  return res.json() as Promise<T>
}
