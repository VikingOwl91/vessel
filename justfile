# Vessel development commands
# Run `just --list` to see all available commands

# Default backend port for local development (matches vite proxy default)
backend_port := "9090"

# Default llama.cpp server port
llama_port := "8081"

# Models directory
models_dir := env_var_or_default("VESSEL_MODELS_DIR", "~/.vessel/models")

# Run backend locally on port 9090 (matches vite proxy default)
backend:
    cd backend && go run ./cmd/server -port {{backend_port}}

# Run frontend dev server
frontend:
    cd frontend && npm run dev

# Start frontend + backend in Docker
dev:
    docker compose -f docker-compose.dev.yml up

# Start Docker dev environment in background
dev-detach:
    docker compose -f docker-compose.dev.yml up -d

# Stop Docker dev environment
dev-stop:
    docker compose -f docker-compose.dev.yml down

# View Docker dev logs
dev-logs:
    docker compose -f docker-compose.dev.yml logs -f

# List local GGUF models
models:
    @ls -lh {{models_dir}}/*.gguf 2>/dev/null || echo "No models found in {{models_dir}}"

# Start llama.cpp server with a model
llama-server model:
    llama-server -m {{models_dir}}/{{model}} --port {{llama_port}} -c 8192 -ngl 99

# Start llama.cpp server with custom settings
llama-server-custom model port ctx gpu:
    llama-server -m {{models_dir}}/{{model}} --port {{port}} -c {{ctx}} -ngl {{gpu}}

# Start Docker dev + llama.cpp server
all model: dev-detach
    just llama-server {{model}}

# Check health of all services
health:
    @echo "Frontend (7842):"
    @curl -sf http://localhost:7842/health 2>/dev/null && echo "  OK" || echo "  Not running"
    @echo "Backend (9090):"
    @curl -sf http://localhost:9090/health 2>/dev/null && echo "  OK" || echo "  Not running"
    @echo "Ollama (11434):"
    @curl -sf http://localhost:11434/api/tags 2>/dev/null && echo "  OK" || echo "  Not running"
    @echo "llama.cpp (8081):"
    @curl -sf http://localhost:8081/health 2>/dev/null && echo "  OK" || echo "  Not running"

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
    cd backend && go build -o vessel ./cmd/server
