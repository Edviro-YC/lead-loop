import OpenAI from 'openai'

interface EnhanceParams {
  draftText: string
  leadContext?: Record<string, string>
  intent?: string
}

interface SuggestReplyParams {
  threadMessages: Array<{
    direction: string
    from_email: string | null
    body_text: string | null
    sent_at: string | null
  }>
  examples: string[]
  baseText?: string
  isFollowUp?: boolean
}

export async function enhanceDraft(
  apiKey: string,
  params: EnhanceParams
): Promise<string> {
  const client = new OpenAI({ apiKey })

  const contextLines = params.leadContext
    ? Object.entries(params.leadContext)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : ''

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content: [
          'You are an expert email copywriter for professional outreach.',
          'Improve the draft to be more concise, natural, and compelling.',
          'Preserve the sender\'s voice and core message.',
          'Do not add generic filler or excessive formality.',
          params.intent ? `The sender\'s intent: ${params.intent}` : '',
          contextLines ? `Lead context:\n${contextLines}` : '',
          'Return ONLY the improved email body, no explanations.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      { role: 'user', content: params.draftText },
    ],
  })

  return response.choices[0]?.message?.content ?? params.draftText
}

export async function suggestReply(
  apiKey: string,
  params: SuggestReplyParams
): Promise<string> {
  const client = new OpenAI({ apiKey })

  const threadContext = params.threadMessages
    .map((m) => {
      const label = m.direction === 'sent' ? 'You' : m.from_email ?? 'Them'
      return `[${label}]: ${m.body_text ?? '(empty)'}`
    })
    .join('\n\n')

  const exampleBlock = params.examples.length
    ? `\nHere are examples of successful outreach for reference:\n${params.examples.join('\n---\n')}\n`
    : ''

  const systemPrompt = params.isFollowUp
    ? [
        'You are writing a follow-up email in an ongoing outreach thread.',
        'The recipient has not replied yet.',
        'Be brief, add new value or a different angle, and include a clear ask.',
        'Do not repeat the previous email. Do not be pushy.',
        params.baseText
          ? `Use this template as a starting point:\n${params.baseText}`
          : '',
        exampleBlock,
        'Return ONLY the follow-up email body.',
      ]
        .filter(Boolean)
        .join('\n')
    : [
        'You are helping compose a reply in a professional email thread.',
        'Write a helpful, concise reply that advances the conversation.',
        'Match the tone of the thread.',
        exampleBlock,
        'Return ONLY the reply body.',
      ]
        .filter(Boolean)
        .join('\n')

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Thread so far:\n\n${threadContext}` },
    ],
  })

  return response.choices[0]?.message?.content ?? ''
}

export async function generateEmbedding(
  apiKey: string,
  text: string
): Promise<number[]> {
  const client = new OpenAI({ apiKey })

  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })

  return response.data[0].embedding
}
