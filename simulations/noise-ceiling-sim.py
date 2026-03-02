"""
Noise ceiling experiment: does 2-hop graph expansion blow up precision
when the vault grows from 8 to 40 shards?

Loads shards from the actual vault, builds the wikilink graph, and
compares keyword-only vs 1-hop vs 2-hop expansion across the same 7 queries.
"""

import re
import yaml
from pathlib import Path
from dataclasses import dataclass, field

VAULT = Path.home() / ".claude-shards" / "knowledge-base"
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]")

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
    """Expand from seed shards by following wikilinks (both directions) for N hops."""
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

DASHBOARD_SHARDS = {
    "chose-app-router", "chose-session-tokens", "fetch-cache-persistence",
    "edge-runtime-auth-limits", "rsc-data-fetching-pattern",
    "server-auth-middleware-pattern", "revalidation-cheatsheet",
    "obsidian-flavored-markdown",
}


def main():
    shards = load_vault()

    all_names = set(shards.keys())
    dashboard = {n for n in all_names if n in DASHBOARD_SHARDS}
    non_dashboard = all_names - dashboard

    # ── Graph stats ──
    print("=" * 95)
    print("VAULT GRAPH STATISTICS")
    print("=" * 95)
    total_edges = sum(len(s.outgoing) for s in shards.values())
    cross_domain = 0
    for s in shards.values():
        for t in s.outgoing:
            if t in shards and shards[t].project != s.project:
                cross_domain += 1
    projects = {}
    for s in shards.values():
        projects.setdefault(s.project, []).append(s.name)

    print(f"\n  Total shards:       {len(shards)}")
    print(f"  Total edges:        {total_edges}")
    print(f"  Cross-domain edges: {cross_domain}")
    print(f"  Avg out-degree:     {total_edges / len(shards):.1f}")
    print(f"\n  Shards by project:")
    for proj, names in sorted(projects.items()):
        print(f"    {proj or '(none)':<16} {len(names)} shards")

    # ── Run queries ──
    print(f"\n{'=' * 95}")
    print("NOISE CEILING EXPERIMENT — KEYWORD vs 1-HOP vs 2-HOP EXPANSION")
    print(f"{'=' * 95}")

    agg = {"kw": [], "1h": [], "2h": []}
    agg_prec = {"kw": [], "1h": [], "2h": []}
    agg_cross_noise = {"1h": [], "2h": []}
    agg_total_returned = {"kw": [], "1h": [], "2h": []}

    for test in TESTS:
        q = test["query"]
        ideal = test["ideal_set"]

        kw_results = keyword_search(q, shards)
        kw_names = {n for n, _ in kw_results}

        hop1_expanded = expand_hops(kw_names, shards, 1)
        hop2_expanded = expand_hops(kw_names, shards, 2)

        kw_recall = len(ideal & kw_names) / len(ideal) if ideal else 0
        h1_recall = len(ideal & hop1_expanded) / len(ideal) if ideal else 0
        h2_recall = len(ideal & hop2_expanded) / len(ideal) if ideal else 0

        kw_precision = len(ideal & kw_names) / len(kw_names) if kw_names else 0
        h1_precision = len(ideal & hop1_expanded) / len(hop1_expanded) if hop1_expanded else 0
        h2_precision = len(ideal & hop2_expanded) / len(hop2_expanded) if hop2_expanded else 0

        # Cross-domain noise: non-dashboard shards pulled in by expansion
        h1_cross = hop1_expanded - dashboard - {n for n in hop1_expanded if shards.get(n, Shard("","","","",[],"")).project == "dashboard"}
        h2_cross = hop2_expanded - dashboard - {n for n in hop2_expanded if shards.get(n, Shard("","","","",[],"")).project == "dashboard"}
        # More precisely: shards from unrelated projects
        h1_noise_shards = hop1_expanded - kw_names - ideal
        h2_noise_shards = hop2_expanded - kw_names - ideal

        agg["kw"].append(kw_recall)
        agg["1h"].append(h1_recall)
        agg["2h"].append(h2_recall)
        agg_prec["kw"].append(kw_precision)
        agg_prec["1h"].append(h1_precision)
        agg_prec["2h"].append(h2_precision)
        agg_total_returned["kw"].append(len(kw_names))
        agg_total_returned["1h"].append(len(hop1_expanded))
        agg_total_returned["2h"].append(len(hop2_expanded))

        print(f"\n{'─' * 95}")
        print(f"Test {test['id']} — `{q}`")
        print(f"Ideal set ({len(ideal)}): {sorted(ideal)}")
        print()
        print(f"  {'Method':<14} {'Returned':<10} {'Recall':<10} {'Precision':<12} {'Noise shards':<14}")
        print(f"  {'─'*14} {'─'*10} {'─'*10} {'─'*12} {'─'*14}")
        print(f"  {'Keyword':<14} {len(kw_names):<10} {kw_recall:<10.0%} {kw_precision:<12.0%} {'—':<14}")
        print(f"  {'+ 1-hop':<14} {len(hop1_expanded):<10} {h1_recall:<10.0%} {h1_precision:<12.0%} {len(h1_noise_shards):<14}")
        print(f"  {'+ 2-hop':<14} {len(hop2_expanded):<10} {h2_recall:<10.0%} {h2_precision:<12.0%} {len(h2_noise_shards):<14}")

        # Detail the noise
        if h2_noise_shards:
            by_project = {}
            for n in sorted(h2_noise_shards):
                p = shards[n].project if n in shards else "?"
                by_project.setdefault(p, []).append(n)
            noise_parts = []
            for p, names in sorted(by_project.items()):
                noise_parts.append(f"{p}: {', '.join(names)}")
            print(f"\n  2-hop noise breakdown:")
            for part in noise_parts:
                print(f"    {part}")

    # ── Aggregate ──
    print(f"\n{'=' * 95}")
    print("AGGREGATE")
    print(f"{'=' * 95}")

    def mean(xs):
        return sum(xs) / len(xs) if xs else 0

    print(f"\n  {'Metric':<30} {'Keyword':<12} {'+ 1-hop':<12} {'+ 2-hop':<12}")
    print(f"  {'─'*30} {'─'*12} {'─'*12} {'─'*12}")
    print(f"  {'Mean recall':<30} {mean(agg['kw']):<12.0%} {mean(agg['1h']):<12.0%} {mean(agg['2h']):<12.0%}")
    print(f"  {'Mean precision':<30} {mean(agg_prec['kw']):<12.0%} {mean(agg_prec['1h']):<12.0%} {mean(agg_prec['2h']):<12.0%}")
    print(f"  {'Mean shards returned':<30} {mean(agg_total_returned['kw']):<12.1f} {mean(agg_total_returned['1h']):<12.1f} {mean(agg_total_returned['2h']):<12.1f}")
    print(f"  {'Max shards returned':<30} {max(agg_total_returned['kw']):<12} {max(agg_total_returned['1h']):<12} {max(agg_total_returned['2h']):<12}")

    # Precision collapse threshold
    print(f"\n  Tests where 2-hop precision < 20%: ", end="")
    collapsed = sum(1 for p in agg_prec["2h"] if p < 0.20)
    print(f"{collapsed}/7")

    print(f"  Tests where 2-hop returns > 50% of vault: ", end="")
    half_vault = sum(1 for n in agg_total_returned["2h"] if n > len(shards) * 0.5)
    print(f"{half_vault}/7")

    # Per-test summary
    print(f"\n  {'Test':<6} {'Query':<42} {'KW':<6} {'1h':<6} {'2h':<6} {'KW→2h':<8} {'Prec KW':<9} {'Prec 2h':<9} {'Ret 2h':<8}")
    print(f"  {'─'*6} {'─'*42} {'─'*6} {'─'*6} {'─'*6} {'─'*8} {'─'*9} {'─'*9} {'─'*8}")
    for i, t in enumerate(TESTS):
        delta = agg["2h"][i] - agg["kw"][i]
        d_str = f"+{delta:.0%}" if delta > 0 else "—"
        print(f"  {t['id']:<6} {t['query'][:42]:<42} {agg['kw'][i]:<6.0%} {agg['1h'][i]:<6.0%} {agg['2h'][i]:<6.0%} {d_str:<8} {agg_prec['kw'][i]:<9.0%} {agg_prec['2h'][i]:<9.0%} {agg_total_returned['2h'][i]:<8}")

    # ── Noise verdict ──
    print(f"\n{'=' * 95}")
    print("VERDICT")
    print(f"{'=' * 95}")
    mean_prec_kw = mean(agg_prec["kw"])
    mean_prec_2h = mean(agg_prec["2h"])
    mean_ret_2h = mean(agg_total_returned["2h"])
    print(f"\n  Vault size: {len(shards)} shards, {total_edges} edges ({cross_domain} cross-domain)")
    print(f"  2-hop expansion returns on average {mean_ret_2h:.0f} shards ({mean_ret_2h/len(shards)*100:.0f}% of vault)")
    print(f"  Precision drops from {mean_prec_kw:.0%} (keyword) to {mean_prec_2h:.0%} (2-hop)")
    print(f"  Recall gains: {mean(agg['kw']):.0%} → {mean(agg['2h']):.0%}")


if __name__ == "__main__":
    main()
