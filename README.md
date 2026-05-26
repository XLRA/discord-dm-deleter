<div align="center">

<img src="build/icon.png" alt="Discord DM Deleter" width="128" height="128" />

# Discord DM Deleter

**Wipe your own Discord DM history, on your terms.**

A desktop app for selectively (or completely) deleting *your own* messages in any Discord DM, with intelligent rate limiting and account-safety safeguards baked in.

[![Latest release](https://img.shields.io/github/v/release/XLRA/discord-dm-deleter?display_name=tag&label=download)](../../releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-blue)](../../releases/latest)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[Download](#download) · [Features](#features) · [How it works](#how-it-works) · [Safety](#account-safety) · [FAQ](#faq)

</div>

---

## Download

Grab the latest installer for your OS from the [**Releases page**](../../releases/latest):

| OS | File | Notes |
|---|---|---|
| Windows | `Discord-DM-Deleter-Setup-<version>-x64.exe` (NSIS installer) | Standard installer with Start Menu + Desktop shortcuts |
| Windows | `Discord-DM-Deleter-<version>-x64-Portable.exe` (portable) | Single-file `.exe`, no install needed |
| macOS | `Discord-DM-Deleter-<version>-x64.dmg` / `-arm64.dmg` | Unsigned — see [macOS Gatekeeper](#macos-gatekeeper) |
| Linux | `Discord-DM-Deleter-<version>-x86_64.AppImage` | `chmod +x` then double-click |

> No Discord token to copy/paste, no command line, no terminal. Just open it and sign in with the in-app Discord login.

---

## Features

- **Sign in with Discord** in an embedded login window — no manual token extraction.
- **Pick any DM** (1:1 or group) from a sortable, searchable list.
- **Filter what gets deleted** by:
  - Date range (before / after)
  - Keyword / substring match
  - Has attachments / has embeds / has links
  - Replies-only / pins-excluded
  - Custom message-ID anchors
- **Dual discovery strategy** — uses Discord's search API first, then falls back to full pagination so nothing slips through.
- **Two safety modes** — *Safe* (slow, max paranoia) and *Balanced* (faster, still well under any flag thresholds).
- **Adaptive rate limiting** — respects every `X-RateLimit-*` header Discord returns, applies jitter, and tracks per-channel and global buckets.
- **Live progress + ETA** — scanned, eligible, deleted, skipped, errors, current delete rate per minute.
- **Pause / resume / stop** at any time.
- **Token stored with OS keychain** (`safeStorage` — DPAPI on Windows, Keychain on macOS, libsecret on Linux). Never written in plaintext.
- **Dry-run mode** — preview exactly what *would* be deleted before pulling the trigger.
- **Built-in auto-update** — Windows and Linux builds check this repo's releases on launch and self-update in the background. An in-app banner lets you restart to apply when ready.

---

## How it works

1. Sign in to Discord inside the app's embedded login window. The app extracts your session token from `localStorage` *locally on your machine* — nothing is sent anywhere except to Discord.
2. The app fetches your DM list (`GET /users/@me/channels`).
3. Pick a conversation, configure filters, choose a safety mode.
4. The deletion engine discovers matching messages via Discord's search endpoint (with pagination fallback), then deletes each one with `DELETE /channels/{id}/messages/{id}` — the exact same call your browser makes when you right-click → Delete.
5. The rate limiter and safety monitor sit in front of every request: spacing them out, watching for `429`s and other invalid responses, and aborting early if something looks off.

There is **no** server. There is **no** account creation. Everything happens on your machine, talking directly to `discord.com/api`.

---

## Account safety

Discord's ToS technically prohibits any automation of user accounts. This tool is designed to look as much like a careful human as possible:

- **Conservative defaults.** Safe mode targets ~6–10 deletes/min with randomized human-like jitter. Balanced mode ~20–30/min.
- **Header-driven rate limiting.** Every request honors `X-RateLimit-Remaining` and `X-RateLimit-Reset-After`. Per-channel buckets are tracked separately from global limits.
- **Invalid-request budget tracking.** Discord soft-flags accounts that emit too many `401`/`403`/`429` responses inside a rolling 10-minute window. The safety monitor counts them and **soft-pauses** before you get close, **hard-aborts** if the counter keeps climbing.
- **Consecutive-429 cooldowns.** Three 429s in a row triggers a long backoff. Repeated 429 storms abort the run entirely.
- **Batch pauses.** After every N successful deletes the engine takes a randomized longer break.
- **Pre-filters undeletable messages** (system messages, webhook messages) so the API never sees a doomed request.
- **403-blacklists** any message ID that returns *Missing Permissions* for the rest of the run.
- **Treats 404 as success** (already gone).
- **30-second timeout** on every API call so a hanging request can't quietly stall everything.

> **No tool can promise a zero-risk run.** Mass automation always carries some risk. If account safety matters more than completeness, leave it on **Safe mode** and let it take longer.

---

## Quick start

1. Download the installer from [Releases](../../releases/latest).
2. Open the app and click **Sign in with Discord**. Complete login in the embedded window.
3. Pick a DM, set your filters, pick a safety mode (start with **Safe**).
4. Click **Dry run** first to preview what would be deleted.
5. Happy with the preview? Click **Delete** and confirm.
6. You can pause, resume, or stop at any time. Closing the window cancels the run cleanly.

---

## FAQ

**Can it delete the other person's messages?**
No. Discord only lets you delete your own. Even Nitro doesn't change this. Anyone claiming otherwise is wrong (or lying).

**Can it delete *every* one of my messages in a DM?**
In practice, yes — the dual discovery strategy (search + pagination) is built specifically so nothing falls through search-index gaps. There's no fundamental Discord limit on how many of *your own* messages you can delete from a DM, but Discord will rate-limit you, which is exactly what this tool manages.

**Will I get banned?**
Discord's ToS forbids user-account automation, period. That said, deletes are one of the least-flagged actions, and this tool is engineered to stay well under known soft-flag thresholds. No tool can guarantee safety — use at your own risk, and use Safe mode if you care.

**Where is my token stored?**
Encrypted via your OS's native keychain (`safeStorage`). It never touches disk in plaintext and never leaves your machine except to talk to `discord.com`.

**Does it phone home or collect telemetry?**
No. There is no analytics, no telemetry, no remote server. The app talks to `discord.com/api` and nothing else. The source is in this repo — verify for yourself.

**macOS Gatekeeper**
The macOS build is unsigned (Apple Developer ID certs cost $99/yr). On first launch you'll see a *"can't be opened"* dialog. Right-click the app → **Open** → confirm. Or run `xattr -d com.apple.quarantine "/Applications/Discord DM Deleter.app"` once.

**Windows SmartScreen**
The Windows build is also unsigned. On first launch SmartScreen may warn you. Click **More info** → **Run anyway**. (Or build it yourself from source — see below.)

---

## Build from source

Requires **Node.js 20+** and **npm**.

```bash
git clone https://github.com/XLRA/discord-dm-deleter.git
cd discord-dm-deleter
npm install
npm run dev          # run in dev mode
npm run dist         # build installer for your current OS
npm run dist:win     # force Windows build
npm run dist:mac     # force macOS build
npm run dist:linux   # force Linux build
```

Output installers land in `release/`.

> **Windows local-build note:** `electron-builder` needs symlink permission. Either enable **Developer Mode** (Settings → Privacy & Security → For developers) **or** run the build from an elevated PowerShell. CI builds don't need this — GitHub's Windows runners have it enabled.

---

## Disclaimer

This software is provided "as is", without warranty of any kind. The author is **not affiliated with, endorsed by, or sponsored by Discord Inc.** Use of this tool to automate user accounts may violate Discord's Terms of Service. You assume all risk. See [LICENSE](LICENSE).

---

<div align="center">

Created by **[sleepmare](https://github.com/XLRA)** (Discord: `sleepmare`) · MIT License

</div>
