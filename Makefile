# Root Makefile for VibeTunnel
# Provides one-touch workflows for development, testing and builds.

WEB_DIR := web
PNPM := pnpm

.PHONY: help install typecheck lint test test-server test-client build build-ci build-npm dev dev-server dev-client clean format format-check run

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
