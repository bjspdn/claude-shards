"""
Context cost simulation: measures the TOKEN COST of different retrieval strategies
and their efficiency (recall per token spent).

Strategies:
  A: Index Only (Knowledge Index table injected into CLAUDE.md)
  B: Keyword Search -> Top-5 Results Table
  C: Keyword Search -> Read Top 3
  D: Keyword Search + 1-Hop Graph Expansion -> Read Top 3
  E: Keyword Search + 1-Hop -> Read All Expanded (worst case)
"""

import re
import yaml
import tiktoken
from pathlib import Path
from dataclasses import dataclass, field

VAULT = Path.home() / ".claude-shards" / "knowledge-base"
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]")

enc = tiktoken.get_encoding("cl100k_base")


def tok(text: str) -> int:
    return len(enc.encode(text))


@dataclass
class Shard:
    name: str
    title: str
    type: str
    project: str
    tags: list[str]
    body: str
    outgoing: list[str] = field(default_factory=list)
    incoming: list[str] = field(default_factory=list)


def load_vault() -> dict[str, Shard]:
    shards: dict[str, Shard] = {}
    for md in sorted(VAULT.rglob("*.md")):
        if md.parent.name.startswith(("_", ".")):
            continue
        text = md.read_text()
        if not text.startswith("---"):
            continue

        end = text.index("---", 3)
        fm_raw = text[3:end].strip()
        body = text[end + 3:].strip()

        try:
            fm = yaml.safe_load(fm_raw)
        except yaml.YAMLError:
            continue

        title_match = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else md.stem

        name = md.stem
        links = list(dict.fromkeys(WIKILINK_RE.findall(body)))

        shards[name] = Shard(
            name=name,
            title=title,
            type=fm.get("type", ""),
            project=(fm.get("projects") or [""])[0],
            tags=fm.get("tags", []),
            body=body,
            outgoing=links,
        )

    for name, s in shards.items():
        for target in s.outgoing:
            if target in shards:
                shards[target].incoming.append(name)

    return shards


def score_entry(shard: Shard, keywords: list[str]) -> int:
    score = 0
    title_l = shard.title.lower()
    tags_l = [t.lower() for t in shard.tags]
    body_l = shard.body.lower()
    for kw in keywords:
        kw_l = kw.lower()
        if kw_l in title_l:
            score += 10
        if any(kw_l in t for t in tags_l):
            score += 5
        if kw_l in body_l:
            score += 1
    return score


def keyword_search(query: str, shards: dict[str, Shard]) -> list[tuple[str, int]]:
    keywords = query.split()
    results = []
    for name, s in shards.items():
        sc = score_entry(s, keywords)
        if sc > 0:
            results.append((name, sc))
    results.sort(key=lambda x: -x[1])
    return results


def expand_hops(seed_names: set[str], shards: dict[str, Shard], hops: int) -> set[str]:
    reached = set(seed_names)
    frontier = set(seed_names)
    for _ in range(hops):
        next_frontier = set()
        for name in frontier:
            if name not in shards:
                continue
            s = shards[name]
            for target in s.outgoing:
                if target in shards and target not in reached:
                    next_frontier.add(target)
            for source in s.incoming:
                if source in shards and source not in reached:
                    next_frontier.add(source)
        reached |= next_frontier
        frontier = next_frontier
    return reached


TESTS = [
    # ── Dashboard cluster (from noise-ceiling-sim.py) ──
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
    # ── Auth-system cluster ──
    {
        "id": 8,
        "query": "JWT token refresh Redis rotation",
        "ideal_set": {"chose-jwt-over-sessions", "token-refresh-pattern", "session-revocation-gotcha"},
    },
    {
        "id": 9,
        "query": "bcrypt password hashing event loop blocking",
        "ideal_set": {"password-hashing-gotcha", "chose-jwt-over-sessions", "token-refresh-pattern"},
    },
    {
        "id": 10,
        "query": "TOTP two factor authentication login flow OAuth",
        "ideal_set": {"two-factor-auth-pattern", "oauth2-integration-reference", "chose-jwt-over-sessions"},
    },
    {
        "id": 11,
        "query": "permission check role authorization middleware",
        "ideal_set": {"rbac-permission-pattern", "auth-middleware-reference", "session-revocation-gotcha"},
    },
    # ── CI/CD cluster ──
    {
        "id": 12,
        "query": "GitHub Actions docker build cache layer speed",
        "ideal_set": {"chose-github-actions", "docker-layer-caching-pattern", "artifact-caching-pattern"},
    },
    {
        "id": 13,
        "query": "automated rollback deployment pipeline broken",
        "ideal_set": {"deploy-rollback-gotcha", "chose-github-actions", "k8s-manifests-reference"},
    },
    {
        "id": 14,
        "query": "flaky test secrets environment CI integration",
        "ideal_set": {"flaky-test-gotcha", "environment-secrets-pattern", "chose-github-actions"},
    },
    # ── Elasticsearch cluster ──
    {
        "id": 15,
        "query": "Elasticsearch mapping explosion cardinality",
        "ideal_set": {"elasticsearch-mapping-explosion", "chose-elasticsearch", "chose-fulltext-over-vector"},
    },
    {
        "id": 16,
        "query": "search relevance tuning query DSL",
        "ideal_set": {"search-relevance-tuning-reference", "relevance-tuning-gotcha", "search-query-parsing-pattern"},
    },
    {
        "id": 17,
        "query": "stale search index reindex strategy",
        "ideal_set": {"stale-search-index", "incremental-reindex-pattern", "chose-search-indexing-strategy"},
    },
]


def build_index_table(shards: dict[str, Shard]) -> str:
    icon_map = {"decision": "🟤", "gotcha": "🔴", "pattern": "🔵", "reference": "🟢"}
    rows = ["| Icon | Title | Path | ~Tokens |", "| ---- | ----- | ---- | ------- |"]
    for name, s in sorted(shards.items()):
        icon = icon_map.get(s.type, "⚪")
        body_toks = tok(s.body)
        rows.append(f"| {icon} | {s.title} | {name} | ~{body_toks} |")
    return "\n".join(rows)


def build_search_results_table(results: list[tuple[str, int]], shards: dict[str, Shard]) -> str:
    rows = ["| Title | Path | Score | ~Tokens |", "| ----- | ---- | ----- | ------- |"]
    for name, score in results:
        if name not in shards:
            continue
        s = shards[name]
        body_toks = tok(s.body)
        rows.append(f"| {s.title} | {name} | {score} | ~{body_toks} |")
    return "\n".join(rows)


def recall(found: set[str], ideal: set[str]) -> float:
    if not ideal:
        return 0.0
    return len(ideal & found) / len(ideal)


def efficiency(rec: float, tokens: int) -> float:
    if tokens == 0:
        return 0.0
    return (rec * 100) / (tokens / 100)


def mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def main():
    shards = load_vault()

    index_table = build_index_table(shards)
    index_tokens = tok(index_table)

    body_tokens_cache = {n: tok(shards[n].body) for n in shards}

    agg = {k: {"recall": [], "tokens": [], "efficiency": []} for k in ["A", "B", "C", "D", "E"]}
    agg_max_tokens = {k: [] for k in ["A", "B", "C", "D", "E"]}

    print("=" * 80)
    print("CONTEXT COST SIMULATION — TOKEN COST vs RECALL EFFICIENCY")
    print("=" * 80)
    print(f"\nVault size: {len(shards)} shards")
    print(f"Index table size: {index_tokens} tokens\n")

    for test in TESTS:
        q = test["query"]
        ideal = test["ideal_set"]

        kw_results = keyword_search(q, shards)
        kw_names_ordered = [n for n, _ in kw_results]
        kw_names = set(kw_names_ordered)

        top5 = kw_results[:5]
        top5_names = {n for n, _ in top5}
        top3_names = {n for n, _ in kw_results[:3]}

        hop1_expanded = expand_hops(kw_names, shards, 1)

        top3_expanded_reranked: list[str] = []
        for name in kw_names_ordered[:3]:
            top3_expanded_reranked.append(name)
        for name in sorted(hop1_expanded - kw_names):
            if len(top3_expanded_reranked) >= 3:
                break
            top3_expanded_reranked.append(name)
        top3_expanded_names = set(top3_expanded_reranked[:3])

        search_table_top5 = build_search_results_table(top5, shards)
        search_table_tokens = tok(search_table_top5)

        cost_A = index_tokens
        recall_A = 0.0

        cost_B = search_table_tokens
        recall_B = recall(top5_names, ideal)

        cost_C = search_table_tokens + sum(body_tokens_cache[n] for n in top3_names if n in shards)
        recall_C = recall(top3_names, ideal)

        cost_D = search_table_tokens + sum(body_tokens_cache[n] for n in top3_expanded_names if n in shards)
        recall_D = recall(hop1_expanded, ideal)

        cost_E = search_table_tokens + sum(body_tokens_cache[n] for n in hop1_expanded if n in shards)
        recall_E = recall(hop1_expanded, ideal)

        eff_A = efficiency(recall_A, cost_A)
        eff_B = efficiency(recall_B, cost_B)
        eff_C = efficiency(recall_C, cost_C)
        eff_D = efficiency(recall_D, cost_D)
        eff_E = efficiency(recall_E, cost_E)

        for key, r, c, e in [
            ("A", recall_A, cost_A, eff_A),
            ("B", recall_B, cost_B, eff_B),
            ("C", recall_C, cost_C, eff_C),
            ("D", recall_D, cost_D, eff_D),
            ("E", recall_E, cost_E, eff_E),
        ]:
            agg[key]["recall"].append(r)
            agg[key]["tokens"].append(c)
            agg[key]["efficiency"].append(e)
            agg_max_tokens[key].append(c)

        col0, col1, col2, col3 = 22, 8, 8, 28
        print(f"{'─' * 80}")
        print(f"Test {test['id']} — `{q}`")
        print(f"Ideal set: {sorted(ideal)}\n")
        print(f"  {'Strategy':<{col0}} {'Recall':<{col1}} {'Tokens':<{col2}} {'Efficiency (recall/100tok)':<{col3}}")
        print(f"  {'─' * col0} {'─' * col1} {'─' * col2} {'─' * col3}")
        for label, r, c, e in [
            ("A: Index only",     recall_A, cost_A, eff_A),
            ("B: Search top-5",   recall_B, cost_B, eff_B),
            ("C: Search+Read 3",  recall_C, cost_C, eff_C),
            ("D: 1-hop+Read 3",   recall_D, cost_D, eff_D),
            ("E: 1-hop+Read all", recall_E, cost_E, eff_E),
        ]:
            print(f"  {label:<{col0}} {f'{r:.0%}':<{col1}} {c:<{col2}} {e:.2f}")
        print()

    print("=" * 80)
    print("AGGREGATE")
    print("=" * 80)
    print()
    print(f"  {'Strategy':<22} {'Mean Recall':<14} {'Mean Tokens':<14} {'Mean Efficiency':<18} {'Max Tokens':<12}")
    print(f"  {'─' * 22} {'─' * 14} {'─' * 14} {'─' * 18} {'─' * 12}")
    strategy_labels = [
        ("A", "A: Index only"),
        ("B", "B: Search top-5"),
        ("C", "C: Search+Read 3"),
        ("D", "D: 1-hop+Read 3"),
        ("E", "E: 1-hop+Read all"),
    ]
    for key, label in strategy_labels:
        mr = mean(agg[key]["recall"])
        mt = mean(agg[key]["tokens"])
        me = mean(agg[key]["efficiency"])
        mx = max(agg_max_tokens[key])
        print(f"  {label:<22} {f'{mr:.0%}':<14} {mt:<14.0f} {me:<18.2f} {mx:<12}")

    print()
    print("=" * 80)
    print("PROGRESSIVE DISCLOSURE ANALYSIS")
    print("=" * 80)
    print()

    levels = [
        ("Level 1 — Index only (A)",         "A"),
        ("Level 2 — Index + Search table (B)", "B"),
        ("Level 3 — + Read top 3 (C)",        "C"),
        ("Level 4 — + 1-hop graph (D)",       "D"),
        ("Level 5 — + Read all expanded (E)", "E"),
    ]

    prev_recall = 0.0
    prev_tokens = 0.0

    print(f"  {'Level':<38} {'Tokens':<10} {'Recall':<10} {'Delta Recall':<14} {'Marginal Eff'}")
    print(f"  {'─' * 38} {'─' * 10} {'─' * 10} {'─' * 14} {'─' * 14}")

    for label, key in levels:
        mr = mean(agg[key]["recall"])
        mt = mean(agg[key]["tokens"])
        delta_recall = mr - prev_recall
        delta_tokens = mt - prev_tokens
        marginal_eff = (delta_recall * 100) / (delta_tokens / 100) if delta_tokens > 0 else 0.0
        dr_str = f"+{delta_recall:.0%}" if delta_recall > 0 else "—"
        print(f"  {label:<38} {mt:<10.0f} {f'{mr:.0%}':<10} {dr_str:<14} {marginal_eff:.2f}")
        prev_recall = mr
        prev_tokens = mt

    print()
    print("  RECOMMENDATIONS")
    print("  ────────────────")

    mean_eff = {key: mean(agg[key]["efficiency"]) for key, _ in strategy_labels}
    best_key = max(["B", "C", "D", "E"], key=lambda k: mean_eff[k])
    best_label = dict(strategy_labels)[best_key]

    mean_recall_C = mean(agg["C"]["recall"])
    mean_recall_D = mean(agg["D"]["recall"])
    mean_recall_E = mean(agg["E"]["recall"])
    mean_tokens_C = mean(agg["C"]["tokens"])
    mean_tokens_D = mean(agg["D"]["tokens"])
    mean_tokens_E = mean(agg["E"]["tokens"])

    print(f"\n  Best mean efficiency: {best_label} ({mean_eff[best_key]:.2f} recall/100tok)")
    print(f"\n  Strategy C (Search+Read 3) achieves {mean_recall_C:.0%} recall at {mean_tokens_C:.0f} tokens avg.")
    print(f"  Strategy D (1-hop+Read 3) achieves  {mean_recall_D:.0%} recall at {mean_tokens_D:.0f} tokens avg.")
    print(f"  Strategy E (1-hop+Read all) achieves {mean_recall_E:.0%} recall at {mean_tokens_E:.0f} tokens avg.")

    recall_gain_D_over_C = mean_recall_D - mean_recall_C
    token_cost_D_over_C = mean_tokens_D - mean_tokens_C

    print(f"\n  Going from C -> D: +{recall_gain_D_over_C:.0%} recall for +{token_cost_D_over_C:.0f} tokens")

    if mean_eff["D"] > mean_eff["C"]:
        print(f"  1-hop expansion (D) is MORE efficient than reading top-3 alone (C).")
        print(f"  Recommendation: use Strategy D as the default retrieval path.")
    else:
        print(f"  1-hop expansion does not improve efficiency over reading top-3 (C).")
        print(f"  Recommendation: use Strategy C as the default retrieval path.")

    blowup_ratio = mean_tokens_E / mean_tokens_C if mean_tokens_C > 0 else 0
    print(f"\n  Context blow-up risk: Strategy E uses {blowup_ratio:.1f}x more tokens than C.")
    if blowup_ratio > 3:
        print(f"  WARNING: Reading all expanded results is wasteful — avoid Strategy E in production.")

    print()


if __name__ == "__main__":
    main()
