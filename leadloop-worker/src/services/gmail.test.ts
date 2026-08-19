import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRawEmail, extractBody, sendDraft } from './gmail'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

interface Part {
  mimeType?: string
  body?: { data?: string }
  parts?: Part[]
}

function msg(payload: Part, snippet = '') {
  return {
    id: 'm1',
    threadId: 't1',
    internalDate: '0',
    snippet,
    payload: { headers: [], ...payload },
  }
}

const plainMsg = (body: string) =>
  msg({ mimeType: 'text/plain', body: { data: b64(body) } })

describe('extractBody', () => {
  it('decodes multi-byte UTF-8 without mangling', () => {
    const body = 'Hi — let’s sync re: “Q3 café” 🚀'
    expect(extractBody(plainMsg(body))).toBe(body)
  })

  it('converts single-part HTML to readable text', () => {
    const html =
      '<html><body><p>Hello <b>world</b></p><p>Second &amp; final</p></body></html>'
    expect(extractBody(msg({ mimeType: 'text/html', body: { data: b64(html) } }))).toBe(
      'Hello world\n\nSecond & final'
    )
  })

  it('finds text/plain nested three levels deep', () => {
    const payload: Part = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'application/pdf', body: {} },
        {
          mimeType: 'multipart/related',
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                { mimeType: 'text/plain', body: { data: b64('deep body') } },
                { mimeType: 'text/html', body: { data: b64('<p>deep body</p>') } },
              ],
            },
          ],
        },
      ],
    }
    expect(extractBody(msg(payload))).toBe('deep body')
  })

  it('strips Gmail quoted reply history, including wrapped attribution lines', () => {
    const body =
      'Sounds good, Tuesday works.\n\nOn Mon, Jul 20, 2026 at 9:14 AM Jane Doe\n<jane@example.com> wrote:\n> Are you free Tuesday?\n> Jane'
    expect(extractBody(plainMsg(body))).toBe('Sounds good, Tuesday works.')
  })

  it('strips Outlook quoted reply history', () => {
    const body = 'Confirmed for 3pm.\n\n-----Original Message-----\nFrom: Jane Doe'
    expect(extractBody(plainMsg(body))).toBe('Confirmed for 3pm.')
  })

  it('keeps the body when the whole message is quoted content', () => {
    const body = '> Forwarded content line one\n> line two'
    expect(extractBody(plainMsg(body))).toBe(body)
  })

  it('falls back to the entity-decoded snippet when no text part exists', () => {
    const payload: Part = {
      mimeType: 'multipart/mixed',
      parts: [{ mimeType: 'application/pdf', body: {} }],
    }
    expect(extractBody(msg(payload, 'Can&#39;t wait &amp; thanks'))).toBe(
      "Can't wait & thanks"
    )
  })
})

describe('buildRawEmail', () => {
  it('builds an HTML part: UTF-8 survives, newlines become <br>, URLs get linked, HTML is escaped', () => {
    const body = 'Quick bump — let’s sync 🚀\n\nRead: https://blog.example.com/post/ & reply <soon>'
    const raw = buildRawEmail('sara@acme.com', 'Re: Café rollout', body)
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
    expect(decoded).toContain('Content-Type: text/html; charset=utf-8')
    expect(decoded).toContain('Quick bump — let’s sync 🚀<br><br>')
    expect(decoded).toContain('<a href="https://blog.example.com/post/">https://blog.example.com/post/</a>')
    expect(decoded).toContain('&amp; reply &lt;soon&gt;')
    expect(decoded).toContain(
      `Subject: =?UTF-8?B?${Buffer.from('Re: Café rollout', 'utf8').toString('base64')}?=`
    )
  })

  it('leaves plain-ASCII subjects readable', () => {
    const raw = buildRawEmail('sara@acme.com', 'Re: Rollout', 'plain body')
    expect(Buffer.from(raw, 'base64url').toString('utf8')).toContain('Subject: Re: Rollout')
  })
})

describe('sendDraft', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubFetch(status: number, body: unknown) {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(body), { status })
    })
    return calls
  }

  it('POSTs exactly the stored draft id to drafts.send and returns the sent message', async () => {
    const calls = stubFetch(200, { id: 'msg-9', threadId: 'thr-3' })

    const result = await sendDraft({ accessToken: 'tok-1' }, 'r-draft-42')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/drafts/send')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ id: 'r-draft-42' })
    expect(result).toEqual({ id: 'msg-9', threadId: 'thr-3' })
  })

  it('returns null — a distinct not-found result, never success — when Gmail 404s', async () => {
    stubFetch(404, { error: { code: 404 } })
    expect(await sendDraft({ accessToken: 'tok-1' }, 'gone-draft')).toBeNull()
  })

  it('throws on other Gmail failures so callers report them, not swallow them', async () => {
    stubFetch(500, { error: { code: 500 } })
    await expect(sendDraft({ accessToken: 'tok-1' }, 'r-1')).rejects.toThrow(
      'Gmail sendDraft failed (500)'
    )
  })
})
