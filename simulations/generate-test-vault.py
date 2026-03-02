"""Generate 32 synthetic vault shards for the noise ceiling experiment."""

import os
from pathlib import Path

VAULT = Path(os.path.expanduser("~/.claude-shards/knowledge-base"))

SHARDS = []

def shard(name, type_, project, tags, title, body):
    SHARDS.append({
        "name": name,
        "type": type_,
        "project": project,
        "tags": tags,
        "title": title,
        "body": body,
    })

# ── Payments Cluster ──

shard("chose-stripe", "decisions", "payments",
    ["payments", "architecture"],
    "Chose Stripe for Payments",
    """Evaluated Stripe, Braintree, and Adyen for the payments integration. Stripe won primarily due to its first-class TypeScript SDK, predictable API versioning contract, and the ability to handle server-side payment intent confirmation cleanly inside Next.js server components (see [[chose-app-router]] for how that architecture decision influenced this one).

Stripe's API versioning model lets us pin a specific version in the dashboard and in request headers, so upgrades are always opt-in. Braintree's client-side tokenization flow made it harder to keep sensitive operations server-side, and Adyen's pricing model requires volume commitments we aren't ready for.

One callout: Stripe's `PaymentIntent` object lifecycle (created → processing → succeeded/requires_action) maps cleanly onto our background job model. See [[chose-webhook-queue]] for how we handle the async confirmation side of that flow.""")

shard("chose-webhook-queue", "decisions", "payments",
    ["payments", "infrastructure"],
    "Chose BullMQ for Webhook Processing",
    """Initially processed Stripe webhooks inline in the route handler — verified the signature, updated the database, returned 200. This worked until we hit a slow database write that caused Stripe to retry, creating duplicate order records.

Moved to a BullMQ/Redis queue where the route handler does nothing except verify the signature and enqueue the raw event payload. Background workers consume the queue and do the actual processing. Redis gives us durable job storage so events survive a deployment; BullMQ gives us concurrency control, rate limiting, and a clean retry API with exponential backoff. Ordering guarantees within a single `customerId` are enforced by keying jobs into named queues per customer.

See [[webhook-signature-timing]] for a hard-won lesson about what the route handler must not do before enqueuing, and [[idempotent-payment-pattern]] for how workers safely handle the retries that BullMQ will inevitably trigger.""")

shard("stripe-api-version-pinning", "gotchas", "payments",
    ["payments", "api"],
    "Stripe API Version Mismatch Breaks Webhook Payloads Silently",
    """Stripe sends webhooks using the API version set in the dashboard at the time the webhook endpoint was registered — not the version pinned in your SDK constructor or in your request headers. If you upgrade the dashboard version without updating your webhook endpoint registration, the shape of the event payload changes under you with no error.

We hit this when `payment_intent.succeeded` events started arriving without the `charges` sub-object we were reading from. The webhook route returned 200 (signature verified fine), but the worker silently skipped the database update because the field was `undefined`. No exception, no log line — just missing data. Schema drift at the edge of a third-party API is nasty because your types still compile.

Fix: always pin the API version explicitly on the `Stripe` client constructor (`apiVersion: '2023-10-16'`), mirror that version in the dashboard webhook endpoint settings, and treat any webhook payload shape as untrusted input — validate with Zod before touching any field. See [[webhook-retry-reference]] for the retry schedule that made these silent failures accumulate over hours before we noticed.""")

shard("webhook-signature-timing", "gotchas", "payments",
    ["payments", "security"],
    "Webhook Signature Verification Fails Due to Clock Skew and Body Parsing",
    """Stripe's webhook signature scheme uses a timestamp embedded in the `Stripe-Signature` header and computes an HMAC over `timestamp.rawBody`. Two failure modes burned us. First: Next.js API routes with a JSON body parser consume the request stream and give you a parsed object — Stripe's `constructEvent` needs the raw bytes, not a re-serialized string. Even a single extra space breaks the HMAC. Fix is to read `req.body` as a `Buffer` using `bodyParser: false` or use the `raw` body in the App Router via `request.text()` before any other middleware touches it.

Second: the default Stripe SDK tolerance window is 300 seconds. Our Edge Runtime instances were running with clocks drifted ~6 minutes from NTP, which pushed timestamps outside the tolerance. The `crypto` comparison in `constructEvent` throws `WebhookSignatureVerificationError` with a message that looks identical to a replay attack — easy to misdiagnose. This has the same flavor as the Edge Runtime validation constraints described in [[edge-runtime-auth-limits]].

The fix for timing: ensure your deployment environment syncs NTP, and consider widening the tolerance window slightly (but document why — it's a security tradeoff). For the raw body issue: add a test fixture that posts a pre-signed body and assert no exception is thrown. See [[stripe-error-handling-pattern]] for how we classify these verification errors in the error boundary.""")

shard("idempotent-payment-pattern", "patterns", "payments",
    ["payments", "reliability"],
    "Idempotency Key Pattern for Stripe Charges",
    r"""Any code that creates a Stripe `PaymentIntent` or issues a `Charge` must supply an `idempotencyKey`. Without it, a BullMQ retry (or a user double-submitting) creates duplicate charges. Stripe deduplicates requests with the same key within a 24-hour window, returning the original response rather than processing again.

Our convention: derive the key deterministically from the business entity, not from a random UUID generated at request time. A UUID generated per-request is lost on retry; a key derived from `order:${orderId}:charge:${attemptNumber}` survives across process restarts.

```typescript
const paymentIntent = await stripe.paymentIntents.create(
  {
    amount: order.totalCents,
    currency: "usd",
    customer: order.stripeCustomerId,
    metadata: { orderId: order.id },
  },
  {
    idempotencyKey: `order:${order.id}:intent:${order.paymentAttempt}`,
  }
);
```

Increment `paymentAttempt` only on explicit user retry (e.g., after a card decline), not on infrastructure retries — you want infrastructure retries to reuse the same key. See [[chose-webhook-queue]] for where in the job pipeline this is called.""")

shard("stripe-error-handling-pattern", "patterns", "payments",
    ["payments", "error-handling"],
    "Pattern for Handling Stripe API Errors",
    r"""Stripe errors come back as `Stripe.errors.StripeError` subclasses. The most important split is retryable vs. fatal, because these two categories need completely different handling in a BullMQ worker.

Retryable: `StripeConnectionError`, `StripeAPIError` with 5xx status, `RateLimitError`. These should throw so BullMQ retries with backoff. Fatal: `CardError` (decline codes like `insufficient_funds`, `do_not_honor`), `InvalidRequestError` (bad parameters — retrying won't help), `AuthenticationError`. These should be caught, the job marked failed without retry, and the user notified.

```typescript
try {
  await stripe.paymentIntents.confirm(intentId);
} catch (err) {
  if (err instanceof Stripe.errors.StripeCardError) {
    await markOrderFailed(orderId, err.code);
    return;
  }
  if (err instanceof Stripe.errors.StripeConnectionError) {
    throw err;
  }
  throw err;
}
```

Decline codes worth special-casing: `card_velocity_exceeded` (retry next day), `do_not_honor` (generic bank refusal, usually fatal), `insufficient_funds` (prompt user). See [[stripe-api-version-pinning]] — a version mismatch can cause `InvalidRequestError` on fields that used to be valid, which looks like a fatal error but is actually a config bug.""")

shard("webhook-retry-reference", "references", "payments",
    ["payments", "webhooks"],
    "Stripe Webhook Retry Schedule and Status Codes",
    """Stripe retries failed webhook deliveries (any non-2xx response, or a timeout) on the following schedule:

| Attempt | Delay after previous |
|---------|----------------------|
| 1       | Immediate            |
| 2       | 5 minutes            |
| 3       | 30 minutes           |
| 4       | 2 hours              |
| 5       | 5 hours              |
| 6       | 10 hours             |
| 7       | 24 hours             |
| 8–18    | 24 hours each        |

After 18 failed attempts over ~3 days, Stripe disables the webhook endpoint. You will receive an email notification before this happens.

HTTP status codes your endpoint should return: `200` for success (any 2xx works), `400` for a payload you can parse but reject as invalid (Stripe will not retry), `500` or timeout to signal a transient failure (Stripe will retry). Avoid returning `400` for retryable errors — doing so permanently drops the event. Return `200` immediately after signature verification and enqueue for async processing; never return `200` only after completing database writes.""")

shard("pci-compliance-checklist", "references", "payments",
    ["payments", "security", "compliance"],
    "PCI DSS Checklist for Payments Integration",
    """Using Stripe's hosted fields (Stripe.js + Payment Element) puts us in SAQ-A scope, the lightest PCI DSS self-assessment tier. The core requirement: no raw card data (PAN, CVV, expiry) ever touches our servers or appears in our logs. Stripe handles tokenization on their side; we only ever store and transmit the `PaymentMethod` ID.

Key checklist items for SAQ-A compliance:

- Stripe.js loaded from `js.stripe.com` only — no self-hosting
- Payment Element rendered in a Stripe-controlled iframe — our JavaScript cannot read card fields
- No card data in server logs, error messages, or analytics events (audit `console.log` calls near payment flows)
- `PaymentMethod` IDs treated as sensitive — not exposed in client-side URLs or GET params
- Webhook endpoint protected by signature verification — raw body preserved before any middleware processes the request
- HTTPS enforced on all endpoints with HSTS headers
- Stripe dashboard access restricted by SSO; no shared credentials
- Annual SAQ-A self-assessment submitted; quarterly ASV scan not required for SAQ-A

Tokenization is the key architectural control: because card numbers are replaced with opaque tokens before we see them, a database breach doesn't expose card data. See [[chose-stripe]] for why Stripe's tokenization model was a factor in the vendor decision.""")

# ── Notifications Cluster ──

shard("chose-resend-email", "decisions", "notifications",
    ["notifications", "email"],
    "Chose Resend over SendGrid for Transactional Email",
    """Evaluated Resend, SendGrid, and Postmark for transactional email in early 2024. Resend won primarily on deliverability reputation and developer experience — their shared IP pools are newer and less likely to be flagged by spam filters than SendGrid's aging infrastructure.

The killer feature was first-class support for [[email-template-pattern]] via React Email. Instead of maintaining Handlebars or Mjml templates, we write typed React components that render to email-safe HTML. The preview server (`email dev`) makes iteration fast without sending real emails.

API simplicity was also a factor. Resend's SDK is a thin wrapper around a single `resend.emails.send()` call with a clean TypeScript interface. SendGrid's SDK carries years of legacy API surface that adds cognitive overhead for simple use cases. Onboarding took under an hour versus a full day for the SendGrid integration we prototyped.""")

shard("chose-websocket-notifications", "decisions", "notifications",
    ["notifications", "real-time"],
    "Chose WebSocket over SSE for Real-Time Notifications",
    """Evaluated Server-Sent Events (SSE) and WebSocket for delivering real-time notifications to connected clients. SSE is simpler to implement and works over plain HTTP/2, but the unidirectional constraint became a problem quickly — we needed clients to acknowledge receipt and update presence state.

WebSocket's bi-directional communication was the deciding factor. Clients can send ACK frames, heartbeat pings, and preference updates over the same persistent connection without opening additional HTTP requests. This simplified the [[notification-fanout-pattern]] considerably since the server can track active connections and skip queuing for online users.

The integration with [[chose-app-router]] was non-trivial. Next.js App Router's middleware layer handles the WebSocket upgrade handshake, but this requires careful placement of the `upgrade` header check before any auth middleware short-circuits the request. Server Components cannot hold WebSocket connections, so the client component boundary must be drawn at the notification provider level.""")

shard("email-bounce-rate-limits", "gotchas", "notifications",
    ["notifications", "email", "deliverability"],
    "Resend Suspended Sending Due to High Bounce Rate",
    """Resend automatically suspended our sending account when the bounce rate crossed 5% within a 24-hour window. The root cause was importing a stale user list from a legacy system — many addresses were years old and no longer valid. Hard bounces (permanent delivery failures like non-existent addresses) count heavily against sending reputation, while soft bounces (mailbox full, temporary server errors) are weighted less but still accumulate.

Resend maintains a suppression list per domain. Once an address hard-bounces, it is automatically added to the suppression list and future sends to that address are silently dropped. We were not seeding this list from our legacy bounce history before the migration, so we re-attempted known-bad addresses at volume. Always export suppression data from any previous provider and import it before sending the first message.

Recovery required contacting Resend support, demonstrating a list cleaning process (we ran addresses through ZeroBounce), and sending at reduced volume for 48 hours while reputation recovered. See [[notification-priority-reference]] for the delivery guarantees we now publish internally — critical alerts are routed through a separate subdomain with stricter list hygiene to protect that sending reputation independently.""")

shard("websocket-reconnection-storms", "gotchas", "notifications",
    ["notifications", "real-time", "scaling"],
    "WebSocket Reconnection Storm After Deploy",
    """After a rolling deploy that restarted all app instances within ~30 seconds, every connected WebSocket client attempted to reconnect simultaneously. The session lookup during auth re-negotiation — each client re-authenticating to establish a new connection — overwhelmed the session store. This is a cross-domain issue: see [[server-auth-middleware-pattern]] for how the auth middleware validates session tokens on every WebSocket upgrade, which becomes a bottleneck at reconnection scale.

The fix has two parts. First, clients now implement exponential backoff with full jitter on reconnection: `delay = random(0, min(cap, base * 2^attempt))`. This spreads the reconnection window from ~30 seconds to several minutes. Without jitter, exponential backoff alone still produces synchronized waves if all clients disconnected at the same time. Second, we added a connection pooling layer in front of the Redis pub/sub fanout so that a burst of new subscriptions doesn't create a corresponding burst of Redis SUBSCRIBE commands.

Health check endpoints used by the load balancer now include WebSocket connection counts per instance — see [[health-check-pattern]] for the schema. This lets us detect a reconnection storm in progress and delay marking new instances as healthy until the connection count stabilizes, preventing the load balancer from routing additional fresh connections to an already-overwhelmed instance.""")

shard("notification-fanout-pattern", "patterns", "notifications",
    ["notifications", "architecture"],
    "Fan-Out Pattern for Multi-Channel Notifications",
    r"""When a notification event is produced, it is written to a central queue and then fanned out to each enabled channel — email, WebSocket push, and in-app feed — based on the user's preferences and the notification's priority. Channel routing is resolved at fan-out time, not at enqueue time, so preference changes take effect immediately for any event still in the queue.

```typescript
async function fanOut(event: NotificationEvent, userId: string) {
  const prefs = await getUserNotificationPrefs(userId);
  const channels = resolveChannels(event.priority, prefs);

  await Promise.allSettled(
    channels.map((channel) => channel.deliver(event, userId))
  );
}
```

Email delivery delegates to [[chose-resend-email]]'s SDK. Real-time delivery goes through the WebSocket layer described in [[chose-websocket-notifications]]. Failures in one channel are isolated — `Promise.allSettled` ensures a failed email send does not block the in-app notification. Each channel logs its own delivery status back to the event record for auditability.""")

shard("email-template-pattern", "patterns", "notifications",
    ["notifications", "email", "react"],
    "React Email Template Pattern with Preview and Testing",
    """All transactional email templates are React components that live in `packages/email/` and are co-located with their unit tests and fixture data. The `@react-email/components` library provides email-safe primitives (`<Html>`, `<Section>`, `<Text>`, `<Button>`) that abstract away the table-based layout still required for Outlook compatibility. Each template accepts a strongly-typed props interface, which makes it impossible to send an email with missing dynamic content at compile time.

The preview server (`pnpm email dev`) runs a local Next.js instance that renders every template with its fixture data. Designers can iterate on templates without triggering real sends, and the preview URL can be shared in pull requests as a visual diff. Templates are tested with `@react-email/render` to assert on the rendered HTML string — we check for presence of dynamic values and absence of known rendering artifacts rather than snapshot-testing the full HTML, which is too brittle.

Integration with [[chose-resend-email]] is a single function: render the React component to an HTML string, pass it as the `html` field to `resend.emails.send()`. We also pass the plain-text rendering from `render(component, { plainText: true })` as the `text` field to improve deliverability for clients that prefer or require plain text.""")

shard("notification-priority-reference", "references", "notifications",
    ["notifications", "architecture"],
    "Notification Priority Levels and Delivery Guarantees",
    """Priority levels govern which channels are used, delivery ordering, and the guarantees we make about latency and durability. This table is the authoritative reference for product and engineering.

| Priority | Channels | Delivery Guarantee | Max Latency | Retry Policy |
|---|---|---|---|---|
| Critical | Email + WebSocket + In-App + SMS | At-least-once, durable | 30s | Retry 5x with backoff, then PagerDuty alert |
| High | Email + WebSocket + In-App | At-least-once, durable | 2m | Retry 3x with backoff |
| Normal | WebSocket + In-App (Email if opted in) | Best-effort | 5m | Retry 1x |
| Low | In-App only | Best-effort | 1h | No retry |

Critical notifications are sent from a dedicated sending subdomain (`alerts.mail.example.com`) with a separate IP pool to isolate their sending reputation from bulk notification volume. High-priority and below share the primary sending domain. Events are persisted to the database before fan-out begins — delivery attempts are made against the persisted record so a process crash does not lose the event.""")

shard("rate-limit-reference", "references", "notifications",
    ["notifications", "api", "rate-limiting"],
    "Rate Limits Across Notification Providers",
    """Provider rate limits are a common source of silent notification failures under load. Cache the per-user send counts in Redis (TTL aligned to the provider's window) rather than counting in the database to avoid lock contention at high throughput. This table reflects limits as of Q1 2024 — verify against provider docs before increasing send volume.

| Provider | Limit | Window | Scope | Notes |
|---|---|---|---|---|
| Resend | 100 req/s | Per second | Account | Burst up to 200 for first 500ms; sustained throughput is 100/s |
| Resend | 50,000 emails | Per day | Account | Scales with plan; Free tier is 100/day |
| Web Push (VAPID) | No hard limit | — | Per endpoint | FCM: 240,000 messages/min globally; APNs: 600 req/s per bundle ID |
| Twilio SMS | 1 msg/s | Per second | Per long code | Short codes go up to 100 msg/s; local numbers throttle hard |
| Firebase FCM | 600,000 msg/min | Per minute | Project | Per-device limit: 240 msg/min |

See [[email-bounce-rate-limits]] for how bounce thresholds interact with Resend's automated sending suspension — rate limits and bounce limits are independent mechanisms and both can trigger a suspension.""")

# ── Search Cluster ──

shard("chose-elasticsearch", "decisions", "search",
    ["search", "infrastructure"],
    "Chose Elasticsearch for Product Search",
    """Evaluated Elasticsearch, Algolia, and Meilisearch for the product search backend. Chose Elasticsearch primarily because we needed to self-host for data residency compliance and to avoid per-request pricing that would become punishing at scale. Algolia's managed offering was attractive for DX but the cost projection at 50M+ monthly queries was a non-starter.

Elasticsearch's query flexibility was the other deciding factor — we needed complex boolean filters, nested facets on product variants, and geo-distance scoring simultaneously, which required the full Query DSL. Meilisearch was too opinionated about relevance tuning and lacked the aggregation primitives we needed for faceted navigation.

Operational overhead is real: we run a 3-node cluster with a dedicated coordinating node, and snapshot/restore has bitten us twice. Revisit this decision if the infra team shrinks. See [[chose-search-indexing-strategy]] for how we feed data into the cluster, and [[elasticsearch-query-dsl-reference]] for query patterns we rely on.""")

shard("chose-search-indexing-strategy", "decisions", "search",
    ["search", "architecture"],
    "Chose Event-Driven Incremental Indexing",
    """Decided on event-driven incremental indexing rather than periodic full index rebuilds. Full rebuilds at our catalog size (2M+ SKUs) took 40+ minutes and required a blue/green alias swap, which complicated deployment coordination and caused noticeable consistency lag during the cutover window.

The incremental approach uses change data capture (CDC) on the products and inventory tables via Debezium, publishing change events to Kafka. Consumers debounce rapid successive updates to the same document (100ms window) before issuing partial ES updates, which keeps queue depth manageable during bulk imports. See [[incremental-reindex-pattern]] for the handler implementation.

One important cross-domain consideration: RSC server components in the App Router fetch product data directly from Elasticsearch, and Next.js revalidation signals are wired to trigger reindex jobs for affected documents. This couples the search indexing pipeline to the caching layer — see [[chose-app-router]] for context on how that boundary works. Consistency lag is still ~2–5 seconds under normal load, which is acceptable for our use case.""")

shard("elasticsearch-mapping-explosion", "gotchas", "search",
    ["search", "elasticsearch"],
    "Dynamic Mappings Caused Field Limit Explosion",
    """Hit the Elasticsearch index field limit after dynamic mapping was left enabled on the `product_attributes` object field. Users can define arbitrary attribute keys (e.g. `color`, `finish`, `thread_count`), and each unique key created a new field in the mapping. After onboarding a few large vendors with non-standard attribute schemas, the index blew past the default 1000-field limit and started rejecting indexing requests with `mapper_parsing_exception`.

The fix was two-pronged: disable dynamic mapping on `product_attributes` by setting `"dynamic": false`, and use a `flattened` field type for the whole attribute blob to allow keyword queries without exploding the mapping. Structured fields we actually query (price, category_id, brand_slug) remain explicitly mapped. We also added a dynamic template that routes any unmapped string fields to `keyword` type with `ignore_above: 256` as a safety net on other parts of the document.

Monitor field count via `GET /<index>/_mapping` and alert if it exceeds 800. The underlying issue was no schema governance on what vendors could push into attributes — tightening the ingestion contract is the real fix. See [[search-query-parsing-pattern]] for how attribute filters are translated into queries against the flattened field.""")

shard("stale-search-index", "gotchas", "search",
    ["search", "caching"],
    "Search Index Fell Hours Behind Due to Queue Backlog",
    """During a flash sale event, the Redis-backed indexing queue depth spiked to ~800K messages and consumers fell several hours behind. Customers were seeing products that were out of stock, incorrect prices, and in one case a product that had been delisted entirely. The stale reads were silent — no errors, just confidently wrong data.

The immediate cause was a batch price update job that enqueued 400K update events in a tight loop without rate limiting. Consumers couldn't keep up, and we had no queue depth alerting in place. We had to manually revalidate the entire catalog index to recover, which required the full rebuild path we'd specifically tried to avoid with the incremental strategy. See [[incremental-reindex-pattern]] for the revised consumer implementation with backpressure.

This incident mirrors a class of staleness problems also present in the fetch cache layer — see [[fetch-cache-persistence]] for a parallel case where cached responses served stale data after a deployment. Eventual consistency is fine until it isn't: you need queue depth monitoring (alert at >10K), consumer lag dashboards, and a defined SLA for maximum acceptable index lag. We now have a circuit breaker that falls back to a direct DB read for pricing when index lag exceeds 60 seconds.""")

shard("search-query-parsing-pattern", "patterns", "search",
    ["search", "query"],
    "Pattern: Parsing User Queries into Structured ES Queries",
    r"""User-facing search input needs to be parsed into a structured Elasticsearch query rather than passed as a raw `query_string` query, which is fragile against special characters and gives no control over field weighting. The pattern is to tokenize the raw input, classify tokens as freetext terms vs. filter directives (e.g. `color:blue`), and construct a `bool` query programmatically.

```python
def parse_query(raw: str) -> dict:
    terms, filters = [], []
    for token in raw.strip().split():
        if ":" in token:
            field, value = token.split(":", 1)
            filters.append({"term": {f"attributes.{field}": value}})
        else:
            terms.append(token)

    must = []
    if terms:
        must.append({
            "multi_match": {
                "query": " ".join(terms),
                "fields": ["title^3", "brand^2", "description"],
                "fuzziness": "AUTO",
                "type": "best_fields",
            }
        })
    return {"bool": {"must": must, "filter": filters}}
```

Fuzzy matching (`fuzziness: AUTO`) handles typos well for terms over 4 characters but can produce surprising results on short tokens — consider disabling fuzz for single-character tokens. Tokenization here is naive whitespace splitting; a production version should handle quoted phrases and escaped colons. See [[elasticsearch-query-dsl-reference]] for the full set of query types used across the codebase, and [[elasticsearch-mapping-explosion]] for why the `attributes` field is a `flattened` type rather than a nested object.""")

shard("incremental-reindex-pattern", "patterns", "search",
    ["search", "indexing"],
    "Pattern: Incremental Reindexing with Dead Letter Queue",
    r"""Event-driven incremental reindexing consumes product change events and issues partial updates to Elasticsearch using the bulk API. The handler batches events up to 100 documents or 500ms, whichever comes first, before flushing — this significantly reduces bulk API call overhead compared to per-document updates.

```python
async def handle_reindex_batch(events: list[ChangeEvent]) -> None:
    actions = []
    for event in events:
        if event.op == "delete":
            actions.append({"delete": {"_index": INDEX, "_id": event.doc_id}})
        else:
            doc = await fetch_product_document(event.doc_id)
            actions.append({"index": {"_index": INDEX, "_id": event.doc_id}})
            actions.append(doc)

    try:
        resp = es.bulk(body=actions, timeout="30s")
        if resp["errors"]:
            failed = [i for i in resp["items"] if i.get("index", {}).get("error")]
            await dlq.publish_batch(failed)
    except TransportError as exc:
        await dlq.publish_batch(events, reason=str(exc))
```

Failed documents go to a dead letter queue (DLQ) in SQS with a 3-retry policy and exponential backoff (2s, 8s, 32s). After 3 failures the message lands in a separate DLQ inspection topic that pages on-call. The retry strategy distinguishes between transient ES errors (5xx, timeout — retry) and document-level errors (mapping conflict, field limit — do not retry, alert instead).

See [[chose-search-indexing-strategy]] for why incremental was chosen over full rebuilds and the CDC pipeline architecture that feeds this handler.""")

shard("elasticsearch-query-dsl-reference", "references", "search",
    ["search", "elasticsearch", "api"],
    "Elasticsearch Query DSL Reference",
    """Common Query DSL patterns used across the search codebase. Leaf queries match specific field values; compound queries (`bool`) combine them with `must`, `should`, `filter`, and `must_not` clauses. Queries in `filter` context are cached by ES and do not affect relevance scoring — always prefer `filter` for non-scoring conditions like price range or stock status.

**match** — Full-text search on analyzed fields. Use `operator: "and"` to require all terms. Supports `fuzziness: "AUTO"`.
```json
{ "match": { "title": { "query": "running shoes", "operator": "and" } } }
```

**bool** — Compound query. `must` affects score; `filter` does not.
```json
{ "bool": { "must": [{ "match": { "title": "shoes" } }], "filter": [{ "term": { "in_stock": true } }] } }
```

**range** — Numeric or date range. Use `gte`/`lte`.
```json
{ "range": { "price_cents": { "gte": 1000, "lte": 20000 } } }
```

**nested** — Query against objects in a nested field (preserves object identity, unlike `object` type). Required for querying variant-level fields without cross-variant false positives.
```json
{ "nested": { "path": "variants", "query": { "bool": { "must": [{ "term": { "variants.size": "M" } }, { "term": { "variants.in_stock": true } }] } } } }
```

**function_score** — Modify relevance scores with decay functions, field value factors, or script scores. Used for boosting sponsored listings and applying freshness decay to older products.""")

shard("search-relevance-tuning-reference", "references", "search",
    ["search", "relevance"],
    "Search Relevance Tuning Reference",
    """Field boost values and scoring parameters for product search. These are tuned empirically against click-through rate data from the search analytics pipeline. Boosts are applied in the `multi_match` query and via `function_score` wrappers in the query middleware layer before requests are dispatched to Elasticsearch.

| Field              | Boost | Notes                                              |
|--------------------|-------|----------------------------------------------------|
| `title`            | 3.0   | Exact phrase match gets additional 2x boost        |
| `brand`            | 2.0   | Brand name searches are high-intent                |
| `category_path`    | 1.5   | Ancestors included via `path_hierarchy` analyzer   |
| `description`      | 1.0   | Baseline; noisy, lower precision                   |
| `attributes.*`     | 0.5   | Flattened field, broad keyword match only          |

Decay functions applied via `function_score`:
- **Freshness decay**: `gauss` on `created_at`, scale=90d, decay=0.5 — products older than 90 days score at 50% of their relevance weight. Prevents stale catalog items from ranking above newer equivalents.
- **Popularity boost**: `field_value_factor` on `purchase_count_30d`, factor=0.1, modifier=`log1p` — diminishing returns to prevent runaway bestseller dominance.
- **Sponsored boost**: Fixed additive weight of 2.0, applied only to documents with `sponsored: true` and only in `should` context so they never displace strongly-relevant organic results.

See [[search-query-parsing-pattern]] for how these boosts are composed into the final query object at parse time.""")

# ── Deployment Cluster ──

shard("chose-docker-compose-dev", "decisions", "deployment",
    ["deployment", "docker", "dev-environment"],
    "Chose Docker Compose for Local Dev Environment",
    """Chose Docker Compose over bare Docker CLI or local process management for local development because it handles multi-service orchestration declaratively. The `compose.yml` defines the app, Postgres, Redis, and Elasticsearch services so any dev can spin up the full stack with a single `docker compose up`. Volume mounts enable hot reload without rebuilding the image — the app container sees source changes immediately via the mounted `./src` directory. Production uses the same base images and environment variable conventions, so parity is high enough that "works on my machine" failures are rare. See [[docker-compose-reference]] for the full service definitions we settled on. The CI pipeline in [[chose-github-actions-ci]] builds the production image separately from the dev Compose config to keep concerns separated.""")

shard("chose-github-actions-ci", "decisions", "deployment",
    ["deployment", "ci-cd", "github"],
    "Chose GitHub Actions Over CircleCI/Jenkins",
    """Evaluated CircleCI and a self-hosted Jenkins instance before settling on GitHub Actions. The native GitHub integration eliminates the OAuth dance and webhook setup that CircleCI requires, and we avoid the operational burden of maintaining Jenkins infrastructure. Matrix builds let us run the test suite against multiple Node versions in parallel with minimal YAML overhead — the `matrix.node` strategy halved our confidence-check time compared to sequential CircleCI jobs. Layer caching via `actions/cache` on `node_modules` and the Docker build cache cut median build times from ~8 minutes to ~3 minutes. Deployment triggers use `on: push: branches: [main]` with environment protection rules gating the production job behind a required reviewer. See [[github-actions-workflow-reference]] for the reusable workflow patterns we extracted. The production deploy job calls into [[blue-green-deploy-pattern]] to avoid downtime during releases.""")

shard("env-var-leaking-to-client", "gotchas", "deployment",
    ["deployment", "security", "nextjs"],
    "Server-Only Env Vars Leaked to Client Bundle",
    """Next.js inlines `process.env.SOME_VAR` references at build time into the client bundle unless the variable is prefixed with `NEXT_PUBLIC_`. We had `DATABASE_URL` and `STRIPE_SECRET_KEY` referenced in a utility module that was imported by both a Server Component and a client component — Next.js included the string values verbatim in the browser bundle. The fix was to audit every `process.env` access and ensure secret variables are only read inside Server Components, Route Handlers, or server actions, never in modules reachable from the client graph. Tree-shaking does not save you here: Next.js performs build-time inlining before tree-shaking runs, so the secret is embedded even if the code path is never executed at runtime. See [[chose-app-router]] for context on the Server Component vs client component boundary that governs which env vars are accessible where. Also worth checking [[health-check-pattern]] since our health endpoint was incorrectly reading `INTERNAL_API_SECRET` from `process.env` inside a shared module.""")

shard("docker-layer-cache-invalidation", "gotchas", "deployment",
    ["deployment", "docker", "performance"],
    "Dockerfile Layer Ordering Invalidated Cache on Every Build",
    """The original Dockerfile copied the entire source tree before copying `package.json` and running `npm ci`, which meant any source file change invalidated the dependency installation layer. This turned a cache hit that should take seconds into a full `npm ci` on every build, adding 2–4 minutes to CI. The fix is the standard two-step COPY pattern: copy `package.json` and `package-lock.json` first, run `npm ci`, then copy the rest of the source so only dependency changes bust the dependency layer. We also adopted multi-stage builds — a `deps` stage installs production dependencies, a `build` stage compiles TypeScript, and the final stage copies only the compiled output and `node_modules` from the previous stages. A `.dockerignore` file excluding `node_modules`, `.git`, and test fixtures reduced build context size from ~400MB to ~12MB, which alone cut `docker build` invocation time noticeably. See [[docker-compose-reference]] for the current Dockerfile structure and how the dev Compose config overrides the production image entrypoint.""")

shard("blue-green-deploy-pattern", "patterns", "deployment",
    ["deployment", "reliability"],
    "Blue-Green Deployment with Health Check Gating",
    r"""We run two identical production environments (blue and green) behind a load balancer. The inactive environment receives the new release, the health check gate passes, and then traffic shifts atomically — zero-downtime with a one-command rollback path if metrics degrade. The deploy script used in [[chose-github-actions-ci]] looks roughly like this:

```bash
TARGET=$(current_active == "blue" && echo "green" || echo "blue")
deploy_to $TARGET
wait_for_healthy $TARGET   # polls [[health-check-pattern]] endpoint
shift_traffic_to $TARGET
notify_slack "Deployed to $TARGET; previous environment standing by for rollback"
```

Rollback is `shift_traffic_to $PREVIOUS` — no redeployment needed because the old environment is still running. We keep the previous environment live for 30 minutes post-deploy before scaling it down, which covers the window for latent errors that don't show up immediately in health checks. Traffic shifting is done via weighted target group rules in the load balancer; we ramp 10% → 50% → 100% over ~5 minutes for large releases rather than cutting over instantly.""")

shard("health-check-pattern", "patterns", "deployment",
    ["deployment", "monitoring", "reliability"],
    "Liveness and Readiness Probe Pattern for Containerized Services",
    r"""We expose two health endpoints on every service: `/healthz` (liveness) returns 200 if the process is running and not deadlocked, and `/readyz` (readiness) returns 200 only when all dependencies are reachable. The readiness probe is what Kubernetes uses to gate traffic, so it checks Postgres connectivity, the Redis session store, and any upstream APIs the service depends on. A degraded dependency causes `/readyz` to return 503, which pulls the pod from the load balancer rotation without restarting it — the distinction between liveness and readiness probes matters here. The health check also verifies Redis session store connectivity specifically because a cold-started pod with a broken Redis connection would silently drop user sessions rather than refusing traffic.

```typescript
app.get("/readyz", async (req, res) => {
  const [db, redis] = await Promise.allSettled([
    db.raw("SELECT 1"),
    redisClient.ping(),
  ]);
  const ok = [db, redis].every((r) => r.status === "fulfilled");
  res.status(ok ? 200 : 503).json({ db: db.status, redis: redis.status });
});
```

Kubernetes probe config sets `initialDelaySeconds: 10`, `periodSeconds: 5`, `failureThreshold: 3` for readiness and a more lenient `failureThreshold: 6` for liveness to avoid killing pods that are just slow to handle a burst. Local dev uses [[chose-docker-compose-dev]] with a `healthcheck:` block on each service so dependent containers wait for their dependencies before starting.""")

shard("github-actions-workflow-reference", "references", "deployment",
    ["deployment", "ci-cd", "github"],
    "GitHub Actions Reusable Workflow Patterns and Caching",
    """Common patterns extracted into reusable workflows under `.github/workflows/`. Most jobs share the Node setup and cache step via a composite action.

**Node setup with cache:**
```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: "npm"
- run: npm ci
```

**Matrix test job:**
```yaml
strategy:
  matrix:
    node: [18, 20, 22]
steps:
  - uses: actions/setup-node@v4
    with:
      node-version: ${{ matrix.node }}
```

**Docker build with layer cache:**
```yaml
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
    push: ${{ github.ref == 'refs/heads/main' }}
    tags: ghcr.io/org/app:${{ github.sha }}
```

**Environment protection for production deploys:**
```yaml
jobs:
  deploy-prod:
    environment: production
    needs: [test, build]
    if: github.ref == 'refs/heads/main'
```

Secrets are stored in GitHub Actions environment secrets scoped to the `production` environment so they are not accessible from branch builds. The `GITHUB_TOKEN` is granted `packages: write` for pushing to GHCR.""")

shard("docker-compose-reference", "references", "deployment",
    ["deployment", "docker"],
    "Docker Compose Service Definitions and Common Configurations",
    """Reference for the `compose.yml` used in local development. Services mirror production dependencies so that integration tests run against real infrastructure rather than mocks. The app service can fetch data from Elasticsearch using the same client code that runs in production, which catches query DSL issues early.

```yaml
services:
  app:
    build:
      context: .
      target: dev
    volumes:
      - ./src:/app/src
    environment:
      DATABASE_URL: postgres://postgres:postgres@db:5432/app
      REDIS_URL: redis://redis:6379
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "3000:3000"

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5
    volumes:
      - pg_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  elasticsearch:
    image: elasticsearch:8.13.0
    environment:
      discovery.type: single-node
      xpack.security.enabled: "false"
    ports:
      - "9200:9200"

volumes:
  pg_data:
```

Run `docker compose up --build` on first setup. The `target: dev` stage in the Dockerfile mounts source and runs `npm run dev` with hot reload; the production image uses `target: prod` with compiled output only.""")

# ── Write files ──

TYPE_TO_DIR = {
    "decisions": "decisions",
    "gotchas": "gotchas",
    "patterns": "patterns",
    "references": "references",
}

written = 0
for s in SHARDS:
    dir_ = VAULT / TYPE_TO_DIR[s["type"]]
    path = dir_ / f"{s['name']}.md"
    if path.exists():
        print(f"  SKIP (exists): {path.relative_to(VAULT)}")
        continue

    tags_yaml = "\n".join(f"  - {t}" for t in s["tags"])
    frontmatter = f"""---
type: {s['type']}
projects:
  - {s['project']}
tags:
{tags_yaml}
created: 2026-03-01
updated: 2026-03-01
---"""

    content = f"{frontmatter}\n\n# {s['title']}\n\n{s['body'].strip()}\n"
    path.write_text(content)
    written += 1
    print(f"  WROTE: {path.relative_to(VAULT)}")

print(f"\nDone. {written} files written, {len(SHARDS)} total shards defined.")
