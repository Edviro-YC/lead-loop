-- RPC function for pgvector cosine similarity search on outreach examples.
-- Called by the Worker's retrieval service to find similar examples for reply suggestions.
CREATE OR REPLACE FUNCTION public.match_outreach_examples(
  query_embedding VECTOR(1536),
  match_user_id UUID,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  context TEXT,
  subject TEXT,
  body TEXT,
  outcome TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    oe.id,
    oe.context,
    oe.subject,
    oe.body,
    oe.outcome,
    1 - (oe.embedding <=> query_embedding) AS similarity
  FROM public.outreach_examples oe
  WHERE oe.user_id = match_user_id
    AND oe.embedding IS NOT NULL
  ORDER BY oe.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
