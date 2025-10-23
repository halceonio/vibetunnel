# VibeTunnel Performance & Streaming Enhancements (October 23, 2025)

This document captures the recent set of server and client changes that focused on improving session performance, reducing log churn, and strengthening our streaming story. Use it as a reference when debugging similar issues or planning further optimisations.

---

## Summary of Changes

### 1. Logging & Flow Control
- **Terminal subscription logs** were moved from `info` to `debug` in `web/src/server/services/terminal-manager.ts` and `buffer-aggregator.ts`. This trimmed the number of synchronous `write()` syscalls emitted during steady-state streaming.
- **Buffer notifications** now compute a lightweight snapshot signature and skip notifying listeners when the screen content hasn’t changed.

### 2. Buffer Diff Encoding
- `TerminalManager.encodeSnapshot(sessionId, snapshot)` caches the last snapshot per session and emits:
  - Full frames the first time (or after dimension changes).
  - Row-level diff frames (flag bit `0x01`) when only a subset of rows changed.
- The binary protocol now carries either full-row records or row+index diff records. Existing clients that don’t send a previous snapshot will fail fast, so we updated the client simultaneously.

### 3. Client-Side Decoder
- `TerminalRenderer.decodeBinaryBuffer(buffer, previousSnapshot)` merges diff payloads onto the cached snapshot.
- `buffer-subscription-service` tracks the last snapshot per session and clears it when unsubscribing or disposing. This guarantees diffs apply cleanly after reconnects.

### 4. SSE Fan-Out Improvements
- Event-stream connections are bucketed by a derived key (`x-vt-client-id` header if supplied, otherwise `IP|User-Agent`).
- The maximum connections per key is configurable via `VIBETUNNEL_MAX_EVENTSTREAM_PER_KEY`. If unset or ≤0, the server permits unlimited concurrent streams.
- When a bucket hits the configured limit we evict the oldest stream before accepting a new one, preventing long-lived sessions from blocking re-connect attempts.

### 5. Command Resolution Cache
- `process-utils.resolveCommand` now uses an in-process PATH scanner + LRU cache rather than spawning `which`/`where` on every session create. This significantly reduces launch latency for workflows that open many short-lived terminals.

---

## Operational Notes

| Area | Behaviour | Controls / Observability |
|------|-----------|--------------------------|
| SSE concurrency | Oldest connection per key is evicted once the cap is reached. | `VIBETUNNEL_MAX_EVENTSTREAM_PER_KEY` env var (Integer). Logs include the key and current bucket size. |
| Buffer diffing | Diff frames carry flag bit `0x01`; row indices are `uint16`. | Debug logs emit “Encoded snapshot (diff)” when a diff is sent. |
| Snapshot caching | Server clones snapshots per session; client keeps last snapshot per subscription. | Clearing a subscription removes the cached snapshot automatically. |
| Logging | High-volume listener events now appear only at `DEBUG`. | Set `VIBETUNNEL_LOG_LEVEL=debug` to reinstate them when troubleshooting. |

---

## Verification & Benchmarks

1. `pnpm run build` completes successfully and bundles the new diff-aware binaries.
2. `pnpm exec tsc --noEmit` ensures type safety across the server/client boundary.
3. Manual profiling with `pidstat` shows:
   - Idle server CPU ~0.8 %.
   - Streaming ~100 lines/s produces ~1.8–4 % CPU on the Node process (the shell generating output still dominates).
4. `node --prof` traces indicate >90 % of ticks sit in C++ syscalls (as expected), with no new hotspots in JS.

---

## Follow-Up Ideas

1. **Expose diagnostics** (e.g. `/metrics`) for SSE bucket occupancy and diff ratios to aid live monitoring.
2. **Dirty-row tracking** directly from xterm.js hooks, eliminating the need to hash/compare full rows.
3. **Client acknowledgements** for diffs to detect and recover from desynchronisation (e.g. on dropped initial frames).
4. **Adaptive diff thresholds** (e.g. fallback to full frame when >60 % of rows changed and the diff would be larger than a fresh snapshot).

---

Document maintained by: `docs@vibetunnel.sh`  
Last updated: 2025-10-23
