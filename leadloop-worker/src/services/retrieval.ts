import type { SupabaseClient } from '@supabase/supabase-js'
import { generateEmbedding } from './openai'

interface RetrievedExample {
  id: string
  context: string
  subject: string | null
  body: string
  outcome: string | null
  similarity: number
}

/**
 * Find outreach examples similar to the given context using pgvector.
 * Returns the top-k most similar examples for the user.
 *
 * Requires a Supabase RPC function (added in Phase 5) that runs:
 *   SELECT *, 1 - (embedding <=> $1) AS similarity
 *   FROM outreach_examples
 *   WHERE user_id = $2
 *   ORDER BY embedding <=> $1
 *   LIMIT $3
 */
export async function findSimilarExamples(
  supabase: SupabaseClient,
  apiKey: string,
  userId: string,
  contextText: string,
  limit = 5
): Promise<RetrievedExample[]> {
  const queryEmbedding = await generateEmbedding(apiKey, contextText)

  const { data, error } = await supabase.rpc('match_outreach_examples', {
    query_embedding: queryEmbedding,
    match_user_id: userId,
    match_count: limit,
  })

  if (error) {
    console.error('Retrieval error:', error.message)
    return []
  }

  return data ?? []
}

/**
 * Format retrieved examples into a text block for the LLM prompt.
 */
export function formatExamplesForPrompt(examples: RetrievedExample[]): string[] {
  return examples.map(
    (ex) =>
      [
        `Context: ${ex.context}`,
        ex.subject ? `Subject: ${ex.subject}` : '',
        `Body: ${ex.body}`,
        ex.outcome ? `Outcome: ${ex.outcome}` : '',
      ]
        .filter(Boolean)
        .join('\n')
  )
}

// ─── Sequences ───────────────────────────────────────────────────────────────

export interface SequenceStep {
  step_number: number
  context: string
  subject: string | null
  body: string
}

export interface SequenceDraftContext {
  name: string
  description: string | null
  currentStep: number
  totalSteps: number
  /** Every step of the sequence, in order, with full example content. */
  steps: SequenceStep[]
}

export type SequenceContextResult =
  | { status: 'ok'; ctx: SequenceDraftContext }
  | { status: 'exhausted'; name: string; totalSteps: number }

/**
 * Pure classification of a thread's position in a sequence.
 * Exhausted = past the last step (a normal state callers must handle
 * explicitly). A gap (no example at the current step but later steps
 * exist) is a data inconsistency and throws.
 */
export function resolveSequenceStep(
  sequence: { name: string; description: string | null },
  steps: SequenceStep[],
  currentStep: number
): SequenceContextResult {
  const lastStep = steps.length ? steps[steps.length - 1].step_number : 0
  if (currentStep > lastStep) {
    return { status: 'exhausted', name: sequence.name, totalSteps: steps.length }
  }

  if (!steps.some((s) => s.step_number === currentStep)) {
    throw new Error(
      `Sequence "${sequence.name}" has no example for step ${currentStep} ` +
        `(steps present: ${steps.map((s) => s.step_number).join(', ')})`
    )
  }

  return {
    status: 'ok',
    ctx: {
      name: sequence.name,
      description: sequence.description,
      currentStep,
      totalSteps: steps.length,
      steps,
    },
  }
}

/**
 * Load the sequence context needed to draft the given step of a thread's
 * assigned sequence. Shared by the /generate-followup route and the
 * follow-up-draft queue job. Throws on a missing sequence or DB error —
 * an assigned sequence must never silently degrade to generic drafting.
 */
export async function loadSequenceContext(
  supabase: SupabaseClient,
  userId: string,
  sequenceId: string,
  currentStep: number
): Promise<SequenceContextResult> {
  const { data: sequence, error: seqError } = await supabase
    .from('sequences')
    .select('name, description')
    .eq('id', sequenceId)
    .eq('user_id', userId)
    .single()

  if (seqError || !sequence) {
    throw new Error(`Sequence ${sequenceId} not found: ${seqError?.message ?? 'no row'}`)
  }

  const { data: steps, error: stepsError } = await supabase
    .from('outreach_examples')
    .select('step_number, context, subject, body')
    .eq('sequence_id', sequenceId)
    .eq('user_id', userId)
    .order('step_number', { ascending: true })

  if (stepsError) {
    throw new Error(`Failed to load steps of sequence "${sequence.name}": ${stepsError.message}`)
  }

  return resolveSequenceStep(sequence, steps ?? [], currentStep)
}
