# Codex Session Startup Failure – Cursor Position Timeout

## Summary
- **Issue**: `codex` sessions launched through VibeTunnel failed with `Error: The cursor position could not be read within a normal duration`.
- **Impact**: Codex CLI refused to start in VibeTunnel web sessions, blocking any GPT‑5 Codex workflows.
- **Root Cause**: The PTY proxy never responded to Codex's ANSI cursor position request (`ESC[6n]`). Codex expects a prompt response (`ESC[row;colR]`) during initialization, and times out when none arrives.

## Investigation Notes
- Verified Codex binary embeds the error string by inspecting `/home/linuxbrew/.linuxbrew/lib/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/codex/codex`.
- Tail of `~/.vibetunnel/log.txt` showed Codex sessions terminating immediately; no cursor response logged.
- Asciinema recordings in `~/.vibetunnel/control/<session>/stdout` lacked any `\u001b[6n` responses, confirming the PTY never answered the query.
- VibeTunnel’s PTY manager already filters data but did not emulate terminal responses for headless sessions.

## Resolution
- Added automatic handling of cursor position queries in `web/src/server/pty/pty-manager.ts`.
  - Detect incoming `ESC[6n` sequences, buffering partial matches across chunk boundaries.
  - Queue a synthetic `ESC[1;1R` reply through the existing input queue and record it for asciinema playback.
  - Track residual prefix in `cursorPositionQueryBuffer` via a new `PtySession` field (`web/src/server/pty/types.ts`).
- The PTY now behaves like a real terminal, unblocking Codex initialization.

## Follow-Up
- Run `pnpm tsc --noEmit --project tsconfig.server.json` once pnpm is available, ensuring server typechecks with the new helpers.
- Retest Codex session launch (direct and via `bash`) to confirm the timeout no longer occurs.
