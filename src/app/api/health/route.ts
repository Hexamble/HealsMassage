// Lightweight health endpoint.
//
// Used by an external cron-ping (cron-job.org) hitting this URL every
// 14 minutes to keep the Render free-tier web service warm (Render
// spins down free instances after 15 minutes of inactivity).
//
// Returns plain text "ok" with status 200. No DB queries, no auth —
// the goal is just to register inbound HTTP traffic so Render's idle
// timer resets. Response stays under 100 bytes so the ping costs
// almost nothing.

export const dynamic = 'force-dynamic'

export function GET() {
  return new Response('ok', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

export function HEAD() {
  return new Response(null, { status: 200 })
}
