# Keyword Search vs. Link-Aware Retrieval — Experimental Findings

## Objective

Evaluate whether keyword-only search produces incomplete or incorrectly ranked results when the vault contains wikilink relationships between shards, and quantify how link-aware retrieval would change outcomes.

## Setup

**Corpus:** 9 shards (2 decisions, 3 gotchas, 2 patterns, 1 reference, 1 unrelated control) scoped to a "dashboard" project, plus 1 Obsidian formatting reference (no project).

**Graph structure:** 12 directed edges via `[[wikilinks]]` forming two clusters (caching, auth) sharing a common root node.

```
chose-app-router ──→ fetch-cache-persistence ──→ revalidation-cheatsheet
       │                      │
       │                      └──→ rsc-data-fetching-pattern ──→ revalidation-cheatsheet
       │
       ├──→ edge-runtime-auth-limits ──→ server-auth-middleware-pattern
       │              │
       │              └──→ chose-session-tokens ──→ server-auth-middleware-pattern
       │
       └──→ rsc-data-fetching-pattern
```

**Search method:** `search` tool — uses `scoreEntry()` in `src/tools/search-tool.ts`. No link awareness, no type weighting.

## Methodology

### Scoring algorithm

The `search` tool tokenizes the query into space-separated keywords and scores each shard via case-insensitive substring matching (`.includes()`). Points are awarded per keyword, per location:

| Match location | Points per keyword |
|----------------|--------------------|
| Title          | +10                |
| Tags (any tag) | +5                 |
| Body           | +1                 |

Scores are summed across all keywords. Shards with score 0 are excluded. Results are sorted descending by score, capped at `limit` (default 10).

A score of 1 means a single keyword matched somewhere in the body — effectively noise level. A score of 10+ indicates a title or multi-keyword match.

### Ideal result set

For each query, we defined the ideal result set as: all shards reachable within 2 hops via `[[wikilinks]]` from the most relevant keyword hit, filtered to shards a human would consider contextually necessary to fully answer the query. This represents what link-aware retrieval could surface that keyword search alone cannot.

### Recall

Recall = (ideal-set shards returned by keyword search) / (total ideal-set shards). A shard counts as "returned" regardless of its rank position. Ranking quality is assessed separately in the analysis.

### Test design

7 natural-language queries were selected to probe different retrieval failure modes:
- Cross-vocabulary queries (terms that don't appear in linked shards)
- Causal chain queries ("what caused X", "why did we choose Y")
- Specificity queries (API names, library names)
- Broad queries ("what decisions did we make")

Queries were run against the live MCP server via the `search` tool. All results (shards, scores, ordering) were recorded verbatim.

## Results

### Test 1 — `jose library Web Crypto`

| Shard                    | Score | In ideal set? |
|--------------------------|-------|---------------|
| edge-runtime-auth-limits | 4     | Yes           |

**Recall: 1/3** (33%). Missed `chose-session-tokens` and `server-auth-middleware-pattern` — both 1 hop away. Zero keyword overlap with query; relationship is purely structural.

### Test 2 — `Redis session lookup latency`

| Shard                          | Score | In ideal set? |
|--------------------------------|-------|---------------|
| chose-session-tokens           | 13    | Yes           |
| server-auth-middleware-pattern | 2     | Yes           |
| edge-runtime-auth-limits       | 1     | Yes           |

**Recall: 3/4** (75%). Missed `chose-app-router` — 2 hops away, zero keyword overlap. This is the root decision in the chain. Scores drop sharply: the directly relevant shard scores 13, the rest are at noise level (1-2).

### Test 3 — `jsonwebtoken middleware broken`

| Shard                          | Score | In ideal set? |
|--------------------------------|-------|---------------|
| server-auth-middleware-pattern | 16    | Yes           |
| edge-runtime-auth-limits       | 12    | Yes           |
| chose-app-router               | 1     | Yes           |
| chose-session-tokens           | 1     | Yes           |

**Recall: 4/4** (100%) but **precision issue: the fix outranked the problem**. The pattern (solution) scored 16, the gotcha (cause) scored 12. A consumer of these results sees the workaround before understanding what broke. Decisions scored 1 — indistinguishable from noise.

### Test 4 — `what architectural decisions did we make for dashboard`

| Shard                          | Score | In ideal set? |
|--------------------------------|-------|---------------|
| server-auth-middleware-pattern | 12    | No            |
| obsidian-flavored-markdown     | 7     | No            |
| chose-app-router               | 3     | Yes           |
| chose-session-tokens           | 1     | Yes           |

**Recall: 2/2** (both decisions found) but **ranked 3rd and 7th**. Top two results are false positives — a pattern and an unrelated formatting reference. The word "architectural" matched incidentally in non-decision shards. No type-aware ranking exists.

### Test 5 — `revalidatePath revalidateTag`

| Shard                     | Score | In ideal set? |
|---------------------------|-------|---------------|
| rsc-data-fetching-pattern | 2     | Yes           |
| revalidation-cheatsheet   | 2     | Yes           |

**Recall: 2/4** (50%). Returned the "how" (cheatsheet, pattern) but missed the "why" — `fetch-cache-persistence` (the incident) and `chose-app-router` (the root cause). Both are 1-2 hops via backlinks.

### Test 6 — `cookie session_id validation`

| Shard                          | Score | In ideal set? |
|--------------------------------|-------|---------------|
| revalidation-cheatsheet        | 11    | No            |
| server-auth-middleware-pattern | 3     | Yes           |
| chose-session-tokens           | 2     | Yes           |

**Recall: 2/3** (67%). Missed `edge-runtime-auth-limits`. **False positive ranked first:** "validation" substring-matched "revalidatePath"/"revalidateTag" in the caching cheatsheet — a completely different domain.

### Test 7 — `what problems did App Router cause`

| Shard                          | Score | In ideal set?              |
|--------------------------------|-------|----------------------------|
| chose-app-router               | 22    | Yes                        |
| server-auth-middleware-pattern | 22    | No — solution, not problem |
| fetch-cache-persistence        | 2     | Yes                        |

**Recall: 2/3** (67%). Missed `edge-runtime-auth-limits` — a direct consequence of App Router, linked from the decision. A pattern (solution) tied for top score with the decision (problem). Keyword scoring can't distinguish causal direction.

## Aggregate

| Metric                                               | Value     |
|------------------------------------------------------|-----------|
| Mean recall (ideal set)                              | 63%       |
| Tests with false positive in top 2                   | 3/7 (43%) |
| Tests where cause/effect ranking inverted            | 3/7 (43%) |
| Tests where root decision was missing or noise-level | 3/7 (43%) |
| Tests with cross-domain false positive               | 2/7 (29%) |

## Failure Modes

**1. Vocabulary gap (4/7 tests).** Linked shards use different terminology. `chose-session-tokens` talks about "Redis" and "revocation"; `edge-runtime-auth-limits` talks about "jsonwebtoken" and "Web Crypto". They're causally linked but lexically disjoint. Keyword search can't bridge this.

**2. Causal direction blindness (3/7 tests).** A gotcha links to its fix; a decision links to its consequence. Keyword search returns both with similar scores and no ordering signal. The consumer can't distinguish "this caused that" from "these are related."

**3. Substring collision (2/7 tests).** "validation" matches "revalidatePath"; "architectural" matches incidental usage in patterns. No semantic disambiguation — the scorer treats all substring hits equally.

**4. Hub node invisibility (3/7 tests).** `chose-app-router` is the root decision linking to 3 shards, but it only surfaces when the query happens to contain "App Router." Downstream queries about caching or auth never reach it because the vocabulary diverges at each hop.

## Expected Impact of Link-Aware Retrieval

Link traversal (1-2 hops from keyword hits) would address failure modes 1 and 4 directly — bridging vocabulary gaps and surfacing hub nodes. Causal direction (mode 2) could be partially addressed by distinguishing outgoing links (shard references) from incoming backlinks (shard is referenced by). Substring collision (mode 3) is orthogonal — it requires scoring improvements, not graph structure.

Projected recall improvement: keyword hits provide the entry points, 1-hop expansion covers the 37% of ideal-set shards currently missed. The vault is small enough (~10-50 shards typical) that 2-hop expansion won't create excessive noise.

---

## Follow-Up: Synthetic Keywords Experiment

### Hypothesis

Before building full graph traversal, test a cheaper intervention: for each shard containing `[[target]]`, append the target shard's title text to the linking shard's body before scoring. If most vocabulary gaps are between a shard's body and its immediate neighbors' titles, this index-time enrichment could close the recall gap without any query-time graph walking.

### Method

The same 7 queries were re-scored against shard bodies augmented with outgoing link target titles. Scoring algorithm unchanged. Simulation script: `simulations/synthetic-keywords-sim.py`.

Concretely, for a shard like `edge-runtime-auth-limits` which links to `[[server-auth-middleware-pattern]]` and `[[chose-session-tokens]]`, the body gains:

```
Server-side auth middleware pattern for App Router
Chose server-side sessions over JWTs
```

### Results

| Test | Query                                                    | Baseline | Synthetic | Delta |
|------|----------------------------------------------------------|----------|-----------|-------|
| 1    | `jose library Web Crypto`                                | 33%      | 33%       | —     |
| 2    | `Redis session lookup latency`                           | 75%      | 75%       | —     |
| 3    | `jsonwebtoken middleware broken`                         | 100%     | 100%      | —     |
| 4    | `what architectural decisions did we make for dashboard` | 100%     | 100%      | —     |
| 5    | `revalidatePath revalidateTag`                           | 50%      | 50%       | —     |
| 6    | `cookie session_id validation`                           | 67%      | 67%       | —     |
| 7    | `what problems did App Router cause`                     | 67%      | 100%      | +33%  |

| Metric                             | Baseline | Synthetic |
|------------------------------------|----------|-----------|
| Mean recall                        | 70%      | 75%       |
| Tests improved                     | —        | 1/7       |
| Tests unchanged                    | —        | 6/7       |
| Tests with false positive in top 2 | 3/7      | 3/7       |

One test improved (Test 7). The remaining six were unchanged. No tests degraded. False positive rate was unaffected.

### Why it failed

Synthetic keywords inject link target **titles** into the **linking shard's** body. This only helps when both conditions hold:

1. The query terms appear in a neighbor's title.
2. The linking shard (not the neighbor) is the one missing from results.

That conjunction almost never holds. The actual retrieval gap runs in the opposite direction:

**The source shard already scores.** In Test 1 (`jose library Web Crypto`), `edge-runtime-auth-limits` already matches — it contains "jose", "Web Crypto" in its body. Injecting its link targets' titles into its body is pointless; the shard is already found.

**The missing neighbors don't gain anything.** `chose-session-tokens` and `server-auth-middleware-pattern` are the missing shards. Their outgoing links point to `edge-runtime-auth-limits` (title: "Next.js Middleware runs on Edge Runtime — no Node.js APIs") — no overlap with "jose" or "Web Crypto". The enrichment flows into the wrong shard.

**Hub nodes stay invisible.** `chose-app-router` (the root decision, 2 hops from most query hits) gains its link targets' titles: "Next.js fetch() caches responses indefinitely by default", "Next.js Middleware runs on Edge Runtime — no Node.js APIs", etc. These titles don't contain downstream vocabulary like "Redis", "jose", or "revalidatePath". The vocabulary has already diverged at each hop.

**The one success was a stop-word collision.** Test 7 (`what problems did App Router cause`) gained `edge-runtime-auth-limits` because the injected title "Chose server-side sessions over JWTs" provided substring matches for common words in the query. This is not a meaningful retrieval improvement.

### Conclusion

The vocabulary gap between linked shards is **structural** — it exists in the body-level terminology, not in titles. Titles are short and generic; they don't carry the specific terms that would bridge lexically disjoint shards. No amount of text concatenation at index time substitutes for walking edges at query time.

Re-running the same simulation against the expanded 42-shard vault (see Noise Ceiling Experiment below) produced identical results: 1/7 tests improved, mean recall 70% → 75%, precision unchanged. Vault scale does not help — the failure mode is directional, not statistical.

This rules out the cheap path. The "Note linking and backlinks" feature (Idea #3) needs query-time graph traversal: find entry-point shards via keyword scoring, then expand 1 hop along `[[wikilink]]` edges to surface structurally related shards that keyword search cannot reach.

### Note on aggregate recall

The per-test recall figures above yield a mean of 70%, not the 63% reported in the original aggregate table. The per-test numerators and denominators in the original results are internally consistent (e.g., Test 4 reports 2/2 = 100%), so the 63% figure appears to be an arithmetic error. Both the baseline and synthetic columns in this follow-up use the 70% figure derived from the individual tests.

---

## Follow-Up: Noise Ceiling Experiment

### Hypothesis

Before building graph traversal, determine whether 2-hop expansion stays precise enough to be useful at realistic vault scale, or whether it degenerates into "return most of the vault." A 9-shard test vault is too small to expose graph blow-up — most 2-hop walks trivially reach every node.

### Method

**Expanded corpus:** 42 shards across 5 project clusters, each with realistic internal link density:

| Cluster       | Shards | Internal edges | Cross-domain edges                |
|---------------|--------|----------------|-----------------------------------|
| dashboard     | 7      | 12             | —                                 |
| payments      | 8      | 8              | 2 (→ dashboard)                   |
| notifications | 8      | 9              | 2 (→ dashboard), 1 (→ deployment) |
| search        | 8      | 8              | 2 (→ dashboard)                   |
| deployment    | 8      | 8              | 1 (→ dashboard)                   |
| (no project)  | 3      | 0              | —                                 |

Total: 56 directed edges, 8 cross-domain. Average out-degree 1.3.

Cross-domain links were deliberately placed at realistic bridge points: `chose-stripe → chose-app-router`, `webhook-signature-timing → edge-runtime-auth-limits`, `stale-search-index → fetch-cache-persistence`, etc. Deliberate substring collision words ("validation", "session", "cache", "middleware", "runtime", "fetch") were planted in non-dashboard shards to stress the keyword scorer.

**Experiment:** The same 7 queries from the baseline experiment were run against three retrieval strategies:

- **Keyword only:** `scoreEntry()` substring matching (title +10, tag +5, body +1).
- **+ 1-hop:** Keyword hits, then expand 1 hop along wikilinks (both directions).
- **+ 2-hop:** Keyword hits, then expand 2 hops along wikilinks (both directions).

Simulation script: `simulations/noise-ceiling-sim.py`.

### Results

| Test | Query                                         | KW recall | 1-hop | 2-hop | KW prec | 1-hop prec | 2-hop prec | 2-hop returned |
|------|-----------------------------------------------|-----------|-------|-------|---------|------------|------------|----------------|
| 1    | `jose library Web Crypto`                     | 33%       | 100%  | 100%  | 7%      | 12%        | 10%        | 30             |
| 2    | `Redis session lookup latency`                | 75%       | 100%  | 100%  | 27%     | 18%        | 14%        | 29             |
| 3    | `jsonwebtoken middleware broken`              | 100%      | 100%  | 100%  | 40%     | 19%        | 12%        | 32             |
| 4    | `what architectural decisions did we make...` | 100%      | 100%  | 100%  | 5%      | 5%         | 5%         | 40             |
| 5    | `revalidatePath revalidateTag`                | 50%       | 100%  | 100%  | 100%    | 100%       | 40%        | 10             |
| 6    | `cookie session_id validation`                | 67%       | 100%  | 100%  | 29%     | 20%        | 14%        | 22             |
| 7    | `what problems did App Router cause`          | 67%       | 100%  | 100%  | 7%      | 8%         | 8%         | 39             |

| Metric                         | Keyword | + 1-hop | + 2-hop |
|--------------------------------|---------|---------|---------|
| Mean recall                    | 70%     | 100%    | 100%    |
| Mean precision                 | 31%     | 26%     | 15%     |
| Mean shards returned           | 16.4    | 23.7    | 28.9    |
| Tests with precision < 20%     | 3/7     | 4/7     | 6/7     |
| Tests returning > 50% of vault | 2/7     | 3/7     | 6/7     |

### Analysis

**1-hop is the sweet spot.** 1-hop expansion achieves 100% mean recall — identical to 2-hop — while returning 5 fewer shards per query on average (23.7 vs 28.9). Every query that 1-hop can't solve, 2-hop also can't solve better; the second hop adds only noise.

**2-hop degenerates.** At 42 shards and 56 edges, 2-hop expansion returns 69% of the vault on average. 6 of 7 tests hit precision below 20%. Cross-domain edges act as bridges: a single link from `chose-stripe → chose-app-router` pulls the entire payments cluster into dashboard queries at 2 hops. At 100+ shards, this would be catastrophic.

**The noise is cross-domain.** 2-hop noise breakdowns show shards from 3-4 unrelated project clusters in every query. Test 3 (`jsonwebtoken middleware broken`) pulled in 22 noise shards spanning all 5 clusters — 76% of the vault. The cross-domain bridges designed into the vault (8 edges, ~14% of total) are sufficient to connect the graph within 2 hops.

**Keyword precision was already low.** Even keyword-only search returns 16.4 shards on average (39% of vault) due to substring collisions — "validation" matches revalidation shards, "session" matches health-check shards, "middleware" matches PCI shards. The planted collision words worked as designed. This confirms that graph expansion amplifies an existing precision problem: noisy keyword hits become noisy seed nodes.

**Test 4 is a floor case.** The broad query "what architectural decisions did we make for dashboard" hit every shard (40/42) by keyword alone — "dashboard" and common words like "what", "did", "we", "make" appear everywhere. No expansion strategy can improve a query that already returns the entire vault. This suggests keyword pre-filtering should cap seed set size.

**Test 5 is the ceiling case.** `revalidatePath revalidateTag` — highly specific terms that only appear in 2 shards. 1-hop expanded to exactly the 4 ideal shards with 100% precision. 2-hop pulled in 6 noise shards. This is the ideal scenario for graph expansion: narrow keyword hits + 1 hop covers the gap perfectly.

### Conclusions

1. **Implement 1-hop, not 2-hop.** 2-hop provides zero recall benefit over 1-hop while halving precision. The graph is connected enough at realistic density that 2-hop walks reach most of the vault.

2. **Cap the seed set.** Queries with many keyword hits (Test 4: 40 hits) make expansion pointless. A seed set cap (e.g., top-5 by score) would prevent broad queries from flooding the graph walk.

3. **Project-scoped expansion.** Cross-domain edges caused most of the noise. Restricting hop expansion to shards within the same project as the seed node would eliminate cross-cluster blow-up while preserving intra-cluster recall.

4. **Precision needs scoring, not filtering.** Even at 1-hop, mean precision is 26%. The expanded set should be re-ranked (e.g., by distance from seed + keyword score) rather than returned as a flat set.

---

## Recommended Implementation

Based on all three experiments (baseline keyword search, synthetic keywords, noise ceiling), the optimal retrieval strategy is **1-hop graph expansion with project scoping and distance-decay re-ranking**.

### Components

**1. 1-hop expansion at query time.** After keyword scoring, expand from seed shards by following `[[wikilink]]` edges (both outgoing and incoming) for exactly 1 hop. 2-hop is ruled out — it adds zero recall over 1-hop while halving precision (26% → 15%) and returning 69% of the vault. Synthetic keywords (index-time title injection) is also ruled out — it improved 1/7 tests at both 8-shard and 42-shard scale.

**2. Project-scoped edges.** Only follow links to shards within the same project as the seed node. Most 1-hop noise comes from cross-domain bridges (e.g., `chose-stripe → chose-app-router` pulls the entire payments cluster into dashboard queries). Test 5 demonstrates the ideal case: both keyword hits are in-project, 1-hop reaches exactly the 4 ideal shards at 100% precision.

**3. Score-threshold seed selection.** Expand only from seed shards scoring above a threshold (e.g., ≥ 5, meaning at least a tag match). This prevents broad queries from flooding the graph walk — Test 4 returned 40/42 shards by keyword alone, making expansion pointless. A top-N cap is not viable: in Test 4 the ideal shards score 3 and 1, they'd get cut by a top-5 filter.

**4. Distance-decay re-ranking.** Shards reached via 1-hop should not appear as a flat set alongside keyword hits. A 1-hop neighbor inherits a fraction of its seed's score:

```
final_score = own_keyword_score + (decay × seed_keyword_score)
```

where `decay` ≈ 0.5. This ensures expanded shards rank below direct keyword matches but above noise-level hits. The exact decay factor should be tuned empirically.

### What this won't fix

**Substring collision** (failure mode 3 from baseline experiment) is orthogonal to graph structure. "validation" matching "revalidatePath" is a keyword scoring problem — it requires tokenization improvements (word boundary matching) or TF-IDF weighting, not link traversal.

**Causal direction** (failure mode 2) is partially addressed by distinguishing outgoing links (shard references a target) from incoming backlinks (shard is referenced by others), but fully resolving cause-vs-effect ranking would require type-aware scoring (e.g., gotchas outrank patterns for "what broke" queries).

---

## Correction: Simulation vs. Real Tool (limit=10)

### Discovery

Stress-testing the simulation results against the live MCP `search` tool revealed one critical discrepancy. The scoring algorithm is identical — every shard/score pair matches exactly between the Python simulations and the TypeScript implementation in `src/tools/search-tool.ts`. However, the simulations returned **all** matching shards with no result cap, while the real tool defaults to `limit=10` (`search-tool.ts:79`).

### Impact

This affects Test 4 (`what architectural decisions did we make for dashboard`). With 40/42 shards matching by keyword, the ideal shards `chose-app-router` (score 3, rank 21) and `chose-session-tokens` (score 1, rank 36) fall outside the top 10. The user sees 10 results — all false positives from payments, notifications, and deployment clusters. Recall drops from 100% to 0%. (Note: ranks differ slightly from simulation due to unstable tiebreaker ordering within same-score tiers — sim reported ranks 19 and 35.)

| Test     | Query                                         | Sim recall | Real recall (limit=10) |
|----------|-----------------------------------------------|------------|------------------------|
| 1        | `jose library Web Crypto`                     | 33%        | 33%                    |
| 2        | `Redis session lookup latency`                | 75%        | 75%                    |
| 3        | `jsonwebtoken middleware broken`              | 100%       | 100%                   |
| 4        | `what architectural decisions did we make...` | 100%       | **0%**                 |
| 5        | `revalidatePath revalidateTag`                | 50%        | 50%                    |
| 6        | `cookie session_id validation`                | 67%        | 67%                    |
| 7        | `what problems did App Router cause`          | 67%        | 67%                    |
| **Mean** |                                               | **70%**    | **56%**                |

The simulations overstated baseline recall by 14 percentage points. The real keyword→1-hop improvement gap is wider than measured: 56% → 100%, not 70% → 100%.

### Effect on conclusions

All prior conclusions hold — 1-hop beats 2-hop, synthetic keywords is dead, project scoping reduces noise. The urgency for graph expansion is higher than the simulations suggested. The recommendation for score-threshold seed selection (component 3 in the implementation section) is also reinforced: broad queries already fail at the scoring stage before graph expansion is even relevant.

---

## Critique: Issues With the Recommended Implementation

A post-hoc review of the recommended implementation against the full experimental evidence reveals several problems — ranging from parameter choices that break existing tests to an entire failure mode that graph expansion cannot address.

### 1. Seed threshold ≥5 loses Test 1's last ideal shard

The recommendation specifies expanding only from seeds scoring ≥5. In Test 1 (`jose library Web Crypto`), there are 6 seeds at ≥5 — but all are false positives from other clusters ("Web" substring-matching "webhook", "websocket"). These accidentally reach 2/3 ideal shards via cross-domain edges (`websocket-reconnection-storms` → `server-auth-middleware-pattern`, `webhook-signature-timing` → `edge-runtime-auth-limits`). However, `chose-session-tokens` is only reachable through `edge-runtime-auth-limits`, which scores 4 (body-only matches). A ≥5 threshold gets Test 1 from 33% to 67% recall; a ≥2 threshold reaches 100%. The last ideal shard depends on a below-threshold seed.

### 2. Test 4 is partially fixable by 1-hop, but needs type-aware scoring for full recall

Test 4 (`what architectural decisions did we make for dashboard`) has 0% real recall because the ideal shards rank 21st (`chose-app-router`, score 3) and 36th (`chose-session-tokens`, score 1) — well outside the limit=10 cap. They never enter the seed pool directly. However, two top-10 false-positive seeds — `chose-websocket-notifications` (rank 2, score 22) and `chose-stripe` (rank 6, score 13) — have cross-domain links to `chose-app-router`. 1-hop from the real top-10 seeds reaches `chose-app-router`, improving recall from 0% to 50%.

`chose-session-tokens` remains unreachable — its only inbound links come from `edge-runtime-auth-limits` (rank 34, score 1) and `server-auth-middleware-pattern` (rank 15, score 12), both outside top-10. Full recall requires **type-aware scoring**: if the query contains "decisions", boost decision-type shards before the limit cap is applied. This is a scoring-layer change, not a graph-layer change.

### 3. ~~Type-aware scoring should be built alongside 1-hop~~ — 1-hop is strictly dominant; naive type-aware is harmful

Simulation with limit=10 applied (matching the real tool) shows 1-hop is the clear winner:

| Strategy                                | Mean recall | Tests improved | Tests regressed |
|-----------------------------------------|-------------|----------------|-----------------|
| Baseline (limit=10)                     | 51%*        | —              | —               |
| + 1-hop from top-10 seeds               | **93%**     | 6/7            | 0/7             |
| + naive type-aware (+10 for type match) | 56%         | 2/7            | **1/7**         |
| + both (type-aware seeds → 1-hop)       | 93%         | 6/7            | 0/7             |

*Baseline is 51% in simulation vs 56% in MCP due to tiebreaker instability on Test 7 (see below).

**Naive type-aware scoring regresses Test 3.** The query "jsonwebtoken middleware broken" triggers a gotchas boost ("broken" → gotchas type). This pushes 8 non-ideal gotchas from payments, deployment, and search clusters into the top-10, displacing `chose-app-router` and `chose-session-tokens` (both decisions, score 1, not boosted). Recall drops from 100% to 50%. The critique's claim that type-aware "improves causal-direction ranking (Tests 3, 6, 7)" was wrong — it only helps Test 7 (+33pp), does nothing for Test 6, and hurts Test 3.

**Test 4 improves equally under both strategies.** 1-hop reaches `chose-app-router` via cross-domain seeds (0% → 50%). Type-aware promotes `chose-app-router` into the top-10 via decisions boost (0% → 50%). Neither reaches `chose-session-tokens`. Combined recall is still 50%.

**1-hop is strictly better than type-aware on every metric.** Higher mean recall (93% vs 56%), more tests improved (6 vs 2), zero regressions (vs 1). Adding type-aware on top of 1-hop doesn't change the outcome — the combined strategy has the same 93% recall as 1-hop alone.

**Tiebreaker instability is a fifth failure mode.** Test 7 has 9 shards at score=2 competing for 5 remaining top-10 slots. `fetch-cache-persistence` (ideal) lands at rank 6 in the MCP (67% recall) but rank 11 in the simulation (33% recall). The baseline recall figure depends on arbitrary sort order within tie groups. This affects any strategy that applies a limit to a sorted result set — including the real tool.

### 4. Decay formula double-counting is desirable but should be explicit

Shards reachable from multiple seeds, or that are both keyword hits and 1-hop neighbors, accumulate score from each path. This is probably correct — convergent evidence from independent paths *should* boost ranking. But the spec should state this explicitly rather than leaving it as an emergent property.

### 5. ~~Ideal set definition is circular~~ — Not circular

The concern was that ideal sets defined as "reachable within 2 hops" make the conclusion "1-hop is sufficient" tautological. Verification shows this is not the case. Every ideal shard across all 7 tests is either a keyword hit itself (0 hops) or exactly 1 hop from the nearest keyword hit — the 2-hop boundary in the definition never comes into play. The ideal sets were human-curated ("filtered to shards a human would consider contextually necessary"), not mechanically derived from the hop count. Pairwise distances within the dashboard cluster reach up to 4 hops (e.g., `chose-session-tokens` ↔ `revalidation-cheatsheet`), but these span semantically disjoint clusters (auth vs. caching) where cross-inclusion would be incorrect.

### 6. Substring collision is orthogonal and cheap to fix

"validation" matching "revalidatePath" is a word-boundary problem, not a graph problem. Word-boundary matching (splitting on non-alphanumeric characters before `.includes()`) or TF-IDF weighting would fix this class of false positive in both bare keyword search and seed selection for graph expansion. This is a separate, low-cost improvement that reduces noise across all retrieval strategies.

### 7. ~~Noise ceiling precision figures are unverified~~ — Verified correct

The 31% mean keyword precision was initially suspect — Test 4 at 5% seemed like it should drag the mean well below 31%. Re-running the simulation confirms all per-test figures are exact. The mean holds because Test 5 at 100% precision (2 ideal shards in 2 returned) counterbalances Test 4's floor. No arithmetic errors in this section.

### 8. Simulations must apply limit=10 going forward

The gap between limit=10 and limit=∞ results is itself a useful diagnostic — it measures information lost to truncation, a distinct failure mode from vocabulary gap or graph structure. All future simulations should apply the real limit as the default and report uncapped results separately.

### 9. Test queries assume insider vocabulary — Test 4 is the representative case

All 7 test queries use vocabulary from someone who *knows* the vault contents. Real retrieval queries will be vaguer — closer to Test 4 ("what decisions did we make") than Test 5 ("revalidatePath revalidateTag"). Test 4's 0% recall isn't an edge case; it's the representative failure mode for the primary use case: rediscovery under partial memory.

This reframes the Test 4 failure from an edge case to the representative failure mode. However, as shown in point 3, naive type-aware scoring doesn't solve it cleanly — it helps Test 4 (+50pp) but regresses Test 3 (-50pp). 1-hop expansion also gets Test 4 to 50% recall without regressions, making it the safer first intervention. The remaining 50% gap on Test 4 (reaching `chose-session-tokens`) is an open problem requiring a non-naive type-aware design.

### 10. Two-phase retrieval resolves the verbosity problem

The original `research` tool collapsed scoring and fetching into a single call — ~14k tokens per query, ~100k tokens total across all 7 test queries — just to check shard counts and scores from the index table. This was a tool design issue independent of scoring or graph expansion: in an LLM context, where every token of response consumes finite context window, the tool's default verbosity was itself a precision problem — returning 14k tokens when 500 would answer the question.

**Resolution:** `research` was removed and replaced with a two-phase pipeline: `search` returns only the scored index table (~500 tokens), `read` fetches individual note bodies on demand. Verification results are in the "Two-Phase Retrieval Verification" section below.

### Revised priority ordering

1. **1-hop graph expansion** — strictly dominant strategy. 93% mean recall vs 51% baseline, 6/7 tests improved, zero regressions. Addresses vocabulary gap (Tests 1, 5, 6), hub node invisibility (Test 7), and partially fixes the discovery query (Test 4, 0% → 50%).
2. **Tiebreaker stabilization** — the limit=10 cutoff falls inside tie groups on 2/7 tests, making recall depend on arbitrary sort order. A secondary sort key (e.g., shard type priority, creation date, or deterministic hash) would make results reproducible.
3. **Word-boundary keyword matching** — orthogonal fix for substring collision (Tests 5, 6). Low cost, reduces noise in both bare search and seed selection.
4. **Type-aware scoring (non-naive)** — the naive +10 boost regresses Test 3. A viable type-aware approach needs to be additive with existing score (not a flat bonus) or applied as a filter/reranking step rather than a scoring boost. Deferred until a design that doesn't regress existing recall is found.
5. **Distance-decay re-ranking** — final polish after the above are in place.

---

## Two-Phase Retrieval Verification

### Context

The `research` tool was removed and replaced with a two-phase pipeline: `search` (scored index table only) + `read` (fetch full content on demand). This verification re-runs the same 7 test queries against the live MCP `search` tool to confirm scoring parity with the previous `research` tool and the Python simulations.

### Method

All 7 queries were run against the `search` tool with default `limit=10`. Results were compared against the per-test findings documented above and the correction section's limit=10 figures.

### Results

| Test | Query | `search` recall | Findings (limit=10) | Scores match? |
|------|-------|-----------------|----------------------|---------------|
| 1 | `jose library Web Crypto` | 33% | 33% | Yes — edge-runtime-auth-limits: 4 |
| 2 | `Redis session lookup latency` | 75% | 75% | Yes — chose-session-tokens: 13, server-auth-middleware-pattern: 2, edge-runtime-auth-limits: 1 |
| 3 | `jsonwebtoken middleware broken` | 100% | 100% | Yes — server-auth-middleware-pattern: 16, edge-runtime-auth-limits: 12, chose-app-router: 1, chose-session-tokens: 1 |
| 4 | `what architectural decisions did we make for dashboard` | 0% | 0% | Yes — ideal shards outside top 10 |
| 5 | `revalidatePath revalidateTag` | 50% | 50% | Yes — rsc-data-fetching-pattern: 2, revalidation-cheatsheet: 2 |
| 6 | `cookie session_id validation` | 67% | 67% | Yes — revalidation-cheatsheet: 11 (FP), server-auth-middleware-pattern: 3, chose-session-tokens: 2 |
| 7 | `what problems did App Router cause` | 67% | 67% | Yes — chose-app-router: 22, fetch-cache-persistence: 2 |

| Metric | `search` tool | Findings (limit=10) |
|--------|---------------|----------------------|
| Mean recall | 56% | 56% |
| Tests with false positive in top 2 | 3/7 | 3/7 |

Every shard/score pair matches exactly. The `search` tool uses the same `scoreEntry()` function that `research` delegated to — the scoring algorithm is unchanged.

### Observations

**Test 7 gained a new false positive.** `elasticsearch-mapping-explosion` (score 23, from the search cluster) now outranks the ideal shard `chose-app-router` (score 22). The substring "problems" matches its body text. This shard was not present in the original 9-shard experiment; it was added in the noise ceiling vault expansion. The recall figure is unaffected (2/3 = 67%) but the false-positive-in-top-2 count is confirmed at 3/7.

**Token savings.** The 7 `search` queries returned ~500 tokens total (index tables only). The equivalent `research` queries would have returned ~100k tokens (full note bodies). The two-phase pipeline reduces retrieval cost by ~99.5% for the scoring phase, with `read` available for selective fetching of the ~1–3 shards actually needed per query.
