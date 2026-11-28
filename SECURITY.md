# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/trmnl-horizon/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| latest `main` | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the self-hosted TRMNL BYOS server, e-paper dithering engine, Liquid plugin workbench, HTTP API, device registry and plugin templates.

In scope:

- A path traversal, static-file allowlist bypass or HTTP API flaw that exposes repository internals or unintended local files.
- A cross-site scripting, template injection or HTML injection path through plugin data, device data, Liquid templates or rendered output.
- A request-size, header parsing or device-registry flaw that corrupts another device workspace or crashes the server remotely.
- A template export, BMP export or spreadsheet escaping flaw that makes generated output execute a formula or script when opened.

Out of scope:

- Browser, operating system, firmware or hardware vulnerabilities outside this repository.
- Damage caused by modified copies that do not come from this repository.
- Documented approximation or simulation limits, unless a report shows a specific validation or output integrity failure.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial triage: within 14 calendar days.
- Fix or mitigation target: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.
