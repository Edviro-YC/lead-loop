/**
 * The one place {{variable}} syntax is defined. Used by sequence CRUD
 * (auto-detecting variables), enrollment (validating coverage), and the
 * draft job (rendering follow-up bodies).
 */
const PLACEHOLDER = /\{\{([a-zA-Z0-9_]+)\}\}/g

/** Extract unique {{placeholder}} names from a step body. */
export function extractVariables(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))]
}

/** Fill {{placeholder}}s from values. Unknown placeholders are left intact. */
export function renderTemplate(text: string, variables: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (match, name: string) => variables[name] ?? match)
}
