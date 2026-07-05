# Security Policy

Code Janitor formats, analyzes, and can edit local code. It also supports AI providers that may use API keys, so please report security issues privately.

## Reporting a Vulnerability

Use GitHub's private vulnerability reporting flow:

https://github.com/Debanshu2005/code-janitor/security/advisories/new

If that is unavailable, open a minimal public issue asking for a secure contact path. Do not include exploit details, API keys, private source code, tokens, or logs containing secrets in a public issue.

## What to Report

Please report issues such as:

- API keys, tokens, or credentials being logged, stored unsafely, or sent to an unexpected provider.
- Path traversal, unsafe file writes, or edits outside the intended workspace.
- Command execution paths that can be triggered with untrusted input.
- Provider request behavior that leaks more code or workspace metadata than expected.
- Marketplace package contents that include secrets, private files, or unnecessary local artifacts.

## Supported Versions

Security fixes target the latest published version of Code Janitor.

## Handling Expectations

Maintainers will acknowledge valid private reports as soon as practical, investigate impact, and coordinate a fix before public disclosure when needed.
