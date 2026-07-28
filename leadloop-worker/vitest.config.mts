import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
				miniflare: {
					// Deterministic test-only values (override any local .dev.vars)
					bindings: {
						SUPABASE_URL: 'https://test-project.supabase.co',
						SUPABASE_ANON_KEY: 'test-anon-key',
						SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
						MCP_API_KEY: 'test-mcp-key',
					},
				},
			},
		},
	},
});
