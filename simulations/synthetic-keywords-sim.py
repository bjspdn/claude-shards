"""
Simulate keyword search with and without synthetic keywords injection.

Loads shards from the actual vault, builds the wikilink graph, and compares
baseline keyword scoring vs scoring with outgoing link target titles appended
to each shard's body.
"""

import re
import yaml
from pathlib import Path
from dataclasses import dataclass, field

VAULT = Path.home() / ".claude-shards" / "knowledge-base"
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:[|#][^\]]*)?]]")

@dataclass
class Shard:
    name: str
    title: str
    type: str
    project: str
    tags: list[str]
    body: str
    outgoing: list[str] = field(default_factory=list)


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

    return shards


def score_entry(shard: Shard, keywords: list[str], extra_body: str = "") -> int:
    score = 0
    title_l = shard.title.lower()
    tags_l = [t.lower() for t in shard.tags]
    body_l = (shard.body + extra_body).lower()
    for kw in keywords:
        kw_l = kw.lower()
        if kw_l in title_l:
            score += 10
        if any(kw_l in t for t in tags_l):
            score += 5
        if kw_l in body_l:
            score += 1
    return score


def run_query(query: str, shards: dict[str, Shard], use_synthetic: bool) -> list[tuple[str, int]]:
    keywords = query.split()
    results = []
    for name, shard in shards.items():
        extra = ""
        if use_synthetic:
            for target in shard.outgoing:
                if target in shards:
                    extra += "\n" + shards[target].title
        sc = score_entry(shard, keywords, extra)
        if sc > 0:
            results.append((name, sc))
    results.sort(key=lambda x: -x[1])
    return results


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


def main():
    shards = load_vault()

    print("=" * 95)
    print(f"SYNTHETIC KEYWORDS SIMULATION — {len(shards)} shards loaded")
    print("Approach: append wikilink target titles to linking shard's body text before scoring")
    print("=" * 95)

    baseline_recalls = []
    synthetic_recalls = []
    baseline_precisions = []
    synthetic_precisions = []

    for test in TESTS:
        q = test["query"]
        ideal = test["ideal_set"]

        baseline = run_query(q, shards, use_synthetic=False)
        synthetic = run_query(q, shards, use_synthetic=True)

        baseline_names = {name for name, _ in baseline}
        synthetic_names = {name for name, _ in synthetic}

        baseline_recall = len(ideal & baseline_names) / len(ideal)
        synthetic_recall = len(ideal & synthetic_names) / len(ideal)
        baseline_recalls.append(baseline_recall)
        synthetic_recalls.append(synthetic_recall)

        baseline_prec = len(ideal & baseline_names) / len(baseline_names) if baseline_names else 0
        synthetic_prec = len(ideal & synthetic_names) / len(synthetic_names) if synthetic_names else 0
        baseline_precisions.append(baseline_prec)
        synthetic_precisions.append(synthetic_prec)

        print(f"\n{'─' * 95}")
        print(f"Test {test['id']} — `{q}`")
        print(f"Ideal set ({len(ideal)}): {sorted(ideal)}")
        print()

        max_rows = max(len(baseline), len(synthetic))
        print(f"  {'BASELINE':<45} {'SYNTHETIC KEYWORDS':<45}")
        print(f"  {'Shard':<35} {'Score':<10} {'Shard':<35} {'Score':<10}")
        print(f"  {'─'*35} {'─'*10} {'─'*35} {'─'*10}")
        for i in range(max_rows):
            b_name = baseline[i][0] if i < len(baseline) else ""
            b_score = str(baseline[i][1]) if i < len(baseline) else ""
            s_name = synthetic[i][0] if i < len(synthetic) else ""
            s_score = str(synthetic[i][1]) if i < len(synthetic) else ""
            b_marker = " *" if b_name in ideal else "  " if b_name else "  "
            s_marker = " *" if s_name in ideal else "  " if s_name else "  "
            print(f"  {b_name:<33}{b_marker} {b_score:<10} {s_name:<33}{s_marker} {s_score:<10}")

        new_shards = synthetic_names - baseline_names
        score_changes = []
        baseline_dict = dict(baseline)
        synthetic_dict = dict(synthetic)
        for name in synthetic_names & baseline_names:
            if synthetic_dict[name] != baseline_dict[name]:
                score_changes.append((name, baseline_dict[name], synthetic_dict[name]))

        print()
        print(f"  Recall:    {baseline_recall:.0%} → {synthetic_recall:.0%}  ", end="")
        if synthetic_recall > baseline_recall:
            print(f"(+{synthetic_recall - baseline_recall:.0%})")
        elif synthetic_recall == baseline_recall:
            print("(no change)")
        else:
            print(f"({synthetic_recall - baseline_recall:+.0%})")
        print(f"  Precision: {baseline_prec:.0%} → {synthetic_prec:.0%}")

        if new_shards:
            new_ideal = new_shards & ideal
            new_noise = new_shards - ideal
            if new_ideal:
                print(f"  NEW ideal-set shards surfaced: {sorted(new_ideal)}")
            if new_noise:
                print(f"  NEW false positives surfaced:   {sorted(new_noise)}")
        if score_changes:
            for name, old, new in sorted(score_changes, key=lambda x: -x[2]):
                marker = "(ideal)" if name in ideal else "(noise)"
                print(f"  Score changed: {name} {old} → {new} {marker}")

    # ── Aggregate ──

    n = len(TESTS)
    mean = lambda xs: sum(xs) / len(xs) if xs else 0

    print(f"\n{'=' * 95}")
    print("AGGREGATE COMPARISON")
    print(f"{'=' * 95}")
    print()
    print(f"  {'Metric':<50} {'Baseline':<12} {'Synthetic':<12} {'Delta':<10}")
    print(f"  {'─'*50} {'─'*12} {'─'*12} {'─'*10}")

    mean_b = mean(baseline_recalls)
    mean_s = mean(synthetic_recalls)
    print(f"  {'Mean recall':<50} {mean_b:<12.0%} {mean_s:<12.0%} {mean_s - mean_b:+.0%}")

    mean_bp = mean(baseline_precisions)
    mean_sp = mean(synthetic_precisions)
    print(f"  {'Mean precision':<50} {mean_bp:<12.0%} {mean_sp:<12.0%} {mean_sp - mean_bp:+.0%}")

    def top2_fp(results, ideal):
        top2 = [name for name, _ in results[:2]]
        return any(name not in ideal for name in top2)

    fp_baseline = sum(1 for t in TESTS if top2_fp(run_query(t["query"], shards, False), t["ideal_set"]))
    fp_synthetic = sum(1 for t in TESTS if top2_fp(run_query(t["query"], shards, True), t["ideal_set"]))
    print(f"  {'Tests with false positive in top 2':<50} {f'{fp_baseline}/{n}':<12} {f'{fp_synthetic}/{n}':<12} {fp_synthetic - fp_baseline:+d}")

    improved = sum(1 for i in range(n) if synthetic_recalls[i] > baseline_recalls[i])
    unchanged = sum(1 for i in range(n) if synthetic_recalls[i] == baseline_recalls[i])
    degraded = sum(1 for i in range(n) if synthetic_recalls[i] < baseline_recalls[i])
    print(f"  {'Tests improved':<50} {'—':<12} {f'{improved}/{n}':<12}")
    print(f"  {'Tests unchanged':<50} {'—':<12} {f'{unchanged}/{n}':<12}")
    print(f"  {'Tests degraded':<50} {'—':<12} {f'{degraded}/{n}':<12}")

    print()
    print(f"  {'Test':<6} {'Query':<45} {'Base':<8} {'Synth':<8} {'Delta':<8}")
    print(f"  {'─'*6} {'─'*45} {'─'*8} {'─'*8} {'─'*8}")
    for i, t in enumerate(TESTS):
        delta = synthetic_recalls[i] - baseline_recalls[i]
        d_str = f"{delta:+.0%}" if delta != 0 else "—"
        print(f"  {t['id']:<6} {t['query'][:45]:<45} {baseline_recalls[i]:<8.0%} {synthetic_recalls[i]:<8.0%} {d_str:<8}")


if __name__ == "__main__":
    main()
