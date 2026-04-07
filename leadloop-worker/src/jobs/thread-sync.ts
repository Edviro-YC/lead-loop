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
  // Fetch the thread record and the user's Gmail credentials
  const { data: thread } = await supabase
    .from('watched_threads')
    .select('gmail_thread_id, user_id')
    .eq('id', msg.threadId)
    .single()

  if (!thread) {
    console.error(`Thread ${msg.threadId} not found`)
    return
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('gmail_refresh_token, gmail_email')
    .eq('id', thread.user_id)
    .single()

  if (!profile?.gmail_refresh_token) {
    console.error(`No Gmail credentials for user ${thread.user_id}`)
    return
  }

  // Get a fresh access token
  const { access_token } = await refreshAccessToken(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    profile.gmail_refresh_token
  )

  // Fetch the full thread from Gmail
  const gmailThread = await getThread(
    { accessToken: access_token },
    thread.gmail_thread_id
  )

  // Upsert each message
  const userEmail = profile.gmail_email?.toLowerCase() ?? ''

  for (const gmailMsg of gmailThread.messages) {
    const from = getHeader(gmailMsg, 'From')
    const to = getHeader(gmailMsg, 'To')
    const subject = getHeader(gmailMsg, 'Subject')
    const bodyText = extractBody(gmailMsg)
    const sentAt = new Date(parseInt(gmailMsg.internalDate)).toISOString()

    // Determine direction by checking if the "From" contains the user's email
    const direction = from.toLowerCase().includes(userEmail) ? 'sent' : 'received'

    await supabase.from('thread_messages').upsert(
      {
        thread_id: msg.threadId,
        gmail_message_id: gmailMsg.id,
        direction,
        from_email: from,
        to_email: to,
        subject,
        body_text: bodyText,
        snippet: gmailMsg.snippet,
        sent_at: sentAt,
      },
      { onConflict: 'gmail_message_id' }
    )
  }

  // Update thread metadata
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
