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
