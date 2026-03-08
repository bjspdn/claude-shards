# TypeScript Web Security Patterns

## Compile-Time Safety

`strict: true` in tsconfig. Key flags: `noImplicitAny`, `strictNullChecks`, `exactOptionalPropertyTypes`. Types erased at compile time — runtime validation still required at boundaries.

## `unknown` over `any`

`any` bypasses type system entirely. Use `unknown` + type guards to force narrowing. Lint: `@typescript-eslint/no-explicit-any`.

## Runtime Validation (Zod)

Validate at system boundaries (API routes, file reads, env vars). Catches injection, XSS, DoS, prototype pollution. Use `.strict()`, `.max()`, `.regex()`. Trust internally after validation.

## Branded Types

Nominally distinct types from primitives — zero runtime cost. Use for `SanitizedHTML`, `EncryptedString`, `UserId` vs `OrderId`.

## Prototype Pollution

Defend: sanitize keys (`__proto__`, `constructor`), `Object.create(null)`, `Map` over plain objects, Zod `.strict()`.

## Command Injection

Never `eval`/`Function`/`exec` with user input. Use `execFile`/`spawn` with args array.

## Path Traversal

`path.resolve()` then verify starts with base dir + `path.sep`. Reject `..`, `~`, null bytes.

## Error Handling

Generic messages to clients, detailed logs server-side. Fail closed — deny on unexpected errors.

## Supply Chain (OWASP A03)

Pin deps, lockfiles, `npm audit`, publish-time 2FA, `--ignore-scripts` for untrusted packages.

## Checklist

1. `strict: true` 2. Ban `any` 3. Zod at boundaries 4. Parameterized queries 5. `execFile`/`spawn` 6. Path verification 7. Branded types 8. Safe error responses 9. CSP headers 10. Dep auditing 11. Scoped tokens 12. `Object.create(null)`/`Map`