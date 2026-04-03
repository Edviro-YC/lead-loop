import type { Database } from './database.types'

export type { Database, Json, Tables, TablesInsert, TablesUpdate } from './database.types'

type PublicTables = Database['public']['Tables']

export type Profile = PublicTables['profiles']['Row']
export type Lead = PublicTables['leads']['Row']
export type LeadInsert = PublicTables['leads']['Insert']
export type Template = PublicTables['templates']['Row']
export type TemplateInsert = PublicTables['templates']['Insert']
export type WatchedThread = PublicTables['watched_threads']['Row']
export type ThreadMessage = PublicTables['thread_messages']['Row']
export type FollowUpRule = PublicTables['follow_up_rules']['Row']
export type ScheduledFollowUp = PublicTables['scheduled_follow_ups']['Row']
export type OutreachExample = PublicTables['outreach_examples']['Row']

export type LeadStatus = 'active' | 'contacted' | 'replied' | 'converted' | 'unsubscribed'
export type ThreadStatus = 'active' | 'paused' | 'completed' | 'lost'
export type FollowUpCondition = 'no_reply' | 'always'
export type FollowUpRuleStatus = 'active' | 'paused' | 'exhausted' | 'cancelled'
export type ScheduledFollowUpStatus = 'pending' | 'draft_created' | 'dismissed' | 'sent'
export type MessageDirection = 'sent' | 'received'
export type TemplateCategory = 'initial_outreach' | 'follow_up' | 'reply'
export type LeadSource = 'csv' | 'manual' | 'gmail'
export type OutcomeType = 'replied' | 'meeting_booked' | 'converted'
