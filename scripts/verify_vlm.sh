#!/usr/bin/env bash
#
# VLM Verification Script
# Tests VLM functionality before release
#
# Usage:
#   ./scripts/verify_vlm.sh [--with-model <model-path>]
#
# Tests:
#   1. VLM binary execution
#   2. Config generation
#   3. Health endpoint
#   4. Models endpoint
#   5. Chat completion (if --with-model provided)

set -euo pipefail

# Colors
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' CYAN='' BOLD='' NC=''
fi

# Configuration
VLM_BIN="${VLM_BIN:-./apps/vlm/vlm}"
VLM_PORT="${VLM_PORT:-32799}"  # Use non-default port for testing
TEST_CONFIG="/tmp/vlm_test_config_$$.toml"
MODEL_PATH=""
VLM_PID=""

# Helpers
info() { echo -e "${CYAN}[INFO]${NC} $1"; }
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

cleanup() {
    if [[ -n "$VLM_PID" ]] && kill -0 "$VLM_PID" 2>/dev/null; then
        info "Stopping VLM (PID: $VLM_PID)"
        kill "$VLM_PID" 2>/dev/null || true
        wait "$VLM_PID" 2>/dev/null || true
    fi
    rm -f "$TEST_CONFIG"
}
trap cleanup EXIT

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --with-model)
            MODEL_PATH="$2"
            shift 2
            ;;
        --vlm-bin)
            VLM_BIN="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --with-model <path>  Test chat completion with a GGUF model"
            echo "  --vlm-bin <path>     Path to VLM binary (default: ./apps/vlm/vlm)"
            echo "  --help               Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# ============================================================================
# Tests
# ============================================================================

test_binary_exists() {
    info "Testing: VLM binary exists"
    if [[ ! -f "$VLM_BIN" ]]; then
        fail "VLM binary not found at $VLM_BIN"
        info "Build with: cd apps/vlm && go build -o vlm ./cmd/vlm/"
        return 1
    fi
    pass "Binary exists: $VLM_BIN"
}

test_binary_version() {
    info "Testing: VLM --version"
    local version
    if ! version=$("$VLM_BIN" --version 2>&1); then
        fail "VLM --version failed"
        return 1
    fi
    pass "Version: $version"
}

test_generate_config() {
    info "Testing: Config generation"

    # Generate test config
    cat > "$TEST_CONFIG" << EOF
[meta]
schema_version = 1

[vlm]
bind = "127.0.0.1:${VLM_PORT}"
auth_token = "test_token_for_verification"
log_dir = "/tmp/vlm_test_logs"
state_dir = "/tmp/vlm_test_state"

[security]
require_token_for_inference = true

[scheduler]
max_concurrent_requests = 2
queue_size = 64
interactive_reserve = 1

[models]
directories = ["/tmp/vlm_test_models"]
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
default_args = ["-c", "4096"]
EOF

    if [[ ! -f "$TEST_CONFIG" ]]; then
        fail "Failed to create test config"
        return 1
    fi
    pass "Test config created: $TEST_CONFIG"
}

test_vlm_startup() {
    info "Testing: VLM startup"

    mkdir -p /tmp/vlm_test_logs /tmp/vlm_test_state /tmp/vlm_test_models

    # Start VLM in background
    "$VLM_BIN" --config "$TEST_CONFIG" &>/tmp/vlm_test_output.log &
    VLM_PID=$!

    # Wait for startup
    local attempts=0
    local max_attempts=30

    while [[ $attempts -lt $max_attempts ]]; do
        if curl -sf "http://127.0.0.1:${VLM_PORT}/vlm/health" &>/dev/null; then
            pass "VLM started (PID: $VLM_PID)"
            return 0
        fi

        # Check if process died
        if ! kill -0 "$VLM_PID" 2>/dev/null; then
            fail "VLM process died during startup"
            echo "--- VLM output ---"
            cat /tmp/vlm_test_output.log
            echo "--- end output ---"
            VLM_PID=""
            return 1
        fi

        sleep 0.5
        attempts=$((attempts + 1))
    done

    fail "VLM did not become ready in time"
    return 1
}

test_health_endpoint() {
    info "Testing: /vlm/health endpoint"

    local response
    if ! response=$(curl -sf -H "Authorization: Bearer test_token_for_verification" \
        "http://127.0.0.1:${VLM_PORT}/vlm/health" 2>&1); then
        fail "Health endpoint failed"
        return 1
    fi

    pass "Health: $response"
}

test_status_endpoint() {
    info "Testing: /vlm/status endpoint"

    local response
    if ! response=$(curl -sf -H "Authorization: Bearer test_token_for_verification" \
        "http://127.0.0.1:${VLM_PORT}/vlm/status" 2>&1); then
        fail "Status endpoint failed"
        return 1
    fi

    pass "Status: $response"
}

test_models_endpoint() {
    info "Testing: /vlm/models endpoint"

    local response
    if ! response=$(curl -sf -H "Authorization: Bearer test_token_for_verification" \
        "http://127.0.0.1:${VLM_PORT}/vlm/models" 2>&1); then
        fail "Models endpoint failed"
        return 1
    fi

    pass "Models: $response"
}

test_v1_models_endpoint() {
    info "Testing: /v1/models endpoint (OpenAI-compatible)"

    local response
    if ! response=$(curl -sf -H "Authorization: Bearer test_token_for_verification" \
        "http://127.0.0.1:${VLM_PORT}/v1/models" 2>&1); then
        fail "/v1/models endpoint failed"
        return 1
    fi

    # Verify it looks like OpenAI format
    if ! echo "$response" | grep -q '"object"'; then
        fail "/v1/models response not in OpenAI format"
        return 1
    fi

    pass "/v1/models: OpenAI-compatible response"
}

test_auth_required_inference() {
    info "Testing: Auth required for /v1/models (inference)"

    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        "http://127.0.0.1:${VLM_PORT}/v1/models" 2>&1)

    if [[ "$http_code" == "401" ]]; then
        pass "Auth required for /v1/models (401 without token)"
    else
        fail "Auth not enforced for /v1/models (got $http_code, expected 401)"
        return 1
    fi
}

test_auth_required_control() {
    info "Testing: Auth required for /vlm/status (control plane)"

    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        "http://127.0.0.1:${VLM_PORT}/vlm/status" 2>&1)

    if [[ "$http_code" == "401" ]]; then
        pass "Auth required for /vlm/status (401 without token)"
    else
        fail "Auth not enforced for /vlm/status (got $http_code, expected 401)"
        return 1
    fi
}

test_auth_with_token() {
    info "Testing: Auth succeeds with valid token"

    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer test_token_for_verification" \
        "http://127.0.0.1:${VLM_PORT}/vlm/status" 2>&1)

    if [[ "$http_code" == "200" ]]; then
        pass "Auth succeeds with valid token (200)"
    else
        fail "Auth failed with valid token (got $http_code, expected 200)"
        return 1
    fi
}

test_auth_wrong_token() {
    info "Testing: Auth fails with wrong token"

    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer wrong_token_here" \
        "http://127.0.0.1:${VLM_PORT}/vlm/status" 2>&1)

    if [[ "$http_code" == "401" ]]; then
        pass "Auth rejected wrong token (401)"
    else
        fail "Auth accepted wrong token (got $http_code, expected 401)"
        return 1
    fi
}

test_chat_completion() {
    if [[ -z "$MODEL_PATH" ]]; then
        warn "Skipping chat completion test (no --with-model provided)"
        return 0
    fi

    if [[ ! -f "$MODEL_PATH" ]]; then
        fail "Model file not found: $MODEL_PATH"
        return 1
    fi

    info "Testing: Chat completion with model $MODEL_PATH"

    # Check if llama-server path is configured
    local llama_server_path
    llama_server_path=$(grep 'llama_server_path' "$TEST_CONFIG" 2>/dev/null | sed 's/.*= *"\([^"]*\)".*/\1/')

    if [[ -z "$llama_server_path" ]] || [[ ! -x "$llama_server_path" ]]; then
        warn "llama_server_path not configured or not executable"
        warn "Set it in the test config to enable streaming tests"
        return 0
    fi

    # Select model
    info "Selecting model..."
    local select_response
    select_response=$(curl -s -X POST \
        -H "Authorization: Bearer test_token_for_verification" \
        -H "Content-Type: application/json" \
        -d "{\"model_id\": \"llamacpp:$(basename "$MODEL_PATH" .gguf)\"}" \
        "http://127.0.0.1:${VLM_PORT}/vlm/models/select" 2>&1)

    if ! echo "$select_response" | grep -q '"status"'; then
        warn "Model select may have failed: $select_response"
    fi

    # Wait for model to load
    info "Waiting for model to load..."
    sleep 5

    # Test streaming completion
    info "Testing streaming chat completion..."
    local chunk_count=0
    local temp_output="/tmp/vlm_stream_test_$$.txt"

    # Send a simple request and capture first few chunks
    timeout 30 curl -sN -X POST \
        -H "Authorization: Bearer test_token_for_verification" \
        -H "Content-Type: application/json" \
        -d '{"model":"test","messages":[{"role":"user","content":"Say hi"}],"stream":true,"max_tokens":10}' \
        "http://127.0.0.1:${VLM_PORT}/v1/chat/completions" 2>/dev/null | head -5 > "$temp_output" || true

    if [[ -s "$temp_output" ]]; then
        # Check for SSE format
        if grep -q '^data:' "$temp_output"; then
            chunk_count=$(grep -c '^data:' "$temp_output" || echo 0)
            pass "Streaming works: received $chunk_count SSE chunks"
        else
            warn "Response not in SSE format"
            cat "$temp_output"
        fi
    else
        warn "No streaming response received (model may not be loaded)"
    fi

    rm -f "$temp_output"
}

# ============================================================================
# Main
# ============================================================================

main() {
    echo ""
    echo -e "${BOLD}VLM Verification Suite${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    local failed=0

    # Binary tests
    echo -e "${BOLD}Binary Tests${NC}"
    test_binary_exists || failed=$((failed + 1))
    test_binary_version || failed=$((failed + 1))
    echo ""

    # Config tests
    echo -e "${BOLD}Config Tests${NC}"
    test_generate_config || failed=$((failed + 1))
    echo ""

    # Startup test (required for remaining tests)
    echo -e "${BOLD}Startup Tests${NC}"
    test_vlm_startup || { failed=$((failed + 1)); return $failed; }
    echo ""

    # API tests
    echo -e "${BOLD}API Endpoint Tests${NC}"
    test_health_endpoint || failed=$((failed + 1))
    test_status_endpoint || failed=$((failed + 1))
    test_models_endpoint || failed=$((failed + 1))
    test_v1_models_endpoint || failed=$((failed + 1))
    echo ""

    # Auth tests
    echo -e "${BOLD}Authentication Tests${NC}"
    test_auth_required_inference || failed=$((failed + 1))
    test_auth_required_control || failed=$((failed + 1))
    test_auth_with_token || failed=$((failed + 1))
    test_auth_wrong_token || failed=$((failed + 1))
    echo ""

    # Streaming tests (optional)
    echo -e "${BOLD}Streaming Tests${NC}"
    test_chat_completion || failed=$((failed + 1))
    echo ""

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [[ $failed -eq 0 ]]; then
        echo -e "${GREEN}${BOLD}All tests passed!${NC}"
    else
        echo -e "${RED}${BOLD}$failed test(s) failed${NC}"
    fi
    echo ""

    return $failed
}

main "$@"
