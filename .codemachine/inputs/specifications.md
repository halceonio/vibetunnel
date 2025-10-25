# VibeTunnel Core Refactor (VT‑Core)

## Current Understanding

**Facts**

* Your fork exists at **halceonio/vibetunnel** and tracks upstream `amantus-ai/vibetunnel`. Recent commits on Oct 23–24, 2025 include: “**Add diff‑based terminal snapshots and cap SSE connections per client**,” “**Improve SSE stream lifecycle and dedupe terminal snapshots**,” “**parallelize terminal bootstrap & cache history**,” “**Improve worker reliability and test resilience**,” and “**terminal direct‑input toggle**.” These confirm an active push to reduce payloads on join/reconnect and stabilize multi‑client behavior. ([GitHub][1])
* Upstream **web** docs describe a **Node/Bun server** in `web/src/server/` handling **REST + WebSocket** (binary) with PTY via `node-pty`, and list typical routes like `/api/sessions` and `…/ws`. Example client code currently connects to **`ws://localhost:4020`** (default upstream port). ([docs.vibetunnel.sh][2])
* Upstream architecture moved **internal IPC** from file watchers to a **binary framed protocol over Unix domain sockets** (per‑session `ipc.sock`) with message types such as `STDIN_DATA`, `CONTROL_CMD`, `STATUS_UPDATE`, `HEARTBEAT`, `ERROR`. ([docs.vibetunnel.sh][3])
* Playwright is documented for E2E testing; best practices emphasize deterministic waits and terminal‑specific assertions. ([docs.vibetunnel.sh][4])
* Industry guidance: **WebSockets** are two‑way and support binary; **SSE** is one‑way (UTF‑8 only) and subject to per‑browser connection limits (e.g., ~6). This underscores consolidating interactive terminal I/O onto WebSockets. ([Ably Realtime][5])

**Your Confirmations / Constraints**

* **Primary OS:** Linux host.
* **Auth:** Keycloak OIDC with optional **group** gating (request `groups` scope when configured).
* **Web UI:** Can be adapted to new WS API; SSE optional for presence.
* **Scale target:** ≤ **50 sessions** with ≤ **10 clients per session** on **8 vCPU / 32 GB RAM**.
* **No Windows support** this cycle; **no recording/redaction policy** now; **single‑box** scale (multi‑node later).
* **Operational:** **Do not use port 4020** (conflicts with prod). **Chrome DevTools MCP** must validate e2e after each cycle with a clean browser (all pages closed beforehand).

**Open Questions (non‑blocking)**

* None required to proceed; we’ll default sensible values where unspecified (e.g., ring buffer size).

---

## 1.0 Project Overview  

**1.1 Name**
**VibeTunnel Core Refactor (VT‑Core)**

**1.2 Goal**
Replace the Node/Bun backend with a **Golang** service optimized for **ultra‑low‑latency terminal I/O** and **robust session/client fan‑out**, integrate **Keycloak OIDC** with optional group gating, and deliver a **seamless device‑switch** UX—browser‑only (Chrome primary, Safari secondary).

**1.3 Target Audience**
Developers and operators who need a fast, VSCode/iTerm/Ghostty‑caliber terminal UX from any device.

---

## 2.0 Core Functionality & User Journeys  

**2.1 Core Features**

* **Session lifecycle:** create, attach/detach, list, terminate.
* **Multi‑client attachment:** up to **10** concurrent viewers per session; **single writer lock** with **direct‑input toggle** (aligns to recent fork changes). ([GitHub][1])
* **Transport:** **WebSocket** (binary frames) for terminal I/O; **SSE (optional)** for presence/notifications. ([docs.vibetunnel.sh][2])
* **State sync:** snapshot‑on‑join + incremental diffs; ring‑buffer replay on resume; per‑client backpressure & coalescing. (Builds on your **diff‑based snapshots** direction.) ([GitHub][1])
* **AuthN/Z:** OIDC (Keycloak) with optional **groups** gate. ([Keycloak][6])
* **Observability:** Prometheus metrics, JSON logs, pprof.
* **Scale:** Single process on 8 vCPU; optional multi‑worker (SO_REUSEPORT + sticky).

**2.2 User Journeys**

* **Desktop → Mobile Handoff**
  User attaches on desktop → server **MUST** send snapshot + start diffs → user leaves → mobile authenticates and reconnects with `last_acked_seq` → server **MUST** replay from ring buffer or send a compact snapshot → user continues seamlessly.

* **Shared Viewing / Read‑Only Guests**
  Owner starts session → up to nine additional clients attach read‑only → server **MUST** broadcast output to all with per‑client backpressure; slow clients **SHOULD** receive coalesced frames or periodic snapshots to catch up.

* **Writer Handoff**
  Owner toggles **direct‑input** → server **MUST** switch writer lock atomically and notify clients via presence events.

* **Group‑Gated Access**
  On WS/SSE/REST attach, server **MUST** verify JWT and **MUST** enforce allowed groups if configured; otherwise any authenticated user allowed. ([Keycloak][6])

---

## 3.0 Data Models  

* **Session:** `id` (UUID), `owner_user_id`, `title`, `cmd`, `env[]`, `cwd`, `cols`, `rows`, `created_at`, `status`, `seq`, `ring_buffer_bytes` (default **1 MiB**).
* **Client:** `id`, `session_id`, `user_id`, `role` (owner/viewer), `last_acked_seq`, `latency_ms_p50/p95`, `ws_state`, `created_at`, `last_seen_at`.
* **AuthContext:** `user_id`, `email`, `groups[]`, `token_exp`.
* **Event:** `type` (attach/detach/role_change/snapshot/output), `session_id`, `client_id`, `seq`, `payload`.

---

## 4.0 Essential Error Handling  

* **Auth failure / group mismatch:** **MUST** return 401/403 with machine‑readable reason.
* **Session not found/terminated:** **MUST** return 404; client **SHOULD** offer session list.
* **Slow client:** **MUST** coalesce frames or send snapshot; **MAY** detach after threshold.
* **Mobile background drop:** **MUST** auto‑reconnect and resume by `last_acked_seq`.
* **Graceful shutdown:** **MUST** drain attaches, flush buffers, close PTYs cleanly.

---

## 5.0 Formal Project Controls & Scope  

**5.1 Document Control**
Version **2.0** • Status **Ready for Build** • Date **Oct 25, 2025**

**5.2 Scope**

* **In Scope:**

  * **Golang** backend (**vt‑core**) replacing Node/Bun server for session/PTY, transport, and auth.
  * **WS‑first** terminal I/O; **SSE optional** for presence. ([docs.vibetunnel.sh][2])
  * **Keycloak OIDC** (Authorization Code + PKCE in web app; JWT verification in server) with **optional `groups`** allow‑list. ([Keycloak][6])
  * **Linux** host first.
  * **Port** default changed to **4620** (configurable) to avoid **4020** conflict noted in upstream docs and your environment. ([docs.vibetunnel.sh][2])
  * **Chrome DevTools MCP** E2E validation after each cycle; clean state (close all pages) requirement codified.
  * Prometheus/pprof/JSON logging; single‑box multi‑worker option.

* **Out of Scope (this cycle):**

  * Windows host support.
  * Multi‑node/Kubernetes HQ mode (keep design hooks).
  * Session recording/redaction policy.

**5.3 Glossary**

* **PTY** – pseudo‑terminal.
* **WS/SSE** – WebSocket / Server‑Sent Events. ([Ably Realtime][5])
* **OIDC** – OpenID Connect (Keycloak). ([Keycloak][6])
* **CDP** – Chrome DevTools Protocol. ([Chrome DevTools][7])

---

## 6.0 Granular & Traceable Requirements  (selected)  

| ID                  | Requirement    | Description                                                                                                                        | Priority |
| ------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **FR‑SES‑001**      | Create Session | `POST /api/sessions` spawns PTY (cols/rows/env/cwd).                                                                               | Critical |
| **FR‑SES‑002**      | Attach over WS | `wss:///ws/sessions/:id` → send **snapshot** then **diffs**; client acks seq.                                                      | Critical |
| **FR‑SES‑003**      | Multi‑client   | ≤10 clients per session; broadcast output with per‑client backpressure.                                                            | Critical |
| **FR‑SES‑004**      | Writer lock    | Exactly one writer; **direct‑input toggle** to hand off.                                                                           | High     |
| **FR‑SES‑005**      | Resume         | On reconnect with `last_acked_seq`, replay ring buffer or re‑snapshot.                                                             | High     |
| **FR‑AUTH‑001**     | OIDC verify    | Validate JWT (issuer, audience, expiry); accept on REST, WS (subprotocol or ticket), SSE.                                          | Critical |
| **FR‑AUTH‑002**     | Group gate     | If `allowed_groups` configured, require `groups` claim match; else allow any authenticated user.                                   | Critical |
| **FR‑OPS‑001**      | Port policy    | Server **MUST NOT** bind 4020; default **4620**; env `VT_PORT` overrides.                                                          | Critical |
| **FR‑TEST‑CDP‑001** | E2E (CDP/MCP)  | CI job runs **Chrome DevTools MCP** tests; **MUST** close all pages/sessions before run; verify create/attach/typing/resume paths. | Critical |
| **FR‑OBS‑001**      | Metrics        | Expose Prom: sessions, clients, bytes/sec, lag, p95 latency, backpressure events.                                                  | High     |

---

## 7.0 Measurable Non‑Functional Requirements (NFRs)  

| ID               | Category      | Requirement                        | Metric / Acceptance                                                                                        |
| ---------------- | ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **NFR‑PERF‑001** | Latency       | Server‑side added latency for echo | ≤20 ms p95 on LAN; ≤50 ms p95 under 50×10 load                                                             |
| **NFR‑PERF‑002** | Throughput    | Broadcast fan‑out                  | 50 sessions × 10 clients receiving bursts totaling ≥1 MB/s aggregate without drops; slow clients coalesced |
| **NFR‑SCAL‑001** | Concurrency   | Session/client limits              | On 8 vCPU/32 GB, CPU ≤70% p95; RSS ≤8 GB (excl. child processes)                                           |
| **NFR‑UX‑001**   | Device switch | Reattach speed                     | Resume to correct state in <1 s                                                                            |
| **NFR‑SEC‑001**  | OIDC          | Token & groups                     | JWT validations pass; group gate enforced when configured. ([Keycloak][6])                                 |
| **NFR‑REL‑001**  | Stability     | No leaks/soak                      | 24‑hour soak: no goroutine leaks; stable memory                                                            |
| **NFR‑TEST‑001** | E2E rigor     | CDP/MCP gate                       | CI pipeline **fails** if MCP E2E doesn’t pass from a clean Chrome                                          |

---

## 8.0 Technical & Architectural Constraints

**8.1 Language Selection: Go (retained)**

* **WS:** `github.com/coder/websocket` (maintained successor to `nhooyr`). ([GitHub][8])
* **PTY:** `github.com/creack/pty` (Linux‑friendly PTY mgmt). *(Library widely used; if your distro needs patches we’ll vendor)*.
* **HTTP:** `net/http` (+ `chi` router).
* **OIDC:** `github.com/coreos/go-oidc` + `golang-jwt/jwt`. **Keycloak** protocol mappers provide `groups` in tokens. ([Keycloak][6])
* **Why Go for Linux host?** Fast I/O and goroutine fan‑out matches your 50×10 target with excellent DX/time‑to‑value compared to a Rust rewrite for this I/O‑bound workload.

**8.2 Topology**
Single **vt‑core** process; goroutines per session/client; optional **N workers** with **SO_REUSEPORT** and **sticky hash on `session_id`**.

**8.3 Transport**

* **WebSocket** for **interactive terminal I/O** (binary frames, seq/ack, backpressure).
* **SSE (optional)** for **presence/lifecycle** events only (avoid per‑tab WS overhead when read‑only). Rationale: WS is two‑way + binary; SSE is one‑way & limited. ([Ably Realtime][5])

**8.4 PTY & IPC**

* Spawn PTY per session, stream directly into a **Session Broadcaster** (no file watchers). Upstream already moved IPC to a **binary framed socket**—we keep that spirit in‑process for speed. ([docs.vibetunnel.sh][3])

**8.5 Diff/Snapshot & Backpressure**

* **Snapshot‑on‑join** (cols×rows grid) → incremental **diff** frames.
* Per‑client bounded queue; **coalesce** adjacent output; if lag persists, **send snapshot** instead of flooding.

**8.6 Web UI Compatibility**

* Keep xterm.js + addons (`fit`, etc.); adapt client to new `wss:///ws/sessions/:id` and presence SSE. ([GitHub][9])
* Replace legacy **4020** references with new default **4620**; expose `VT_BASE_URL` for client bootstrap. (Upstream docs reference 4020 today.) ([docs.vibetunnel.sh][2])

**8.7 Security**

* Verify JWT **per request/attach**; **WS** auth via `Sec-WebSocket-Protocol: bearer, <JWT>` or short‑lived attach ticket.
* Keycloak **groups**: request `groups` scope; alternatively read roles/mapper if groups absent. ([Keycloak][6])

---

## 9.0 Assumptions, Dependencies & Risks  

* **Assumptions:** Linux host; Keycloak available; reverse proxy optional.
* **Dependencies:** Keycloak issuer & JWKS reachable; Chrome available on CI for CDP.
* **Risks & Mitigations**

  * **Mobile Safari quirks:** enforce fast resume & WS‑first; SSE only for presence. ([Ably Realtime][5])
  * **Upstream port conflicts:** default to **4620** and make it explicit in UI and docs (env/config). ([docs.vibetunnel.sh][2])
  * **Group claim variability:** document Keycloak mapper steps to emit `groups`. ([Keycloak][6])

---

## 10.0 Implementation Plan (one full development cycle)

1. **Scaffold vt‑core (Go)**

   * `net/http` + `chi`; config (`VT_PORT`, `VT_BIND`, `VT_ALLOWED_GROUPS`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`).
   * OIDC verifier (discovery, JWKS), middleware, group gate.

2. **PTY + Session Registry**

   * `creack/pty` spawn/resize/kill; session map with lifecycle hooks; per‑session broadcaster & ring buffer (1 MiB default).

3. **Binary WS Protocol**

   * Frames: `OUTPUT`, `SNAPSHOT`, `STATUS` (server→client); `STDIN`, `ACK`, `RESIZE` (client→server). Length‑prefixed (big‑endian) to mirror upstream protocol style. ([docs.vibetunnel.sh][3])

4. **Diff Engine + Backpressure**

   * Efficient line‑based diff; coalescing queues; snapshot fallback for laggards.

5. **Web App Integration**

   * Switch terminal attach to `wss:///ws/sessions/:id`; keep SSE for presence.
   * Update config & env: **no 4020**; use **4620**. (Replace constants seen in docs/examples.) ([docs.vibetunnel.sh][2])

6. **Observability & Ops**

   * Prometheus metrics, pprof, JSON logs; systemd unit; reverse proxy examples.

7. **Chrome DevTools MCP E2E**

   * Add a **CDP‑driven** test runner (Go **chromedp**) invoked via MCP action:

     * **Pre‑step:** **close all pages/targets** via CDP (`Target.getTargets` / `Target.closeTarget`) or start a fresh headless instance with an ephemeral user‑data‑dir to guarantee isolation. ([Chrome DevTools][7])
     * Test flow: open app → create session → assert terminal visible (xterm presence) → type & verify echo → resize → detach → reconnect with `last_acked_seq` → verify replay.
   * Retain Playwright smoke if desired; CDP runs are the **release gate**.

8. **Performance & Soak**

   * Synthetic 50×10 load; measure p95 echo latency, CPU/RSS; slow‑client drills; 24‑hour soak.

9. **Cutover**

   * Feature‑flag the new WS endpoint; flip default; retire Node/Bun server.

---

## 11.0 API & Wire Protocol

**REST (selected)**

* `POST /api/sessions {cmd,cwd,env,cols,rows}` → `{id}`
* `POST /api/sessions/:id/resize {cols,rows}` → 204
* `DELETE /api/sessions/:id` → 204
* `GET /api/sessions/:id` → session metadata

**WS (binary)** `wss://<host>:4620/ws/sessions/:id` (JWT via header or ticket)

* **Server→Client:** `SNAPSHOT {seq, cols, rows, screen_bytes}`, `OUTPUT {seq, payload}`, `STATUS {json}`
* **Client→Server:** `ACK {lastSeq}`, `STDIN {bytes}`, `RESIZE {cols,rows}`

**SSE (optional)** `/sse/events` — presence & role changes only.

---

## 12.0 Security Design

* **OIDC (Keycloak):** verify `iss`, `aud`, signature, expiry; require `groups` match if configured (Keycloak **protocol mappers** control which claims appear in tokens). ([Keycloak][6])
* **WS auth:** `Sec-WebSocket-Protocol: bearer, <JWT>` or short‑lived attach ticket fetched via REST.
* **Process isolation:** Sessions spawn under a controlled service user; env/cwd whitelisting.
* **IPC:** in‑memory broadcaster; no disk file watching (consistent with socket‑first direction). ([docs.vibetunnel.sh][3])

---

## 13.0 Observability & Operations

* **Metrics:** `vt_sessions_active`, `vt_clients_active`, `vt_output_bytes_total`, `vt_client_lag_frames`, `vt_backpressure_events_total`, latency histograms, WS connects.
* **Logs:** JSON with `session_id`/`client_id` correlation; redact control sequences.
* **Profiling:** `pprof` behind admin token.
* **Config:**

  * `VT_BIND=0.0.0.0`
  * `VT_PORT=4620` (**MUST NOT** use 4020) ([docs.vibetunnel.sh][2])
  * `OIDC_ISSUER=https://keycloak.example.com/realms/…`
  * `OIDC_CLIENT_ID=vt-core` • `OIDC_AUDIENCE=vt-core`
  * `VT_ALLOWED_GROUPS=devs,ops` (optional)

---

## 14.0 Testing Strategy

**Unit:** PTY spawn/resize mock, ring buffer, diff engine, OIDC validator.
**Integration:** WS attach, seq/ack/replay; writer toggle; resize; shutdown drain.
**E2E (Chrome DevTools MCP):**

* Launch headless Chrome via **chromedp**; ensure **no prior pages** (close all targets or new user‑data‑dir). ([GitHub][10])
* Drive flows for create/attach/type/resize/detach/resume on both desktop Chrome and Mobile Emulation; assert xterm content & prompt. (xterm.js terminal presence is validated via DOM, e.g., `.xterm`.) ([GitHub][9])
  **Playwright (optional):** Retain a minimal smoke suite; however MCP/CDP remains the gating step. ([docs.vibetunnel.sh][4])
  **Perf:** 50×10 synthetic fan‑out; burst output (e.g., piped data) and observe backpressure counters.
  **Soak:** 24‑hour run, reconnect churn, slow‑client scenarios.

---

## 15.0 Migration Plan

1. Deploy vt‑core on **4620**; keep Node/Bun server idle or on an alternate port (not 4020).
2. Web UI: switch WS endpoint to new path; keep presence SSE if needed.
3. Run MCP E2E & performance soak; cut traffic.
4. Remove Node/Bun server, preserve REST shapes to avoid client changes.

---

## 16.0 Findings from Codebase & Docs (why this refactor is optimal)

* Your recent commits prioritize **diff snapshots**, **SSE lifecycle**, **bootstrap parallelism**, **history caching**, and **worker reliability**—all aligned to latency and multi‑client stability. ([GitHub][1])
* Upstream **web** docs show **WS** handler and **node‑pty**, with examples still pointing to **port 4020** and using **WS for terminal**; our refactor keeps the API shape but moves the heavy lifting to Go for better fan‑out/backpressure and predictable memory use on Linux. ([docs.vibetunnel.sh][2])
* Upstream IPC has already embraced a **binary socket protocol**—our in‑process broadcaster with framed WS messages continues that model without file watchers. ([docs.vibetunnel.sh][3])
* Given SSE limitations and your concurrency target, **WS‑first** is the right default for interactive I/O. ([Ably Realtime][5])

**Conclusion:** Retaining WS+SSE but putting the **core session fan‑out, diffing, backpressure, and auth in Go** will give you the performance headroom and DX you want for **50×10** on a single Linux box, with a straightforward path to multiple workers if needed.

---

## 17.0 Recommendation Summary (language choice locked)

* **Primary backend:** **Golang** (Go)
* **Why Go:** Full‑duplex WS + binary framing, robust PTY libs, fast I/O under goroutines, simpler operational footprint, and rapid time‑to‑value on Linux; well‑supported CDP testing via **chromedp** for your **Chrome DevTools MCP** gate. ([GitHub][8])

---

## 18.0 Acceptance Criteria (including your new notes)

* **Server does not bind to 4020**; default **4620**; configurable via `VT_PORT`. (Upstream examples use 4020; we explicitly diverge.) ([docs.vibetunnel.sh][2])
* **Chrome DevTools MCP** E2E suite runs **after every cycle**; **all pages closed** before tests begin; flows: create → attach → type → resize → detach → resume succeed. (CDP control via chromedp.) ([Chrome DevTools][7])
* **Keycloak OIDC**: tokens verified; **groups** gating works when enabled (Keycloak protocol mapper emits `groups`). ([Keycloak][6])
* **Performance**: meets NFRs (p95 echo latency & 50×10 fan‑out).
* **UX**: Device switching resumes state in <1 s; writer handoff visible; terminal UX comparable to VSCode/iTerm/Ghostty.

---

### Appendix: Source Notes

* **Fork commit history (Oct 23–24 2025)** with diff snapshots, SSE caps, bootstrap parallelism, reliability. ([GitHub][1])
* **Web server/WS/PTy structure** and **port 4020** examples. ([docs.vibetunnel.sh][2])
* **Socket protocol** (binary framed IPC over Unix sockets). ([docs.vibetunnel.sh][3])
* **Playwright testing patterns** (reference for existing tests). ([docs.vibetunnel.sh][4])
* **SSE vs WebSocket** trade‑offs. ([Ably Realtime][5])
* **xterm.js** references used by the web UI. ([GitHub][9])
* **CDP & chromedp** for the MCP gate. ([Chrome DevTools][7])


[1]: https://github.com/halceonio/vibetunnel/commits/main/ "Commits · halceonio/vibetunnel · GitHub"
[2]: https://docs.vibetunnel.sh/docs/platform/web "Web - VibeTunnel"
[3]: https://docs.vibetunnel.sh/web/docs/socket-protocol "Socket protocol - VibeTunnel"
[4]: https://docs.vibetunnel.sh/web/docs/playwright-testing "Playwright testing - VibeTunnel"
[5]: https://ably.com/blog/websockets-vs-sse?utm_source=chatgpt.com "WebSockets vs Server-Sent Events: Key differences and ..."
[6]: https://www.keycloak.org/docs/latest/server_admin/index.html?utm_source=chatgpt.com "Server Administration Guide"
[7]: https://chromedevtools.github.io/devtools-protocol/?utm_source=chatgpt.com "Chrome DevTools Protocol - GitHub Pages"
[8]: https://github.com/coder/websocket?utm_source=chatgpt.com "Minimal and idiomatic WebSocket library for Go"
[9]: https://github.com/xtermjs/xterm.js?utm_source=chatgpt.com "xtermjs/xterm.js: A terminal for the web"
[10]: https://github.com/chromedp/chromedp?utm_source=chatgpt.com "chromedp/chromedp: A faster, simpler way to drive ..."
