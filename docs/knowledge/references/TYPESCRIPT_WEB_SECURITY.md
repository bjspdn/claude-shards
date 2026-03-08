---
type: references
description: "TypeScript type safety, runtime validation, and secure coding patterns for web applications"
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

## The `unknown` vs `any` Anti-Pattern

The `any` type bypasses the entire type system and is the single most common source of type-related security bugs. Any value typed as `any` can flow through the codebase unchecked, defeating both compile-time and runtime safety.

Use `unknown` instead of `any` for values of uncertain type. `unknown` forces explicit narrowing via type guards before the value can be used, ensuring unsafe data is never consumed without validation.

```typescript
// BAD — silently accepts anything, no narrowing required
function process(input: any) { return input.name.toUpperCase(); }

// GOOD — forces validation before use
function process(input: unknown) {
  if (typeof input === 'object' && input !== null && 'name' in input) {
    const name = (input as { name: unknown }).name;
    if (typeof name === 'string') return name.toUpperCase();
  }
  throw new Error('Invalid input');
}
```

Lint rule: enable `@typescript-eslint/no-explicit-any` to catch regressions.

Sources: [Snyk: Is TypeScript All We Need for Application Security?](https://snyk.io/articles/is-typescript-all-we-need-for-application-security/), [Secably TypeScript Security Guide 2025](https://secably.com/learn/language-security/typescript/)

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

## Branded Types for Sensitive Data

Branded (opaque) types create nominally distinct types from structural primitives, preventing accidental misuse of sensitive values at compile time with zero runtime overhead.

Use cases:
- **Sanitized vs unsanitized strings** — a `SanitizedHTML` type prevents raw user input from being rendered without escaping
- **Encrypted vs plaintext** — an `EncryptedString` type ensures plaintext is never stored or transmitted where encrypted data is expected
- **User IDs vs other numeric IDs** — prevents passing an `OrderId` where a `UserId` is required

```typescript
type Brand<T, B extends string> = T & { readonly __brand: B };
type SanitizedHTML = Brand<string, 'SanitizedHTML'>;
type UserId = Brand<number, 'UserId'>;

function sanitize(raw: string): SanitizedHTML {
  return DOMPurify.sanitize(raw) as SanitizedHTML;
}

function renderComment(html: SanitizedHTML) { /* safe to inject into DOM */ }
renderComment('<script>alert(1)</script>'); // compile error
renderComment(sanitize(userInput));         // OK
```

Sources: [Branded Types in TypeScript](https://dev.to/kuncheriakuruvilla/branded-types-in-typescript-beyond-primitive-type-safety-5bba), [Refining TypeScript's Opaque Types](https://asyncmove.com/blog/2025/02/refining-typescripts-opaque-types-for-enhanced-type-safety/)

## Prototype Pollution Prevention

Prototype pollution occurs when an attacker injects properties like `__proto__` or `constructor.prototype` into objects via recursive merges, `JSON.parse`, or query-string parsers. Polluted prototypes affect every object in the runtime, leading to logic errors, privilege escalation, or RCE.

Defenses (use multiple layers):
- **Key sanitization** — reject or strip `__proto__`, `constructor`, and `prototype` keys before any object merge. Prefer an allowlist of permitted keys over a denylist.
- **`Object.create(null)`** — create lookup objects without a prototype chain so polluted `Object.prototype` properties cannot appear.
- **`Map` instead of plain objects** — `Map.get()` only returns directly-set keys, immune to prototype inheritance.
- **`Object.freeze(Object.prototype)`** — prevents modifications to the base prototype. Use cautiously as some libraries depend on extending prototypes.
- **Zod `.strict()` mode** — rejects unexpected keys at the validation boundary before they reach merge logic.

Sources: [OWASP Prototype Pollution Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html), [MDN: Prototype Pollution](https://developer.mozilla.org/en-US/docs/Web/Security/Attacks/Prototype_pollution)

## Command Injection & Dynamic Code Execution

Never pass user-controlled strings to `eval()`, `Function()`, `child_process.exec()`, or template engines that compile to code. These are functionally equivalent to remote code execution.

Mitigations:
- **Avoid `eval` and `new Function`** — use JSON.parse for data, static imports for modules.
- **Use `execFile` / `spawn` over `exec`** — `execFile` bypasses the shell entirely, preventing argument injection. Always pass arguments as an array, never as a concatenated string.
- **Parameterize shell commands** — if shell execution is unavoidable, use a library that handles escaping (e.g., `shell-quote`).

```typescript
// BAD — shell interprets user input
exec(`git log --author="${userInput}"`);

// GOOD — no shell, arguments are array elements
execFile('git', ['log', `--author=${userInput}`]);
```

Sources: [StackHawk: TypeScript Command Injection](https://www.stackhawk.com/blog/typescript-command-injection-examples-and-prevention/), [Kodem: JavaScript/TypeScript Security Playbook](https://www.kodemsecurity.com/resources/javascript-typescript-security-playbook)

## Path Traversal Prevention

Path traversal attacks use sequences like `../` to escape intended directories and read or write arbitrary files. This applies to any server-side TypeScript that resolves file paths from user input.

Defenses:
- **Avoid user input in file paths entirely** — map user-facing identifiers to server-generated paths via a database or lookup table.
- **Resolve and verify** — use `path.resolve()` to get the canonical absolute path, then verify it starts with the expected base directory.
- **Reject suspicious characters** — deny `..`, `~`, null bytes, and backslashes in filenames before any resolution.

```typescript
import path from 'node:path';

const SAFE_BASE = '/data/uploads';

function safePath(userInput: string): string {
  const resolved = path.resolve(SAFE_BASE, userInput);
  if (!resolved.startsWith(SAFE_BASE + path.sep)) {
    throw new Error('Path traversal attempt');
  }
  return resolved;
}
```

Sources: [OWASP: Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal), [StackHawk: Node.js Path Traversal Guide](https://www.stackhawk.com/blog/node-js-path-traversal-guide-examples-and-prevention/)

## Secure Error Handling

Detailed error messages (stack traces, internal paths, query strings) leak implementation details that aid attackers (OWASP A10). TypeScript's type system can help enforce a separation between internal and external error representations.

Rules:
- **Generic messages to clients** — return opaque error codes or messages; never forward raw `Error.message` or `Error.stack` to responses.
- **Detailed logging server-side** — log the full error with context for debugging, but keep it out of HTTP responses.
- **Fail closed** — on unexpected errors, deny the operation rather than defaulting to an insecure state. Roll back partial state changes fully rather than leaving the system in an intermediate state.
- **Centralize error handling** — use a single error handler middleware that maps internal errors to safe HTTP responses.

Sources: [Aptori: Secure Coding in TypeScript](https://www.aptori.com/blog/secure-coding-in-typescript-best-practices-to-build-secure-applications), [CloudDevs: Secure Coding in TypeScript](https://clouddevs.com/typescript/secure-coding/)

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
2. Ban `any` via linting (`@typescript-eslint/no-explicit-any`)
3. Runtime validation at every system boundary (Zod, Valibot, ArkType)
4. Parameterized queries — never interpolate user input into SQL/NoSQL
5. `execFile`/`spawn` over `exec` — never pass user input through a shell
6. Resolve and verify file paths against a base directory
7. Branded types for sanitized/encrypted/sensitive data
8. Generic error responses to clients, detailed logs server-side
9. CSP headers and output encoding — prevent XSS even if validation is bypassed
10. Dependency auditing in CI — catch known CVEs before merge
11. Short-lived, scoped tokens for npm publish and CI secrets
12. `Object.create(null)` or `Map` for user-keyed lookup objects
