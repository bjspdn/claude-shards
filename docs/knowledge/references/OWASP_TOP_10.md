# OWASP Top 10 (2025)

Source: https://owasp.org/Top10/2025/

**A01 Broken Access Control** — unenforced auth restrictions; unauthorized data/functionality access, privilege escalation. #1 since 2021.

**A02 Security Misconfiguration** — default creds, unnecessary features, permissive cloud storage, missing headers, verbose errors. Was A05:2021.

**A03 Supply Chain Failures** — compromised deps, malicious vendor updates (SolarWinds), package worms. Fix: SBOMs, signed packages, MFA on CI/CD, staged deploys. New; absorbs A06:2021.

**A04 Cryptographic Failures** — weak/missing encryption, deprecated algos (MD5/SHA1), no TLS, hardcoded keys, plaintext passwords. Was A02:2021.

**A05 Injection** — untrusted data to interpreters (SQL, NoSQL, OS, LDAP). Fix: parameterized queries, input validation. Was A03:2021.

**A06 Insecure Design** — architecture flaws, missing threat modeling, no rate limiting, no abuse-case testing. Unchanged A04:2021.

**A07 Authentication Failures** — weak passwords, no brute-force protection, session fixation, no MFA. Enables credential stuffing.

**A08 Integrity Failures** — insecure CI/CD, unsigned auto-updates, untrusted deserialization.

**A09 Logging & Alerting Failures** — insufficient security event logging, no alerting, undetected breaches.

**A10 Mishandling Exceptions** — sensitive info in errors, null derefs, failing open. Fix: fail securely, centralize error handling, rate limit, observability. New; replaces SSRF.