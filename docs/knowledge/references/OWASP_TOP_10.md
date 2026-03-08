---
type: references
description: "The 10 most critical web application security risks from the OWASP Top 10 (2025 edition)"
tags:
  - security
  - owasp
  - web
created: 2026-03-06
updated: 2026-03-08
status: active
---

# OWASP Top 10 Critical Vulnerabilities (2025)

Source: https://owasp.org/Top10/2025/

## A01:2025 — Broken Access Control

Restrictions on authenticated users are not properly enforced. Attackers can access unauthorized functionality or data — e.g. modifying other users' accounts, viewing sensitive records, or escalating privileges. Remained #1 from the 2021 edition.

## A02:2025 — Security Misconfiguration

Default credentials, unnecessary features enabled, overly permissive cloud storage, missing security headers, verbose error messages leaking stack traces. Applies to application servers, frameworks, and cloud services. Moved up from A05:2021.

## A03:2025 — Software Supply Chain Failures

New category replacing "Injection" at A03 and absorbing A06:2021 "Vulnerable and Outdated Components". Covers compromised dependencies, malicious updates from trusted vendors (e.g. SolarWinds), and self-propagating package worms (e.g. Shai-Hulud npm worm, 500+ packages). Prevention: maintain SBOMs, source signed packages from official repos, enforce MFA and least-privilege across CI/CD, use staged deployments.

## A04:2025 — Cryptographic Failures

Weak or missing encryption of sensitive data in transit or at rest. Includes using deprecated algorithms (MD5, SHA1), missing TLS, hardcoded keys, or storing passwords in plaintext. Was A02:2021.

## A05:2025 — Injection

Untrusted data sent to an interpreter as part of a command or query. Covers SQL injection, NoSQL injection, OS command injection, and LDAP injection. Prevented by parameterized queries and input validation. Moved from A03:2021.

## A06:2025 — Insecure Design

Flaws in the design and architecture rather than the implementation. Missing threat modeling, insecure business logic, lack of rate limiting, or missing abuse-case testing. Unchanged from A04:2021.

## A07:2025 — Authentication Failures

Weak password policies, missing brute-force protection, session fixation, missing MFA, or exposing session IDs in URLs. Allows credential stuffing and account takeover. Renamed from "Identification and Authentication Failures" (A07:2021).

## A08:2025 — Software or Data Integrity Failures

Code and infrastructure that does not protect against integrity violations. Includes insecure CI/CD pipelines, auto-update without signature verification, and deserialization of untrusted data. Unchanged from A08:2021.

## A09:2025 — Security Logging and Alerting Failures

Insufficient logging of security events, missing alerting, and inability to detect active breaches. Attackers rely on the lack of monitoring to maintain long-term access. Renamed from "Security Logging and Monitoring Failures" (A09:2021).

## A10:2025 — Mishandling of Exceptional Conditions

New category replacing SSRF (A10:2021). Encompasses 24 CWEs around improper error handling: sensitive info in error messages, NULL pointer dereferences, and "failing open" scenarios where systems default to insecure states. Prevention: catch errors at source, fail securely (roll back fully rather than partial recovery), centralize error handling, add rate limiting and resource quotas, deploy observability tooling.
