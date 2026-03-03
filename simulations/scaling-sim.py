"""
Scaling simulation: generates synthetic vaults at 106 → 1k → 5k → 10k → 50k sizes
and measures how the substring-based scorer degrades.

No file I/O — all notes generated in memory. Replicates the TS scorer exactly:
substring matching (Python `in` operator), case-insensitive, title=+10, tag=+5, body=+1.

Validates Section 5 failure mode projections (FM-1 through FM-5) against empirical data.
"""

import random
import math
from dataclasses import dataclass, field

random.seed(42)

STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "must", "ought",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
    "us", "them", "my", "your", "his", "its", "our", "their",
    "what", "which", "who", "whom", "this", "that", "these", "those",
    "am", "if", "or", "but", "and", "so", "yet", "both", "either",
    "not", "no", "nor", "as", "at", "by", "for", "from", "in", "into",
    "of", "on", "to", "with", "about", "between", "through", "during",
    "before", "after", "above", "below", "up", "down", "out", "off",
    "over", "under", "again", "further", "then", "once", "here", "there",
    "when", "where", "why", "how", "all", "each", "every", "few", "more",
    "most", "other", "some", "such", "only", "own", "same", "than", "too",
    "very", "just", "because", "also", "make", "made",
}

FILLER_WORDS = [
    "implementation", "configuration", "performance", "optimization", "architecture",
    "infrastructure", "documentation", "functionality", "integration", "deployment",
    "monitoring", "scalability", "reliability", "availability", "maintenance",
    "development", "production", "environment", "repository", "dependency",
    "framework", "component", "interface", "abstraction", "middleware",
    "validation", "authorization", "encryption", "compression", "serialization",
    "database", "migration", "transaction", "connection", "replication",
    "notification", "scheduling", "processing", "rendering", "caching",
    "debugging", "profiling", "benchmarking", "refactoring", "versioning",
    "pipeline", "workflow", "container", "orchestration", "provisioning",
    "endpoint", "payload", "response", "protocol", "certificate",
    "throttling", "pagination", "aggregation", "normalization", "indexing",
    "rollback", "snapshot", "checkpoint", "failover", "redundancy",
    "compilation", "transpilation", "bundling", "minification", "obfuscation",
    "authentication", "tokenization", "hashing", "salting", "rotation",
    "webhook", "callback", "listener", "emitter", "subscriber",
    "partition", "sharding", "clustering", "balancing", "distribution",
]

DOMAIN_VOCABS = {
    "auth": {
        "terms": ["JWT", "OAuth", "RBAC", "TOTP", "bcrypt", "token", "refresh", "session",
                  "permission", "role", "login", "password", "credential", "identity", "SSO"],
        "tags": ["auth", "security", "identity"],
        "title_words": ["Auth", "Authentication", "Authorization", "Session", "Token", "Login"],
    },
    "cicd": {
        "terms": ["GitHub Actions", "Docker", "pipeline", "deploy", "rollback", "artifact",
                  "cache", "layer", "flaky", "secrets", "environment", "CI", "CD", "build"],
        "tags": ["ci", "cd", "devops", "docker"],
        "title_words": ["CI", "Pipeline", "Deploy", "Docker", "Build", "Actions"],
    },
    "database": {
        "terms": ["Postgres", "MySQL", "pooling", "N+1", "migration", "index", "query",
                  "transaction", "replication", "sharding", "connection", "ORM", "schema"],
        "tags": ["database", "postgres", "sql"],
        "title_words": ["Database", "Query", "Migration", "Postgres", "Schema", "Pool"],
    },
    "frontend": {
        "terms": ["React", "Redux", "Zustand", "component", "state", "hook", "render",
                  "virtual DOM", "SSR", "hydration", "bundle", "webpack", "tree-shaking"],
        "tags": ["frontend", "react", "state"],
        "title_words": ["React", "Component", "State", "Redux", "Frontend", "Render"],
    },
    "api": {
        "terms": ["REST", "GraphQL", "CORS", "rate limit", "endpoint", "payload",
                  "versioning", "OpenAPI", "swagger", "gRPC", "protocol", "HTTP"],
        "tags": ["api", "rest", "graphql"],
        "title_words": ["API", "REST", "GraphQL", "Endpoint", "Route", "Gateway"],
    },
    "observability": {
        "terms": ["logging", "tracing", "metrics", "SLO", "SLI", "alert", "dashboard",
                  "Prometheus", "Grafana", "span", "trace", "correlation", "sampling"],
        "tags": ["observability", "logging", "monitoring"],
        "title_words": ["Logging", "Tracing", "Metrics", "Alert", "Monitor", "SLO"],
    },
    "search": {
        "terms": ["Elasticsearch", "mapping", "cardinality", "relevance", "DSL", "index",
                  "reindex", "vector", "embedding", "fulltext", "analyzer", "tokenizer"],
        "tags": ["search", "elasticsearch"],
        "title_words": ["Search", "Elasticsearch", "Index", "Relevance", "Query", "Mapping"],
    },
    "payments": {
        "terms": ["Stripe", "webhook", "idempotency", "charge", "refund", "invoice",
                  "subscription", "checkout", "payment intent", "PCI", "ledger"],
        "tags": ["payments", "stripe", "billing"],
        "title_words": ["Payment", "Stripe", "Checkout", "Invoice", "Billing", "Charge"],
    },
    "testing": {
        "terms": ["unit test", "integration", "e2e", "mock", "fixture", "coverage",
                  "assertion", "snapshot", "regression", "flaky", "deterministic"],
        "tags": ["testing", "quality"],
        "title_words": ["Test", "Testing", "Mock", "Fixture", "Coverage", "E2E"],
    },
    "infra": {
        "terms": ["Kubernetes", "Terraform", "AWS", "load balancer", "CDN", "DNS",
                  "certificate", "firewall", "VPC", "subnet", "autoscaling", "EC2"],
        "tags": ["infra", "cloud", "kubernetes"],
        "title_words": ["Kubernetes", "AWS", "Terraform", "Infra", "Cloud", "Network"],
    },
}

NOISE_DOMAINS = [
    "sourdough", "espresso", "gardening", "vinyl records", "board games",
    "knitting", "birdwatching", "pottery", "origami", "calligraphy",
    "fermentation", "woodworking", "stamp collecting", "candle making",
    "model trains", "aquarium", "beekeeping", "bread baking", "cheese making",
    "flower arranging", "kite flying", "soap making", "weaving", "yoga",
]

TYPES = ["decisions", "gotchas", "patterns", "references"]
TYPE_PREFIXES = {
    "decisions": "chose",
    "gotchas": "",
    "patterns": "",
    "references": "",
}
TYPE_SUFFIXES = {
    "decisions": "",
    "gotchas": "gotcha",
    "patterns": "pattern",
    "references": "reference",
}


@dataclass
class Note:
    name: str
    title: str
    tags: list[str]
    body: str
    outgoing: list[str] = field(default_factory=list)
    incoming: list[str] = field(default_factory=list)


# ── The 7 dashboard test queries and their ideal sets ──

TESTS = [
    {
        "id": 1,
        "query": "jose library Web Crypto",
        "ideal_set": {"edge-runtime-auth-limits", "chose-session-tokens", "server-auth-middleware-pattern"},
    },
    {
        "id": 2,
        "query": "Redis session lookup latency",
        "ideal_set": {"chose-session-tokens", "server-auth-middleware-pattern", "edge-runtime-auth-limits", "chose-app-router"},
    },
    {
        "id": 3,
        "query": "jsonwebtoken middleware broken",
        "ideal_set": {"edge-runtime-auth-limits", "server-auth-middleware-pattern", "chose-app-router", "chose-session-tokens"},
    },
    {
        "id": 4,
        "query": "what architectural decisions did we make for dashboard",
        "ideal_set": {"chose-app-router", "chose-session-tokens"},
    },
    {
        "id": 5,
        "query": "revalidatePath revalidateTag",
        "ideal_set": {"rsc-data-fetching-pattern", "revalidation-cheatsheet", "fetch-cache-persistence", "chose-app-router"},
    },
    {
        "id": 6,
        "query": "cookie session_id validation",
        "ideal_set": {"server-auth-middleware-pattern", "chose-session-tokens", "edge-runtime-auth-limits"},
    },
    {
        "id": 7,
        "query": "what problems did App Router cause",
        "ideal_set": {"chose-app-router", "fetch-cache-persistence", "edge-runtime-auth-limits"},
    },
]


# ── Scorer: exact replica of TS scoreEntry ──

def score_entry(note: Note, keywords: list[str]) -> int:
    score = 0
    title_l = note.title.lower()
    tags_l = [t.lower() for t in note.tags]
    body_l = note.body.lower()
    for kw in keywords:
        kw_l = kw.lower()
        if kw_l in title_l:
            score += 10
        if any(kw_l in t for t in tags_l):
            score += 5
        if kw_l in body_l:
            score += 1
    return score


def keyword_search(query: str, notes: dict[str, Note]) -> list[tuple[str, int]]:
    keywords = query.split()
    results = []
    for name, n in notes.items():
        sc = score_entry(n, keywords)
        if sc > 0:
            results.append((name, sc))
    results.sort(key=lambda x: -x[1])
    return results


def expand_1hop(seed_names: set[str], notes: dict[str, Note]) -> set[str]:
    reached = set(seed_names)
    for name in seed_names:
        if name not in notes:
            continue
        n = notes[name]
        for target in n.outgoing:
            if target in notes:
                reached.add(target)
        for source in n.incoming:
            if source in notes:
                reached.add(source)
    return reached


# ── Body text generation ──

def generate_body(domain_terms: list[str], word_count: int = 200) -> str:
    words = []
    stopword_list = list(STOPWORDS)
    for _ in range(word_count):
        r = random.random()
        if r < 0.35:
            words.append(random.choice(stopword_list))
        elif r < 0.55:
            words.append(random.choice(FILLER_WORDS))
        elif r < 0.85:
            words.append(random.choice(domain_terms))
        else:
            words.append(random.choice(FILLER_WORDS))
    sentences = []
    i = 0
    while i < len(words):
        sent_len = random.randint(8, 20)
        chunk = words[i:i + sent_len]
        if chunk:
            chunk[0] = chunk[0].capitalize()
            sentences.append(" ".join(chunk) + ".")
        i += sent_len
    return " ".join(sentences)


def generate_noise_body(domain: str, word_count: int = 200) -> str:
    noise_terms = domain.split() + [
        "technique", "method", "approach", "style", "tradition", "practice",
        "material", "tool", "step", "process", "result", "quality",
    ]
    return generate_body(noise_terms, word_count)


# ── Original 43+64 shards (base vault representation) ──

ORIGINAL_DASHBOARD_SHARDS = {
    "chose-app-router": Note(
        name="chose-app-router",
        title="Chose Next.js App Router Over Pages Router",
        tags=["architecture", "nextjs"],
        body="Chose App Router for the dashboard project. The app directory structure with nested layouts "
             "and React Server Components made data fetching simpler. Tradeoff: the middleware layer is "
             "more limited than Pages Router — no Node.js APIs in edge runtime, which caused problems "
             "with jsonwebtoken library. See [[edge-runtime-auth-limits]] for the auth workaround and "
             "[[fetch-cache-persistence]] for the caching gotcha we hit. Redis session lookup latency "
             "was acceptable at p99. We made architectural decisions for dashboard around RSC patterns.",
    ),
    "chose-session-tokens": Note(
        name="chose-session-tokens",
        title="Chose Session Tokens for Dashboard Auth",
        tags=["auth", "architecture", "dashboard"],
        body="Evaluated JWT vs session tokens for the dashboard. Session tokens won because the dashboard "
             "is a single deployment — no microservice boundary to cross. The session_id cookie is validated "
             "by the middleware on every request. Redis stores session data with 24h TTL. The jsonwebtoken "
             "library was our first choice but broke in edge runtime. Latency of Redis session lookup is "
             "under 5ms at p99. Forward to the API layer for validation.",
    ),
    "edge-runtime-auth-limits": Note(
        name="edge-runtime-auth-limits",
        title="Edge Runtime Auth Limits",
        tags=["gotchas", "auth", "nextjs"],
        body="The jose library is the only JWT library that works in Web Crypto (Edge Runtime). "
             "jsonwebtoken uses Node.js crypto which is unavailable in middleware. This caused problems "
             "when we deployed the App Router dashboard. Cookie validation and session_id checks must "
             "use jose instead. See [[server-auth-middleware-pattern]] for the workaround and "
             "[[chose-session-tokens]] for why we switched to sessions.",
    ),
    "server-auth-middleware-pattern": Note(
        name="server-auth-middleware-pattern",
        title="Server Auth Middleware Pattern",
        tags=["patterns", "auth", "nextjs"],
        body="Pattern for auth middleware in Next.js App Router. Validates session cookie on every request. "
             "The session_id is checked against Redis. If invalid, redirect to login. Uses jose for JWT "
             "validation in edge runtime since jsonwebtoken is broken there. Cookie handling follows "
             "httpOnly + secure + sameSite strict. See [[edge-runtime-auth-limits]] and "
             "[[chose-session-tokens]].",
    ),
    "fetch-cache-persistence": Note(
        name="fetch-cache-persistence",
        title="Fetch Cache Persistence Gotcha",
        tags=["gotchas", "nextjs", "caching"],
        body="The App Router fetch cache persists across deployments by default. This caused stale data "
             "on the dashboard after deploys. Fix: use revalidatePath or revalidateTag to invalidate. "
             "The problems with App Router caching are subtle — the cache key includes the full URL and "
             "headers. See [[rsc-data-fetching-pattern]] and [[revalidation-cheatsheet]].",
    ),
    "rsc-data-fetching-pattern": Note(
        name="rsc-data-fetching-pattern",
        title="RSC Data Fetching Pattern",
        tags=["patterns", "nextjs", "rsc"],
        body="Pattern for data fetching in React Server Components. Use async components with direct "
             "database/API calls. No useEffect or client-side fetching needed. revalidatePath and "
             "revalidateTag control cache invalidation. See [[fetch-cache-persistence]] for gotchas.",
    ),
    "revalidation-cheatsheet": Note(
        name="revalidation-cheatsheet",
        title="Revalidation Cheatsheet",
        tags=["references", "nextjs", "caching"],
        body="Quick reference for Next.js cache revalidation. revalidatePath('/dashboard') clears the "
             "page cache. revalidateTag('user-data') clears tagged fetches. Time-based revalidation via "
             "next.revalidate option. On-demand revalidation from API routes or Server Actions.",
    ),
}

ORIGINAL_OTHER_SHARDS = [
    "obsidian-flavored-markdown", "stripe-error-handling-pattern",
    "rate-limiting-pattern", "chose-rest-over-graphql",
    "webhook-retry-reference", "webhook-design-reference", "webhook-signature-timing",
]


def build_base_vault() -> dict[str, Note]:
    notes: dict[str, Note] = {}

    for name, note in ORIGINAL_DASHBOARD_SHARDS.items():
        notes[name] = Note(
            name=note.name,
            title=note.title,
            tags=list(note.tags),
            body=note.body,
            outgoing=list(note.outgoing),
        )

    for name in ORIGINAL_OTHER_SHARDS:
        notes[name] = Note(
            name=name,
            title=name.replace("-", " ").title(),
            tags=["misc"],
            body=generate_body(random.choice(list(DOMAIN_VOCABS.values()))["terms"], 150),
        )

    return notes


def build_wikilink_graph(notes: dict[str, Note]):
    import re
    wikilink_re = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]")
    for name, note in notes.items():
        links = list(dict.fromkeys(wikilink_re.findall(note.body)))
        note.outgoing = [l for l in links if l in notes]
    for name, note in notes.items():
        note.incoming = []
    for name, note in notes.items():
        for target in note.outgoing:
            if target in notes:
                notes[target].incoming.append(name)


def generate_cluster(domain: str, vocab: dict, cluster_size: int, project_name: str, cluster_id: int) -> dict[str, Note]:
    notes: dict[str, Note] = {}
    names = []

    for i in range(cluster_size):
        note_type = TYPES[i % len(TYPES)]
        title_word = random.choice(vocab["title_words"])
        suffix = TYPE_SUFFIXES[note_type]
        prefix = TYPE_PREFIXES[note_type]

        uid = f"c{cluster_id}n{i}"
        if note_type == "decisions":
            base = f"{prefix}-{title_word.lower()}-{domain}-{uid}"
        elif suffix:
            base = f"{title_word.lower()}-{domain}-{suffix}-{uid}"
        else:
            base = f"{title_word.lower()}-{domain}-{uid}"

        name = base.replace(" ", "-")
        title = f"{title_word} {domain.title()} {'Decision' if note_type == 'decisions' else suffix.title() if suffix else 'Note'} {uid}"
        tags = list(vocab["tags"]) + [domain]

        body = generate_body(vocab["terms"], random.randint(150, 250))
        notes[name] = Note(name=name, title=title, tags=tags, body=body)
        names.append(name)

    hub_idx = 0
    hub_name = names[hub_idx]
    hub_degree = min(len(names) - 1, random.randint(12, 20))
    targets = [n for n in names if n != hub_name]
    random.shuffle(targets)
    hub_links = targets[:hub_degree]
    for target in hub_links:
        notes[hub_name].body += f" See [[{target}]] for details."
    notes[hub_name].outgoing = hub_links

    for name in names:
        if name == hub_name:
            continue
        degree = random.randint(1, 4)
        candidates = [n for n in names if n != name]
        random.shuffle(candidates)
        links = candidates[:degree]
        for target in links:
            notes[name].body += f" Related: [[{target}]]."
        notes[name].outgoing = links

    return notes


def generate_noise_notes(count: int, start_idx: int) -> dict[str, Note]:
    notes: dict[str, Note] = {}
    for i in range(count):
        domain = random.choice(NOISE_DOMAINS)
        name = f"noise-{domain.replace(' ', '-')}-{start_idx + i}"
        title = f"{domain.title()} Tips {start_idx + i}"
        tags = [domain.replace(" ", "-"), "hobby"]
        body = generate_noise_body(domain, random.randint(150, 250))
        notes[name] = Note(name=name, title=title, tags=tags, body=body)
    return notes


def build_scaled_vault(target_size: int) -> dict[str, Note]:
    notes = build_base_vault()

    existing_count = len(notes)
    remaining = target_size - existing_count
    if remaining <= 0:
        build_wikilink_graph(notes)
        return notes

    noise_count = int(target_size * 0.10)
    cluster_budget = remaining - noise_count

    domains = list(DOMAIN_VOCABS.keys())
    clusters_needed = max(1, cluster_budget // 8)
    cluster_size_base = max(4, cluster_budget // clusters_needed)

    allocated = 0
    cluster_idx = 0
    while allocated < cluster_budget:
        domain = domains[cluster_idx % len(domains)]
        vocab = DOMAIN_VOCABS[domain]
        this_size = min(cluster_size_base, cluster_budget - allocated)
        if this_size < 2:
            break
        project_name = f"{domain}-project-{cluster_idx}"
        cluster = generate_cluster(domain, vocab, this_size, project_name, cluster_idx)
        notes.update(cluster)
        allocated += len(cluster)
        cluster_idx += 1

    noise = generate_noise_notes(noise_count, 0)
    notes.update(noise)

    build_wikilink_graph(notes)
    return notes


# ── Metrics ──

def recall(found: set[str], ideal: set[str]) -> float:
    if not ideal:
        return 0.0
    return len(ideal & found) / len(ideal)


def ranks_of_ideal(results: list[tuple[str, int]], ideal: set[str]) -> list[int]:
    ranks = []
    for i, (name, _) in enumerate(results):
        if name in ideal:
            ranks.append(i + 1)
    for name in ideal:
        if not any(n == name for n, _ in results):
            ranks.append(-1)
    return sorted(ranks)


def score_stats(results: list[tuple[str, int]], ideal: set[str]) -> dict:
    ideal_scores = [sc for n, sc in results if n in ideal]
    all_scores = [sc for _, sc in results]
    non_ideal_scores = [sc for n, sc in results if n not in ideal]
    return {
        "ideal_min": min(ideal_scores) if ideal_scores else 0,
        "ideal_max": max(ideal_scores) if ideal_scores else 0,
        "ideal_median": sorted(ideal_scores)[len(ideal_scores) // 2] if ideal_scores else 0,
        "noise_median": sorted(non_ideal_scores)[len(non_ideal_scores) // 2] if non_ideal_scores else 0,
        "noise_max": max(non_ideal_scores) if non_ideal_scores else 0,
    }


def hop1_reach(seed_names: set[str], notes: dict[str, Note]) -> int:
    expanded = expand_1hop(seed_names, notes)
    return len(expanded)


# ── FM projection formulas ──

def fm1_projected_substring_fps(vault_size: int, keyword: str, observed_rate: float) -> float:
    return vault_size * observed_rate


def fm2_projected_noise_floor(num_stopwords: int, vault_size: int, stopword_hit_rate: float = 0.9) -> float:
    return vault_size * (1 - (1 - stopword_hit_rate) ** num_stopwords)


def fm4_projected_notes_above_zero(vault_size: int, num_keywords: int,
                                    stopword_rate: float = 0.9, content_rate: float = 0.1,
                                    num_stopwords: int = 5, num_content: int = 3) -> float:
    p_zero = ((1 - stopword_rate) ** num_stopwords) * ((1 - content_rate) ** num_content)
    return vault_size * (1 - p_zero)


def fm5_projected_cluster_found(per_note_match_prob: float, cluster_size: int) -> float:
    return 1 - (1 - per_note_match_prob) ** cluster_size


# ── Main simulation ──

SCALE_POINTS = [106, 1_000, 5_000, 10_000, 50_000]


def run_simulation():
    print("=" * 100)
    print("SCALING SIMULATION — Failure Mode Validation")
    print("=" * 100)

    all_results = {}

    for size in SCALE_POINTS:
        print(f"\n{'─' * 100}")
        print(f"VAULT SIZE: {size:,}")
        print(f"{'─' * 100}")

        notes = build_scaled_vault(size)
        actual_size = len(notes)
        print(f"  Actual notes generated: {actual_size:,}")

        total_edges = sum(len(n.outgoing) for n in notes.values())
        mean_degree = total_edges / actual_size if actual_size else 0
        print(f"  Total edges: {total_edges:,}, mean out-degree: {mean_degree:.1f}")

        noise_count = sum(1 for name in notes if name.startswith("noise-"))
        print(f"  Noise notes: {noise_count:,} ({noise_count / actual_size * 100:.0f}%)")

        metrics = {
            "recalls": [],
            "recalls_at_10": [],
            "recalls_at_50": [],
            "notes_above_zero": [],
            "ideal_ranks": [],
            "score_stats": [],
            "hop1_reaches": [],
        }

        print(f"\n  {'#':<4} {'Query':<44} {'R∞':<6} {'R@10':<6} {'R@50':<6} {'#>0':<8} {'Ideal Ranks':<24} {'1-hop':<8}")
        print(f"  {'─'*4} {'─'*44} {'─'*6} {'─'*6} {'─'*6} {'─'*8} {'─'*24} {'─'*8}")

        for test in TESTS:
            q = test["query"]
            ideal = test["ideal_set"]

            results = keyword_search(q, notes)
            found_names = {n for n, _ in results}
            found_at_10 = {n for n, _ in results[:10]}
            found_at_50 = {n for n, _ in results[:50]}

            r = recall(found_names, ideal)
            r10 = recall(found_at_10, ideal)
            r50 = recall(found_at_50, ideal)
            metrics["recalls"].append(r)
            metrics["recalls_at_10"].append(r10)
            metrics["recalls_at_50"].append(r50)

            above_zero = len(results)
            metrics["notes_above_zero"].append(above_zero)

            ranks = ranks_of_ideal(results, ideal)
            metrics["ideal_ranks"].append(ranks)

            stats = score_stats(results, ideal)
            metrics["score_stats"].append(stats)

            kw_hit_names = {n for n, _ in results[:50]}
            reach = hop1_reach(kw_hit_names, notes)
            metrics["hop1_reaches"].append(reach)

            ranks_str = ",".join(str(r) if r > 0 else "miss" for r in ranks)
            print(f"  {test['id']:<4} {q[:44]:<44} {r:<6.0%} {r10:<6.0%} {r50:<6.0%} {above_zero:<8} {ranks_str:<24} {reach:<8}")

        def mean(xs): return sum(xs) / len(xs) if xs else 0

        mean_recall = mean(metrics["recalls"])
        mean_r10 = mean(metrics["recalls_at_10"])
        mean_r50 = mean(metrics["recalls_at_50"])
        mean_above_zero = mean(metrics["notes_above_zero"])
        mean_hop1 = mean(metrics["hop1_reaches"])

        all_ideal_scores = [s for stats in metrics["score_stats"] for s in [stats["ideal_median"]]]
        all_noise_scores = [s for stats in metrics["score_stats"] for s in [stats["noise_median"]]]

        print(f"\n  Summary for N={actual_size:,}:")
        print(f"    Mean recall (unlimited): {mean_recall:.0%}")
        print(f"    Mean recall @10:         {mean_r10:.0%}")
        print(f"    Mean recall @50:         {mean_r50:.0%}")
        print(f"    Mean notes scoring > 0:  {mean_above_zero:.0f}")
        print(f"    Mean 1-hop reach:        {mean_hop1:.0f} ({mean_hop1 / actual_size * 100:.1f}% of vault)")
        print(f"    Median ideal score:      {sum(all_ideal_scores) / len(all_ideal_scores):.1f}")
        print(f"    Median noise score:      {sum(all_noise_scores) / len(all_noise_scores):.1f}")

        all_results[size] = {
            "actual_size": actual_size,
            "mean_recall": mean_recall,
            "mean_recall_at_10": mean_r10,
            "mean_recall_at_50": mean_r50,
            "mean_above_zero": mean_above_zero,
            "mean_hop1_reach": mean_hop1,
            "mean_hop1_pct": mean_hop1 / actual_size * 100,
            "mean_ideal_median_score": sum(all_ideal_scores) / len(all_ideal_scores),
            "mean_noise_median_score": sum(all_noise_scores) / len(all_noise_scores),
            "metrics": metrics,
        }

    # ── Scaling Curve Summary ──
    print(f"\n\n{'=' * 100}")
    print("SCALING CURVE SUMMARY")
    print(f"{'=' * 100}")
    print()

    print("### Keyword Recall Degradation")
    print()
    print("| Vault Size | R (unlim) | R@10 | R@50 | Notes > 0 | 1-hop Reach | 1-hop % | Ideal Med | Noise Med |")
    print("|------------|-----------|------|------|-----------|-------------|---------|-----------|-----------|")
    for size in SCALE_POINTS:
        r = all_results[size]
        print(f"| {r['actual_size']:>10,} | {r['mean_recall']:>9.0%} | {r['mean_recall_at_10']:>4.0%} | {r['mean_recall_at_50']:>4.0%} | {r['mean_above_zero']:>9.0f} | {r['mean_hop1_reach']:>11.0f} | {r['mean_hop1_pct']:>7.1f}% | {r['mean_ideal_median_score']:>9.1f} | {r['mean_noise_median_score']:>9.1f} |")

    print()
    print("### Per-Query Recall Across Scale Points")
    print()
    header = "| # | Query" + "".join(f" | N={s:,}" for s in SCALE_POINTS) + " |"
    sep = "|---|------" + "".join(" | -------" for _ in SCALE_POINTS) + " |"
    print(header)
    print(sep)
    for i, test in enumerate(TESTS):
        row = f"| {test['id']} | {test['query'][:40]:<40}"
        for size in SCALE_POINTS:
            r = all_results[size]["metrics"]["recalls"][i]
            row += f" | {r:>6.0%} "
        row += " |"
        print(row)

    print()
    print("### Per-Query Notes Scoring > 0 Across Scale Points")
    print()
    header = "| # | Query" + "".join(f" | N={s:,}" for s in SCALE_POINTS) + " |"
    print(header)
    print(sep)
    for i, test in enumerate(TESTS):
        row = f"| {test['id']} | {test['query'][:40]:<40}"
        for size in SCALE_POINTS:
            n = all_results[size]["metrics"]["notes_above_zero"][i]
            row += f" | {n:>7,} "
        row += " |"
        print(row)

    print()
    print("### Per-Query Recall@10 Across Scale Points")
    print()
    header = "| # | Query" + "".join(f" | N={s:,}" for s in SCALE_POINTS) + " |"
    print(header)
    print(sep)
    for i, test in enumerate(TESTS):
        row = f"| {test['id']} | {test['query'][:40]:<40}"
        for size in SCALE_POINTS:
            r = all_results[size]["metrics"]["recalls_at_10"][i]
            row += f" | {r:>6.0%} "
        row += " |"
        print(row)

    print()
    print("### Per-Query Recall@50 Across Scale Points")
    print()
    header = "| # | Query" + "".join(f" | N={s:,}" for s in SCALE_POINTS) + " |"
    print(header)
    print(sep)
    for i, test in enumerate(TESTS):
        row = f"| {test['id']} | {test['query'][:40]:<40}"
        for size in SCALE_POINTS:
            r = all_results[size]["metrics"]["recalls_at_50"][i]
            row += f" | {r:>6.0%} "
        row += " |"
        print(row)

    # ── FM Validation ──
    print(f"\n\n{'=' * 100}")
    print("FAILURE MODE VALIDATION — Projected vs Empirical")
    print(f"{'=' * 100}")

    print()
    print("### FM-1: Substring False Positive Rate")
    print()

    base_notes = build_scaled_vault(SCALE_POINTS[0])
    base_for_hits = sum(1 for n in base_notes.values() if "for" in n.body.lower())
    base_rate = base_for_hits / len(base_notes)
    print(f"Testing keyword 'for' (3-char stopword, measured {base_rate:.0%} hit rate at N={len(base_notes)})")
    print()
    print("| Vault Size | Projected Hits | Empirical Hits | Rate | Match? |")
    print("|------------|----------------|----------------|------|--------|")

    for size in SCALE_POINTS:
        notes = build_scaled_vault(size)
        empirical = sum(1 for n in notes.values() if "for" in n.body.lower())
        projected = fm1_projected_substring_fps(len(notes), "for", base_rate)
        match = "YES" if abs(empirical - projected) / max(projected, 1) < 0.2 else "NO"
        actual_rate = empirical / len(notes)
        print(f"| {len(notes):>10,} | {projected:>14,.0f} | {empirical:>14,} | {actual_rate:>4.0%} | {match:<6} |")

    print()
    print("### FM-2: Stopword Noise Floor")
    print()
    print("Testing Q4 (5 stopwords: what, did, we, make, for)")
    print()
    print("| Vault Size | Projected Notes Above Noise | Empirical Notes > 0 | Match? |")
    print("|------------|-----------------------------|--------------------|--------|")

    for size in SCALE_POINTS:
        r = all_results[size]
        q4_above = r["metrics"]["notes_above_zero"][3]
        projected = fm2_projected_noise_floor(5, r["actual_size"], 0.9)
        match = "YES" if abs(q4_above - projected) / max(projected, 1) < 0.3 else "NO"
        print(f"| {r['actual_size']:>10,} | {projected:>27,.0f} | {q4_above:>18,} | {match:<6} |")

    print()
    print("### FM-3: 1-Hop Reach Percentage")
    print()
    print("| Vault Size | Mean 1-hop Reach | % of Vault |")
    print("|------------|------------------|------------|")

    for size in SCALE_POINTS:
        r = all_results[size]
        print(f"| {r['actual_size']:>10,} | {r['mean_hop1_reach']:>16,.0f} | {r['mean_hop1_pct']:>10.1f}% |")

    print()
    print("### FM-4: Limit Truncation (notes scoring > 0)")
    print()
    print("| Vault Size | Mean Notes > 0 | % of Vault | Limit=10 Useful? | Limit=50 Useful? |")
    print("|------------|----------------|------------|------------------|------------------|")

    for size in SCALE_POINTS:
        r = all_results[size]
        pct = r["mean_above_zero"] / r["actual_size"] * 100
        l10 = "YES" if r["mean_above_zero"] < 20 else "NO"
        l50 = "YES" if r["mean_above_zero"] < 100 else "NO"
        print(f"| {r['actual_size']:>10,} | {r['mean_above_zero']:>14,.0f} | {pct:>10.1f}% | {l10:<16} | {l50:<16} |")

    print()
    print("### FM-5: Cluster Discovery Probability")
    print()
    print("P(keyword finds at least 1 note in target cluster)")
    print()
    print("| Cluster Size | P(match)=0.23 | P(match)=0.10 | P(match)=0.05 |")
    print("|--------------|---------------|---------------|---------------|")

    for cs in [4, 8, 15, 20, 50]:
        p23 = fm5_projected_cluster_found(0.23, cs)
        p10 = fm5_projected_cluster_found(0.10, cs)
        p05 = fm5_projected_cluster_found(0.05, cs)
        print(f"| {cs:>12} | {p23:>13.0%} | {p10:>13.0%} | {p05:>13.0%} |")

    print()
    print("### Score Distribution: Ideal vs Noise Floor")
    print()
    print("| Vault Size | Ideal Min | Ideal Median | Ideal Max | Noise Median | Noise Max | Signal-to-Noise |")
    print("|------------|-----------|--------------|-----------|--------------|-----------|-----------------|")

    for size in SCALE_POINTS:
        r = all_results[size]
        ms = r["metrics"]["score_stats"]
        ideal_mins = [s["ideal_min"] for s in ms if s["ideal_min"] > 0]
        ideal_meds = [s["ideal_median"] for s in ms if s["ideal_median"] > 0]
        ideal_maxs = [s["ideal_max"] for s in ms if s["ideal_max"] > 0]
        noise_meds = [s["noise_median"] for s in ms]
        noise_maxs = [s["noise_max"] for s in ms]

        imin = sum(ideal_mins) / len(ideal_mins) if ideal_mins else 0
        imed = sum(ideal_meds) / len(ideal_meds) if ideal_meds else 0
        imax = sum(ideal_maxs) / len(ideal_maxs) if ideal_maxs else 0
        nmed = sum(noise_meds) / len(noise_meds) if noise_meds else 0
        nmax = sum(noise_maxs) / len(noise_maxs) if noise_maxs else 0
        snr = imed / nmed if nmed > 0 else float("inf")

        print(f"| {r['actual_size']:>10,} | {imin:>9.1f} | {imed:>12.1f} | {imax:>9.1f} | {nmed:>12.1f} | {nmax:>9.1f} | {snr:>15.2f}x |")

    print()


if __name__ == "__main__":
    run_simulation()
