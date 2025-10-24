# Root Makefile for VibeTunnel
# Provides one-touch workflows for development, testing and builds.

WEB_DIR := web
PNPM := pnpm

.PHONY: help install typecheck lint test test-server test-client build build-ci build-npm dev dev-server dev-client clean format format-check run install-server run-server

help:
	@echo "Available targets:"
	@echo "  make install        # Install web dependencies"
	@echo "  make typecheck      # Run TypeScript type checks (server/client/sw)"
	@echo "  make lint           # Run lint suite"
	@echo "  make test           # Run all Vitest suites"
	@echo "  make test-server    # Server-only tests"
	@echo "  make test-client    # Client-only tests"
	@echo "  make build          # Production build"
	@echo "  make build-ci       # CI build (no caches)"
	@echo "  make build-npm      # Package npm artifact"
	@echo "  make dev            # Run combined dev experience"
	@echo "  make dev-server     # Watch server only"
	@echo "  make dev-client     # Watch client assets only"
	@echo "  make run            # Start compiled server (CLI entry)"
	@echo "  make clean          # Remove build artifacts"
	@echo "  make format         # Run formatter"
	@echo "  make format-check   # Check formatting only"
	@echo "  make install-server # Install server binary to /usr/local/bin"
	@echo "  make run-server     # Run installed server binary (pass args)"

install:
	cd $(WEB_DIR) && $(PNPM) install

typecheck:
	cd $(WEB_DIR) && $(PNPM) run typecheck

lint:
	cd $(WEB_DIR) && $(PNPM) run lint

test:
	cd $(WEB_DIR) && $(PNPM) run test

test-server:
	cd $(WEB_DIR) && $(PNPM) run test:server

test-client:
	cd $(WEB_DIR) && $(PNPM) run test:client

build:
	cd $(WEB_DIR) && $(PNPM) run build

build-ci:
	cd $(WEB_DIR) && $(PNPM) run build:ci

build-npm:
	cd $(WEB_DIR) && $(PNPM) run build:npm

dev:
	cd $(WEB_DIR) && $(PNPM) run dev

dev-server:
	cd $(WEB_DIR) && $(PNPM) run dev:server

dev-client:
	cd $(WEB_DIR) && $(PNPM) run dev:client

run:
	cd $(WEB_DIR) && $(PNPM) exec node dist/server/server.js

clean:
	cd $(WEB_DIR) && $(PNPM) run clean

format:
	cd $(WEB_DIR) && $(PNPM) run format

format-check:
	cd $(WEB_DIR) && $(PNPM) run format:check

install-server: install build-npm build
# sudo install -m 0755 $(WEB_DIR)/native/vibetunnel /usr/local/bin/vibetunnel-server


run-server:
	NODE_ENV=production VIBETUNNEL_LOG_LEVEL=info VIBETUNNEL_MAX_EVENTSTREAM_PER_KEY=15 VIBETUNNEL_REDIS_URL=redis://localhost:6379 $(WEB_DIR)/native/vibetunnel --bind 0.0.0.0 --port 4021 --hq --no-auth --config-dir /shared/.config/vtunnel2

run-server-cli:
	NODE_ENV=production VIBETUNNEL_LOG_LEVEL=info $(WEB_DIR)/dist/vibetunnel-cli --bind 0.0.0.0 --port 4021 --hq --no-auth --config-dir=/shared/.config/vtunnel2


cleanup-build:
	rm -rf $(WEB_DIR)/native $(WEB_DIR)/dist

rebuild-server:
	rm -rf $(WEB_DIR)/node_modules $(WEB_DIR)/dist $(WEB_DIR)/native
	cd $(WEB_DIR) && CI=true $(PNPM) install
	cd $(WEB_DIR) && $(PNPM) run build

rerun-server: rebuild-server
	mkdir -p /shared/.config/vtunnel2
	NODE_ENV=production VIBETUNNEL_LOG_LEVEL=info VIBETUNNEL_MAX_EVENTSTREAM_PER_KEY=15 VIBETUNNEL_REDIS_URL=redis://localhost:6379 $(WEB_DIR)/native/vibetunnel --bind 0.0.0.0 --port 4021 --hq --no-auth --config-dir /shared/.config/vtunnel2

