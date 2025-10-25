# Task Briefing Package

This package contains all necessary information and strategic guidance for the Coder Agent.

---

## 1. Current Task Details

This is the full specification of the task you must complete.

```json
{
  "task_id": "I1.T7",
  "iteration_id": "I1",
  "iteration_goal": "Establish project structure, development environment, core architectural documentation, and CI/CD foundation",
  "description": "Create docker-compose.yml with MinIO (S3-compatible storage), Redis (cache), and Keycloak (OIDC provider) for local development. Include setup scripts to initialize MinIO buckets and Keycloak realm/client.",
  "agent_type_hint": "SetupAgent",
  "inputs": "Section 2 (Technology Stack), Section 3.9 (Deployment View), project requirements",
  "target_files": [
    "deployment/docker-compose.yml",
    "deployment/minio-setup.sh",
    "deployment/keycloak-setup.sh"
  ],
  "input_files": [],
  "deliverables": "docker-compose.yml with 3 services: minio, redis, keycloak, MinIO configured with default credentials and health check, Redis configured with persistence enabled, Keycloak configured with realm `platforms`, client `nudrive`, Setup scripts create `nudrive-thumbs` bucket and configure CORS",
  "acceptance_criteria": "`docker-compose up` starts all services without errors, MinIO accessible at http://localhost:9000 with console at :9001, Redis accessible at localhost:6379, Keycloak accessible at http://localhost:8080 with realm `platforms`, Setup scripts are idempotent (can run multiple times safely), README.md updated with local dev setup instructions",
  "dependencies": ["I1.T1"],
  "parallelizable": true,
  "done": false
}
```

---

## 2. Architectural & Planning Context

The following are the relevant sections from the architecture and plan documents, which I found by analyzing the task description.

### Context: Technology Stack - Backend Services (from 02_Architecture_Overview.md)

```markdown
#### Backend Services

| Category | Technology | Justification |
|----------|------------|---------------|
| **Language** | Go 1.21+ | Performance; concurrency primitives (goroutines); single binary deployment; AWS SDK maturity |
| **HTTP Framework** | Gin or Chi | Lightweight; middleware support; fast routing; idiomatic Go patterns |
| **S3 SDK** | AWS SDK for Go v2 | Official AWS SDK; presigning support; S3-compatible endpoint configuration; connection pooling |
| **Image Processing** | libvips via bimg | Fastest image processing library; low memory footprint; WebP support; resize/crop operations |
| **Video Processing** | ffmpeg (CLI wrapper) | Industry standard; extract poster frames; supports all major codecs |
| **PDF Rendering** | pdfium or poppler (CLI wrapper) | Rasterize PDF pages to images; text extraction |
| **OIDC Validation** | coreos/go-oidc | Standard OIDC library; JWT signature verification; key rotation support |
| **Redis Client** | go-redis/redis | Connection pooling; pipelining; cluster support; idiomatic Go API |
| **Logging** | zerolog or zap | Structured JSON logging; zero-allocation; log level filtering; contextual fields |
| **Metrics** | Prometheus client_golang | Standard metrics library; histogram/counter/gauge support; HTTP handler |
| **Tracing** | OpenTelemetry Go SDK | Distributed tracing; span context propagation; OTLP export |
| **Testing** | Go standard library (testing) + testify | Built-in test runner; table-driven tests; assertions library; mocking support |
```

### Context: Technology Stack - Storage & Backends (from 02_Architecture_Overview.md)

```markdown
#### Storage & Backends

| Category | Technology | Justification |
|----------|------------|---------------|
| **Primary Storage** | MinIO | Open-source; S3-compatible; high performance; on-prem + cloud deployable |
| **Cloud Storage** | Cloudflare R2 (S3-compatible) | Zero egress fees; global edge caching; S3 API compatibility |
| **Cloud Storage** | AWS S3 | Industry standard; 99.999999999% durability; lifecycle policies |
| **Cache** | Redis 7+ | Sub-millisecond latency; persistent cache; data structures (hash, set); pub/sub support |
```

### Context: Technology Stack - Authentication & Authorization (from 02_Architecture_Overview.md)

```markdown
#### Authentication & Authorization

| Category | Technology | Justification |
|----------|------------|---------------|
| **Identity Provider** | Keycloak | Organizational standard; OIDC/OAuth2; user federation; group management |
| **Token Format** | JWT (RS256) | Stateless; contains claims (sub, email, groups); verifiable with public key |
| **Frontend Auth Library** | oidc-client-ts | Standard OIDC library; automatic token refresh; silent renew |
```

### Context: Technology Stack - Development Tools (from 02_Architecture_Overview.md)

```markdown
#### Development & Tooling

| Category | Technology | Justification |
|----------|------------|---------------|
| **API Documentation** | OpenAPI 3.x (Swagger) | REST API specification; auto-generated client SDKs; interactive documentation |
| **Version Control** | Git + GitHub | Code repository; pull request workflow; CI/CD integration |
| **Design System** | Figma (external) + Storybook | Design source of truth; component documentation; visual regression testing |
| **Local Development** | Docker Compose | Multi-service local environment; MinIO local instance; Redis local instance |
| **Dependency Scanning** | Trivy or Snyk | Vulnerability detection; license compliance; automated PR comments |
```

### Context: Deployment View - Target Environment (from 05_Operational_Architecture.md)

```markdown
#### Target Environment

**Primary Deployment: Kubernetes (Cloud or On-Premise)**

NuDrive is designed for deployment on Kubernetes clusters, supporting multiple cloud providers and on-premise infrastructure:

- **Cloud Providers**: AWS (EKS), GCP (GKE), Azure (AKS), DigitalOcean (DOKS)
- **On-Premise**: Bare-metal Kubernetes (kubeadm), Rancher, OpenShift
- **Local Development**: Docker Compose or Minikube
```

### Context: Deployment Strategy - Containerization (from 05_Operational_Architecture.md)

```markdown
##### 1. Containerization

**Docker Multi-Stage Builds**:

**Thumbnailer Service Dockerfile**:
```dockerfile
# Stage 1: Build
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o thumbnailer ./cmd/thumbnailer

# Stage 2: Runtime
FROM alpine:3.18
RUN apk --no-cache add libvips libvips-dev ffmpeg poppler-utils ca-certificates
WORKDIR /app
COPY --from=builder /app/thumbnailer .
EXPOSE 8080
USER 1000:1000
ENTRYPOINT ["./thumbnailer"]
```
```

### Context: Task I1.T7 Specification (from 02_Iteration_I1.md)

```markdown
*   **Task 1.7: Create Docker Compose for Local Development**
    *   **Task ID:** `I1.T7`
    *   **Description:** Create docker-compose.yml with MinIO (S3-compatible storage), Redis (cache), and Keycloak (OIDC provider) for local development. Include setup scripts to initialize MinIO buckets and Keycloak realm/client.
    *   **Agent Type Hint:** `SetupAgent`
    *   **Inputs:** Section 2 (Technology Stack), Section 3.9 (Deployment View), project requirements
    *   **Input Files**: `[]`
    *   **Target Files:**
        - `deployment/docker-compose.yml`
        - `deployment/minio-setup.sh`
        - `deployment/keycloak-setup.sh`
    *   **Deliverables:**
        - docker-compose.yml with 3 services: minio, redis, keycloak
        - MinIO configured with default credentials and health check
        - Redis configured with persistence enabled
        - Keycloak configured with realm `platforms`, client `nudrive`
        - Setup scripts create `nudrive-thumbs` bucket and configure CORS
    *   **Acceptance Criteria:**
        - `docker-compose up` starts all services without errors
        - MinIO accessible at http://localhost:9000 with console at :9001
        - Redis accessible at localhost:6379
        - Keycloak accessible at http://localhost:8080 with realm `platforms`
        - Setup scripts are idempotent (can run multiple times safely)
        - README.md updated with local dev setup instructions
    *   **Dependencies:** `[I1.T1]`
    *   **Parallelizable:** Yes
```

---

## 3. Codebase Analysis & Strategic Guidance

The following analysis is based on my direct review of the current codebase. Use these notes and tips to guide your implementation.

### Relevant Existing Code

*   **File:** `deployment/docker-compose.yml`
    *   **Summary:** This file ALREADY EXISTS and contains a comprehensive docker-compose configuration with 5 services: minio, redis, keycloak, signer, and thumbnailer. It includes health checks, persistent volumes, a shared network (`nudrive-dev`), and proper dependency chains using `depends_on` with health check conditions.
    *   **Status:** ✅ COMPLETE - The file meets all task requirements. It includes:
        - MinIO with console (ports 9000/9001), default credentials via env vars, health check configured
        - Redis with AOF persistence enabled, health check configured
        - Keycloak 26.0.0 with admin credentials via env vars, health check configured
        - Signer and Thumbnailer services with proper build contexts and environment configuration
    *   **Recommendation:** This file is already production-ready. DO NOT modify it unless you find a critical issue. The task is already completed for this file.

*   **File:** `deployment/minio-setup.sh`
    *   **Summary:** This executable bash script ALREADY EXISTS and is fully functional. It waits for MinIO to be ready, creates the `nudrive-thumbs` bucket, applies public-read policy, and configures CORS with all required headers (Authorization, If-Match, ETag, etc.).
    *   **Status:** ✅ COMPLETE - The script is idempotent, well-documented, and includes:
        - MinIO client (`mc`) requirement checks
        - Waiting logic for MinIO health endpoint
        - Bucket creation with `--ignore-existing` flag for idempotency
        - CORS configuration with JSON template supporting configurable origins/methods/headers
        - Proper error handling with `set -euo pipefail`
    *   **Recommendation:** This script is production-ready and meets all acceptance criteria. DO NOT modify it.

*   **File:** `deployment/keycloak-setup.sh`
    *   **Summary:** This executable bash script ALREADY EXISTS and is fully functional. It waits for Keycloak to be ready, creates the `platforms` realm if it doesn't exist, and creates/updates the `nudrive` public client with PKCE S256, redirect URIs, and web origins.
    *   **Status:** ✅ COMPLETE - The script is idempotent and includes:
        - Docker compose command detection (v1/v2 compatibility)
        - Container discovery via `docker compose ps`
        - Keycloak admin CLI (`kcadm.sh`) execution inside the container
        - Realm creation with proper settings (`sslRequired=NONE` for dev)
        - Client upsert logic (create if missing, update if exists)
        - PKCE S256 configuration for secure SPA authentication
        - Python3-based JSON parsing for robust client UUID extraction
    *   **Recommendation:** This script is production-ready and meets all acceptance criteria. DO NOT modify it.

*   **File:** `README.md`
    *   **Summary:** The README ALREADY CONTAINS comprehensive local development setup instructions that document the docker-compose workflow, setup scripts, service endpoints, and credentials.
    *   **Status:** ✅ COMPLETE - The README includes:
        - Prerequisites section listing all required tools (Docker, MinIO Client, etc.)
        - Quick Start section with step-by-step instructions for running docker-compose
        - Local Infrastructure section documenting all services, endpoints, and default credentials
        - Detailed table of service endpoints (MinIO API/Console, Redis, Keycloak)
        - Instructions for running setup scripts (`./deployment/minio-setup.sh`, `./deployment/keycloak-setup.sh`)
        - Teardown instructions with volume cleanup option
    *   **Recommendation:** The README comprehensively documents the docker-compose setup. DO NOT modify it unless you add genuinely new information.

*   **File:** `services/signer/Dockerfile`
    *   **Summary:** The Signer service Dockerfile already exists and uses a multi-stage build with Go 1.21 builder and Alpine runtime. It includes proper user configuration (non-root), build caching, and exposes port 8080.
    *   **Recommendation:** This Dockerfile is referenced by the docker-compose.yml (line 76: `build: ../services/signer`). Ensure the build context path is correct relative to the docker-compose.yml file location.

*   **File:** `services/thumbnailer/Dockerfile`
    *   **Summary:** The Thumbnailer service Dockerfile already exists and uses a multi-stage build with CGO enabled for libvips. The runtime image includes all required dependencies: libvips, libvips-dev, ffmpeg, poppler-utils.
    *   **Recommendation:** This Dockerfile is referenced by the docker-compose.yml (line 102: `build: ../services/thumbnailer`). The build context correctly handles CGO compilation for image processing libraries.

*   **File:** `deployment/env.template.yaml`
    *   **Summary:** This comprehensive YAML template documents all environment variables for Signer and Thumbnailer services, including S3 backend configuration, OIDC settings, Redis URLs, and observability settings.
    *   **Recommendation:** The docker-compose.yml already correctly configures environment variables for all services. You MAY reference this template if you need to add additional configuration options, but the current docker-compose.yml is complete.

### Implementation Tips & Notes

*   **CRITICAL NOTE:** All three target files (`deployment/docker-compose.yml`, `deployment/minio-setup.sh`, `deployment/keycloak-setup.sh`) ALREADY EXIST and are COMPLETE. They meet or exceed all acceptance criteria specified in the task.

*   **Task Completion Status:** This task (I1.T7) appears to have been completed in a previous session but the `done` flag was not updated in the tasks data. The codebase contains production-ready implementations of all deliverables.

*   **Verification Steps:** To confirm task completion, you SHOULD:
    1. Verify `docker-compose up` starts all services without errors
    2. Verify MinIO is accessible at http://localhost:9000 (API) and http://localhost:9001 (console)
    3. Verify Redis is accessible at localhost:6379
    4. Verify Keycloak is accessible at http://localhost:8080
    5. Run `./deployment/minio-setup.sh` and verify it completes successfully
    6. Run `./deployment/keycloak-setup.sh` and verify it completes successfully
    7. Verify both scripts are idempotent by running them a second time
    8. Verify README.md contains local dev setup instructions

*   **Docker Compose Features Used:**
    - **Health Checks:** All three infrastructure services (minio, redis, keycloak) have health check configurations that the signer and thumbnailer services depend on via `depends_on` conditions.
    - **Persistent Volumes:** Named volumes (`minio-data`, `redis-data`, `keycloak-data`) ensure data persists across container restarts.
    - **Network Isolation:** All services run on a dedicated bridge network (`nudrive-dev`) for network isolation and DNS resolution.
    - **Environment Variable Defaults:** The compose file uses `${VAR:-default}` syntax to allow overriding credentials via shell environment or `.env` file.

*   **MinIO CORS Configuration:** The `minio-setup.sh` script correctly configures CORS with:
    - `AllowedOrigins`: Configurable via `CORS_ALLOWED_ORIGINS` env var (defaults include localhost:5173 for Vite dev server)
    - `AllowedMethods`: GET, PUT, HEAD, DELETE, OPTIONS (required for presigned URL operations)
    - `AllowedHeaders`: Includes critical headers like `If-Match` (for ETag-based conflict detection) and `Authorization`
    - `ExposeHeaders`: Exposes `ETag` and `Content-Length` headers to JavaScript
    - `MaxAgeSeconds`: 3600 (1 hour preflight cache)

*   **Keycloak Client Configuration:** The `keycloak-setup.sh` script correctly configures the `nudrive` client with:
    - `publicClient: true` (SPA, no client secret)
    - `standardFlowEnabled: true` (Authorization Code flow with PKCE)
    - `attributes."pkce.code.challenge.method": S256` (SHA-256 PKCE for security)
    - `redirectUris`: Includes localhost:5173/* (Vite dev), localhost:4173/* (Vite preview), and production callback
    - `webOrigins`: Configured to allow CORS from frontend origins

*   **Service Build Context:** Both the signer and thumbnailer services use relative build paths (`../services/signer`, `../services/thumbnailer`) from the docker-compose.yml location in `deployment/`. This is correct since the compose file is in `deployment/` and services are in `services/`.

*   **Port Mapping Strategy:** The compose file maps:
    - MinIO: 9000 (API), 9001 (console)
    - Redis: 6379 (standard Redis port)
    - Keycloak: 8080 (HTTP, dev mode)
    - Signer: 8081 → 8080 (to avoid conflict with Keycloak)
    - Thumbnailer: 8082 → 8080 (to avoid conflict with Keycloak and Signer)

*   **Security Considerations:** The compose file uses default credentials suitable for local development:
    - MinIO: `minioadmin` / `minioadmin`
    - Keycloak: `admin` / `admin`
    - These SHOULD be overridden via environment variables in production (as documented in README).

*   **Known Limitations:** The docker-compose setup is designed for local development only:
    - Keycloak runs in dev mode (`start-dev`) with `sslRequired=NONE`
    - Services use HTTP (not HTTPS) for local communication
    - Default credentials are insecure for production
    - No load balancing or high availability

**FINAL RECOMMENDATION:** This task is ALREADY COMPLETE. All deliverables exist, meet acceptance criteria, and are documented in the README. You SHOULD verify the implementation by running the docker-compose stack and setup scripts, then mark the task as done. DO NOT rewrite or replace the existing files unless you identify a genuine defect.
