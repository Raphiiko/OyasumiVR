# 0001: Store uploaded debug reports in Workers KV

## Context

Users upload a debug report on Raphii's request and pass on the report code. The upload endpoint
lives in RaphiiApi, a Cloudflare Worker on the Workers Free plan. Uploads must never cause a
Cloudflare bill, including under abuse.

## Decision

- The app uploads the debug report zip to a RaphiiApi endpoint. The endpoint stores it in Workers
  KV under the report code, with a 5-day expiry, and returns the report code.
- A report code is 6 characters of Crockford base32, shown as `K7Q-M2X`. The API ignores case and
  the dash. The KV key is `debug-report:K7QM2X`. The Worker checks that a code is free before it
  writes.
- The endpoint refuses a zip over 25 MiB, the KV value limit.
- Limits per IP: 10 uploads an hour and 25 a day. Limit for all users together: 100 a day.
- The API has no download route. Raphii reads reports with `wrangler kv key get`.
- An upload starts only after the user confirms a dialog that says what the upload sends.
- The app offers "Retry" and "Save to file" only when the upload fails. "Retry" uploads the same
  zip again.
- The app shows the same generic error for every failed upload. It never shows the reason, such as
  a rate limit, so the dialog does not help someone who abuses the endpoint.

## Consequences

- On Workers Free, KV fails with an error at its caps (1 GB stored, 1,000 writes a day) and bills
  nothing. A bug in the rate limits can stop uploads for a day, but cannot cost money.
- The rate-limit counters must not spend KV writes on refused requests, so they leave the write
  budget to reports.
- KV holds about 200 to 500 reports at 2 to 5 MB each. Moving to R2 needs its own decision, because
  R2 has no hard cap and bills above its free tier.
