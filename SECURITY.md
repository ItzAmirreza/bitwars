# Security Policy

Thanks for helping keep BitWars and its players safe. If you've found a security vulnerability, please report it **privately** — never in a public issue or pull request, and never in Discussions or Discord. Public disclosure before a fix is shipped puts every player at risk.

## Supported versions

BitWars has no released or tagged versions — it's a continuously deployed game. Only two things are supported for security purposes:

| What | Supported |
|---|---|
| The live game at [bitwars.io](https://bitwars.io) | Yes |
| The `master` branch of this repository | Yes |

Anything else — forks, old commits, your local instance — is out of scope. Fixes land on `master` and roll out to bitwars.io; there are no back-ported patches.

## Reporting a vulnerability

Report it privately through **GitHub Security Advisories**:

1. Go to the repository's [Security tab](https://github.com/ItzAmirreza/bitwars/security).
2. Click **"Report a vulnerability"**.
3. Fill in the form with as much detail as you can.

This opens a private advisory visible only to you and the maintainer — **do not** open a public issue, post in Discussions, or mention it on Discord.

Please include:

- **What the issue is** — the vulnerability type and the impact you think it has.
- **Where it is** — the affected file, reducer, endpoint, or client system.
- **How to reproduce it** — clear steps, ideally against your own local instance (see [CONTRIBUTING.md](CONTRIBUTING.md) for local setup).
- **Proof of concept** — minimal code, a request, or a description that demonstrates it.
- **Your assessment** — severity, prerequisites, and any ideas for a fix.

The more we can reproduce from your report, the faster it gets fixed.

## Please do NOT

- **Publicly disclose** the issue — in an issue, PR, Discussion, Discord, blog post, or anywhere else — before a fix has shipped and we've agreed on disclosure.
- **Test against the live `bitwars.io` servers** or against other players. Reproduce everything against your own local instance — never on production or real people.
- **Run denial-of-service, load, stress, or spam tests** of any kind. Don't probe production infrastructure. Local testing against your own instance only.
- **Access, modify, or exfiltrate data** that isn't yours, or disrupt other players' games.

Stay within your own local environment and you're squarely in scope.

## What to expect

- **Acknowledgement** — we aim to respond to your advisory within about **72 hours**.
- **Coordinated disclosure** — we'll work with you on a fix and agree on timing before anything is made public. The advisory stays private until the fix is live on bitwars.io.
- **Credit** — if you'd like it, we'll credit you in the published advisory. Tell us how you want to be named, or ask to stay anonymous.

## A note on rewards

BitWars is a non-commercial, source-available project — there's no money behind it and **no paid bug bounty**. What we can offer is genuine thanks, credit in the advisory, and a faster, safer game for everyone. Reports from people who take the time to do this right are hugely appreciated.
