# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1.0 | No        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them through one of the following channels:

- **Email**: [security@hasna.dev](mailto:security@hasna.dev)
- **GitHub Security Advisory**: [Report a vulnerability](https://github.com/hasna/assistants/security/advisories/new)

Include the following in your report:

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Affected versions
- Any suggested mitigations or fixes, if available

## What Qualifies as a Security Vulnerability

- SSRF bypasses (e.g., circumventing private IP / internal hostname blocking)
- Path traversal (e.g., reading or writing files outside the allowed project directory)
- Symlink-based attacks that escape path validation
- Command injection through the bash tool or other tool inputs
- Credential or secret exposure (e.g., leaking API keys, tokens, or protected files)
- Sandbox escapes or privilege escalation
- Bypasses of the blocked-command or dangerous-pattern checks

## What Does Not Qualify

- Feature requests or missing functionality
- UI or rendering bugs in the terminal interface
- Performance issues or slow responses
- Issues requiring physical access to the user's machine
- Vulnerabilities in upstream dependencies (report those to the respective projects)

## Response Timeline

- **Acknowledgement**: Within 48 hours of receiving your report
- **Initial assessment**: Within 5 business days
- **Fix for critical vulnerabilities**: Within 30 days
- **Fix for non-critical vulnerabilities**: Within 90 days

You will receive updates as the issue progresses through triage, confirmation, and resolution. If a vulnerability is declined, we will provide an explanation.

## Security Features

The `@hasna/assistants` project includes the following built-in protections:

- **SSRF protection** -- Network requests are validated against private and internal IP ranges (IPv4 and IPv6), including carrier-grade NAT, link-local, loopback, and IPv4-mapped IPv6 addresses. DNS resolution is checked and fails closed on lookup errors to prevent DNS rebinding attacks.
- **Path validation** -- File operations are restricted to the project working directory by default. A blocklist of protected paths (SSH keys, cloud credentials, shell history, password stores, etc.) and protected filename patterns (.env, credentials, private keys) is enforced regardless of allowlist configuration. Symlinks that point outside allowed directories or to protected paths are blocked.
- **Bash command validation** -- Destructive and dangerous shell commands are blocked, including fork bombs, disk formatting (mkfs, dd), direct device writes, eval, command substitution, and piping to shells. A blocklist prevents catastrophic commands like `rm -rf /`.
- **Input validation types** -- Typed severity levels and structured security events ensure consistent handling of threats across the system.
- **Security audit logging** -- All blocked operations are logged with timestamps, severity levels, session IDs, and details. Critical and high-severity events produce immediate console warnings. Logs are persisted to disk in JSONL format for cross-session review.
