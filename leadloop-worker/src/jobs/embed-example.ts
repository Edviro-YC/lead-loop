import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmbedExampleMessage } from '../lib/types'
import { generateEmbedding } from '../services/openai'

/**
 * Generate and store an embedding for an outreach example.
 * Called by the embed-example queue consumer.
 */
export async function embedOutreachExample(
  supabase: SupabaseClient,
  openaiKey: string,
  msg: EmbedExampleMessage
): Promise<void> {
  const { data: example } = await supabase
    .from('outreach_examples')
    .select('context, subject, body, outcome')
    .eq('id', msg.exampleId)
    .single()

  if (!example) {
    console.error(`Example ${msg.exampleId} not found`)
    return
  }

  // Build the text to embed: structured concatenation of all fields
  const textToEmbed = [
    `Context: ${example.context}`,
    example.subject ? `Subject: ${example.subject}` : '',
    `Body: ${example.body}`,
    example.outcome ? `Outcome: ${example.outcome}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const embedding = await generateEmbedding(openaiKey, textToEmbed)

  // pgvector expects the embedding as a string representation: '[0.1, 0.2, ...]'
  const embeddingStr = `[${embedding.join(',')}]`

  await supabase
    .from('outreach_examples')
    .update({ embedding: embeddingStr })
    .eq('id', msg.exampleId)
}
