#!/usr/bin/env bash
#
# Vessel Install Script
# A modern web interface for Ollama
#
# Usage:
#   curl -fsSL https://raw.somegit.dev/vikingowl/vessel/main/install.sh | bash
#   ./install.sh [--uninstall] [--update]
#
# Copyright (C) 2026 VikingOwl
# Licensed under GPL-3.0

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

VESSEL_DIR="${VESSEL_DIR:-$HOME/.vessel}"
VESSEL_REPO="https://somegit.dev/vikingowl/vessel.git"
VESSEL_RAW_URL="https://somegit.dev/vikingowl/vessel/raw/main"
DEFAULT_MODEL="llama3.2"
FRONTEND_PORT=7842
BACKEND_PORT=9090
OLLAMA_PORT=11434
COMPOSE_CMD="docker compose"

# VLM (Vessel Llama Manager) configuration
VLM_ENABLED="${VLM_ENABLED:-true}"
VLM_PORT=32789
VLM_BIN_DIR="$VESSEL_DIR/bin"
VLM_BIN="$VLM_BIN_DIR/vlm"
VLM_CONFIG="$VESSEL_DIR/llm.toml"
VLM_STATE_DIR="$VESSEL_DIR/state"
VLM_LOG_DIR="$VESSEL_DIR/logs"
VLM_MODELS_DIR="$VESSEL_DIR/models"
VLM_RELEASE_BASE="https://somegit.dev/vikingowl/vessel/releases/download"
VLM_LATEST_URL="https://somegit.dev/vikingowl/vessel/raw/main/vlm_latest.txt"
VLM_VERSION="${VLM_VERSION:-latest}"

# Compose file selection (set by detect_os)
COMPOSE_FILES=(-f docker-compose.yml)

# Colors (disabled if not a terminal)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    PURPLE='\033[0;35m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m' # No Color
else
    RED='' GREEN='' YELLOW='' BLUE='' PURPLE='' CYAN='' BOLD='' NC=''
fi

# =============================================================================
# Helper Functions
# =============================================================================

print_banner() {
    echo -e "${PURPLE}"
    cat << 'EOF'
 __     __                  _
 \ \   / /__ ___ ___  ___  | |
  \ \ / / _ Y __/ __|/ _ \ | |
   \ V /  __|__ \__ \  __/ | |
    \_/ \___|___/___/\___| |_|

EOF
    echo -e "${NC}"
    echo -e "${BOLD}A modern web interface for Ollama${NC}"
    echo ""
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

fatal() {
    error "$1"
    exit 1
}

prompt_yes_no() {
    local prompt="$1"
    local default="${2:-y}"
    local response

    if [[ "$default" == "y" ]]; then
        prompt="$prompt [Y/n] "
    else
        prompt="$prompt [y/N] "
    fi

    # Read from /dev/tty to work with curl | bash
    # Print prompt to stderr so it shows even when stdin is redirected
    if [[ -t 0 ]]; then
        read -r -p "$prompt" response
    else
        printf "%s" "$prompt" >&2
        read -r response < /dev/tty 2>/dev/null || response="$default"
    fi
    response="${response:-$default}"

    [[ "$response" =~ ^[Yy]$ ]]
}

# =============================================================================
# Prerequisite Checks
# =============================================================================

check_command() {
    command -v "$1" &> /dev/null
}

check_prerequisites() {
    info "Checking prerequisites..."

    # Check Docker
    if ! check_command docker; then
        fatal "Docker is not installed. Please install Docker first: https://docs.docker.com/get-docker/"
    fi

    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        fatal "Docker daemon is not running. Please start Docker and try again."
    fi
    success "Docker is installed and running"

    # Check Docker Compose (v2)
    if docker compose version &> /dev/null; then
        success "Docker Compose v2 is available"
    elif check_command docker-compose; then
        warn "Found docker-compose (v1). Recommend upgrading to Docker Compose v2."
        COMPOSE_CMD="docker-compose"
    else
        fatal "Docker Compose is not installed. Please install Docker Compose: https://docs.docker.com/compose/install/"
    fi

    # Set compose command
    COMPOSE_CMD="${COMPOSE_CMD:-docker compose}"

    # Check git (needed for remote install)
    if [[ ! -f "docker-compose.yml" ]] && ! check_command git; then
        fatal "Git is not installed. Please install git first."
    fi
}

detect_os() {
    case "$(uname -s)" in
        Linux*)  OS="linux" ;;
        Darwin*) OS="macos" ;;
        *)       fatal "Unsupported operating system: $(uname -s)" ;;
    esac
    info "Detected OS: $OS"

    # Linux needs extra_hosts for host.docker.internal
    if [[ "$OS" == "linux" ]]; then
        COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.linux.yml)
    fi
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)   ARCH="amd64" ;;
        aarch64|arm64)  ARCH="arm64" ;;
        *)              fatal "Unsupported architecture: $(uname -m)" ;;
    esac
    info "Detected architecture: $ARCH"
}

# =============================================================================
# Ollama Detection
# =============================================================================

check_ollama() {
    info "Checking for local Ollama installation..."

    # Check if ollama command exists
    if ! check_command ollama; then
        fatal "Ollama is not installed. Please install Ollama first: https://ollama.com/download"
    fi

    # Check if Ollama is responding on default port
    if curl -s --connect-timeout 2 "http://localhost:${OLLAMA_PORT}/api/tags" &> /dev/null; then
        success "Ollama is running on port ${OLLAMA_PORT}"
    else
        warn "Ollama is installed but not running. Please start it with: ollama serve"
        if ! prompt_yes_no "Continue anyway?" "n"; then
            exit 1
        fi
    fi
}

# =============================================================================
# VLM Installation
# =============================================================================

generate_token() {
    if command -v openssl >/dev/null; then
        openssl rand -hex 32
    else
        head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}

resolve_vlm_version() {
    local version="$VLM_VERSION"

    # Normalize: strip leading 'v' if present (user might pass v0.1.0 or 0.1.0)
    version="${version#v}"

    if [[ "$version" != "latest" ]]; then
        echo "$version"
        return
    fi

    # Fetch latest version from text file
    local resolved
    resolved=$(curl -fsSL "$VLM_LATEST_URL" 2>/dev/null | tr -d '[:space:]')

    if [[ -z "$resolved" ]]; then
        warn "Could not resolve latest VLM version from $VLM_LATEST_URL"
        warn "Skipping VLM binary download"
        return 1
    fi

    # Also strip 'v' from resolved version (in case file contains it)
    resolved="${resolved#v}"
    echo "$resolved"
}

verify_checksum() {
    local file="$1"
    local expected="$2"

    local actual
    if command -v sha256sum &>/dev/null; then
        actual=$(sha256sum "$file" | awk '{print $1}')
    elif command -v shasum &>/dev/null; then
        actual=$(shasum -a 256 "$file" | awk '{print $1}')
    else
        warn "No sha256sum or shasum available, skipping checksum verification"
        return 0
    fi

    if [[ "$actual" != "$expected" ]]; then
        error "Checksum mismatch!"
        error "  Expected: $expected"
        error "  Got:      $actual"
        return 1
    fi

    return 0
}

download_vlm() {
    if [[ "$VLM_ENABLED" != "true" ]]; then
        info "VLM disabled, skipping binary download"
        return
    fi

    mkdir -p "$VLM_BIN_DIR" "$VLM_LOG_DIR" "$VLM_STATE_DIR" "$VLM_MODELS_DIR"

    # Resolve version (handles "latest" -> actual version)
    local version
    if ! version=$(resolve_vlm_version); then
        return
    fi

    # Determine asset name based on OS/arch
    # Format: vlm_<version>_<os>_<arch>
    local asset="vlm_${version}_${OS}_${ARCH}"
    local release_url="${VLM_RELEASE_BASE}/v${version}"
    local binary_url="${release_url}/${asset}"
    local checksums_url="${release_url}/checksums.txt"

    info "VLM version: ${version}"
    info "Download URL: ${binary_url}"

    # Download checksums first (optional - warn if unavailable)
    local expected_checksum=""
    local checksums_file="/tmp/vlm_checksums_$$.txt"

    if curl -fsSL "$checksums_url" -o "$checksums_file" 2>/dev/null; then
        expected_checksum=$(grep "$asset" "$checksums_file" 2>/dev/null | awk '{print $1}')
        if [[ -n "$expected_checksum" ]]; then
            info "Checksum: ${expected_checksum:0:16}..."
        else
            warn "Asset not found in checksums.txt, skipping verification"
        fi
        rm -f "$checksums_file"
    else
        warn "checksums.txt not available, skipping verification"
    fi

    # Download binary
    if ! curl -fsSL "$binary_url" -o "${VLM_BIN}.new" 2>/dev/null; then
        warn "VLM binary not available at: $binary_url"
        warn "This is expected if VLM hasn't been released yet."
        warn "Build manually: cd apps/vlm && go build -o ~/.vessel/bin/vlm ./cmd/vlm/"
        return
    fi

    # Verify checksum if available
    if [[ -n "$expected_checksum" ]]; then
        if ! verify_checksum "${VLM_BIN}.new" "$expected_checksum"; then
            rm -f "${VLM_BIN}.new"
            fatal "VLM binary checksum verification failed - aborting for security"
        fi
        success "Checksum verified"
    fi

    chmod +x "${VLM_BIN}.new"

    # Rollback: keep old binary
    if [[ -f "$VLM_BIN" ]]; then
        mv "$VLM_BIN" "${VLM_BIN}.old" || true
    fi

    mv "${VLM_BIN}.new" "$VLM_BIN"

    # Verify it runs
    if ! "$VLM_BIN" --version &>/dev/null; then
        warn "VLM binary failed to execute"
        if [[ -f "${VLM_BIN}.old" ]]; then
            mv "${VLM_BIN}.old" "$VLM_BIN"
            warn "Rolled back to previous version"
        fi
        return
    fi

    success "VLM v${version} installed at $VLM_BIN"
}

ensure_vlm_config() {
    if [[ "$VLM_ENABLED" != "true" ]]; then
        return
    fi

    if [[ -f "$VLM_CONFIG" ]]; then
        info "VLM config exists at $VLM_CONFIG"

        # Check if auth_token is empty and patch it
        if grep -q 'auth_token = ""' "$VLM_CONFIG" 2>/dev/null; then
            local token
            token=$(generate_token)
            # Use sed with backup (works on both GNU and BSD sed)
            sed -i.bak "s|auth_token = \"\"|auth_token = \"${token}\"|" "$VLM_CONFIG"
            rm -f "${VLM_CONFIG}.bak"
            success "Generated auth token for VLM"
        fi
        return
    fi

    info "Creating VLM config at $VLM_CONFIG"

    local token
    token=$(generate_token)

    cat > "$VLM_CONFIG" << EOF
# VLM (Vessel Llama Manager) Configuration
# Documentation: https://somegit.dev/vikingowl/vessel

[meta]
schema_version = 1

[vlm]
# 0.0.0.0 allows Docker containers to reach VLM via host.docker.internal
# For localhost-only, change to 127.0.0.1 (requires host networking in Docker)
bind = "0.0.0.0:${VLM_PORT}"
auth_token = "${token}"
log_dir = "${VLM_LOG_DIR}"
state_dir = "${VLM_STATE_DIR}"

[security]
require_token_for_inference = true

[scheduler]
max_concurrent_requests = 2
queue_size = 64
interactive_reserve = 1

[models]
directories = ["${VLM_MODELS_DIR}", "~/Models/gguf"]
scan_interval = "30s"

[llamacpp]
active_profile = "default"
active_model_id = ""

[llamacpp.switching]
startup_timeout = "60s"
graceful_timeout = "8s"
keep_old_until_ready = true

[[llamacpp.profiles]]
name = "default"
llama_server_path = ""
preferred_backend = "auto"
extra_env = []
default_args = ["-c", "8192", "--batch-size", "512"]
EOF

    success "Created VLM config with auth token"
    echo ""
    warn "Edit $VLM_CONFIG to set llama_server_path to your llama-server binary"
}

set_env_kv() {
    local key="$1" val="$2" file="$3"
    mkdir -p "$(dirname "$file")"
    touch "$file"
    if grep -q "^${key}=" "$file" 2>/dev/null; then
        # Use sed with backup for portability
        sed -i.bak "s|^${key}=.*|${key}=${val}|" "$file"
        rm -f "${file}.bak"
    else
        echo "${key}=${val}" >> "$file"
    fi
}

setup_vlm_env() {
    if [[ "$VLM_ENABLED" != "true" ]]; then
        return
    fi

    local env_file="$VESSEL_DIR/.env"

    # Read token from config if it exists
    local token=""
    if [[ -f "$VLM_CONFIG" ]]; then
        token=$(grep 'auth_token' "$VLM_CONFIG" 2>/dev/null | sed 's/.*= *"\([^"]*\)".*/\1/' | head -1)
    fi

    # Set VLM environment variables for Docker Compose
    set_env_kv "VLM_ENABLED" "true" "$env_file"

    # Use host.docker.internal for containers to reach host VLM
    if [[ "$OS" == "linux" ]]; then
        set_env_kv "VLM_URL" "http://host.docker.internal:${VLM_PORT}" "$env_file"
    else
        set_env_kv "VLM_URL" "http://host.docker.internal:${VLM_PORT}" "$env_file"
    fi

    if [[ -n "$token" ]]; then
        set_env_kv "VLM_TOKEN" "$token" "$env_file"
    fi

    success "VLM environment configured in $env_file"
}

# =============================================================================
# Installation
# =============================================================================

clone_repository() {
    if [[ -f "docker-compose.yml" ]]; then
        # Already in project directory
        VESSEL_DIR="$(pwd)"
        info "Using current directory: $VESSEL_DIR"
        return
    fi

    if [[ -d "$VESSEL_DIR" ]]; then
        if [[ -f "$VESSEL_DIR/docker-compose.yml" ]]; then
            info "Vessel already installed at $VESSEL_DIR"
            cd "$VESSEL_DIR"
            return
        fi
    fi

    info "Cloning Vessel to $VESSEL_DIR..."
    git clone --depth 1 "$VESSEL_REPO" "$VESSEL_DIR"
    cd "$VESSEL_DIR"
    success "Repository cloned"
}


check_port_available() {
    local port=$1
    local name=$2

    if lsof -i :"$port" &> /dev/null || ss -tuln 2>/dev/null | grep -q ":$port "; then
        warn "Port $port ($name) is already in use"
        return 1
    fi
    return 0
}

check_ports() {
    info "Checking port availability..."
    local has_conflict=false

    if ! check_port_available $FRONTEND_PORT "frontend"; then
        has_conflict=true
    fi

    if ! check_port_available $BACKEND_PORT "backend"; then
        has_conflict=true
    fi

    # Check VLM port (host-side, only warn)
    if [[ "$VLM_ENABLED" == "true" ]]; then
        if ! check_port_available $VLM_PORT "VLM"; then
            warn "VLM port $VLM_PORT is in use - VLM may fail to start"
        fi
    fi

    if [[ "$has_conflict" == true ]]; then
        if ! prompt_yes_no "Continue anyway?" "n"; then
            fatal "Aborted due to port conflicts"
        fi
    fi
}

start_services() {
    info "Starting Vessel services..."

    $COMPOSE_CMD "${COMPOSE_FILES[@]}" up -d --build

    success "Services started"
}

wait_for_health() {
    info "Waiting for services to be ready..."

    local max_attempts=30
    local attempt=0

    # Wait for frontend
    while [[ $attempt -lt $max_attempts ]]; do
        if curl -s --connect-timeout 2 "http://localhost:${FRONTEND_PORT}" &> /dev/null; then
            success "Frontend is ready"
            break
        fi
        attempt=$((attempt + 1))
        sleep 2
    done

    if [[ $attempt -ge $max_attempts ]]; then
        warn "Frontend did not become ready in time. Check logs with: $COMPOSE_CMD logs frontend"
    fi

    # Wait for backend
    attempt=0
    while [[ $attempt -lt $max_attempts ]]; do
        if curl -s --connect-timeout 2 "http://localhost:${BACKEND_PORT}/api/v1/health" &> /dev/null; then
            success "Backend is ready"
            break
        fi
        attempt=$((attempt + 1))
        sleep 2
    done

    if [[ $attempt -ge $max_attempts ]]; then
        warn "Backend did not become ready in time. Check logs with: $COMPOSE_CMD logs backend"
    fi
}

# =============================================================================
# Model Management
# =============================================================================

prompt_pull_model() {
    echo ""

    # Check if any models are available
    local has_models=false
    if ollama list 2>/dev/null | grep -q "NAME"; then
        has_models=true
    fi

    if [[ "$has_models" == true ]]; then
        info "Existing models found"
        if ! prompt_yes_no "Pull additional model ($DEFAULT_MODEL)?" "n"; then
            return
        fi
    else
        if ! prompt_yes_no "Pull starter model ($DEFAULT_MODEL)?" "y"; then
            warn "No models available. Pull a model manually:"
            echo "  ollama pull $DEFAULT_MODEL"
            return
        fi
    fi

    info "Pulling $DEFAULT_MODEL (this may take a while)..."
    ollama pull "$DEFAULT_MODEL"
    success "Model $DEFAULT_MODEL is ready"
}

# =============================================================================
# Completion
# =============================================================================

print_success() {
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}${BOLD}  Vessel is now running!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  ${BOLD}Open in browser:${NC}  ${CYAN}http://localhost:${FRONTEND_PORT}${NC}"
    echo ""
    echo -e "  ${BOLD}Useful commands:${NC}"
    echo -e "    View logs:      ${CYAN}cd $VESSEL_DIR && $COMPOSE_CMD logs -f${NC}"
    echo -e "    Stop:           ${CYAN}cd $VESSEL_DIR && $COMPOSE_CMD down${NC}"
    echo -e "    Update:         ${CYAN}cd $VESSEL_DIR && ./install.sh --update${NC}"
    echo -e "    Pull model:     ${CYAN}ollama pull <model>${NC}"
    echo ""

    if [[ "$VLM_ENABLED" == "true" ]]; then
        echo -e "  ${BOLD}VLM (llama.cpp manager):${NC}"
        echo -e "    Binary:         ${CYAN}$VLM_BIN${NC}"
        echo -e "    Config:         ${CYAN}$VLM_CONFIG${NC}"
        echo -e "    Start VLM:      ${CYAN}$VLM_BIN --config $VLM_CONFIG${NC}"
        echo ""
        echo -e "  ${YELLOW}Note: VLM is not started automatically.${NC}"
        echo -e "  ${YELLOW}Edit $VLM_CONFIG to set llama_server_path, then start VLM.${NC}"
        echo ""
    fi
}

# =============================================================================
# Uninstall / Update
# =============================================================================

do_uninstall() {
    info "Uninstalling Vessel..."

    if [[ -f "docker-compose.yml" ]]; then
        VESSEL_DIR="$(pwd)"
    elif [[ -d "$VESSEL_DIR" ]]; then
        cd "$VESSEL_DIR"
    else
        fatal "Vessel installation not found"
    fi

    # Stop Docker services
    $COMPOSE_CMD "${COMPOSE_FILES[@]}" down -v --remove-orphans 2>/dev/null || true

    # Stop VLM if running (best effort)
    if pgrep -f "vlm.*--config" >/dev/null 2>&1; then
        info "Stopping VLM..."
        pkill -f "vlm.*--config" 2>/dev/null || true
    fi

    if prompt_yes_no "Remove installation directory ($VESSEL_DIR)?" "n"; then
        cd ~
        rm -rf "$VESSEL_DIR"
        success "Removed $VESSEL_DIR (includes VLM binary, config, and data)"
    else
        if [[ -f "$VLM_BIN" ]] && prompt_yes_no "Remove VLM binary ($VLM_BIN)?" "n"; then
            rm -f "$VLM_BIN" "${VLM_BIN}.old"
            success "Removed VLM binary"
        fi
    fi

    success "Vessel has been uninstalled"
    exit 0
}

do_update() {
    info "Updating Vessel..."

    if [[ -f "docker-compose.yml" ]]; then
        VESSEL_DIR="$(pwd)"
    elif [[ -d "$VESSEL_DIR" ]]; then
        cd "$VESSEL_DIR"
    else
        fatal "Vessel installation not found"
    fi

    # Detect OS/arch for VLM update
    detect_os
    detect_arch

    info "Pulling latest changes..."
    git pull

    info "Rebuilding containers..."
    $COMPOSE_CMD "${COMPOSE_FILES[@]}" up -d --build

    # Update VLM binary if enabled
    if [[ "$VLM_ENABLED" == "true" ]]; then
        info "Updating VLM..."
        download_vlm
        setup_vlm_env
    fi

    success "Vessel has been updated"

    wait_for_health
    print_success
    exit 0
}

# =============================================================================
# Main
# =============================================================================

main() {
    # Handle flags
    case "${1:-}" in
        --uninstall|-u)
            detect_os  # Needed for COMPOSE_FILES
            do_uninstall
            ;;
        --update)
            do_update
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --uninstall, -u  Remove Vessel installation"
            echo "  --update         Update to latest version"
            echo "  --help, -h       Show this help message"
            echo ""
            echo "Environment variables:"
            echo "  VESSEL_DIR       Installation directory (default: ~/.vessel)"
            echo "  VLM_ENABLED      Enable VLM installation (default: true)"
            echo "  VLM_VERSION      VLM version to install (default: latest)"
            exit 0
            ;;
    esac

    print_banner
    check_prerequisites
    detect_os
    detect_arch
    check_ollama
    clone_repository
    check_ports

    # Install VLM components (before Docker services for .env)
    if [[ "$VLM_ENABLED" == "true" ]]; then
        download_vlm
        ensure_vlm_config
        setup_vlm_env
    fi

    start_services
    wait_for_health
    prompt_pull_model
    print_success
}

# Run main with all arguments
main "$@"
