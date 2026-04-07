"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LeadForm } from "./lead-form";
import { CsvImport } from "./csv-import";
import { Pencil, Trash2, Users } from "lucide-react";

interface Lead {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  title: string | null;
  status: string;
  source: string;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-blue-100 text-blue-700",
  contacted: "bg-yellow-100 text-yellow-700",
  replied: "bg-green-100 text-green-700",
  converted: "bg-purple-100 text-purple-700",
  unsubscribed: "bg-gray-100 text-gray-500",
};

export function LeadList({ leads, total }: { leads: Lead[]; total: number }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Lead | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);

  async function handleDelete(id: string) {
    if (!confirm("Delete this lead?")) return;
    const supabase = createClient();
    await supabase.from("leads").delete().eq("id", id);
    router.refresh();
  }

  function handleSaved() {
    setEditing(null);
    setShowNew(false);
    setShowImport(false);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Leads</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {total} contact{total !== 1 ? "s" : ""} total.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Import CSV
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add Lead
          </button>
        </div>
      </div>

      <div className="p-6">
        {leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No leads yet. Add leads manually or import from CSV.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="w-20 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-t border-border hover:bg-muted/50">
                    <td className="px-4 py-2.5 font-medium">{lead.name || "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{lead.email}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{lead.company || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[lead.status] ?? "bg-gray-100"}`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{lead.source}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        <button onClick={() => setEditing(lead)} className="p-1 text-muted-foreground hover:text-foreground">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => handleDelete(lead.id)} className="p-1 text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && <LeadForm onClose={() => setShowNew(false)} onSaved={handleSaved} />}
      {editing && <LeadForm lead={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />}
      {showImport && <CsvImport onClose={() => setShowImport(false)} onImported={handleSaved} />}
    </>
  );
}
