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
    if [[ -t 0 ]]; then
        read -r -p "$prompt" response
    else
        read -r -p "$prompt" response < /dev/tty 2>/dev/null || response="$default"
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
}

# =============================================================================
# Ollama Detection
# =============================================================================

detect_ollama() {
    info "Checking for local Ollama installation..."

    OLLAMA_LOCAL=false

    # Check if ollama command exists
    if check_command ollama; then
        # Check if Ollama is responding on default port
        if curl -s --connect-timeout 2 "http://localhost:${OLLAMA_PORT}/api/tags" &> /dev/null; then
            OLLAMA_LOCAL=true
            success "Local Ollama detected and running on port ${OLLAMA_PORT}"
        else
            warn "Ollama is installed but not running"
        fi
    else
        info "No local Ollama installation found"
    fi
}

prompt_ollama_mode() {
    if [[ "$OLLAMA_LOCAL" == true ]]; then
        echo ""
        if prompt_yes_no "Use your local Ollama installation?" "y"; then
            USE_SYSTEM_OLLAMA=true
            info "Will use system Ollama on localhost:${OLLAMA_PORT}"
        else
            USE_SYSTEM_OLLAMA=false
            info "Will run Ollama in Docker"
        fi
    else
        USE_SYSTEM_OLLAMA=false
        info "Will run Ollama in Docker container"
    fi
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

setup_compose_override() {
    local override_file="docker-compose.override.yml"

    if [[ "$USE_SYSTEM_OLLAMA" == true ]]; then
        info "Configuring for system Ollama..."

        cat > "$override_file" << 'EOF'
# Auto-generated by install.sh - System Ollama mode
# Delete this file to use Docker Ollama instead

services:
  ollama:
    # Disable the ollama service when using system Ollama
    profiles: ["disabled"]

  frontend:
    environment:
      - OLLAMA_API_URL=http://host.docker.internal:11434
    extra_hosts:
      - "host.docker.internal:host-gateway"

  backend:
    environment:
      - OLLAMA_URL=http://host.docker.internal:11434
    extra_hosts:
      - "host.docker.internal:host-gateway"
EOF
        success "Created $override_file for system Ollama"
    else
        # Remove override if exists (use Docker Ollama)
        if [[ -f "$override_file" ]]; then
            rm "$override_file"
            info "Removed existing $override_file"
        fi
    fi
}

check_port_available() {
    local port=$1
    local name=$2

    if lsof -i :"$port" &> /dev/null || ss -tuln 2>/dev/null | grep -q ":$port "; then
        if [[ "$port" == "$OLLAMA_PORT" && "$USE_SYSTEM_OLLAMA" == true ]]; then
            # Expected - system Ollama is using this port
            return 0
        fi
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

    if [[ "$USE_SYSTEM_OLLAMA" != true ]]; then
        if ! check_port_available $OLLAMA_PORT "ollama"; then
            has_conflict=true
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

    $COMPOSE_CMD up -d --build

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
    if [[ "$USE_SYSTEM_OLLAMA" == true ]]; then
        if ollama list 2>/dev/null | grep -q "NAME"; then
            has_models=true
        fi
    else
        if $COMPOSE_CMD exec -T ollama ollama list 2>/dev/null | grep -q "NAME"; then
            has_models=true
        fi
    fi

    if [[ "$has_models" == true ]]; then
        info "Existing models found"
        if ! prompt_yes_no "Pull additional model ($DEFAULT_MODEL)?" "n"; then
            return
        fi
    else
        if ! prompt_yes_no "Pull starter model ($DEFAULT_MODEL)?" "y"; then
            warn "No models available. Pull a model manually:"
            if [[ "$USE_SYSTEM_OLLAMA" == true ]]; then
                echo "  ollama pull $DEFAULT_MODEL"
            else
                echo "  $COMPOSE_CMD exec ollama ollama pull $DEFAULT_MODEL"
            fi
            return
        fi
    fi

    info "Pulling $DEFAULT_MODEL (this may take a while)..."
    if [[ "$USE_SYSTEM_OLLAMA" == true ]]; then
        ollama pull "$DEFAULT_MODEL"
    else
        $COMPOSE_CMD exec -T ollama ollama pull "$DEFAULT_MODEL"
    fi
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
    if [[ "$USE_SYSTEM_OLLAMA" == true ]]; then
        echo -e "  ${BOLD}Ollama:${NC} Using system installation"
    else
        echo -e "  ${BOLD}Ollama:${NC} Running in Docker"
    fi
    echo ""
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

    $COMPOSE_CMD down -v --remove-orphans 2>/dev/null || true

    if prompt_yes_no "Remove installation directory ($VESSEL_DIR)?" "n"; then
        cd ~
        rm -rf "$VESSEL_DIR"
        success "Removed $VESSEL_DIR"
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

    info "Pulling latest changes..."
    git pull

    info "Rebuilding containers..."
    $COMPOSE_CMD up -d --build

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
            exit 0
            ;;
    esac

    print_banner
    check_prerequisites
    detect_os
    clone_repository
    detect_ollama
    prompt_ollama_mode
    setup_compose_override
    check_ports
    start_services
    wait_for_health
    prompt_pull_model
    print_success
}

# Run main with all arguments
main "$@"
