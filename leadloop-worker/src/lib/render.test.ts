import { describe, expect, it } from 'vitest'
import { extractVariables, renderTemplate } from './render'

describe('render', () => {
  it('extracts unique variables from a step body', () => {
    expect(
      extractVariables('Hi {{first_name}}, following up on {{company}} — {{first_name}}')
    ).toEqual(['first_name', 'company'])
  })

  it('fills placeholders and leaves unknown ones intact', () => {
    expect(
      renderTemplate('Hi {{first_name}} of {{company}}, {{unknown}}', {
        first_name: 'Sara',
        company: 'Acme',
      })
    ).toBe('Hi Sara of Acme, {{unknown}}')
  })
})
