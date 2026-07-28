import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { extractBody } from './gmail'

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
