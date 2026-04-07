import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single();

  const hasGmailToken = !!profile?.gmail_refresh_token;

  // Stats
  const { count: templateCount } = await supabase
    .from("templates")
    .select("*", { count: "exact", head: true });
  const { count: leadCount } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true });
  const { count: threadCount } = await supabase
    .from("watched_threads")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");
  const { count: exampleCount } = await supabase
    .from("outreach_examples")
    .select("*", { count: "exact", head: true });

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-2xl space-y-8 p-6">
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Account</h2>
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm font-medium">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm font-medium">
                {profile?.display_name || "—"}
              </span>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Gmail Connection</h2>
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  {hasGmailToken ? "Connected" : "Not connected"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {hasGmailToken
                    ? `Gmail access for ${profile?.gmail_email}`
                    : "Sign out and sign back in to grant Gmail access."}
                </p>
              </div>
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  hasGmailToken ? "bg-green-500" : "bg-muted-foreground"
                }`}
              />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Gmail Add-on</h2>
          <div className="rounded-lg border border-border p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Install the LeadLoop Gmail add-on to use templates, AI
              enhancement, and thread watching directly from Gmail.
            </p>
            <div className="rounded-md bg-muted p-3">
              <p className="mb-1 text-xs font-medium">Setup steps:</p>
              <ol className="list-inside list-decimal space-y-1 text-xs text-muted-foreground">
                <li>
                  Open the Apps Script project and deploy as a Gmail add-on
                </li>
                <li>
                  Set the Worker URL in Script Properties (key:{" "}
                  <code className="rounded bg-background px-1">WORKER_URL</code>
                  )
                </li>
                <li>
                  Open the add-on in Gmail and enter the API key when prompted
                </li>
              </ol>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Usage</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Templates", count: templateCount ?? 0 },
              { label: "Leads", count: leadCount ?? 0 },
              { label: "Active Threads", count: threadCount ?? 0 },
              { label: "Examples", count: exampleCount ?? 0 },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-border p-3 text-center"
              >
                <p className="text-2xl font-bold">{stat.count}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
