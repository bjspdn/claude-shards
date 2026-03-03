"""Generate 64 synthetic vault shards with wikilinks for graph simulation."""

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

# ── Auth System Cluster ──

shard("chose-jwt-over-sessions", "decisions", "auth-system",
    ["auth", "architecture"],
    "Chose JWT Over Server Sessions for Auth",
    """Evaluated JWT tokens vs server-side sessions for authentication. JWT won for our microservices architecture because tokens are self-contained — no shared session store needed between services. The tradeoff is token revocation complexity, which we handle via short-lived access tokens (15min) paired with refresh tokens stored in Redis.

See [[token-refresh-pattern]] for the refresh flow implementation, and [[session-revocation-gotcha]] for the edge case that almost burned us with stale tokens after password changes.""")

shard("token-refresh-pattern", "patterns", "auth-system",
    ["auth", "jwt", "security"],
    "Token Refresh Pattern with Sliding Expiry",
    r"""Access tokens expire after 15 minutes. Refresh tokens are stored server-side in Redis with a 7-day TTL and rotate on every use (old token invalidated, new one issued). This sliding window means active users never see login prompts, while inactive sessions expire naturally.

```typescript
async function refreshAccessToken(refreshToken: string): Promise<TokenPair> {
  const stored = await redis.get(`refresh:${refreshToken}`);
  if (!stored) throw new AuthError("invalid_refresh_token");

  await redis.del(`refresh:${refreshToken}`);
  const newRefresh = generateRefreshToken();
  await redis.set(`refresh:${newRefresh}`, stored, "EX", 604800);

  return {
    accessToken: signJwt({ sub: stored.userId }, "15m"),
    refreshToken: newRefresh,
  };
}
```

This pattern is referenced by [[chose-jwt-over-sessions]] as the core refresh mechanism. See [[password-hashing-gotcha]] for why bcrypt rounds matter when validating during token issuance, and [[auth-middleware-reference]] for how the middleware chain validates tokens on each request.""")

shard("session-revocation-gotcha", "gotchas", "auth-system",
    ["auth", "jwt", "security"],
    "JWT Session Revocation Fails After Password Change",
    """After a user changes their password, existing JWT access tokens remain valid until they expire (up to 15 minutes). This means a compromised account stays accessible even after the user "secures" it by changing their password. We discovered this during a security audit when a test showed a stolen token still worked 10 minutes after a password reset.

The fix: maintain a `tokenInvalidatedAt` timestamp per user in Redis. The [[auth-middleware-reference]] checks this timestamp on every request — if the token was issued before `tokenInvalidatedAt`, reject it. Password changes, account lockouts, and admin "force logout" all update this timestamp. See [[chose-jwt-over-sessions]] for why we accepted this tradeoff and [[rbac-permission-pattern]] for how permission changes interact with cached token claims.""")

shard("oauth2-integration-reference", "references", "auth-system",
    ["auth", "oauth", "api"],
    "OAuth2 Provider Integration Reference",
    """Reference for integrating third-party OAuth2 providers (Google, GitHub, Discord). All providers follow the same authorization code flow but differ in token response shapes and user info endpoints.

| Provider | Auth URL | Token URL | User Info | Scopes |
|----------|----------|-----------|-----------|--------|
| Google | accounts.google.com/o/oauth2/v2/auth | oauth2.googleapis.com/token | /userinfo/v2/me | openid email profile |
| GitHub | github.com/login/oauth/authorize | github.com/login/oauth/access_token | api.github.com/user | read:user user:email |
| Discord | discord.com/oauth2/authorize | discord.com/api/oauth2/token | discord.com/api/users/@me | identify email |

State parameter is a signed JWT containing the redirect URI and a nonce — never use a random string without validation. PKCE (S256) is required for all providers even when using a confidential client, because it prevents authorization code injection attacks. See [[chose-jwt-over-sessions]] for how OAuth tokens are exchanged for our internal JWT pair, and [[two-factor-auth-pattern]] for how 2FA interacts with the OAuth login flow.""")

shard("rbac-permission-pattern", "patterns", "auth-system",
    ["auth", "authorization", "patterns"],
    "Role-Based Access Control Pattern",
    r"""Permissions are stored as a flat set of strings on the user record, derived from roles at assignment time. Roles are templates (admin, editor, viewer) that expand to permission sets. Checking a permission is a simple `Set.has()` lookup — no role hierarchy traversal at runtime.

```typescript
interface User {
  id: string;
  roles: string[];
  permissions: Set<string>;
}

function hasPermission(user: User, permission: string): boolean {
  return user.permissions.has(permission);
}
```

Permission claims are embedded in the JWT access token (see [[chose-jwt-over-sessions]]) so most authorization checks happen without a database query. When roles change, the `tokenInvalidatedAt` flag forces token refresh so new permissions take effect — see [[session-revocation-gotcha]] for the invalidation mechanism. The [[auth-middleware-reference]] enforces permission checks at the route level.""")

shard("password-hashing-gotcha", "gotchas", "auth-system",
    ["auth", "security", "performance"],
    "Bcrypt Cost Factor Causes Login Timeout Under Load",
    """Set bcrypt cost factor to 14 for maximum security during initial development. Under load testing, login requests consistently timed out at 3 seconds. Each bcrypt hash at cost 14 takes ~1.5 seconds on our hardware, and with 50 concurrent login attempts, the event loop was effectively blocked.

Reduced cost factor to 12 (~300ms per hash), which is still well above the minimum recommended value of 10. The key insight: bcrypt is deliberately CPU-intensive, so running it in the main thread blocks the event loop for all other requests. Moved hashing to a worker thread pool to prevent blocking, but even then, the pool size limits concurrency. See [[token-refresh-pattern]] for how the refresh flow avoids repeated password hashing, and [[chose-jwt-over-sessions]] for the overall auth architecture that minimizes how often we need to hash.""")

shard("two-factor-auth-pattern", "patterns", "auth-system",
    ["auth", "2fa", "security"],
    "TOTP Two-Factor Authentication Pattern",
    r"""Two-factor auth uses TOTP (RFC 6238) with 30-second time steps. The shared secret is generated at enrollment time, stored encrypted in the database, and presented to the user as a QR code for scanning with an authenticator app.

```typescript
function verifyTotp(secret: string, token: string): boolean {
  const now = Math.floor(Date.now() / 30000);
  for (const offset of [-1, 0, 1]) {
    const expected = generateTotp(secret, now + offset);
    if (timingSafeEqual(expected, token)) return true;
  }
  return false;
}
```

The [-1, 0, 1] window compensates for clock drift between client and server. Recovery codes (8 single-use codes) are generated alongside the secret and stored as bcrypt hashes. See [[oauth2-integration-reference]] for how 2FA integrates with the OAuth login flow — after OAuth callback, if 2FA is enabled, the user is redirected to the TOTP prompt before the JWT pair from [[chose-jwt-over-sessions]] is issued.""")

shard("auth-middleware-reference", "references", "auth-system",
    ["auth", "middleware", "api"],
    "Auth Middleware Chain Reference",
    """The authentication middleware chain runs on every protected route in this order:

1. **Extract token** — reads `Authorization: Bearer <token>` header or `__session` cookie
2. **Verify JWT** — validates signature, checks `exp` claim, rejects if expired
3. **Check invalidation** — compares `iat` against `tokenInvalidatedAt` in Redis (see [[session-revocation-gotcha]])
4. **Load permissions** — reads permission set from token claims (see [[rbac-permission-pattern]])
5. **Route guard** — checks required permissions against loaded set

If step 2 fails with an expired token, the middleware returns 401 with a `token_expired` error code — the client SDK intercepts this and triggers the [[token-refresh-pattern]] flow automatically.

Rate limiting is applied after step 1 to prevent brute-force attacks on stolen refresh tokens. Failed auth attempts are logged with client IP for audit trail. See [[chose-jwt-over-sessions]] for the architectural context.""")

# ── CI/CD Pipeline Cluster ──

shard("chose-github-actions", "decisions", "cicd-pipeline",
    ["cicd", "github", "automation"],
    "Chose GitHub Actions for CI/CD",
    """Evaluated GitHub Actions, CircleCI, and GitLab CI. GitHub Actions won because of native repository integration — no external webhook configuration, status checks are first-class, and reusable workflows reduce YAML duplication across repos.

Matrix builds let us test against Node 18/20/22 in parallel. The built-in `GITHUB_TOKEN` handles artifact pushing to GHCR without managing separate credentials. See [[docker-layer-caching-pattern]] for how we cut build times by 60%, and [[deploy-rollback-gotcha]] for what went wrong with our first automated deployment.""")

shard("docker-layer-caching-pattern", "patterns", "cicd-pipeline",
    ["cicd", "docker", "performance"],
    "Docker Multi-Stage Build with Layer Caching",
    r"""Dockerfile uses multi-stage builds to separate dependency installation from source compilation. This ensures that changing a source file doesn't invalidate the `npm ci` layer.

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]
```

CI uses `docker/build-push-action` with GitHub Actions cache (`cache-from: type=gha`). Cache hit rate went from ~30% to ~85% after this change. See [[chose-github-actions]] for the CI setup, and [[k8s-manifests-reference]] for how the built image is deployed.""")

shard("deploy-rollback-gotcha", "gotchas", "cicd-pipeline",
    ["cicd", "deployment", "reliability"],
    "Automated Deploy Rolled Back to Wrong Version",
    """Our rollback script used `git revert HEAD` to undo a bad deploy, but the deployment pipeline triggered on any push to `main` — including the revert commit. This created an infinite loop: deploy → bad → revert → deploy revert → bad (because the revert was also a code change that triggered CI).

The fix: rollback deploys a specific image tag from the container registry rather than reverting git commits. The deploy workflow now takes an explicit `image_tag` input parameter for manual rollbacks. See [[chose-github-actions]] for the workflow structure and [[artifact-caching-pattern]] for how we tag and store images.""")

shard("k8s-manifests-reference", "references", "cicd-pipeline",
    ["cicd", "kubernetes", "infrastructure"],
    "Kubernetes Deployment Manifests Reference",
    """Standard deployment manifest pattern used across all services. Key settings: rolling update strategy with `maxSurge: 1` and `maxUnavailable: 0` for zero-downtime deploys.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    spec:
      containers:
      - name: api
        image: ghcr.io/org/api:latest
        resources:
          requests:
            cpu: 250m
            memory: 512Mi
          limits:
            cpu: "1"
            memory: 1Gi
        livenessProbe:
          httpGet:
            path: /healthz
            port: 3000
        readinessProbe:
          httpGet:
            path: /readyz
            port: 3000
```

The image tag is replaced by the CI pipeline from [[chose-github-actions]] at deploy time. See [[pipeline-monitoring-reference]] for how deploy status is tracked.""")

shard("environment-secrets-pattern", "patterns", "cicd-pipeline",
    ["cicd", "security", "configuration"],
    "Environment Secret Management Pattern",
    r"""Secrets are scoped to deployment environments (staging, production) in GitHub Actions. Each environment has its own set of secrets that are only accessible from workflows running against that environment.

```yaml
jobs:
  deploy:
    environment: production
    steps:
      - run: echo "API_KEY=${{ secrets.API_KEY }}" >> .env
```

Local development uses `.env.local` (gitignored) populated from a team-shared 1Password vault via the `op` CLI. Never hardcode secrets or commit `.env` files. See [[chose-github-actions]] for the workflow-level environment configuration and [[flaky-test-gotcha]] for a case where missing test secrets caused intermittent failures.""")

shard("flaky-test-gotcha", "gotchas", "cicd-pipeline",
    ["cicd", "testing", "reliability"],
    "Flaky Tests Due to Missing Environment Secrets in CI",
    """Integration tests that hit external APIs (Stripe test mode, Resend sandbox) started failing intermittently in CI. The root cause: environment secrets were scoped to the `production` environment but tests ran in the default environment which had no secrets. Tests would pass when a developer had local `.env` values but fail in CI with cryptic `undefined` errors.

Fix: created a `testing` environment with sandbox API keys. Tests that require external services are tagged and only run in CI jobs that specify `environment: testing`. See [[environment-secrets-pattern]] for the secret scoping strategy and [[chose-github-actions]] for how environments are configured in workflows.""")

shard("artifact-caching-pattern", "patterns", "cicd-pipeline",
    ["cicd", "docker", "performance"],
    "Artifact Caching and Tagging Strategy",
    r"""Every build produces a tagged Docker image pushed to GHCR. Tags follow the pattern: `sha-<commit>` for every build, `latest` for main branch, and `v<semver>` for releases.

```bash
IMAGE="ghcr.io/org/app"
SHA_TAG="sha-$(git rev-parse --short HEAD)"
docker tag $IMAGE:build $IMAGE:$SHA_TAG
docker push $IMAGE:$SHA_TAG
if [ "$BRANCH" = "main" ]; then
  docker tag $IMAGE:build $IMAGE:latest
  docker push $IMAGE:latest
fi
```

Rollbacks reference the SHA tag directly rather than rebuilding. The [[deploy-rollback-gotcha]] taught us never to rollback via git — always deploy a known-good image tag. See [[docker-layer-caching-pattern]] for the build-side caching that makes image creation fast.""")

shard("pipeline-monitoring-reference", "references", "cicd-pipeline",
    ["cicd", "monitoring", "observability"],
    "CI/CD Pipeline Monitoring Reference",
    """Key metrics tracked for pipeline health and reliability.

| Metric | Target | Alert Threshold | Source |
|--------|--------|-----------------|--------|
| Build duration | <5min | >10min | GitHub Actions timing |
| Test pass rate | >99% | <95% for 3 consecutive runs | Test reporter |
| Deploy frequency | Daily | <1/week | Deploy event webhook |
| Rollback rate | <5% | >10% of deploys | Deploy event + rollback counter |
| Cache hit rate | >80% | <50% | Docker build logs |

Slack notifications fire on: build failure, deploy success/failure, rollback triggered. PagerDuty alerts on: >3 consecutive failures on main, deploy stuck in pending >15min. See [[chose-github-actions]] for the notification workflow steps and [[artifact-caching-pattern]] for cache metrics collection.""")

# ── Database Scaling Cluster ──

shard("chose-postgres-over-mysql", "decisions", "database-scaling",
    ["database", "architecture", "postgres"],
    "Chose PostgreSQL Over MySQL for Primary Database",
    """Evaluated PostgreSQL and MySQL for the primary OLTP database. PostgreSQL won on: JSONB support for semi-structured product attributes, window functions for analytics queries, and the ecosystem of extensions (pg_trgm for fuzzy search, PostGIS if we ever need geo). MySQL's replication setup is simpler, but Postgres logical replication covers our CDC needs for [[read-replica-pattern]].

The rich type system (enums, arrays, composite types) reduces the impedance mismatch between TypeScript types and database columns. See [[connection-pooling-pattern]] for how we manage connections at scale, and [[sharding-decision]] for the scaling path we're planning.""")

shard("connection-pooling-pattern", "patterns", "database-scaling",
    ["database", "postgres", "performance"],
    "PgBouncer Connection Pooling Pattern",
    r"""PostgreSQL's default connection model (one process per connection) limits concurrent connections to ~100-200 before memory pressure becomes problematic. PgBouncer sits between the app and Postgres, multiplexing application connections onto a smaller pool of database connections.

```yaml
# pgbouncer.ini
[databases]
app = host=postgres port=5432 dbname=app
[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
```

Transaction-level pooling is critical: connections are returned to the pool after each transaction, not after each client disconnects. This means `SET` commands and prepared statements don't persist across transactions — see [[n-plus-one-query-gotcha]] for a case where this caused unexpected behavior with ORMs. See [[chose-postgres-over-mysql]] for why Postgres, and [[query-planner-reference]] for optimizing queries that run through the pool.""")

shard("n-plus-one-query-gotcha", "gotchas", "database-scaling",
    ["database", "orm", "performance"],
    "ORM N+1 Query Kills Response Time Under PgBouncer",
    """Prisma's eager loading (`include`) generates multiple queries per relationship. With PgBouncer in transaction pooling mode, each query in the N+1 pattern gets a potentially different connection, losing any prepared statement benefits. A page listing 50 orders with items generated 51 queries, each acquiring and releasing a connection from the pool.

The fix: use Prisma's `relationLoadStrategy: "join"` to force a single SQL query with JOINs instead of separate queries. For complex aggregations, drop to raw SQL with `$queryRaw`. Monitor query count per request using the Prisma query event logger. See [[connection-pooling-pattern]] for the PgBouncer setup that amplifies this problem, and [[index-optimization-reference]] for ensuring the JOINs are properly indexed.""")

shard("index-optimization-reference", "references", "database-scaling",
    ["database", "postgres", "performance"],
    "PostgreSQL Index Optimization Reference",
    """Index types and when to use each. Default B-tree covers 90% of cases. Check `pg_stat_user_indexes` for unused indexes and `pg_stat_user_tables` for sequential scans on large tables.

| Index Type | Use Case | Example |
|-----------|----------|---------|
| B-tree | Equality, range, sorting | `CREATE INDEX ON orders(created_at)` |
| GIN | JSONB, arrays, full-text | `CREATE INDEX ON products USING gin(attributes)` |
| GiST | Range types, geometric | `CREATE INDEX ON events USING gist(during)` |
| Hash | Equality only (rare) | `CREATE INDEX ON sessions USING hash(token)` |
| Partial | Conditional filtering | `CREATE INDEX ON orders(status) WHERE status = 'pending'` |

Composite indexes: column order matters. Put equality conditions first, range conditions last. A composite `(user_id, created_at)` supports queries on `user_id` alone but not `created_at` alone. See [[n-plus-one-query-gotcha]] for JOIN performance, and [[query-planner-reference]] for reading EXPLAIN output.""")

shard("read-replica-pattern", "patterns", "database-scaling",
    ["database", "postgres", "scaling"],
    "Read Replica Pattern with Automatic Routing",
    r"""Heavy read queries (dashboards, reports, search reindexing) are routed to a read replica to keep the primary available for writes. The application layer uses a connection router that directs queries based on context.

```typescript
function getConnection(ctx: RequestContext): PrismaClient {
  if (ctx.isReadOnly || ctx.isAnalytics) return replicaClient;
  return primaryClient;
}
```

Replication lag (typically <100ms) means reads from the replica may be slightly stale. For read-after-write consistency, mutations return the updated data directly rather than re-querying. See [[chose-postgres-over-mysql]] for the logical replication setup, and [[migration-rollback-gotcha]] for how schema migrations interact with replica lag.""")

shard("migration-rollback-gotcha", "gotchas", "database-scaling",
    ["database", "migrations", "reliability"],
    "Schema Migration Broke Read Replica During Rollback",
    """Ran a migration that added a NOT NULL column with a default value. The migration succeeded on the primary, but during rollback (dropping the column), the read replica received the DROP COLUMN via replication while the application was still running code that referenced the new column. Result: 500 errors on all read replica queries for ~2 minutes.

The fix: migrations must be backward-compatible. Instead of adding a NOT NULL column, add it as nullable, deploy code that handles both states, backfill data, then alter to NOT NULL in a subsequent migration. See [[read-replica-pattern]] for the replica routing that exposed this issue, and [[chose-postgres-over-mysql]] for replication configuration.""")

shard("query-planner-reference", "references", "database-scaling",
    ["database", "postgres", "debugging"],
    "PostgreSQL Query Planner and EXPLAIN Output Reference",
    """Reading `EXPLAIN (ANALYZE, BUFFERS)` output to diagnose slow queries.

Key fields:
- **Seq Scan**: full table scan — check if an index would help
- **Index Scan**: good, using an index
- **Bitmap Heap Scan**: index scan + heap fetch — common for multi-condition queries
- **Nested Loop**: fine for small inner tables, problematic for large ones
- **Hash Join**: good for equi-joins on large tables
- **Sort**: check if an index could eliminate the sort

Red flags:
- `rows=1` estimate but `actual rows=50000` → stale statistics, run `ANALYZE`
- `Buffers: shared read=X` with large X → data not in cache, consider reducing working set
- Sequential scan on table with millions of rows → missing index

See [[index-optimization-reference]] for index types, and [[connection-pooling-pattern]] for how PgBouncer affects prepared statements used by the planner.""")

shard("chose-sharding-strategy", "decisions", "database-scaling",
    ["database", "scaling", "architecture"],
    "Chose Tenant-Based Sharding Strategy",
    """When single-node Postgres hits write throughput limits, the scaling path is horizontal sharding by tenant ID. Evaluated hash-based sharding (even distribution) vs range-based (easy splits) vs tenant-based (data isolation). Tenant-based won because: each shard contains all data for a set of tenants, making cross-table JOINs within a tenant fast, and tenant isolation simplifies GDPR data deletion requests.

Citus extension for Postgres handles the distributed query routing transparently. The application doesn't need to know which shard a tenant lives on. See [[chose-postgres-over-mysql]] for why Postgres was chosen (Citus compatibility was a factor), and [[connection-pooling-pattern]] for how PgBouncer fronts each shard independently.""")

# ── Frontend State Cluster ──

shard("chose-zustand-over-redux", "decisions", "frontend-state",
    ["frontend", "state-management", "react"],
    "Chose Zustand Over Redux for Client State",
    """Evaluated Redux Toolkit and Zustand for client-side state management. Zustand won on simplicity: no actions/reducers/dispatching ceremony, no Provider wrapper needed, and the store is a plain function that returns an object. The API surface is tiny — `create()` and `useStore()` — which means less code to maintain and fewer patterns to enforce.

Redux's middleware ecosystem (thunks, sagas) wasn't needed because our data fetching happens in Server Components (see [[server-component-data-pattern]]). Client state is limited to UI concerns: form state, modal visibility, optimistic updates. See [[form-validation-pattern]] for how Zustand manages form state, and [[hydration-mismatch-gotcha]] for the server/client state sync issue we hit.""")

shard("form-validation-pattern", "patterns", "frontend-state",
    ["frontend", "forms", "validation"],
    "Form Validation Pattern with Zod and Zustand",
    r"""Forms use Zod schemas for validation (shared between client and server) with Zustand for state management. The form store holds field values, touched state, and derived errors.

```typescript
const useFormStore = create<FormState>((set, get) => ({
  values: { email: "", password: "" },
  touched: {},
  setField: (name, value) =>
    set((s) => ({ values: { ...s.values, [name]: value }, touched: { ...s.touched, [name]: true } })),
  get errors() {
    const result = LoginSchema.safeParse(get().values);
    return result.success ? {} : result.error.flatten().fieldErrors;
  },
}));
```

Errors are computed on read (not stored), so they're always consistent with current values. Only show errors for touched fields to avoid overwhelming the user on first render. See [[chose-zustand-over-redux]] for why Zustand, and [[optimistic-updates-pattern]] for how form submissions use optimistic state.""")

shard("hydration-mismatch-gotcha", "gotchas", "frontend-state",
    ["frontend", "nextjs", "ssr"],
    "Hydration Mismatch From Zustand Store Initialization",
    """Zustand stores initialized with browser-dependent values (localStorage, window.matchMedia) cause React hydration mismatches because the server renders with different initial values than the client. The error message is cryptic: "Text content does not match server-rendered HTML."

The fix: initialize stores with safe defaults that match server rendering, then hydrate from browser APIs in a `useEffect` after mount. Alternatively, use `useSyncExternalStore` with a `getServerSnapshot` that returns the server-safe default. See [[chose-zustand-over-redux]] for the state management architecture, and [[stale-closure-gotcha]] for a related issue with stale values in event handlers.""")

shard("react-hooks-reference", "references", "frontend-state",
    ["frontend", "react", "api"],
    "React Hooks Usage Reference",
    """Quick reference for hooks used in the codebase and when to reach for each.

| Hook | Use For | Don't Use For |
|------|---------|---------------|
| useState | Simple local UI state | Derived state (compute inline) |
| useRef | DOM refs, mutable values that don't trigger re-render | State that should trigger re-render |
| useMemo | Expensive computations from existing state | Everything (premature optimization) |
| useCallback | Stable function refs for child memo optimization | Functions that don't cause re-render issues |
| useEffect | Sync with external systems (DOM, timers, subscriptions) | Data fetching (use Server Components), derived state |
| useSyncExternalStore | Subscribe to Zustand, browser APIs | One-time reads |

See [[chose-zustand-over-redux]] for the store pattern, and [[stale-closure-gotcha]] for a common pitfall with useCallback.""")

shard("optimistic-updates-pattern", "patterns", "frontend-state",
    ["frontend", "ux", "state-management"],
    "Optimistic Update Pattern for Mutations",
    r"""UI updates immediately on user action, then reconciles with the server response. If the server rejects the mutation, the optimistic state is rolled back and an error is shown.

```typescript
async function toggleFavorite(itemId: string) {
  const prev = useStore.getState().favorites;
  useStore.setState({ favorites: toggle(prev, itemId) });
  try {
    await api.post(`/favorites/${itemId}`);
  } catch {
    useStore.setState({ favorites: prev });
    toast.error("Failed to update favorites");
  }
}
```

The rollback pattern captures previous state before mutation. For list operations (add/remove/reorder), keep the rollback state as a snapshot of the full list rather than trying to reverse the operation. See [[chose-zustand-over-redux]] for the store setup, and [[form-validation-pattern]] for how form submissions use this pattern.""")

shard("stale-closure-gotcha", "gotchas", "frontend-state",
    ["frontend", "react", "javascript"],
    "Stale Closure Captures Outdated State in Event Handler",
    """Event handlers defined inside a component capture the state values from their render cycle. If state updates between renders, the handler still sees the old value. This bit us with a debounced search handler that always sent the query from 2 keystrokes ago.

```typescript
// Bug: query is stale inside the debounced function
const handleSearch = useCallback(
  debounce(() => search(query), 300), // query is captured at callback creation time
  [] // empty deps means query never updates
);
```

Fix: use a ref to hold the current value, or include the dependency in the useCallback deps array (which recreates the debounced function). For Zustand, call `useStore.getState()` inside the handler instead of using the hook value. See [[react-hooks-reference]] for correct hook usage, and [[hydration-mismatch-gotcha]] for a related initialization timing issue.""")

shard("server-component-data-pattern", "patterns", "frontend-state",
    ["frontend", "nextjs", "data-fetching"],
    "Server Component Data Fetching Pattern",
    r"""Data fetching happens in async Server Components via direct database/API calls — no useEffect, no client-side loading states for initial data. Client components receive data as props from their Server Component parents.

```typescript
// app/dashboard/page.tsx (Server Component)
export default async function DashboardPage() {
  const metrics = await db.query.metrics.findMany();
  return <DashboardClient metrics={metrics} />;
}

// components/DashboardClient.tsx ('use client')
export function DashboardClient({ metrics }: Props) {
  // Only manages UI interactions, not data fetching
  const [selected, setSelected] = useState(metrics[0]?.id);
  return <Chart data={metrics} selected={selected} onSelect={setSelected} />;
}
```

This eliminates loading spinners for initial page load and reduces client bundle size. See [[chose-zustand-over-redux]] for why client state is minimal, and [[hydration-mismatch-gotcha]] for the server/client boundary pitfall.""")

shard("bundle-size-reference", "references", "frontend-state",
    ["frontend", "performance", "nextjs"],
    "Bundle Size Budget and Analysis Reference",
    """Bundle size budgets enforced in CI. Exceeding the budget fails the build.

| Chunk | Budget | Current | Notes |
|-------|--------|---------|-------|
| First Load JS | 85kB | 72kB | Shared runtime + framework |
| Per-route max | 50kB | 38kB (dashboard) | Largest route chunk |
| Total client JS | 200kB | 168kB | All routes combined |

Analysis tools:
- `next build` outputs route-by-route sizes
- `@next/bundle-analyzer` generates treemap visualization
- `source-map-explorer` for dependency-level breakdown

Common size wins: dynamic imports for heavy components (charts, editors), replacing moment.js with date-fns tree-shaking, using server components to keep data-heavy code off the client. See [[server-component-data-pattern]] for the server/client split strategy, and [[chose-zustand-over-redux]] for why Zustand's 1kB footprint beat Redux's 11kB.""")

# ── API Design Cluster ──

shard("chose-rest-over-graphql", "decisions", "api-design",
    ["api", "architecture", "rest"],
    "Chose REST Over GraphQL for Public API",
    """Evaluated REST and GraphQL for the public-facing API. REST won because: our clients are mostly server-to-server integrations that benefit from cache-friendly GET endpoints, the data model is resource-oriented with predictable access patterns, and we didn't want to maintain a schema stitching layer for what amounts to straightforward CRUD.

GraphQL's flexibility is a liability for our use case — we'd spend more time on query complexity analysis and depth limiting than we'd save on endpoint design. See [[rate-limiting-pattern]] for how we throttle API usage, and [[openapi-spec-reference]] for the auto-generated documentation.""")

shard("rate-limiting-pattern", "patterns", "api-design",
    ["api", "security", "performance"],
    "Token Bucket Rate Limiting Pattern",
    r"""API rate limiting uses a token bucket algorithm backed by Redis. Each API key gets a bucket with a fixed capacity and refill rate. Requests consume tokens; when the bucket is empty, requests get 429 responses.

```typescript
async function checkRateLimit(apiKey: string): Promise<boolean> {
  const key = `ratelimit:${apiKey}`;
  const [tokens, lastRefill] = await redis.hmget(key, "tokens", "lastRefill");
  const elapsed = Date.now() - Number(lastRefill);
  const refilled = Math.min(BUCKET_CAPACITY, Number(tokens) + elapsed * REFILL_RATE);
  if (refilled < 1) return false;
  await redis.hmset(key, { tokens: refilled - 1, lastRefill: Date.now() });
  return true;
}
```

Response headers include `X-RateLimit-Remaining`, `X-RateLimit-Limit`, and `Retry-After` per RFC 6585. See [[chose-rest-over-graphql]] for the API architecture, and [[cors-misconfiguration-gotcha]] for a related header issue.""")

shard("cors-misconfiguration-gotcha", "gotchas", "api-design",
    ["api", "security", "cors"],
    "CORS Wildcard Origin Allowed Credential Requests",
    """Set `Access-Control-Allow-Origin: *` during development and forgot to restrict it before launch. This alone isn't a security issue, but when combined with `Access-Control-Allow-Credentials: true`, browsers reject the response entirely — you cannot use wildcard origin with credentials. The symptom was "CORS error" in the browser console with no request visible in the network tab.

The fix: explicitly list allowed origins from an environment variable, validate the `Origin` header against the whitelist, and reflect it back in the response. Never use `*` with credentials. See [[chose-rest-over-graphql]] for the API architecture, and [[error-response-pattern]] for how CORS errors are formatted.""")

shard("openapi-spec-reference", "references", "api-design",
    ["api", "documentation", "openapi"],
    "OpenAPI Specification and Code Generation Reference",
    """API documentation is auto-generated from Zod schemas using `zod-to-openapi`. The OpenAPI spec is served at `/api/docs` via Swagger UI.

Key conventions:
- Every endpoint has a Zod request schema and response schema
- Schemas are registered with `registry.register()` for reuse
- Error responses use the standard shape from [[error-response-pattern]]
- Authentication is documented as `bearerAuth` security scheme
- Pagination parameters follow [[pagination-pattern]] conventions

Generation: `pnpm generate:openapi` outputs `openapi.json`. This file is committed and diffed in PRs to catch breaking API changes. See [[chose-rest-over-graphql]] for the design philosophy, and [[versioning-gotcha]] for API versioning issues.""")

shard("pagination-pattern", "patterns", "api-design",
    ["api", "performance", "ux"],
    "Cursor-Based Pagination Pattern",
    r"""All list endpoints use cursor-based pagination instead of offset-based. Cursor pagination is stable under concurrent inserts/deletes and performs consistently regardless of page depth (no `OFFSET N` scans).

```typescript
interface PaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  hasMore: boolean;
}

async function paginate<T>(query: Query, cursor?: string, limit = 20) {
  const where = cursor ? { id: { gt: decodeCursor(cursor) } } : {};
  const items = await query.findMany({ where, take: limit + 1, orderBy: { id: "asc" } });
  const hasMore = items.length > limit;
  return { data: items.slice(0, limit), cursor: hasMore ? encodeCursor(items[limit - 1].id) : null, hasMore };
}
```

Cursors are opaque base64-encoded strings containing the sort field value. See [[chose-rest-over-graphql]] for the API design decisions, and [[openapi-spec-reference]] for how pagination params are documented.""")

shard("versioning-gotcha", "gotchas", "api-design",
    ["api", "versioning", "breaking-changes"],
    "API Version Header Ignored by Client SDK Cache",
    """Introduced API versioning via `Accept-Version` header. The server correctly routed v1 and v2 responses, but the client SDK cached responses keyed by URL only — not by version header. This meant a client switching from v1 to v2 could receive a cached v1 response, causing type errors.

The fix: include the API version in the URL path (`/api/v2/users`) rather than in a header. URL-based versioning plays nicely with HTTP caches, CDNs, and client-side caching libraries that key on the full URL. See [[chose-rest-over-graphql]] for the versioning decision, and [[rate-limiting-pattern]] for how rate limits are scoped per API version.""")

shard("error-response-pattern", "patterns", "api-design",
    ["api", "error-handling", "dx"],
    "Standardized API Error Response Pattern",
    r"""All API errors follow a consistent JSON structure regardless of the error source. This makes client-side error handling predictable.

```typescript
interface ApiError {
  error: {
    code: string;        // machine-readable: "validation_error", "not_found", "rate_limited"
    message: string;     // human-readable description
    details?: unknown;   // optional: field errors, retry info, etc.
  };
}

// Usage in error handler middleware:
function handleError(err: unknown, res: Response) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: { code: "validation_error", message: err.message, details: err.fieldErrors } });
  }
  return res.status(500).json({ error: { code: "internal_error", message: "An unexpected error occurred" } });
}
```

Error codes are documented in the [[openapi-spec-reference]]. Client SDKs switch on `error.code` rather than HTTP status for granular handling. See [[cors-misconfiguration-gotcha]] for how CORS errors bypass this pattern entirely.""")

shard("webhook-design-reference", "references", "api-design",
    ["api", "webhooks", "architecture"],
    "Webhook Delivery and Retry Reference",
    """Outbound webhook delivery follows the same reliability patterns we learned from consuming Stripe webhooks. Each webhook event is persisted before delivery, and failed deliveries are retried with exponential backoff.

| Attempt | Delay | Timeout |
|---------|-------|---------|
| 1 | Immediate | 10s |
| 2 | 1 min | 10s |
| 3 | 10 min | 10s |
| 4 | 1 hour | 10s |
| 5 | 6 hours | 10s |

After 5 failures, the endpoint is marked as failing and the customer is notified via email. Endpoints returning 410 Gone are automatically unsubscribed.

Payload signature: HMAC-SHA256 over `timestamp.body` with the endpoint's signing secret, sent in `X-Webhook-Signature` header. This is the same scheme Stripe uses. See [[chose-rest-over-graphql]] for the API architecture, and [[rate-limiting-pattern]] for how webhook delivery respects rate limits.""")

# ── Observability Cluster ──

shard("chose-structured-logging", "decisions", "observability",
    ["observability", "logging", "architecture"],
    "Chose Structured JSON Logging Over Plain Text",
    """Switched from `console.log` with string templates to structured JSON logging via Pino. JSON logs are machine-parseable, which makes log aggregation, filtering, and alerting dramatically easier. Searching for `{"userId":"abc","action":"payment"}` in a structured log is a simple JSON query; extracting the same data from `User abc made payment at 2024-01-15` requires fragile regex patterns.

Pino was chosen over Winston for its lower overhead — it serializes to JSON faster because it avoids creating intermediate objects. See [[distributed-tracing-pattern]] for how trace IDs flow through logs, and [[log-aggregation-pattern]] for the ELK stack that ingests them.""")

shard("distributed-tracing-pattern", "patterns", "observability",
    ["observability", "tracing", "microservices"],
    "Distributed Tracing with OpenTelemetry",
    r"""Every incoming request gets a trace ID (generated or propagated from `traceparent` header). The trace ID is attached to all log entries, database queries, and outbound HTTP calls within that request's lifecycle.

```typescript
import { trace, context } from "@opentelemetry/api";

function handleRequest(req: Request) {
  const span = trace.getTracer("api").startSpan("handleRequest");
  const ctx = trace.setSpan(context.active(), span);
  return context.with(ctx, async () => {
    logger.info({ traceId: span.spanContext().traceId }, "request started");
    const result = await processRequest(req);
    span.end();
    return result;
  });
}
```

Traces are exported to Jaeger via OTLP. The [[chose-structured-logging]] decision ensures trace IDs appear in every log line. See [[prometheus-metrics-reference]] for how trace-derived metrics feed into dashboards, and [[alert-fatigue-gotcha]] for a case where tracing noise overwhelmed alerting.""")

shard("alert-fatigue-gotcha", "gotchas", "observability",
    ["observability", "alerting", "reliability"],
    "Alert Fatigue Caused Critical Alert to Be Ignored",
    """Set up PagerDuty alerts for: error rate >1%, latency p99 >2s, CPU >80%, memory >85%, disk >90%, and queue depth >100. Within a week, the team was receiving 50+ alerts per day — most were brief CPU spikes during deployments or transient latency bumps from database maintenance windows.

When a genuine database outage occurred, the on-call engineer had already silenced their phone. The critical alert was buried in 12 other active incidents.

Fix: dramatically reduce alert count by raising thresholds to actionable levels, adding duration requirements (sustained >5min, not instantaneous), and tiering alerts into critical (pages) vs warning (Slack). See [[slo-definition-pattern]] for how SLOs now drive alerting thresholds, and [[metric-cardinality-gotcha]] for another monitoring anti-pattern.""")

shard("prometheus-metrics-reference", "references", "observability",
    ["observability", "prometheus", "metrics"],
    "Prometheus Metrics and PromQL Reference",
    """Standard metrics exposed by all services, scraped by Prometheus at 15-second intervals.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| http_requests_total | Counter | method, path, status | Total HTTP requests |
| http_request_duration_seconds | Histogram | method, path | Request latency distribution |
| db_query_duration_seconds | Histogram | query_type | Database query latency |
| queue_depth | Gauge | queue_name | Current items in queue |
| active_connections | Gauge | service | WebSocket/DB connections |

Common PromQL patterns:
- Error rate: `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])`
- P99 latency: `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))`
- Request rate: `sum(rate(http_requests_total[5m])) by (path)`

See [[chose-structured-logging]] for how log-derived metrics complement Prometheus, and [[grafana-dashboard-reference]] for visualization.""")

shard("log-aggregation-pattern", "patterns", "observability",
    ["observability", "logging", "infrastructure"],
    "Log Aggregation Pattern with ELK Stack",
    """Logs flow: Application (Pino JSON) → Filebeat (ships to Logstash) → Logstash (parses, enriches, routes) → Elasticsearch (stores) → Kibana (queries, dashboards).

Key Logstash filters:
- Parse JSON body from Pino output
- Extract trace ID from `traceId` field (see [[distributed-tracing-pattern]])
- GeoIP lookup on client IP for geographic distribution dashboards
- Drop health check logs (`path: "/healthz"`) to reduce noise

Retention: 30 days for info, 90 days for warn/error, 1 year for audit events. Index lifecycle management (ILM) handles rotation and deletion automatically. See [[chose-structured-logging]] for the logging format, and [[metric-cardinality-gotcha]] for why we limit label values in log-derived metrics.""")

shard("metric-cardinality-gotcha", "gotchas", "observability",
    ["observability", "prometheus", "performance"],
    "High Cardinality Labels Caused Prometheus OOM",
    """Added `userId` as a label on the `http_requests_total` metric to track per-user request rates. With 100K active users, this created 100K time series per endpoint per method — about 50M total series. Prometheus OOM'd within hours.

The rule: never use unbounded values (user IDs, request IDs, email addresses) as metric labels. Labels should have low, bounded cardinality (<100 unique values). For per-user metrics, log the data and query it from the log aggregation layer (see [[log-aggregation-pattern]]) rather than exposing it as a Prometheus metric. See [[prometheus-metrics-reference]] for the correct label schema, and [[alert-fatigue-gotcha]] for how this OOM triggered a cascade of false alerts.""")

shard("slo-definition-pattern", "patterns", "observability",
    ["observability", "sre", "reliability"],
    "SLO Definition and Error Budget Pattern",
    """Service Level Objectives define the reliability targets that drive alerting and prioritization decisions. Each SLO has a target, a measurement window, and an error budget.

| SLO | Target | Window | Error Budget |
|-----|--------|--------|-------------|
| Availability | 99.9% | 30 days | 43 minutes downtime |
| Latency (p99) | <500ms | 30 days | 0.1% of requests >500ms |
| Error rate | <0.1% | 30 days | 0.1% of requests return 5xx |

Error budget consumed = (actual errors / total requests) / (1 - SLO target). When budget is >80% consumed, freeze feature work and focus on reliability. When budget is exhausted, halt deploys until the window resets.

Alerting is derived from SLOs: alert when error budget burn rate exceeds 14.4x (will exhaust budget in 1 hour) for page-level urgency, or 6x (will exhaust in 6 hours) for ticket-level. See [[alert-fatigue-gotcha]] for why SLO-based alerting replaced threshold-based alerts, and [[prometheus-metrics-reference]] for the metrics that feed SLO calculations.""")

shard("grafana-dashboard-reference", "references", "observability",
    ["observability", "grafana", "visualization"],
    "Grafana Dashboard Layout and Query Reference",
    """Standard dashboard layout used across all services. Each service gets three dashboards: Overview (golden signals), Deep Dive (per-endpoint), and Infrastructure (CPU/memory/disk).

Overview dashboard panels:
1. **Request rate** — `sum(rate(http_requests_total[5m]))` stacked by status code
2. **Error rate** — `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])` with SLO target line
3. **Latency heatmap** — `http_request_duration_seconds_bucket` histogram
4. **Active connections** — `active_connections` gauge
5. **Error budget remaining** — custom panel from [[slo-definition-pattern]] calculation

Variables: `$service` (dropdown), `$environment` (staging/production), `$timerange`.

Annotations: deploy events from GitHub webhook, PagerDuty incidents, maintenance windows. These overlay on all panels so latency spikes can be correlated with deploys. See [[prometheus-metrics-reference]] for the underlying metrics, and [[chose-structured-logging]] for log-based panels.""")

# ── Search/NLP Cluster ──

shard("chose-fulltext-over-vector", "decisions", "search-nlp",
    ["search", "nlp", "architecture"],
    "Chose Full-Text Search Over Vector Search as Primary",
    """Evaluated full-text search (Elasticsearch BM25) vs vector search (embeddings + cosine similarity) for the primary search path. Full-text won as the primary because: exact keyword matches are critical for our use case (product names, SKUs, brand names), BM25 ranking is well-understood and debuggable, and the operational overhead of an embedding pipeline (model hosting, batch re-embedding on content changes) was premature.

Vector search is valuable for semantic queries ("comfortable running shoes" matching "lightweight jogging sneakers") but we're adding it as a secondary signal rather than replacing BM25. See [[hybrid-retrieval-pattern]] for how we combine both, and [[embedding-model-pattern]] for the vector pipeline.""")

shard("embedding-model-pattern", "patterns", "search-nlp",
    ["search", "ml", "embeddings"],
    "Embedding Model Selection and Pipeline Pattern",
    r"""Text embeddings are generated using OpenAI's `text-embedding-3-small` (1536 dimensions) for cost efficiency, with a batch pipeline that processes new/updated documents nightly.

```typescript
async function embedDocuments(docs: Document[]): Promise<void> {
  const batches = chunk(docs, 100);
  for (const batch of batches) {
    const texts = batch.map((d) => `${d.title} ${d.description}`);
    const embeddings = await openai.embeddings.create({ input: texts, model: "text-embedding-3-small" });
    await vectorStore.upsert(batch.map((d, i) => ({ id: d.id, vector: embeddings.data[i].embedding, metadata: d })));
  }
}
```

The embedding input is `title + description` — not the full document, because long inputs dilute the semantic signal. See [[chose-fulltext-over-vector]] for why this is a secondary signal, and [[tokenization-gotcha]] for an input length issue we hit.""")

shard("tokenization-gotcha", "gotchas", "search-nlp",
    ["search", "nlp", "api"],
    "Embedding API Silently Truncated Long Input",
    """OpenAI's embedding API has an 8191 token limit for `text-embedding-3-small`. Inputs exceeding this limit are silently truncated — no error, no warning, just a shorter embedding that doesn't represent the full content. We discovered this when search results for long product descriptions were semantically wrong.

The fix: pre-tokenize input using tiktoken's `cl100k_base` encoder (same tokenizer the model uses) and truncate at 8000 tokens with a clear boundary (end of sentence). Log a warning when truncation occurs. See [[embedding-model-pattern]] for the pipeline, and [[elasticsearch-reference-config]] for how we store both the embedding and the full-text index.""")

shard("elasticsearch-reference-config", "references", "search-nlp",
    ["search", "elasticsearch", "configuration"],
    "Elasticsearch Index Configuration Reference",
    """Index settings and mappings for the hybrid search index. Text fields use custom analyzers for language-aware tokenization; dense_vector fields store embeddings for kNN search.

```json
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "product_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding", "english_stemmer"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "title": { "type": "text", "analyzer": "product_analyzer", "boost": 3.0 },
      "description": { "type": "text", "analyzer": "product_analyzer" },
      "embedding": { "type": "dense_vector", "dims": 1536, "index": true, "similarity": "cosine" }
    }
  }
}
```

See [[chose-fulltext-over-vector]] for the hybrid architecture decision, and [[index-sharding-reference]] for shard allocation strategy.""")

shard("semantic-search-pattern", "patterns", "search-nlp",
    ["search", "nlp", "vector-search"],
    "Semantic Search Pattern with kNN",
    r"""Semantic search uses Elasticsearch's kNN API to find documents with similar embeddings. The query embedding is generated at search time using the same model as indexing.

```typescript
async function semanticSearch(query: string, k = 10) {
  const queryEmbedding = await embed(query);
  return es.search({
    knn: { field: "embedding", query_vector: queryEmbedding, k, num_candidates: 100 },
  });
}
```

`num_candidates` controls the accuracy/speed tradeoff: higher values search more shards but return more accurate results. 100 candidates for k=10 is a good default. See [[chose-fulltext-over-vector]] for why semantic search is secondary, and [[hybrid-retrieval-pattern]] for how it combines with BM25.""")

shard("relevance-tuning-gotcha", "gotchas", "search-nlp",
    ["search", "relevance", "debugging"],
    "Vector Search Returned Irrelevant Results for Short Queries",
    """Short queries (1-2 words like "shoes" or "laptop") produced poor results from the vector search path because the embedding for a single word captures broad semantic meaning rather than specific intent. "Shoes" matched running shoes, shoe racks, shoe polish, and even "shoe-in" metaphors in product descriptions.

The fix: for queries under 4 tokens, disable the vector search component entirely and rely only on BM25 keyword matching. Short queries have high keyword precision — the user typed exactly what they want. Vector search adds value only for longer, more descriptive queries where vocabulary gaps exist. See [[hybrid-retrieval-pattern]] for the routing logic, and [[chose-fulltext-over-vector]] for the architectural decision.""")

shard("hybrid-retrieval-pattern", "patterns", "search-nlp",
    ["search", "nlp", "architecture"],
    "Hybrid Retrieval Pattern Combining BM25 and Vector Search",
    r"""Hybrid search issues both a BM25 text query and a kNN vector query in a single Elasticsearch request, then combines scores using Reciprocal Rank Fusion (RRF).

```typescript
async function hybridSearch(query: string, k = 10) {
  const embedding = await embed(query);
  const tokenCount = countTokens(query);

  if (tokenCount < 4) {
    return textOnlySearch(query, k);
  }

  return es.search({
    query: { match: { title: { query, boost: 3 } } },
    knn: { field: "embedding", query_vector: embedding, k, num_candidates: 100 },
    rank: { rrf: { window_size: 100 } },
  });
}
```

RRF merges ranked lists without needing score normalization — it uses `1/(rank + 60)` per result per list, summing across lists. This avoids the problem of BM25 scores and cosine similarities being on incomparable scales. See [[chose-fulltext-over-vector]] for the architecture, [[semantic-search-pattern]] for the vector component, and [[relevance-tuning-gotcha]] for why short queries skip vector search.""")

shard("index-sharding-reference", "references", "search-nlp",
    ["search", "elasticsearch", "infrastructure"],
    "Elasticsearch Index Sharding and Capacity Reference",
    """Guidelines for shard sizing and allocation based on document count and query patterns.

| Document Count | Shards | Replicas | Notes |
|---------------|--------|----------|-------|
| <1M | 1 | 1 | Single shard is simpler to manage |
| 1M-10M | 3 | 1 | Standard config, good parallelism |
| 10M-50M | 5 | 1 | Consider time-based indices for append-only data |
| 50M+ | Calculated | 1-2 | Target 30-50GB per shard |

Rules of thumb:
- Shard size: 20-50GB for search-heavy workloads, up to 50GB for logging
- Shard count per node: max 20 per GB of heap
- JVM heap: 50% of RAM, never exceeding 31GB (compressed oops threshold)

See [[elasticsearch-reference-config]] for index settings, and [[chose-fulltext-over-vector]] for the overall search architecture.""")

# ── Noise Notes (no wikilinks) ──

shard("sourdough-starter-maintenance", "patterns", "cooking",
    ["baking", "fermentation"],
    "Sourdough Starter Maintenance Schedule",
    """Maintain a healthy sourdough starter with consistent feeding schedule. Unfed starter develops hooch (liquid on top) and becomes overly acidic, producing dense, sour bread.

Daily feeding (room temperature): discard all but 50g, add 50g flour + 50g water. Refrigerated maintenance: feed once per week, take out 12 hours before baking. Peak activity is 4-6 hours after feeding at 75F — the starter should double in volume and pass the float test (a spoonful floats in water).

Flour matters: unbleached all-purpose works, but adding 25% whole wheat or rye accelerates fermentation due to higher mineral and wild yeast content. Chlorinated water can inhibit yeast — use filtered water.""")

shard("chose-coffee-grinder", "decisions", "cooking",
    ["coffee", "equipment"],
    "Chose Burr Grinder Over Blade for Espresso",
    """Blade grinders produce inconsistent particle sizes — some powder, some boulders. This causes uneven extraction in espresso: fine particles over-extract (bitter) while coarse particles under-extract (sour). A burr grinder crushes beans between two abrasive surfaces at a fixed distance, producing uniform particle size.

Chose the Baratza Encore (conical burr) over the Breville Smart Grinder (flat burr) because conical burrs generate less heat and produce less static, which matters for retention (grounds sticking inside the grinder). Flat burrs produce slightly more uniform particles at espresso grind sizes, but the difference is negligible outside commercial settings.""")

shard("cast-iron-seasoning-gotcha", "gotchas", "cooking",
    ["cooking", "maintenance"],
    "Flaxseed Oil Seasoning Flakes Off Cast Iron",
    """Seasoned a cast iron skillet with flaxseed oil based on internet recommendations (highest smoke point among food-safe oils, creates hardest polymer). After 3 months of regular use, the seasoning started flaking off in sheets, revealing bare metal underneath.

Flaxseed oil polymerizes into a very hard but brittle layer. Thermal cycling from stovetop to sink (even with careful cooling) causes differential expansion that cracks the rigid layer. Switch to Crisco shortening or grapeseed oil — they produce a slightly softer but more flexible seasoning that survives thermal stress. Season at 450F for 1 hour, 3-4 thin layers with full cooldown between coats.""")

shard("cake-frosting-techniques", "references", "cooking",
    ["baking", "decoration"],
    "Cake Frosting Techniques Reference",
    """Frosting types and their best applications:

| Type | Texture | Best For | Holds Shape | Temperature Sensitive |
|------|---------|----------|-------------|---------------------|
| Buttercream (American) | Sweet, thick | Piping decorations | Very well | Yes — softens above 80F |
| Swiss Meringue | Silky, light | Smooth finishes | Moderate | Yes — deflates in humidity |
| Cream Cheese | Tangy, soft | Carrot cake, red velvet | Poorly | Yes — must refrigerate |
| Ganache | Rich, glossy | Poured coating, truffles | Sets firm | Moderate — remelts at 90F |
| Royal Icing | Hard, matte | Cookie decoration | Rigid when dry | No — shelf stable |

Crumb coat trick: apply a thin first layer of frosting, refrigerate 15 minutes until firm, then apply the final coat. This traps crumbs in the base layer so the outer surface stays clean.""")

shard("indoor-plant-watering", "patterns", "gardening",
    ["plants", "home"],
    "Indoor Plant Watering Schedule Pattern",
    """Overwatering kills more houseplants than underwatering. The finger test: stick your finger 1 inch into the soil. If dry, water. If moist, wait. Different plants have different thresholds.

| Plant | Water When | Frequency (summer) | Frequency (winter) |
|-------|------------|-------------------|-------------------|
| Pothos | Top inch dry | Every 7-10 days | Every 14-21 days |
| Snake Plant | Fully dry | Every 14 days | Every 30 days |
| Monstera | Top 2 inches dry | Every 7-10 days | Every 14 days |
| Fiddle Leaf Fig | Top inch dry | Every 7 days | Every 10-14 days |
| Succulents | Fully dry | Every 14 days | Every 30 days |

Drainage is non-negotiable: every pot needs a drainage hole. Standing water in the saucer for >30 minutes causes root rot. Use a moisture meter for large pots where the finger test can't reach deep enough.""")

shard("vinyl-record-cleaning-gotcha", "gotchas", "hobbies",
    ["vinyl", "maintenance"],
    "Tap Water Leaves Mineral Deposits on Vinyl Records",
    """Cleaned vinyl records with tap water and a microfiber cloth, thinking it was the gentlest approach. After drying, records had increased surface noise — pops and crackles that weren't there before. The cause: dissolved minerals in tap water (calcium, magnesium) deposited into the grooves as the water evaporated.

Use distilled water only. For deep cleaning, a solution of distilled water + 1 drop of non-lotion dish soap per liter, applied with a carbon fiber brush following the groove direction (never across grooves). Rinse with pure distilled water and air dry vertically in a dish rack. For valuable records, invest in an ultrasonic cleaner — it reaches deep into grooves without physical contact that can cause micro-scratches.""")

shard("catan-board-game-strategy", "references", "hobbies",
    ["boardgames", "strategy"],
    "Settlers of Catan Strategy Reference",
    """Core strategy principles for competitive Catan play:

Initial placement priorities:
1. Diversify numbers — place on different numbers, not just high-probability ones
2. Resource diversity — wheat is the most versatile resource (needed for settlements, cities, and dev cards)
3. Port access — a 2:1 port for your most abundant resource is worth a slightly worse placement

Probability reference: 6 and 8 are rolled most often (5/36 each), 2 and 12 least (1/36 each). Expected resource production: sum probability × resource type across your settlements.

Trading: never trade resources that help the leader. Track what opponents need by watching their builds. Offering favorable trades early game builds goodwill for late-game negotiations.

Longest Road vs Largest Army: Road is more expensive (5 brick + 5 wood minimum vs 3 wheat + 3 sheep + 3 ore for 3 dev cards). Army also gives robber control, which has defensive value. Prefer Army unless your resource mix strongly favors brick/wood.""")

shard("espresso-troubleshooting", "decisions", "cooking",
    ["coffee", "troubleshooting"],
    "Chose Pressure Profiling for Espresso Extraction",
    """Standard espresso machines apply 9 bars of pressure throughout the entire extraction. Pressure profiling machines allow varying pressure over time — typically starting low (2-3 bar) for pre-infusion, ramping to full pressure, then declining at the end.

Chose a machine with pressure profiling (Lelit Bianca) over a standard E61 grouphead because: pre-infusion at low pressure saturates the puck evenly before full extraction, reducing channeling. Declining pressure at the end reduces harsh over-extracted flavors from fines that break down late in the shot. The result: wider grind tolerance (less puck prep precision needed) and a sweeter, more balanced shot.

Diagnostic by taste: sour = under-extracted (grind finer or increase brew time), bitter = over-extracted (grind coarser or reduce time), watery = low dose or too coarse, astringent = too fine or too hot.""")

# ── Write files ──

TYPE_TO_DIR = {
    "decisions": "decisions",
    "gotchas": "gotchas",
    "patterns": "patterns",
    "references": "references",
}

written = 0
skipped = 0
for s in SHARDS:
    dir_ = VAULT / TYPE_TO_DIR[s["type"]]
    path = dir_ / f"{s['name']}.md"
    if path.exists():
        print(f"  SKIP (exists): {path.relative_to(VAULT)}")
        skipped += 1
        continue

    dir_.mkdir(parents=True, exist_ok=True)
    tags_yaml = "\n".join(f"  - {t}" for t in s["tags"])
    frontmatter = f"""---
type: {s['type']}
projects:
  - {s['project']}
tags:
{tags_yaml}
created: 2026-03-02
updated: 2026-03-02
---"""

    content = f"{frontmatter}\n\n# {s['title']}\n\n{s['body'].strip()}\n"
    path.write_text(content)
    written += 1
    print(f"  WROTE: {path.relative_to(VAULT)}")

print(f"\nDone. {written} written, {skipped} skipped, {len(SHARDS)} total shards defined.")