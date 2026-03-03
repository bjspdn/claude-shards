"""Generate a 10,000-note synthetic vault for scaling benchmarks."""

import argparse
import math
import os
import random
import re
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from vault_10k_seeds import SEEDS, NOISE_DOMAINS, TIER_CONFIG

TYPES = ["decisions", "gotchas", "patterns", "references"]
TYPE_WEIGHTS = [0.15, 0.30, 0.25, 0.30]

STOPWORDS = [
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "need", "must", "i", "you", "he",
    "she", "it", "we", "they", "me", "him", "her", "us", "them", "my",
    "your", "his", "its", "our", "their", "what", "which", "who", "this",
    "that", "these", "those", "if", "or", "but", "and", "so", "not", "no",
    "as", "at", "by", "for", "from", "in", "into", "of", "on", "to", "with",
    "about", "between", "through", "during", "before", "after", "then",
    "when", "where", "why", "how", "all", "each", "every", "some", "also",
]

FILLER_SENTENCES = [
    "This required careful coordination across the team.",
    "We spent about a week getting this right.",
    "The initial implementation was straightforward.",
    "Performance benchmarks confirmed the approach.",
    "We documented this for future reference.",
    "The rollout went smoothly after testing.",
    "Several edge cases needed special handling.",
    "The tradeoff was acceptable for our use case.",
    "We revisited this decision after the first quarter.",
    "Monitoring showed no regression after the change.",
    "The team agreed this was the right direction.",
    "We validated this against production traffic.",
    "This simplified the debugging workflow significantly.",
    "The migration path was incremental and reversible.",
    "We kept the old path as a fallback for two sprints.",
]

DECISION_TEMPLATES = [
    "We evaluated {a} vs {b} for {ctx}. {a} won because {reason}. The tradeoff is {tradeoff}.",
    "We debated {a} and {b} for {ctx}. After benchmarking, {a} was the clear winner because {reason}.",
    "We considered {a}, {b}, and {c} for {ctx}. {a} came out ahead because {reason}. {tradeoff}.",
    "The team chose {a} over {b} for {ctx}. {reason}. We accepted the tradeoff of {tradeoff}.",
    "We needed a solution for {ctx}. After comparing {a} and {b}, we went with {a}. {reason}.",
    "For {ctx}, we evaluated {a} against {b}. {a} was simpler to integrate because {reason}.",
    "We switched from {b} to {a} for {ctx}. The migration took about a week. {reason}.",
    "After a spike on {ctx}, we picked {a} over {b}. {reason}. The downside is {tradeoff}.",
    "We chose {a} for {ctx} because {reason}. We had previously tried {b} but it fell short on {tradeoff}.",
    "The decision to use {a} for {ctx} came down to {reason}. {b} was the runner-up but {tradeoff}.",
    "We went back and forth on {a} vs {b} for {ctx}. In the end {a} was better because {reason}.",
    "For {ctx}, {a} beat {b} on every metric we cared about. {reason}.",
    "We prototyped both {a} and {b} for {ctx}. {a} had better ergonomics because {reason}.",
    "After production issues with {b} in {ctx}, we migrated to {a}. {reason}.",
    "We ran {a} and {b} side by side for {ctx} over two weeks. {a} won on throughput because {reason}.",
    "The choice between {a} and {b} for {ctx} was clear after load testing. {reason}.",
    "We picked {a} for {ctx}. {b} looked promising but {tradeoff}. {reason}.",
    "For {ctx} we needed something mature and well-supported. {a} fit the bill over {b} because {reason}.",
    "We originally used {b} for {ctx} but switched to {a} after hitting scaling issues. {reason}.",
    "After evaluating cost, complexity, and team familiarity for {ctx}, we chose {a}. {reason}.",
]

DECISION_REASONS = [
    "it has better performance under load",
    "the community support is stronger",
    "it integrates cleanly with our existing stack",
    "the operational overhead is much lower",
    "it handles our scale requirements out of the box",
    "the debugging experience is significantly better",
    "type safety reduced production incidents",
    "the migration path from our current setup was simpler",
    "it has first-class support for our primary use case",
    "latency benchmarks showed a 3x improvement",
    "the API surface is smaller and easier to reason about",
    "it reduced our infrastructure costs by roughly 40%",
    "the error handling model is more predictable",
    "it supports incremental adoption without a full rewrite",
    "the documentation and examples covered our exact scenario",
]

DECISION_TRADEOFFS = [
    "higher memory usage in exchange for speed",
    "more complex configuration but better defaults in production",
    "a steeper learning curve for new team members",
    "vendor lock-in that we accepted given the timeline",
    "less flexibility for edge cases we rarely encounter",
    "slightly worse cold-start performance",
    "additional operational burden for the infra team",
    "we lose some composability compared to the alternative",
    "the ecosystem is smaller so we write more glue code",
    "debugging is harder when things go wrong at the boundary",
]

GOTCHA_TEMPLATES = [
    "{symptom}. The root cause was {cause}. We fixed it by {fix}.",
    "We hit a bug where {symptom}. It turned out that {cause}. The fix was {fix}.",
    "{symptom}. After hours of debugging, we found that {cause}. {fix}.",
    "Production went down because {symptom}. {cause}. We resolved it by {fix}.",
    "We noticed {symptom} after deploying on Friday. {cause}. The fix: {fix}.",
    "{symptom}. This only happened under high load. {cause}. We worked around it by {fix}.",
    "A subtle issue: {symptom}. The cause was non-obvious: {cause}. {fix}.",
    "We wasted two days on {symptom}. Turns out {cause}. Simple fix: {fix}.",
    "Intermittent failures where {symptom}. The underlying issue was {cause}. {fix}.",
    "{symptom}. This affected all environments. Root cause: {cause}. Resolution: {fix}.",
    "Users reported {symptom}. Investigation revealed {cause}. We shipped {fix} the same day.",
    "{symptom}. This was a regression introduced when {cause}. Rolled back and {fix}.",
    "CI started failing because {symptom}. {cause}. Fixed by {fix}.",
    "The staging environment showed {symptom} but production was fine. {cause}. {fix}.",
    "{symptom}. We only caught this because of our alerting setup. {cause}. {fix}.",
    "A customer escalation led us to discover {symptom}. {cause}. We patched it with {fix}.",
    "{symptom}. This was a classic race condition: {cause}. {fix}.",
    "Memory usage spiked because {symptom}. {cause}. The mitigation was {fix}.",
    "{symptom}. The error message was misleading, but the real issue was {cause}. {fix}.",
    "After upgrading, {symptom}. The breaking change was {cause}. We adapted by {fix}.",
]

GOTCHA_SYMPTOMS = [
    "{term_a} returned stale data after deployments",
    "the {term_a} connection pool was exhausted under load",
    "{term_a} silently dropped events above the rate limit",
    "the {term_a} response time spiked to 30 seconds",
    "{term_a} and {term_b} had conflicting configuration",
    "{term_a} threw cryptic errors during the migration",
    "the {term_a} cache invalidation was not propagating",
    "{term_a} queries timed out after the schema change",
    "the {term_a} integration test suite became flaky",
    "{term_a} failed silently when the upstream was down",
    "{term_a} serialization broke for nested {term_b} objects",
    "the {term_a} index rebuild blocked writes for 20 minutes",
    "{term_a} metrics showed zero throughput despite active traffic",
    "the {term_a} handshake failed intermittently on cold starts",
    "{term_a} consumed all available memory within an hour",
]

GOTCHA_CAUSES = [
    "the default timeout was too aggressive for our workload",
    "a missing index on the {term_a} lookup table",
    "the {term_a} library had an undocumented breaking change in v3",
    "{term_a} and {term_b} used different serialization formats",
    "the connection string had an incorrect {term_a} parameter",
    "a race condition in the {term_a} initialization path",
    "the {term_a} retry logic did not use exponential backoff",
    "{term_a} was configured for the wrong environment",
    "the {term_a} dependency had a memory leak in its connection pooling",
    "a misconfigured {term_a} TTL caused premature eviction",
    "the {term_a} schema migration ran out of order",
    "{term_a} had implicit limits that were not documented",
    "the {term_a} client reused connections that had been closed server-side",
    "a version mismatch between the {term_a} client and server",
    "{term_a} defaulted to synchronous mode without warning",
]

GOTCHA_FIXES = [
    "adding explicit {term_a} timeout configuration",
    "creating a compound index on the {term_a} lookup path",
    "pinning the {term_a} dependency to a known-good version",
    "switching to {term_b} for the serialization layer",
    "adding a health check that validates {term_a} connectivity",
    "wrapping the {term_a} call with proper retry and circuit breaker",
    "adding {term_a} connection pool monitoring and alerting",
    "rewriting the {term_a} initialization to be idempotent",
    "bumping the {term_a} client to the latest patch release",
    "adding a migration step that validates {term_a} state before proceeding",
    "implementing graceful degradation when {term_a} is unavailable",
    "adding rate limiting on the {term_a} ingestion path",
    "switching {term_a} to async mode with proper backpressure",
    "documenting the {term_a} limits and adding validation",
    "adding end-to-end tests that cover the {term_a} failure path",
]

PATTERN_TEMPLATES = [
    "This pattern solves {problem}. The key insight is {insight}. {detail}.",
    "We use this pattern for {problem}. It works by {insight}. {detail}.",
    "Pattern for {problem}. {insight}. This eliminated {detail}.",
    "A reliable approach to {problem}. The core mechanism is {insight}. {detail}.",
    "We standardized on this pattern for {problem}. {insight}. {detail}.",
    "This addresses {problem} by {insight}. {detail}.",
    "Our approach to {problem}: {insight}. {detail}.",
    "This pattern emerged from production issues with {problem}. {insight}. {detail}.",
    "For {problem}, we found that {insight}. {detail}.",
    "This is how we handle {problem}. {insight}. In practice, {detail}.",
    "We developed this pattern after struggling with {problem}. {insight}. {detail}.",
    "The solution to {problem} turned out to be {insight}. {detail}.",
    "This pattern prevents {problem}. {insight}. {detail}.",
    "We adopted this pattern across all services for {problem}. {insight}. {detail}.",
    "After several iterations on {problem}, we landed on {insight}. {detail}.",
]

PATTERN_PROBLEMS = [
    "managing {term_a} state across distributed services",
    "handling {term_a} failures gracefully",
    "scaling {term_a} throughput beyond a single node",
    "coordinating {term_a} and {term_b} lifecycle events",
    "reducing {term_a} latency for the hot path",
    "ensuring {term_a} consistency during deployments",
    "batching {term_a} operations for efficiency",
    "isolating {term_a} failures from the critical path",
    "validating {term_a} input at the boundary",
    "propagating {term_a} context across service boundaries",
    "caching {term_a} results without stale reads",
    "migrating {term_a} schema without downtime",
    "rate limiting {term_a} access per tenant",
    "observing {term_a} behavior in production",
    "testing {term_a} integration in CI",
]

PATTERN_INSIGHTS = [
    "using {term_a} as the source of truth with eventual consistency for {term_b}",
    "applying the {term_a} pattern at the gateway level rather than per-service",
    "{term_a} handles the fast path while {term_b} picks up the overflow asynchronously",
    "idempotency keys based on {term_a} prevent duplicate processing",
    "a thin {term_a} wrapper that normalizes errors across all downstream calls",
    "pre-computing {term_a} at write time rather than read time",
    "{term_a} circuit breakers with configurable thresholds per downstream",
    "the {term_a} queue absorbs traffic spikes while {term_b} processes at steady rate",
    "versioned {term_a} schemas with backward-compatible defaults",
    "a {term_a} middleware that injects context before the handler runs",
    "lazy {term_a} initialization with a double-check lock pattern",
    "{term_a} snapshots taken before each migration step for rollback safety",
    "a {term_a} sidecar that handles retries and circuit breaking transparently",
    "structured {term_a} events that downstream consumers can filter efficiently",
    "a {term_a} fanout pattern where one write triggers multiple read model updates",
]

PATTERN_DETAILS = [
    "the p99 latency dropped from 800ms to under 50ms",
    "we have not had a production incident related to this in six months",
    "this reduced the on-call burden significantly",
    "deploy confidence increased because rollbacks are now instant",
    "the approach scales linearly with traffic",
    "new team members can understand the flow within a day",
    "we reuse this pattern across four services now",
    "the error rate dropped by two orders of magnitude",
    "operational overhead is near zero once configured",
    "this handles the 99th percentile case gracefully",
    "we validated this under 10x normal load during a chaos test",
    "the implementation is under 200 lines with full test coverage",
    "the monitoring dashboard gives immediate visibility into the pattern health",
    "we open-sourced a simplified version of this approach",
    "this also simplified our CI pipeline by removing flaky integration tests",
]

REFERENCE_TEMPLATES = [
    "{desc}\n\n{table}",
    "{desc}\n\n{list_block}",
    "{desc}\n\n{table}\n\n{extra}",
    "{desc}\n\n{list_block}\n\n{extra}",
]

REFERENCE_DESCS = [
    "Quick reference for {term_a} configuration options.",
    "Cheatsheet for common {term_a} operations.",
    "Reference table for {term_a} and {term_b} integration points.",
    "Summary of {term_a} limits and quotas.",
    "Lookup table for {term_a} error codes and their meanings.",
    "Quick guide to {term_a} CLI commands we use regularly.",
    "Reference for {term_a} environment variables and their defaults.",
    "Common {term_a} patterns and their trade-offs at a glance.",
    "Mapping between {term_a} concepts and our internal abstractions.",
    "Decision matrix for choosing between {term_a} modes.",
    "Runbook for {term_a} incident response.",
    "Compatibility matrix for {term_a} versions we support.",
    "Key {term_a} metrics and their acceptable ranges.",
    "Standard {term_a} configuration across all environments.",
    "Quick reference for {term_a} API endpoints and their auth requirements.",
]

REFERENCE_EXTRAS = [
    "Always verify these values against the latest upstream documentation.",
    "These defaults were tuned for our specific traffic pattern.",
    "Last validated against production on 2025-09-15.",
    "The team reviews and updates this reference quarterly.",
    "See the runbook for step-by-step procedures.",
]

CODE_TEMPLATES_TS = [
    'async function handle{Fn}({param}: {Type}): Promise<{Ret}> {{\n  const result = await {svc}.{method}({param});\n  if (!result) throw new Error("{err}");\n  return result;\n}}',
    'const {varName} = await {svc}.{method}({{\n  {param}: {val},\n  timeout: {num},\n}});',
    'export function {fn}({param}: {Type}): {Ret} {{\n  return {svc}\n    .{method}({param})\n    .then((res) => res.{prop})\n    .catch((err) => {{\n      logger.error({{ err, {param} }}, "{err}");\n      throw err;\n    }});\n}}',
    'interface {Type} {{\n  {prop}: string;\n  {prop2}: number;\n  {prop3}?: boolean;\n}}\n\nconst {varName}: {Type} = {{\n  {prop}: "{val}",\n  {prop2}: {num},\n}};',
    'app.{method}("/{route}", async (req, res) => {{\n  const {{ {param} }} = req.{source};\n  const data = await {svc}.{fn}({param});\n  res.json({{ data }});\n}});',
]

CODE_TEMPLATES_PY = [
    'async def {fn}({param}: {type_}) -> {ret}:\n    result = await {svc}.{method}({param})\n    if not result:\n        raise ValueError("{err}")\n    return result',
    'class {Type}:\n    def __init__(self, {param}: str, {param2}: int):\n        self.{param} = {param}\n        self.{param2} = {param2}\n\n    def {method}(self) -> {ret}:\n        return self.{param}',
    '@app.route("/{route}", methods=["{http_method}"])\nasync def {fn}({param}: str):\n    data = await {svc}.{method}({param})\n    return jsonify(data)',
    'def {fn}({param}: {type_}, timeout: int = {num}) -> {ret}:\n    with {svc}.connect(timeout=timeout) as conn:\n        return conn.{method}({param})',
]

CODE_TEMPLATES_GO = [
    'func {Fn}(ctx context.Context, {param} {type_}) ({ret}, error) {{\n\tresult, err := {svc}.{Method}(ctx, {param})\n\tif err != nil {{\n\t\treturn {zero}, fmt.Errorf("{err}: %w", err)\n\t}}\n\treturn result, nil\n}}',
    'type {Type} struct {{\n\t{Prop} string `json:"{prop}"`\n\t{Prop2} int    `json:"{prop2}"`\n}}\n\nfunc (s *{Type}) {Method}() {ret} {{\n\treturn s.{Prop}\n}}',
]

CODE_TEMPLATES_RUST = [
    'pub async fn {fn}({param}: &{Type}) -> Result<{Ret}, Error> {{\n    let result = {svc}.{method}({param}).await?;\n    Ok(result)\n}}',
    'impl {Type} {{\n    pub fn new({param}: String, {param2}: u64) -> Self {{\n        Self {{ {param}, {param2} }}\n    }}\n\n    pub fn {method}(&self) -> &str {{\n        &self.{param}\n    }}\n}}',
]

CODE_TEMPLATES_YAML = [
    '{svc}:\n  {param}: {val}\n  {param2}: {num}\n  replicas: 3\n  resources:\n    limits:\n      memory: "512Mi"\n      cpu: "500m"',
    'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {svc}-config\ndata:\n  {param}: "{val}"\n  {param2}: "{num}"',
]

CODE_TEMPLATES_BASH = [
    '#!/bin/bash\nset -euo pipefail\n\n{SVC}_HOST="${{{SVC}_HOST:-localhost}}"\n{SVC}_PORT="${{{SVC}_PORT:-{num}}}"\n\ncurl -s "http://${{{SVC}_HOST}}:${{{SVC}_PORT}}/{route}" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  | jq ".{prop}"',
]

CODE_TEMPLATES_SQL = [
    'SELECT {col}, {col2}, COUNT(*) as total\nFROM {table}\nWHERE {col} = ${num}\n  AND created_at > NOW() - INTERVAL \'7 days\'\nGROUP BY {col}, {col2}\nORDER BY total DESC\nLIMIT 100;',
    'CREATE INDEX CONCURRENTLY idx_{table}_{col}\n  ON {table} ({col})\n  WHERE {col2} IS NOT NULL;',
]

CODE_TEMPLATES = {
    "typescript": CODE_TEMPLATES_TS,
    "python": CODE_TEMPLATES_PY,
    "go": CODE_TEMPLATES_GO,
    "rust": CODE_TEMPLATES_RUST,
    "yaml": CODE_TEMPLATES_YAML,
    "bash": CODE_TEMPLATES_BASH,
    "sql": CODE_TEMPLATES_SQL,
}

DATE_RANGE_START = date(2024, 6, 1)
DATE_RANGE_END = date(2025, 12, 1)


@dataclass
class NotePlan:
    slug: str
    title: str
    note_type: str
    project: str
    tags: list[str]
    target_words: int
    created: str
    updated: str
    vocab: list[str]
    code_lang: str
    tech_stack: list[str]
    body: str = ""
    links: dict[str, list[str]] = field(default_factory=dict)


parser = argparse.ArgumentParser(description="Generate 10k-note synthetic vault")
parser.add_argument("--output", default=os.path.expanduser("~/.claude-shards/vault-10k/"), help="Output directory")
parser.add_argument("--seed", type=int, default=42, help="Random seed")
parser.add_argument("--dry-run", action="store_true", help="Print stats, no files")
parser.add_argument("--resume", action="store_true", default=True, help="Skip existing files")
parser.add_argument("--validate-only", action="store_true", help="Check existing vault")


def weighted_choice(items: list, weights: list) -> str:
    total = sum(weights)
    r = random.random() * total
    cumulative = 0.0
    for item, w in zip(items, weights):
        cumulative += w
        if r <= cumulative:
            return item
    return items[-1]


def lognormal_word_count() -> int:
    raw = math.exp(random.gauss(5.0, 0.7))
    return max(30, min(800, int(raw)))


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def pick_date_in_range(start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=random.randint(0, delta))


def make_slug(note_type: str, words: list[str], idx: int) -> str:
    w1 = slugify(random.choice(words))
    w2 = slugify(random.choice(words))
    while w2 == w1 and len(words) > 1:
        w2 = slugify(random.choice(words))
    if note_type == "decisions":
        return f"chose-{w1}-{w2}-{idx}"
    elif note_type == "gotchas":
        return f"{w1}-{w2}-gotcha-{idx}"
    elif note_type == "patterns":
        return f"{w1}-{w2}-pattern-{idx}"
    else:
        return f"{w1}-{w2}-reference-{idx}"


def make_title(note_type: str, words: list[str], project_name: str) -> str:
    w1 = random.choice(words)
    w2 = random.choice(words)
    while w2 == w1 and len(words) > 1:
        w2 = random.choice(words)
    if note_type == "decisions":
        return f"Chose {w1} Over {w2} for {project_name.replace('-', ' ').title()}"
    elif note_type == "gotchas":
        return f"{w1} {w2} Caused Issues in {project_name.replace('-', ' ').title()}"
    elif note_type == "patterns":
        return f"{w1} {w2} Pattern"
    else:
        return f"{w1} {w2} Reference"


def distribute(seeds: list[dict], noise_domains: list[dict], target: int = 10000, seed: int = 42) -> list[NotePlan]:
    random.seed(seed)
    plans: list[NotePlan] = []

    for proj in seeds:
        tier_range = TIER_CONFIG[proj["tier"]]
        count = random.randint(tier_range[0], tier_range[1])
        proj_start = pick_date_in_range(DATE_RANGE_START, DATE_RANGE_END)
        active_days = random.randint(60, 365)
        proj_end = proj_start + timedelta(days=active_days)

        cluster_center_count = random.randint(1, max(1, count // 50))
        cluster_centers = [
            pick_date_in_range(proj_start, proj_end)
            for _ in range(cluster_center_count)
        ]

        for i in range(count):
            note_type = weighted_choice(TYPES, TYPE_WEIGHTS)
            title_pool = proj.get("title_words", proj["vocab"][:10])
            slug = make_slug(note_type, title_pool, len(plans))
            title = make_title(note_type, title_pool, proj["name"])
            tags = random.sample(proj["tags"], min(random.randint(2, 4), len(proj["tags"])))

            if random.random() < 0.4 and cluster_centers:
                center = random.choice(cluster_centers)
                offset = int(random.gauss(0, 7))
                created_date = center + timedelta(days=offset)
                created_date = max(proj_start, min(proj_end, created_date))
            else:
                created_date = pick_date_in_range(proj_start, proj_end)

            update_offset = random.randint(0, 30)
            updated_date = min(created_date + timedelta(days=update_offset), date(2026, 3, 2))

            plans.append(NotePlan(
                slug=slug,
                title=title,
                note_type=note_type,
                project=proj["name"],
                tags=tags,
                target_words=lognormal_word_count(),
                created=created_date.isoformat(),
                updated=updated_date.isoformat(),
                vocab=proj["vocab"],
                code_lang=proj.get("code_lang", "typescript"),
                tech_stack=proj.get("tech_stack", []),
            ))

    project_total = len(plans)
    noise_target = target - project_total
    if noise_target < 0:
        noise_target = 0

    for i in range(noise_target):
        domain = random.choice(noise_domains)
        slug = f"noise-{slugify(domain['name'])}-{i}"
        title = f"{domain['display']} Tips {i}"
        tags = [slugify(domain["name"]), "hobby"]
        created_date = pick_date_in_range(DATE_RANGE_START, DATE_RANGE_END)
        updated_date = min(created_date + timedelta(days=random.randint(0, 14)), date(2026, 3, 2))

        plans.append(NotePlan(
            slug=slug,
            title=title,
            note_type=random.choice(TYPES),
            project=domain["name"],
            tags=tags,
            target_words=random.randint(30, 200),
            created=created_date.isoformat(),
            updated=updated_date.isoformat(),
            vocab=domain["vocab"],
            code_lang="bash",
            tech_stack=[],
        ))

    return plans


def pick_terms(vocab: list[str], count: int = 2) -> list[str]:
    if len(vocab) < count:
        return list(vocab)
    return random.sample(vocab, count)


def fill_template(template: str, vocab: list[str]) -> str:
    terms = list(vocab)
    random.shuffle(terms)
    idx = 0

    def next_term():
        nonlocal idx
        t = terms[idx % len(terms)]
        idx += 1
        return t

    result = template
    while "{term_a}" in result:
        result = result.replace("{term_a}", next_term(), 1)
    while "{term_b}" in result:
        result = result.replace("{term_b}", next_term(), 1)
    while "{term_c}" in result:
        result = result.replace("{term_c}", next_term(), 1)
    return result


def generate_filler(vocab: list[str], word_count: int) -> str:
    words = []
    for _ in range(word_count):
        r = random.random()
        if r < 0.30:
            words.append(random.choice(STOPWORDS))
        elif r < 0.60:
            words.append(random.choice(vocab) if vocab else "system")
        else:
            words.append(random.choice(FILLER_SENTENCES).split()[random.randint(0, 3)])
    sentences = []
    i = 0
    while i < len(words):
        sent_len = random.randint(8, 18)
        chunk = words[i:i + sent_len]
        if chunk:
            chunk[0] = chunk[0].capitalize()
            sentences.append(" ".join(chunk) + ".")
        i += sent_len
    return " ".join(sentences)


def generate_decision_body(vocab: list[str], target_words: int) -> str:
    template = random.choice(DECISION_TEMPLATES)
    terms = list(vocab)
    random.shuffle(terms)

    a = terms[0] if len(terms) > 0 else "option-A"
    b = terms[1] if len(terms) > 1 else "option-B"
    c = terms[2] if len(terms) > 2 else "option-C"
    ctx_word = terms[3] if len(terms) > 3 else "the service layer"

    body = template.format(
        a=a, b=b, c=c,
        ctx=f"the {ctx_word} layer",
        reason=random.choice(DECISION_REASONS),
        tradeoff=random.choice(DECISION_TRADEOFFS),
    )

    remaining = target_words - len(body.split())
    if remaining > 10:
        body += " " + generate_filler(vocab, remaining)

    return body


def generate_gotcha_body(vocab: list[str], target_words: int) -> str:
    symptom_tpl = random.choice(GOTCHA_SYMPTOMS)
    cause_tpl = random.choice(GOTCHA_CAUSES)
    fix_tpl = random.choice(GOTCHA_FIXES)

    symptom = fill_template(symptom_tpl, vocab)
    cause = fill_template(cause_tpl, vocab)
    fix = fill_template(fix_tpl, vocab)

    template = random.choice(GOTCHA_TEMPLATES)
    body = template.format(symptom=symptom, cause=cause, fix=fix)

    remaining = target_words - len(body.split())
    if remaining > 10:
        body += "\n\n" + generate_filler(vocab, remaining)

    return body


def generate_code_snippet(lang: str, vocab: list[str], lines: int = 5) -> str:
    templates = CODE_TEMPLATES.get(lang, CODE_TEMPLATES["typescript"])
    template = random.choice(templates)

    terms = list(vocab)
    random.shuffle(terms)

    def safe_term(i):
        t = terms[i % len(terms)] if terms else "item"
        return re.sub(r"[^a-zA-Z0-9]", "", t)

    def cap(s):
        return s[0].upper() + s[1:] if s else "X"

    t0 = safe_term(0)
    t1 = safe_term(1)
    t2 = safe_term(2)
    t3 = safe_term(3)

    replacements = {
        "{Fn}": cap(t0),
        "{fn}": t0,
        "{param}": t1[:8],
        "{param2}": t2[:8],
        "{Type}": cap(t1) + "Config",
        "{type_}": t1[:8],
        "{Ret}": cap(t2) + "Result",
        "{ret}": t2[:8],
        "{svc}": t0 + "Service",
        "{SVC}": t0.upper(),
        "{method}": "get" + cap(t1),
        "{Method}": "Get" + cap(t1),
        "{err}": f"{t0}_failed",
        "{val}": t1 + "-value",
        "{num}": str(random.randint(1000, 9999)),
        "{prop}": t1[:6],
        "{Prop}": cap(t1[:6]),
        "{prop2}": t2[:6],
        "{Prop2}": cap(t2[:6]),
        "{prop3}": t3[:6],
        "{varName}": t0 + cap(t1),
        "{route}": f"api/{t0}/{t1}",
        "{source}": random.choice(["body", "params", "query"]),
        "{table}": t0 + "s",
        "{col}": t1 + "_id",
        "{col2}": t2 + "_type",
        "{zero}": '""' if lang == "go" else "None",
        "{http_method}": random.choice(["GET", "POST"]),
    }

    result = template
    for k, v in replacements.items():
        result = result.replace(k, v)

    return f"```{lang}\n{result}\n```"


def generate_pattern_body(vocab: list[str], code_lang: str, target_words: int) -> str:
    problem_tpl = random.choice(PATTERN_PROBLEMS)
    insight_tpl = random.choice(PATTERN_INSIGHTS)
    detail = random.choice(PATTERN_DETAILS)

    problem = fill_template(problem_tpl, vocab)
    insight = fill_template(insight_tpl, vocab)

    template = random.choice(PATTERN_TEMPLATES)
    body = template.format(problem=problem, insight=insight, detail=detail)

    if random.random() < 0.30:
        snippet = generate_code_snippet(code_lang, vocab, random.randint(3, 10))
        body += "\n\n" + snippet

    remaining = target_words - len(body.split())
    if remaining > 10:
        body += "\n\n" + generate_filler(vocab, remaining)

    return body


def generate_reference_table(vocab: list[str], rows: int = 5) -> str:
    terms = list(vocab)
    random.shuffle(terms)
    headers = ["Name", "Value", "Default", "Notes"]
    lines = ["| " + " | ".join(headers) + " |"]
    lines.append("| " + " | ".join("---" for _ in headers) + " |")
    for i in range(rows):
        t = terms[i % len(terms)]
        val = random.choice(["string", "number", "boolean", "enum"])
        default = random.choice(["null", '"auto"', "true", "false", "0", "30s", "1024"])
        note = random.choice(["required", "optional", "deprecated", "env override", ""])
        lines.append(f"| {t} | {val} | {default} | {note} |")
    return "\n".join(lines)


def generate_reference_list(vocab: list[str], items: int = 5) -> str:
    terms = list(vocab)
    random.shuffle(terms)
    lines = []
    for i in range(items):
        t = terms[i % len(terms)]
        desc = random.choice([
            f"Controls the {t} behavior",
            f"Sets the {t} threshold",
            f"Enables {t} mode",
            f"Path to the {t} configuration",
            f"Maximum {t} retries before failure",
            f"Timeout for {t} operations in ms",
        ])
        lines.append(f"- **{t}**: {desc}")
    return "\n".join(lines)


def generate_reference_body(vocab: list[str], target_words: int) -> str:
    desc_tpl = random.choice(REFERENCE_DESCS)
    desc = fill_template(desc_tpl, vocab)

    if random.random() < 0.6:
        table = generate_reference_table(vocab, random.randint(4, 8))
    else:
        table = generate_reference_list(vocab, random.randint(4, 8))

    extra = random.choice(REFERENCE_EXTRAS) if random.random() < 0.5 else ""

    body = f"{desc}\n\n{table}"
    if extra:
        body += f"\n\n{extra}"

    remaining = target_words - len(body.split())
    if remaining > 10:
        body += "\n\n" + generate_filler(vocab, remaining)

    return body


def generate_noise_body(domain_name: str, vocab: list[str], word_count: int) -> str:
    noise_filler = [
        "technique", "method", "approach", "style", "tradition", "practice",
        "material", "tool", "step", "process", "result", "quality",
        "important", "common", "typical", "standard", "recommended",
    ]
    combined = vocab + noise_filler
    return generate_filler(combined, word_count)


def generate_content(plans: list[NotePlan]) -> None:
    stub_threshold = int(len(plans) * 0.05)
    stub_indices = set(random.sample(range(len(plans)), min(stub_threshold, len(plans))))

    for i, plan in enumerate(plans):
        if i in stub_indices:
            if plan.vocab:
                t = random.choice(plan.vocab)
                plan.body = random.choice([
                    f"We need to revisit the {t} approach. Parking this for now.",
                    f"Placeholder for {t} documentation. TODO: fill in details.",
                    f"Brief note on {t}. More details to follow.",
                    f"Quick stub: {t} is configured but not yet documented.",
                ])
            else:
                plan.body = "Placeholder note. TODO: add content."
            continue

        is_noise = plan.slug.startswith("noise-")

        if is_noise:
            plan.body = generate_noise_body(plan.project, plan.vocab, plan.target_words)
            continue

        if plan.note_type == "decisions":
            plan.body = generate_decision_body(plan.vocab, plan.target_words)
        elif plan.note_type == "gotchas":
            plan.body = generate_gotcha_body(plan.vocab, plan.target_words)
        elif plan.note_type == "patterns":
            plan.body = generate_pattern_body(plan.vocab, plan.code_lang, plan.target_words)
        elif plan.note_type == "references":
            plan.body = generate_reference_body(plan.vocab, plan.target_words)


def assign_links(plans: list[NotePlan]) -> None:
    by_project: dict[str, list[int]] = {}
    by_type: dict[str, list[int]] = {}
    slug_to_idx: dict[str, int] = {}
    idx_to_type: dict[int, str] = {}

    for i, p in enumerate(plans):
        by_project.setdefault(p.project, []).append(i)
        by_type.setdefault(p.note_type, []).append(i)
        slug_to_idx[p.slug] = i
        idx_to_type[i] = p.note_type

    tech_stack_map: dict[str, set[str]] = {}
    for i, p in enumerate(plans):
        for t in p.tech_stack:
            tech_stack_map.setdefault(t, set()).add(p.project)

    cross_project_pairs: set[tuple[str, str]] = set()
    for tech, projects in tech_stack_map.items():
        proj_list = sorted(projects)
        for a_idx in range(len(proj_list)):
            for b_idx in range(a_idx + 1, len(proj_list)):
                cross_project_pairs.add((proj_list[a_idx], proj_list[b_idx]))

    orphan_count = int(len(plans) * 0.20)
    orphan_indices = set(random.sample(range(len(plans)), min(orphan_count, len(plans))))

    hub_decisions: dict[str, list[int]] = {}
    for proj, indices in by_project.items():
        decision_indices = [i for i in indices if plans[i].note_type == "decisions"]
        if len(decision_indices) >= 3:
            hub_decisions[proj] = sorted(decision_indices, key=lambda x: plans[x].target_words, reverse=True)[:3]
        elif decision_indices:
            hub_decisions[proj] = decision_indices

    def add_link(source_idx: int, target_idx: int):
        target_type = plans[target_idx].note_type
        target_slug = plans[target_idx].slug
        wikilink = f"[[{target_slug}]]"
        if target_type not in plans[source_idx].links:
            plans[source_idx].links[target_type] = []
        if wikilink not in plans[source_idx].links[target_type]:
            plans[source_idx].links[target_type].append(wikilink)

    for proj, hubs in hub_decisions.items():
        proj_indices = by_project.get(proj, [])
        non_hub = [i for i in proj_indices if i not in set(hubs) and i not in orphan_indices]
        for hub_idx in hubs:
            if hub_idx in orphan_indices:
                orphan_indices.discard(hub_idx)
            link_count = random.randint(5, min(8, len(non_hub)))
            targets = random.sample(non_hub, min(link_count, len(non_hub)))
            for t in targets:
                add_link(hub_idx, t)

    for i, plan in enumerate(plans):
        if i in orphan_indices:
            continue
        if plan.links:
            continue

        proj_indices = by_project.get(plan.project, [])
        candidates = [j for j in proj_indices if j != i]

        if not candidates:
            continue

        if random.random() < 0.60:
            link_count = 1
        else:
            link_count = 2

        if random.random() < 0.12 and cross_project_pairs:
            partner_projects = set()
            for a, b in cross_project_pairs:
                if a == plan.project:
                    partner_projects.add(b)
                elif b == plan.project:
                    partner_projects.add(a)

            if partner_projects:
                partner = random.choice(sorted(partner_projects))
                partner_indices = by_project.get(partner, [])
                if partner_indices:
                    cross_target = random.choice(partner_indices)
                    add_link(i, cross_target)
                    link_count -= 1

        if link_count > 0 and candidates:
            targets = random.sample(candidates, min(link_count, len(candidates)))
            for t in targets:
                add_link(i, t)


def print_stats(plans: list[NotePlan]) -> None:
    total = len(plans)
    type_counts = {}
    project_counts = {}
    word_counts = []
    orphan_count = 0
    link_counts = []
    cross_project = 0

    slug_to_project = {p.slug: p.project for p in plans}

    for p in plans:
        type_counts[p.note_type] = type_counts.get(p.note_type, 0) + 1
        project_counts[p.project] = project_counts.get(p.project, 0) + 1
        word_counts.append(len(p.body.split()))

        all_links = []
        for links in p.links.values():
            all_links.extend(links)

        link_counts.append(len(all_links))

        if len(all_links) == 0:
            orphan_count += 1

        for link in all_links:
            target_slug = link.strip("[]").replace("[[", "").replace("]]", "")
            target_proj = slug_to_project.get(target_slug, "")
            if target_proj and target_proj != p.project:
                cross_project += 1

    word_counts.sort()
    median_words = word_counts[len(word_counts) // 2] if word_counts else 0
    total_links = sum(link_counts)
    hub_count = sum(1 for lc in link_counts if lc >= 5)

    print(f"\n{'=' * 70}")
    print("VAULT GENERATION STATS")
    print(f"{'=' * 70}")
    print(f"\n  Total notes:          {total}")
    print(f"  Median word count:    {median_words}")
    print(f"  Total links:          {total_links}")
    print(f"  Orphans (0 links):    {orphan_count} ({orphan_count / total * 100:.1f}%)")
    print(f"  Hub notes (5+ links): {hub_count}")
    print(f"  Cross-project links:  {cross_project} ({cross_project / max(total_links, 1) * 100:.1f}%)")

    print(f"\n  Type distribution:")
    for t in TYPES:
        c = type_counts.get(t, 0)
        print(f"    {t:<12} {c:>6} ({c / total * 100:.1f}%)")

    print(f"\n  Top 10 projects by note count:")
    sorted_projects = sorted(project_counts.items(), key=lambda x: -x[1])[:10]
    for proj, count in sorted_projects:
        print(f"    {proj:<30} {count:>5}")


def write_vault(plans: list[NotePlan], output: Path, resume: bool = True) -> None:
    written = 0
    skipped = 0

    for plan in plans:
        dir_ = output / plan.note_type
        path = dir_ / f"{plan.slug}.md"

        if resume and path.exists():
            skipped += 1
            continue

        dir_.mkdir(parents=True, exist_ok=True)

        tags_yaml = "\n".join(f"  - {t}" for t in plan.tags)
        frontmatter = f"""---
type: {plan.note_type}
projects:
  - {plan.project}
tags:
{tags_yaml}"""

        for cat in ["decisions", "patterns", "gotchas", "references"]:
            links = plan.links.get(cat, [])
            if links:
                frontmatter += f"\n{cat}:\n" + "\n".join(f'  - "{v}"' for v in links)

        frontmatter += f"""
created: {plan.created}
updated: {plan.updated}
---"""

        content = f"{frontmatter}\n\n# {plan.title}\n\n{plan.body.strip()}\n"
        path.write_text(content)
        written += 1

        if written % 1000 == 0:
            print(f"  ... wrote {written} files")

    print(f"\n  Done. {written} written, {skipped} skipped.")


def validate_plans(plans: list[NotePlan]) -> None:
    total = len(plans)
    slugs = {p.slug for p in plans}

    type_counts = {}
    word_counts = []
    orphan_count = 0
    hub_count = 0
    cross_project = 0
    total_links = 0
    broken_links = 0

    slug_to_project = {p.slug: p.project for p in plans}

    for p in plans:
        type_counts[p.note_type] = type_counts.get(p.note_type, 0) + 1
        word_counts.append(len(p.body.split()))

        all_links = []
        for links in p.links.values():
            all_links.extend(links)

        total_links += len(all_links)

        if len(all_links) == 0:
            orphan_count += 1
        if len(all_links) >= 5:
            hub_count += 1

        for link in all_links:
            target_slug = link.replace("[[", "").replace("]]", "")
            if target_slug not in slugs:
                broken_links += 1
            else:
                target_proj = slug_to_project.get(target_slug, "")
                if target_proj and target_proj != p.project:
                    cross_project += 1

    word_counts.sort()
    median_words = word_counts[len(word_counts) // 2] if word_counts else 0

    print(f"\n{'=' * 70}")
    print("VALIDATION REPORT")
    print(f"{'=' * 70}")

    checks = []

    in_range = 9500 <= total <= 10500
    checks.append(("Total count in [9500, 10500]", in_range, f"{total}"))

    for t, expected_pct in [("decisions", 15), ("patterns", 25), ("gotchas", 30), ("references", 30)]:
        actual_pct = type_counts.get(t, 0) / total * 100
        ok = abs(actual_pct - expected_pct) < 8
        checks.append((f"{t} ~{expected_pct}%", ok, f"{actual_pct:.1f}%"))

    orphan_pct = orphan_count / total * 100
    orphan_ok = 10 <= orphan_pct <= 30
    checks.append(("~20% orphans", orphan_ok, f"{orphan_pct:.1f}%"))

    checks.append(("Hub decisions exist (5+ links)", hub_count > 0, f"{hub_count} hubs"))

    cross_pct = cross_project / max(total_links, 1) * 100
    cross_ok = 1 <= cross_pct <= 15
    checks.append(("~5% cross-project links", cross_ok, f"{cross_pct:.1f}%"))

    checks.append(("No broken wikilinks", broken_links == 0, f"{broken_links} broken"))

    median_ok = 100 <= median_words <= 200
    checks.append(("Median words in [100, 200]", median_ok, f"{median_words}"))

    for label, ok, detail in checks:
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {label}: {detail}")

    failures = sum(1 for _, ok, _ in checks if not ok)
    if failures == 0:
        print(f"\n  All checks passed.")
    else:
        print(f"\n  {failures} check(s) failed.")


def validate_vault(output_dir: str) -> None:
    vault = Path(output_dir)
    if not vault.exists():
        print(f"  Vault directory not found: {vault}")
        sys.exit(1)

    import yaml as yaml_lib

    plans: list[NotePlan] = []
    errors = 0

    for md in sorted(vault.rglob("*.md")):
        text = md.read_text()
        if not text.startswith("---"):
            continue

        try:
            end = text.index("---", 3)
        except ValueError:
            print(f"  YAML parse error: {md}")
            errors += 1
            continue

        fm_raw = text[3:end].strip()
        body = text[end + 3:].strip()

        try:
            fm = yaml_lib.safe_load(fm_raw)
        except Exception:
            print(f"  YAML parse error: {md}")
            errors += 1
            continue

        note_type = fm.get("type", "")
        projects = fm.get("projects", [])
        tags = fm.get("tags", [])

        links = {}
        for cat in ["decisions", "patterns", "gotchas", "references"]:
            cat_links = fm.get(cat, [])
            if cat_links:
                links[cat] = cat_links

        plans.append(NotePlan(
            slug=md.stem,
            title=md.stem,
            note_type=note_type,
            project=projects[0] if projects else "",
            tags=tags,
            target_words=0,
            created=str(fm.get("created", "")),
            updated=str(fm.get("updated", "")),
            vocab=[],
            code_lang="",
            tech_stack=[],
            body=body,
            links=links,
        ))

    print(f"  Loaded {len(plans)} notes from {vault} ({errors} parse errors)")
    validate_plans(plans)


if __name__ == "__main__":
    args = parser.parse_args()
    random.seed(args.seed)

    if args.validate_only:
        validate_vault(args.output)
        sys.exit(0)

    plans = distribute(SEEDS, NOISE_DOMAINS, target=10000, seed=args.seed)

    generate_content(plans)

    assign_links(plans)

    print_stats(plans)

    if not args.dry_run:
        write_vault(plans, Path(args.output), resume=args.resume)

    validate_plans(plans)
