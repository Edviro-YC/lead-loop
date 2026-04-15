import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getThread,
  extractBody,
  getHeader,
  refreshAccessToken,
} from '../services/gmail'

interface SyncEnv {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

/**
 * Sync a watched thread's messages from Gmail into the database.
 * Called on-demand before operations that need fresh thread data
 * (suggest-reply, follow-up draft creation) and on initial watch.
 */
export async function syncThreadFromGmail(
  supabase: SupabaseClient,
  env: SyncEnv,
  opts: {
    threadId: string
    gmailThreadId: string
    userId: string
    refreshToken: string
    userEmail: string
  }
): Promise<void> {
  const { access_token } = await refreshAccessToken(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    opts.refreshToken
  )

  const gmailThread = await getThread(
    { accessToken: access_token },
    opts.gmailThreadId
  )

  const normalizedEmail = opts.userEmail.toLowerCase()

  const rows = gmailThread.messages.map((gmailMsg) => {
    const from = getHeader(gmailMsg, 'From')
    const to = getHeader(gmailMsg, 'To')
    const subject = getHeader(gmailMsg, 'Subject')
    const bodyText = extractBody(gmailMsg)
    const sentAt = new Date(parseInt(gmailMsg.internalDate)).toISOString()
    const direction = from.toLowerCase().includes(normalizedEmail) ? 'sent' : 'received'

    return {
      thread_id: opts.threadId,
      gmail_message_id: gmailMsg.id,
      direction,
      from_email: from,
      to_email: to,
      subject,
      body_text: bodyText,
      snippet: gmailMsg.snippet,
      sent_at: sentAt,
    }
  })

  await supabase.from('thread_messages').upsert(rows, { onConflict: 'gmail_message_id' })

  const lastMessage = gmailThread.messages[gmailThread.messages.length - 1]
  await supabase
    .from('watched_threads')
    .update({
      last_synced_at: new Date().toISOString(),
      last_gmail_history_id: gmailThread.historyId,
      last_activity_at: lastMessage
        ? new Date(parseInt(lastMessage.internalDate)).toISOString()
        : undefined,
    })
    .eq('id', opts.threadId)
}
