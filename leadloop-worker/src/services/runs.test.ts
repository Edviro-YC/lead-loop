import { describe, expect, it } from 'vitest'
import { newestOutgoingAfter, nextDueFrom } from './runs'

/**
 * These two pure helpers carry the send-safety decisions: whether a draft
 * was superseded by a manual send (never double-send), whether a Gmail 404
 * counts as sent or as draft_missing, and when the next step is due after
 * a real send. The IO around them is thin, scoped queries.
 */

describe('newestOutgoingAfter', () => {
  // Mixed timestamp formats on purpose: PostgREST returns +00:00 offsets,
  // toISOString returns Z — a string comparison would misorder them.
  const messages = [
    { direction: 'sent', sent_at: '2026-08-10T10:00:00.000Z' },
    { direction: 'received', sent_at: '2026-08-12T10:00:00.000Z' },
    { direction: 'sent', sent_at: '2026-08-11T10:00:00+00:00' },
    { direction: 'sent', sent_at: null },
  ]

  it('returns the newest outgoing message strictly after the anchor', () => {
    expect(newestOutgoingAfter(messages, '2026-08-10T12:00:00.000Z')).toBe(
      '2026-08-11T10:00:00+00:00'
    )
  })

  it('ignores replies, and equal or older outgoing mail never triggers a supersede', () => {
    // The reply on 08-12 is newer than everything sent — it must not count.
    expect(newestOutgoingAfter(messages, '2026-08-11T10:00:00.000Z')).toBeNull()
    expect(newestOutgoingAfter(messages, '2026-08-14T00:00:00.000Z')).toBeNull()
  })

  it('treats a null anchor as "any outgoing message counts"', () => {
    expect(newestOutgoingAfter(messages, null)).toBe('2026-08-11T10:00:00+00:00')
  })

  it('returns null when nothing outgoing exists (404 stays draft_missing)', () => {
    const onlyReply = [{ direction: 'received', sent_at: '2026-08-12T10:00:00.000Z' }]
    expect(newestOutgoingAfter(onlyReply, null)).toBeNull()
  })
})

describe('nextDueFrom', () => {
  it('anchors the next step wait on the actual send time, not draft creation', () => {
    expect(nextDueFrom('2026-08-10T10:00:00.000Z', 3)).toBe('2026-08-13T10:00:00.000Z')
  })
})
