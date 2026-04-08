import type { SupabaseClient } from '@supabase/supabase-js'
import type { ThreadSyncMessage } from '../lib/types'
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
 * Called by the thread-sync queue consumer.
 */
export async function syncThread(
  supabase: SupabaseClient,
  env: SyncEnv,
  msg: ThreadSyncMessage
): Promise<void> {
  const [{ data: thread }, { data: profile }] = await Promise.all([
    supabase.from('watched_threads').select('gmail_thread_id, user_id').eq('id', msg.threadId).single(),
    supabase.from('profiles').select('gmail_refresh_token, gmail_email').eq('id', msg.userId).single(),
  ])

  if (!thread) {
    console.error(`Thread ${msg.threadId} not found`)
    return
  }

  if (!profile?.gmail_refresh_token) {
    console.error(`No Gmail credentials for user ${msg.userId}`)
    return
  }

  const { access_token } = await refreshAccessToken(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    profile.gmail_refresh_token
  )

  const gmailThread = await getThread(
    { accessToken: access_token },
    thread.gmail_thread_id
  )

  const userEmail = profile.gmail_email?.toLowerCase() ?? ''

  const rows = gmailThread.messages.map((gmailMsg) => {
    const from = getHeader(gmailMsg, 'From')
    const to = getHeader(gmailMsg, 'To')
    const subject = getHeader(gmailMsg, 'Subject')
    const bodyText = extractBody(gmailMsg)
    const sentAt = new Date(parseInt(gmailMsg.internalDate)).toISOString()
    const direction = from.toLowerCase().includes(userEmail) ? 'sent' : 'received'

    return {
      thread_id: msg.threadId,
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
    .eq('id', msg.threadId)
}
