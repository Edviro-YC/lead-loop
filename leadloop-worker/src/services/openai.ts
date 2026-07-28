import OpenAI from 'openai'
import type { SequenceDraftContext } from './retrieval'

interface EnhanceParams {
  draftText: string
  leadContext?: Record<string, string>
  intent?: string
}

export interface SuggestReplyParams {
  threadMessages: Array<{
    direction: string
    from_email: string | null
    body_text: string | null
    sent_at: string | null
  }>
  examples: string[]
  baseText?: string
  isFollowUp?: boolean
  /** Only used with isFollowUp; callers pass either baseText or sequence, not both. */
  sequence?: SequenceDraftContext
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
    model: 'gpt-5.6-sol',
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

/**
 * The concrete day proposed in a sequence draft's closing ask: two days
 * from now, rolled forward past weekends. Weekday computed in the user's
 * timezone (single-tenant: Pacific).
 */
function pilotAskDay(): string {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  const weekday = () =>
    new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' }).format(d)
  while (weekday() === 'Saturday' || weekday() === 'Sunday') d.setDate(d.getDate() + 1)
  return weekday()
}

/**
 * Build the exact messages sent to OpenAI for a reply/follow-up suggestion.
 * Exposed so drafts can be previewed and prompt-engineered.
 */
export function buildSuggestReplyPrompt(
  params: SuggestReplyParams
): { system: string; user: string } {
  const threadContext = params.threadMessages
    .map((m) => {
      const label = m.direction === 'sent' ? 'You' : m.from_email ?? 'Them'
      return `[${label}]: ${m.body_text ?? '(empty)'}`
    })
    .join('\n\n')

  const exampleBlock = params.examples.length
    ? `\nHere are examples of successful outreach for reference:\n${params.examples.join('\n---\n')}\n`
    : ''

  const seq = params.sequence
  const sequenceBlock = seq
    ? [
        `This thread follows the outreach sequence "${seq.name}"${seq.description ? ` — ${seq.description}` : ''}.`,
        `You are drafting step ${seq.currentStep} of ${seq.totalSteps}. The full sequence:`,
        ...seq.steps.map((s) =>
          [
            `--- Step ${s.step_number}${s.step_number === seq.currentStep ? ' (THE STEP YOU ARE DRAFTING)' : ''}`,
            `Context: ${s.context}`,
            s.subject ? `Subject: ${s.subject}` : '',
            `Body:\n${s.body}`,
          ]
            .filter(Boolean)
            .join('\n')
        ),
        `---`,
        `Draft this email by staying close to the step ${seq.currentStep} example: keep its structure, tone, and approximate length, and reuse its phrasing wherever it fits. Change only what personalization requires — the recipient's name, district-specific details, and a natural fit with the thread. Do not add claims or offers that are not in the example.`,
        `End the email with this closing ask, lightly adapted so it reads naturally against this step's topic — always keep the day, the brief chat, and the pilot: "Are you free on ${pilotAskDay()} for a brief chat to discuss a potential pilot to resolve this?"`,
        `The other steps are context: earlier steps show what the recipient has already received; later steps show what is still coming, so do not preempt or repeat their content.`,
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  const systemPrompt = params.isFollowUp
    ? [
        'You are writing a follow-up email in an ongoing outreach thread.',
        'The recipient has not replied yet.',
        // A sequence step already defines the angle; the generic "new angle"
        // instruction would push the model to invent instead.
        seq
          ? 'The sequence step example below supplies the angle and the value-add for this email.'
          : 'Be brief, add new value or a different angle, and include a clear ask.',
        'Do not repeat the previous email. Do not be pushy.',
        sequenceBlock,
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

  return { system: systemPrompt, user: `Thread so far:\n\n${threadContext}` }
}

export async function suggestReply(
  apiKey: string,
  params: SuggestReplyParams
): Promise<string> {
  const client = new OpenAI({ apiKey })
  const prompt = buildSuggestReplyPrompt(params)

  const response = await client.chat.completions.create({
    model: 'gpt-5.6-sol',
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
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
