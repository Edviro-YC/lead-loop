import { createClient } from "@/lib/supabase/server";
import { TemplateList } from "@/components/templates/template-list";

export default async function TemplatesPage() {
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("templates")
    .select("*")
    .order("created_at", { ascending: false });

  return <TemplateList templates={templates ?? []} />;
}
