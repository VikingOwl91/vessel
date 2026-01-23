# Vessel development commands
# Run `just --list` to see all available commands

# Load .env file if present
set dotenv-load

# ----- Port Configuration -----
# All ports can be overridden via .env or environment variables

# Backend API port
backend_port := env_var_or_default("PORT", "9090")

# Frontend dev server port
frontend_port := env_var_or_default("DEV_PORT", "7842")

# llama.cpp server port
llama_port := env_var_or_default("LLAMA_PORT", "8081")

# Ollama API port
ollama_port := env_var_or_default("OLLAMA_PORT", "11434")

# Models directory
models_dir := env_var_or_default("VESSEL_MODELS_DIR", "~/.vessel/models")

# ----- Local Development -----

# Run backend locally
backend:
    cd backend && go run ./cmd/server -port {{backend_port}}

# Run frontend dev server
frontend:
    cd frontend && npm run dev

# ----- Docker Development -----

# Start frontend + backend in Docker
dev:
    docker compose -f docker-compose.dev.yml up

# Start Docker dev environment in background
dev-detach:
    docker compose -f docker-compose.dev.yml up -d

# Stop Docker dev environment
dev-stop:
    docker compose -f docker-compose.dev.yml down

# Rebuild Docker images (use after code changes)
dev-build:
    docker compose -f docker-compose.dev.yml build

# Rebuild Docker images from scratch (no cache)
dev-rebuild:
    docker compose -f docker-compose.dev.yml build --no-cache

# View Docker dev logs
dev-logs:
    docker compose -f docker-compose.dev.yml logs -f

# ----- llama.cpp -----

# List local GGUF models
models:
    @ls -lh {{models_dir}}/*.gguf 2>/dev/null || echo "No models found in {{models_dir}}"

# Start llama.cpp server with a model (--host 0.0.0.0 for Docker access)
llama-server model:
    llama-server -m {{models_dir}}/{{model}} --host 0.0.0.0 --port {{llama_port}} -c 8192 -ngl 99

# Start llama.cpp server with custom settings
llama-server-custom model port ctx gpu:
    llama-server -m {{models_dir}}/{{model}} --host 0.0.0.0 --port {{port}} -c {{ctx}} -ngl {{gpu}}

# Start Docker dev + llama.cpp server
all model: dev-detach
    just llama-server {{model}}

# ----- Health & Status -----

# Check health of all services
health:
    @echo "Frontend ({{frontend_port}}):"
    @curl -sf http://localhost:{{frontend_port}}/health 2>/dev/null && echo "  OK" || echo "  Not running"
    @echo "Backend ({{backend_port}}):"
    @curl -sf http://localhost:{{backend_port}}/health 2>/dev/null && echo "  OK" || echo "  Not running"
    @echo "Ollama ({{ollama_port}}):"
    @curl -sf http://localhost:{{ollama_port}}/api/tags 2>/dev/null && echo "  OK" || echo "  Not running"
    @echo "llama.cpp ({{llama_port}}):"
    @curl -sf http://localhost:{{llama_port}}/health 2>/dev/null && echo "  OK" || echo "  Not running"

# ----- Testing & Building -----

# Run backend tests
test-backend:
    cd backend && go test ./...

# Run frontend type check
check-frontend:
    cd frontend && npm run check

# Build frontend for production
build-frontend:
    cd frontend && npm run build

# Build backend for production
build-backend:
    cd backend && go build -v -o vessel ./cmd/server && echo "Built: backend/vessel"
