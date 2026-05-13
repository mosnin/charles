# Cron — daily founder briefing

Charles sends the founder a daily briefing every morning at 07:00 UTC: yesterday's highlights, three things needing attention today. The route is `GET /api/cron/daily-briefing` and it walks every active Space (subscription `active` or `trialing`, owner has email) and sends one email per space via Resend.

## Runners

In production we use **Vercel Cron** (already wired in `vercel.json`). Alternatives that work without code changes: Modal scheduled functions, GitHub Actions on a cron trigger, Upstash QStash, or any service that can hit an HTTP endpoint on a schedule with a custom `Authorization` header. In local dev, the cron route is a no-op unless you `curl` it manually — there is no in-process scheduler.

## Vercel Cron config

The `vercel.json` `crons` array contains:

```json
{
  "path": "/api/cron/daily-briefing",
  "schedule": "0 7 * * *"
}
```

This fires at 07:00 UTC every day. To trigger manually:

```bash
curl -X GET https://<host>/api/cron/daily-briefing \
  -H "Authorization: Bearer $CRON_SECRET"
```

To send a single briefing to one space without involving the cron path, use the send endpoint:

```bash
curl -X POST https://<host>/api/briefing/send \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"spaceId": "<space-uuid>"}'
```

## Required env vars

| Var | Purpose |
|---|---|
| `CRON_SECRET` | Bearer token. Both routes reject any request without an exact match. |
| `RESEND_API_KEY` | Transactional email sender. |
| `NEXT_PUBLIC_APP_URL` | Base URL used in the "Open Charles" CTA link. Falls back to `https://app.charles.dev`. |
| `RESEND_FROM_EMAIL` | (optional) From address; falls back to `notifications@alerts.usechippi.com`. |

All four must be set in the Vercel project for the daily briefing to land.
