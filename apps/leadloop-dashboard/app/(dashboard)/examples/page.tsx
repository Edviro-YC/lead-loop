import { createClient } from "@/lib/supabase/server";
import { ExampleList } from "@/components/examples/example-list";

export default async function ExamplesPage() {
  const supabase = await createClient();
  const [{ data: examples }, { data: sequences }] = await Promise.all([
    supabase
      .from("outreach_examples")
      .select("id, context, subject, body, outcome, tags, sequence_id, step_number, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("sequences")
      .select("id, name, description")
      .order("created_at", { ascending: false }),
  ]);

  return <ExampleList examples={examples ?? []} sequences={sequences ?? []} />;
}
