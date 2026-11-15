# Running LendLoop in production

The local stack optimizes for "clone and run". Before real neighbours use it, I would change the following,
roughly in priority order.

## Hosting and secrets
- **Managed Convex** (Convex Cloud, or self-hosted on Postgres with backups), deployed from CI with a deploy key.
  Separate dev, staging and prod deployments, each with its own Clerk instance and signing secrets.
- **Next.js on Vercel or AWS** (Amplify, or a container on ECS Fargate behind CloudFront).
- **n8n in queue mode** (main + workers + Redis + Postgres) on ECS/Fargate or n8n Cloud, behind HTTPS only, with
  the editor on a private network or SSO and the webhook path as the only public route. Pin the image version and
  upgrade deliberately. Run Code nodes in external task runners (`n8nio/runners` sidecar) instead of the
  deprecated internal mode.
- **Secrets in a manager** (AWS Secrets Manager or SSM Parameter Store, or n8n external secrets), never in `.env`
  files. That covers the two signing secrets, SMTP credentials, the Clerk keys, `N8N_ENCRYPTION_KEY` (backed up,
  because losing it makes every n8n credential unreadable) and the Convex deploy key. Rotate the signing secrets on a
  schedule: accept both the old and the new key during a short overlap (a `kid` header makes that explicit).
- **Real email** through SES, Postmark or Resend, with SPF, DKIM and DMARC on a sending domain, plus bounce handling
  and an unsubscribe link for reminders.

## Reliability
- Close the last duplicate window. Reminders are claimed with a lease, so overlapping runs never double-send. But if
  n8n crashes after the email went out and before the write-back, the lease expires and a later run sends again.
  Pass `reminderKey` (and the notification `jti`) as an idempotency key where the email provider supports one (for
  example Resend's `Idempotency-Key` header), or keep a short-lived sent-message log keyed on it, so the repeat is
  dropped.
- Replace n8n workflow static data (used to dedupe notification events) with a durable store, or rely only on the
  Convex receipt, so dedupe survives a reset of the n8n database and works across queue-mode workers.
- Paginate the overdue query (today it takes the first 200 loans) and batch the emails.
- **Alerting** on the signals the admin page already shows: failed notifications, failed n8n runs, and an overdue
  sweep that hasn't run in 26 hours. Route them to Slack or PagerDuty, not only an email.
- Health checks and uptime monitoring on the Convex HTTP endpoints and the n8n webhook.

## Security
- **Rate limits** on mutations (for example `@convex-dev/rate-limiter`) and at the edge for the n8n webhook, plus
  bot protection on sign-up (Clerk supports it).
- A strict nonce-based **CSP** (`strict: true` in Clerk's middleware) once every script is accounted for.
- Clerk production instance with MFA available, session lifetime reviewed, and admin accounts required to use MFA.
- Move roles into Clerk organizations, or keep them in Convex but add an audited admin UI for granting roles, so the
  CLI is only needed to bootstrap the first admin.
- Dependency and container scanning in CI (Dependabot, `npm audit`, Trivy), and regular n8n upgrades: it has a
  steady stream of security fixes.

## Privacy and compliance
- **Retention:** delete or anonymize loans, reminders and events after a fixed period (say 12 months), and keep n8n
  execution data for days, not weeks (or save only failed executions).
- **Account deletion:** a Clerk `user.deleted` webhook that removes the user row and anonymizes their loans.
- **Audit log** UI with export. In a regulated setting (healthcare, for example), ship audit records to write-once
  storage (S3 Object Lock, CloudTrail Lake).
- Keep email addresses out of n8n execution logs entirely: send n8n an opaque recipient ID and let a Convex endpoint
  resolve it at send time, or redact fields in the execution data.

## Observability
- Structured logs from Convex (log streams to Datadog or Axiom), n8n execution metrics (`N8N_METRICS=true` for
  Prometheus), and Sentry for the Next.js front end.
- A correlation ID (the event `jti`) carried from the Convex mutation through n8n and back in the receipt, so one
  search shows the whole path of a notification.
