# Vessel Development Justfile
# Run `just --list` to see all available commands

# Default recipe - show help
default:
    @just --list

# ============================================================================
# Docker Compose Commands
# ============================================================================

# Start development environment (frontend + backend in Docker)
dev:
    docker compose -f docker-compose.dev.yml up --build

# Start development environment in detached mode
dev-detach:
    docker compose -f docker-compose.dev.yml up --build -d

# Stop development environment
dev-stop:
    docker compose -f docker-compose.dev.yml down

# View development logs
dev-logs:
    docker compose -f docker-compose.dev.yml logs -f

# Rebuild development containers
dev-rebuild:
    docker compose -f docker-compose.dev.yml build --no-cache

# ============================================================================
# Local Development (without Docker)
# ============================================================================

# Start backend locally
backend:
    cd backend && go run ./cmd/server/

# Start backend on custom port
backend-port port="8080":
    cd backend && go run ./cmd/server/ -port {{port}}

# Start frontend locally
frontend:
    cd frontend && npm run dev

# Build backend binary
build-backend:
    cd backend && go build -o vessel-server ./cmd/server/

# Build frontend
build-frontend:
    cd frontend && npm run build

# ============================================================================
# llama.cpp Server
# ============================================================================

# Default model path
models_dir := env_var_or_default("VESSEL_MODELS_DIR", "~/.vessel/models")

# Start llama.cpp server with a model
# Usage: just llama-server <model-file>
# Example: just llama-server qwen2.5-0.5b-instruct-q4_k_m.gguf
llama-server model:
    #!/usr/bin/env bash
    MODEL_PATH="{{models_dir}}/{{model}}"
    if [[ "{{model}}" == /* ]]; then
        MODEL_PATH="{{model}}"
    fi
    MODEL_PATH="${MODEL_PATH/#\~/$HOME}"

    if [[ ! -f "$MODEL_PATH" ]]; then
        echo "Error: Model not found: $MODEL_PATH"
        echo "Available models in {{models_dir}}:"
        ls -la "${models_dir/#\~/$HOME}"/*.gguf 2>/dev/null || echo "  No GGUF models found"
        exit 1
    fi

    echo "Starting llama.cpp server with: $MODEL_PATH"
    echo "Server will be available at: http://localhost:8081"
    llama-server \
        --model "$MODEL_PATH" \
        --host 0.0.0.0 \
        --port 8081 \
        --ctx-size 4096 \
        --n-gpu-layers 99

# Start llama.cpp server with custom options
# Usage: just llama-server-custom <model> <port> <ctx-size> <gpu-layers>
llama-server-custom model port="8081" ctx="4096" gpu="99":
    #!/usr/bin/env bash
    MODEL_PATH="{{models_dir}}/{{model}}"
    if [[ "{{model}}" == /* ]]; then
        MODEL_PATH="{{model}}"
    fi
    MODEL_PATH="${MODEL_PATH/#\~/$HOME}"

    echo "Starting llama.cpp server:"
    echo "  Model: $MODEL_PATH"
    echo "  Port: {{port}}"
    echo "  Context: {{ctx}}"
    echo "  GPU Layers: {{gpu}}"

    llama-server \
        --model "$MODEL_PATH" \
        --host 0.0.0.0 \
        --port {{port}} \
        --ctx-size {{ctx}} \
        --n-gpu-layers {{gpu}}

# List available local models
models:
    #!/usr/bin/env bash
    MODELS_PATH="${HOME}/.vessel/models"
    echo "Local GGUF models in $MODELS_PATH:"
    echo "---"
    if [[ -d "$MODELS_PATH" ]]; then
        ls -lh "$MODELS_PATH"/*.gguf 2>/dev/null | awk '{print $9, $5}' | while read path size; do
            echo "  $(basename "$path") ($size)"
        done
    else
        echo "  Directory not found. Download models using the Model Browser."
    fi

# ============================================================================
# VLM (Vessel Llama Manager)
# ============================================================================

# Build VLM binary
build-vlm:
    cd apps/vlm && go build -o vlm ./cmd/vlm/

# Generate default VLM config
vlm-init:
    #!/usr/bin/env bash
    cd apps/vlm && go build -o vlm ./cmd/vlm/ && ./vlm --generate-config
    echo ""
    echo "Config written to: ~/.vessel/llm.toml"
    echo "Edit the config to set llama_server_path and auth_token"

# Start VLM daemon
vlm:
    #!/usr/bin/env bash
    VLM_BIN="apps/vlm/vlm"
    if [[ ! -f "$VLM_BIN" ]]; then
        echo "Building VLM..."
        cd apps/vlm && go build -o vlm ./cmd/vlm/
        cd ../..
    fi
    echo "Starting VLM daemon..."
    $VLM_BIN --config ~/.vessel/llm.toml

# Start VLM with custom config
vlm-config config:
    #!/usr/bin/env bash
    VLM_BIN="apps/vlm/vlm"
    if [[ ! -f "$VLM_BIN" ]]; then
        echo "Building VLM..."
        cd apps/vlm && go build -o vlm ./cmd/vlm/
        cd ../..
    fi
    echo "Starting VLM daemon with config: {{config}}"
    $VLM_BIN --config {{config}}

# Show VLM version
vlm-version:
    #!/usr/bin/env bash
    VLM_BIN="apps/vlm/vlm"
    if [[ ! -f "$VLM_BIN" ]]; then
        cd apps/vlm && go build -o vlm ./cmd/vlm/
        cd ../..
    fi
    $VLM_BIN --version

# Check VLM status
vlm-status:
    #!/usr/bin/env bash
    echo "VLM Status:"
    curl -s http://localhost:32789/vlm/status 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  VLM not running"

# List models via VLM
vlm-models:
    #!/usr/bin/env bash
    echo "Models available via VLM:"
    curl -s http://localhost:32789/vlm/models 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "  VLM not running"

# ============================================================================
# Full Stack Commands
# ============================================================================

# Start everything: Docker dev environment + VLM
# Usage: just all-vlm
all-vlm:
    #!/usr/bin/env bash
    echo "Starting Vessel development stack with VLM..."
    echo "1. Starting Docker dev environment..."
    docker compose -f docker-compose.dev.yml up --build -d
    echo ""
    echo "2. Starting VLM daemon..."
    just vlm

# Start everything: Docker dev environment + llama.cpp server (legacy)
# Usage: just all <model-file>
all model:
    #!/usr/bin/env bash
    echo "Starting Vessel development stack..."
    echo "1. Starting Docker dev environment..."
    docker compose -f docker-compose.dev.yml up --build -d
    echo ""
    echo "2. Starting llama.cpp server..."
    just llama-server {{model}}

# ============================================================================
# Utilities
# ============================================================================

# Check service health
health:
    #!/usr/bin/env bash
    echo "Checking services..."
    echo ""
    echo "Backend (port 8080):"
    curl -s http://localhost:8080/health || echo "  Not running"
    echo ""
    echo "Backend Docker (port 9090):"
    curl -s http://localhost:9090/health || echo "  Not running"
    echo ""
    echo "VLM (port 32789):"
    curl -s http://localhost:32789/vlm/health || echo "  Not running"
    echo ""
    echo "llama.cpp direct (port 8081):"
    curl -s http://localhost:8081/health || echo "  Not running"
    echo ""
    echo "Ollama (port 11434):"
    curl -s http://localhost:11434/api/tags | head -c 100 || echo "  Not running"

# Clean up Docker resources
clean:
    docker compose -f docker-compose.dev.yml down -v --remove-orphans
    docker compose -f docker-compose.yml down -v --remove-orphans

# Run backend tests
test-backend:
    cd backend && go test ./...

# Run frontend type check
test-frontend:
    cd frontend && npm run check
