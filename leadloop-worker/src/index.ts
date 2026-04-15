import { Hono } from 'hono'
import type { AppBindings, AppEnv, FollowUpDraftMessage, EmbedExampleMessage } from './lib/types'
import { createServiceClient } from './lib/supabase'
import { debug } from './lib/debug'
import { corsMiddleware } from './middleware/cors'
import { jwtAuth, addonAuth } from './middleware/auth'
import { templates } from './routes/templates'
import { leads } from './routes/leads'
import { threads } from './routes/threads'
import { followUps } from './routes/follow-ups'
import { ai } from './routes/ai'
import { examples } from './routes/examples'
import { addon } from './routes/addon'
import { processFollowUpDraft } from './jobs/follow-up-draft'
import { embedOutreachExample } from './jobs/embed-example'
import { getDueFollowUps } from './services/scheduling'

const app = new Hono<AppEnv>()

// Global middleware
app.use('*', corsMiddleware())

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'leadloop-worker' }))

// Dashboard API routes (JWT auth)
const api = new Hono<AppEnv>()
api.use('*', jwtAuth)
api.route('/templates', templates)
api.route('/leads', leads)
api.route('/threads', threads)
api.route('/follow-ups', followUps)
api.route('/ai', ai)
api.route('/examples', examples)
app.route('/api', api)

// Gmail add-on routes (API key auth)
const addonRoutes = new Hono<AppEnv>()
addonRoutes.use('*', addonAuth)
addonRoutes.route('/', addon)
app.route('/addon', addonRoutes)

// ─── Worker exports ─────────────────────────────────────────────────────────

export default {
  fetch: app.fetch,

  /**
   * Queue consumer: dispatches messages to the appropriate job handler.
   */
  async queue(
    batch: MessageBatch<FollowUpDraftMessage | EmbedExampleMessage>,
    env: AppBindings,
    _ctx: ExecutionContext
  ): Promise<void> {
    const supabase = createServiceClient(env)

    for (const message of batch.messages) {
      try {
        const payload = message.body

        if ('scheduledFollowUpId' in payload) {
          await processFollowUpDraft(supabase, env, payload as FollowUpDraftMessage)
        } else if ('exampleId' in payload) {
          await embedOutreachExample(supabase, env.OPENAI_API_KEY, payload as EmbedExampleMessage)
        } else {
          console.error('Unknown queue message payload:', payload)
        }

        message.ack()
      } catch (err) {
        console.error('Queue job failed:', err)
        message.retry()
      }
    }
  },

  /**
   * Cron trigger: every 10 min, enqueue due follow-ups for draft creation.
   */
  async scheduled(
    _event: ScheduledEvent,
    env: AppBindings,
    _ctx: ExecutionContext
  ): Promise<void> {
    const supabase = createServiceClient(env)
    const dueFollowUps = await getDueFollowUps(supabase)

    for (const fu of dueFollowUps) {
      await env.FOLLOW_UP_DRAFT_QUEUE.send({
        scheduledFollowUpId: fu.id,
        userId: fu.user_id,
      })
    }

    debug(env, `Enqueued ${dueFollowUps.length} follow-ups for draft creation`)
  },
}
