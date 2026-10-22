.DEFAULT_GOAL := help
SHELL := /bin/bash

.PHONY: help install dev api web test test-frontend test-backend e2e schema lint typecheck build up down logs clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install frontend and backend dependencies
	cd frontend && npm install
	cd backend && python -m venv .venv && ./.venv/bin/pip install -e ".[dev]"

dev: ## Run the API and the web app together
	@echo "API  -> http://localhost:8000/docs"
	@echo "Web  -> http://localhost:3000"
	@trap 'kill 0' EXIT; \
	(cd backend && ./.venv/bin/uvicorn app.main:app --reload --port 8000) & \
	(cd frontend && npm run dev) & \
	wait

api: ## Run the API only
	cd backend && ./.venv/bin/uvicorn app.main:app --reload --port 8000

web: ## Run the web app only
	cd frontend && npm run dev

test: test-frontend test-backend ## Run every test suite

test-frontend: ## Frontend unit tests
	cd frontend && npm run test

test-backend: ## Backend unit tests
	cd backend && ./.venv/bin/pytest -q

e2e: ## Run the browser end-to-end suite
	cd frontend && npm run e2e

schema: ## Validate the event fixtures against the shared JSON Schema
	node scripts/validate-schema.mjs

lint: ## Lint everything
	cd backend && ./.venv/bin/ruff check app tests
	cd frontend && npm run typecheck

typecheck: ## Type check the frontend
	cd frontend && npm run typecheck

build: ## Production build of the web app
	cd frontend && npm run build

up: ## Start the full stack with Docker
	docker compose up --build -d

down: ## Stop the stack
	docker compose down

logs: ## Tail the container logs
	docker compose logs -f --tail=100

clean: ## Remove build artefacts and caches
	rm -rf frontend/.next frontend/node_modules/.cache backend/.pytest_cache
	find backend -type d -name __pycache__ -prune -exec rm -rf {} +
