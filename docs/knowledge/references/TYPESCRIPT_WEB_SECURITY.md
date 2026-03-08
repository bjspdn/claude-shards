---
type: references
description: "TypeScript type safety and runtime validation patterns for secure web applications"
tags:
  - typescript
  - security
  - web
  - validation
references:
  - "[[OWASP_TOP_10]]"
created: 2026-03-08
updated: 2026-03-08
status: active
---

# TypeScript Web Security Patterns

## Compile-Time Safety: Strict Mode

TypeScript strict mode (`strict: true` in tsconfig) enables a suite of flags — `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `noImplicitThis` — that catch entire classes of bugs before they reach production. Applications built with strict mode see ~40% fewer type-related bugs reaching production.

Key flags for security:
- `noImplicitAny` — forces explicit typing, preventing untyped data from flowing through unchecked
- `strictNullChecks` — eliminates null/undefined dereference errors that can crash servers or leak error details
- `exactOptionalPropertyTypes` — prevents accidental `undefined` assignment to optional fields

Strict mode is a development-time check only. Types are erased at compile time, so **runtime validation is still required at system boundaries**.

Sources: [TypeScript Strict Mode in Practice](https://dev.to/pipipi-dev/typescript-strict-mode-in-practice-catching-bugs-with-type-safety-3kbk), [TypeScript Doesn't Suck; You Just Don't Care About Security](https://www.securityjourney.com/post/typescript-doesnt-suck-you-just-dont-care-about-security)

## Runtime Safety: Schema Validation (Zod)

TypeScript types vanish after compilation. At system boundaries (API routes, form inputs, file reads, env vars), use a runtime schema validator like Zod to enforce structure and reject malicious payloads before they reach application logic.

What Zod catches:
- **Injection attacks** — unexpected fields or types in request bodies are rejected before reaching SQL/NoSQL/OS interpreters (OWASP A05)
- **XSS payloads** — string refinements (`.max()`, `.regex()`, `.trim()`) constrain input shape
- **DoS via oversized input** — `.max()` on strings and arrays, `.int().positive()` on numbers
- **Prototype pollution** — `.strict()` mode rejects unexpected keys

Pattern: validate at the boundary, trust internally.

```typescript
const CreateUser = z.object({
  email: z.string().email().max(254),
  name: z.string().trim().min(1).max(100),
  age: z.number().int().positive().max(150),
})
type CreateUser = z.infer<typeof CreateUser>
```

Sources: [Zod docs](https://zod.dev/), [Enhancing TypeScript safety with Zod schemas](https://testdouble.com/insights/type-safety-at-runtime-with-zod)

## Supply Chain (OWASP A03)

TypeScript projects inherit the npm ecosystem's supply chain risks — OWASP's #3 risk for 2025. Post-2025 incidents led to tighter npm auth defaults (granular tokens, publish-time 2FA).

Mitigations:
- Pin dependency versions, use lockfiles, audit with `npm audit` / `bun audit`
- Require publish-time 2FA on owned packages
- Use `--ignore-scripts` for untrusted packages
- Run SAST/SCA in CI pipelines

Sources: [TypeScript Security Guide 2025](https://secably.com/learn/language-security/typescript/), [Snyk: Is TypeScript All We Need for Application Security?](https://snyk.io/articles/is-typescript-all-we-need-for-application-security/)

## Secure Defaults Checklist

1. `strict: true` in tsconfig — no exceptions
2. Runtime validation at every system boundary (Zod, Valibot, ArkType)
3. Parameterized queries — never interpolate user input into SQL/NoSQL
4. CSP headers and output encoding — prevent XSS even if validation is bypassed
5. Dependency auditing in CI — catch known CVEs before merge
6. Short-lived, scoped tokens for npm publish and CI secrets
