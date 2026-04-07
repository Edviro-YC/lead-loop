const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1'

interface GmailTokens {
  accessToken: string
}

interface GmailThread {
  id: string
  historyId: string
  messages: GmailMessage[]
}

interface GmailMessage {
  id: string
  threadId: string
  internalDate: string
  snippet: string
  payload: {
    headers: Array<{ name: string; value: string }>
    body?: { data?: string }
    parts?: Array<{
      mimeType: string
      body?: { data?: string }
      parts?: Array<{ mimeType: string; body?: { data?: string } }>
    }>
  }
}

/**
 * Refresh a Google OAuth access token using a stored refresh token.
 */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Token refresh failed: ${err}`)
  }

  return response.json()
}

/**
 * Fetch a single Gmail thread with full message content.
 */
export async function getThread(
  tokens: GmailTokens,
  threadId: string
): Promise<GmailThread> {
  const res = await fetch(
    `${GMAIL_API}/users/me/threads/${threadId}?format=full`,
    {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gmail getThread failed (${res.status}): ${err}`)
  }

  return res.json()
}

/**
 * Create a draft in the user's Gmail.
 */
export async function createDraft(
  tokens: GmailTokens,
  to: string,
  subject: string,
  body: string,
  threadId?: string
): Promise<{ id: string; message: { id: string; threadId: string } }> {
  const raw = buildRawEmail(to, subject, body)
  const payload: Record<string, unknown> = {
    message: { raw, threadId },
  }

  const res = await fetch(`${GMAIL_API}/users/me/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gmail createDraft failed (${res.status}): ${err}`)
  }

  return res.json()
}

/**
 * Extract plain-text body from a Gmail message payload.
 */
export function extractBody(message: GmailMessage): string {
  // Try top-level body
  if (message.payload.body?.data) {
    return base64Decode(message.payload.body.data)
  }

  // Search parts for text/plain
  const parts = message.payload.parts ?? []
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return base64Decode(part.body.data)
    }
    // Nested multipart
    if (part.parts) {
      for (const nested of part.parts) {
        if (nested.mimeType === 'text/plain' && nested.body?.data) {
          return base64Decode(nested.body.data)
        }
      }
    }
  }

  return message.snippet
}

/**
 * Extract a header value from a Gmail message.
 */
export function getHeader(message: GmailMessage, name: string): string {
  return (
    message.payload.headers.find(
      (h) => h.name.toLowerCase() === name.toLowerCase()
    )?.value ?? ''
  )
}

function base64Decode(data: string): string {
  const sanitized = data.replace(/-/g, '+').replace(/_/g, '/')
  return atob(sanitized)
}

function buildRawEmail(to: string, subject: string, body: string): string {
  const email = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n')

  return btoa(email).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
