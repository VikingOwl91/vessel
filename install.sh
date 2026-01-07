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
# Version & Release Notes
# =============================================================================

GITHUB_RELEASES_URL="https://api.github.com/repos/VikingOwl91/vessel/releases"
GITHUB_RELEASES_PAGE="https://github.com/VikingOwl91/vessel/releases"

get_installed_version() {
    if [[ -f "backend/cmd/server/main.go" ]]; then
        grep -oP 'Version\s*=\s*"\K[^"]+' backend/cmd/server/main.go 2>/dev/null || echo "unknown"
    else
        echo "unknown"
    fi
}

version_gt() {
    # Returns 0 (true) if $1 > $2 using version sort
    [[ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" != "$1" ]]
}

show_release_notes() {
    local old_version="$1"
    local new_version="$2"

    # Skip if versions are the same or unknown
    if [[ "$old_version" == "$new_version" ]] || [[ "$old_version" == "unknown" ]]; then
        return
    fi

    # Check if jq is available
    if ! check_command jq; then
        echo ""
        echo -e "${CYAN}📋 What's New:${NC}"
        echo -e "   View release notes at: ${CYAN}${GITHUB_RELEASES_PAGE}${NC}"
        echo ""
        return
    fi

    # Fetch releases from GitHub API
    local releases
    releases=$(curl -s --connect-timeout 5 "$GITHUB_RELEASES_URL" 2>/dev/null) || {
        return
    }

    # Check if we got valid JSON
    if ! echo "$releases" | jq -e '.' &>/dev/null; then
        return
    fi

    # Filter releases between old and new version, format output
    local notes
    notes=$(echo "$releases" | jq -r --arg old "$old_version" --arg new "$new_version" '
        .[] |
        select(.draft == false and .prerelease == false) |
        (.tag_name | ltrimstr("v")) as $ver |
        select(
            ($ver != $old) and
            ([$ver, $old] | sort_by(split(".") | map(tonumber? // 0)) | .[0] == $old) and
            ([$ver, $new] | sort_by(split(".") | map(tonumber? // 0)) | .[1] == $new or $ver == $new)
        ) |
        "───────────────────────────────────────────────────────────\n" +
        "📦 " + .tag_name + " - " + (.name // "Release") + "\n" +
        "🔗 " + .html_url + "\n\n" +
        ((.body // "No release notes") | split("\n")[0:5] | join("\n"))
    ' 2>/dev/null)

    if [[ -n "$notes" ]]; then
        echo ""
        echo -e "${CYAN}📋 What's New (${old_version} → ${new_version}):${NC}"
        echo -e "$notes"
        echo ""
    fi
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

    # Capture current version before updating
    local old_version
    old_version=$(get_installed_version)

    info "Pulling latest changes..."
    git pull

    info "Rebuilding containers..."
    $COMPOSE_CMD up -d --build

    success "Vessel has been updated"

    wait_for_health

    # Get new version and show release notes
    local new_version
    new_version=$(get_installed_version)
    show_release_notes "$old_version" "$new_version"

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
    check_ollama
    clone_repository
    check_ports
    start_services
    wait_for_health
    prompt_pull_model
    print_success
}

# Run main with all arguments
main "$@"
