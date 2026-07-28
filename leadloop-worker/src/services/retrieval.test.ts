import { describe, expect, it } from 'vitest'
import { resolveSequenceStep, type SequenceStep } from './retrieval'

const seq = { name: 'Cold outreach', description: 'K-12 facilities directors' }

const step = (n: number, subject: string | null = null): SequenceStep => ({
  step_number: n,
  context: `ctx ${n}`,
  subject,
  body: `body ${n}`,
})

describe('resolveSequenceStep', () => {
  it('returns the full step list with the current position', () => {
    const steps = [step(1, 'Quick question'), step(2), step(3)]
    const result = resolveSequenceStep(seq, steps, 2)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.ctx.currentStep).toBe(2)
    expect(result.ctx.totalSteps).toBe(3)
    expect(result.ctx.steps).toEqual(steps)
  })

  it('is exhausted past the last step', () => {
    expect(resolveSequenceStep(seq, [step(1), step(2)], 3)).toEqual({
      status: 'exhausted',
      name: 'Cold outreach',
      totalSteps: 2,
    })
  })

  it('is exhausted for a sequence with no steps', () => {
    expect(resolveSequenceStep(seq, [], 1)).toEqual({
      status: 'exhausted',
      name: 'Cold outreach',
      totalSteps: 0,
    })
  })

  it('throws on a step-number gap instead of falling back', () => {
    expect(() => resolveSequenceStep(seq, [step(1), step(3)], 2)).toThrow(
      /no example for step 2/
    )
  })
})
