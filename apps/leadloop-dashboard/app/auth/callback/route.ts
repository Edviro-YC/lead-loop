import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/sequences";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      // Store the Google refresh token for background Gmail API access
      const refreshToken = data.session.provider_refresh_token;
      if (refreshToken) {
        await supabase
          .from("profiles")
          .update({
            gmail_refresh_token: refreshToken,
            gmail_token_expires_at: new Date(
              Date.now() + (data.session.expires_in ?? 3600) * 1000
            ).toISOString(),
          })
          .eq("id", data.session.user.id);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
