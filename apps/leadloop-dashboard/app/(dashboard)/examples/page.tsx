import { createClient } from "@/lib/supabase/server";
import { ExampleList } from "@/components/examples/example-list";

export default async function ExamplesPage() {
  const supabase = await createClient();
  const { data: examples } = await supabase
    .from("outreach_examples")
    .select("id, context, subject, body, outcome, tags, created_at")
    .order("created_at", { ascending: false });

  return <ExampleList examples={examples ?? []} />;
}
