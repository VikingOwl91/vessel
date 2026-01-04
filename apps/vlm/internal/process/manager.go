package process

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/vikingowl91/vessel/apps/vlm/internal/config"
)

const (
	defaultHealthCheckInterval = 10 * time.Second
	healthCheckRetryDelay      = 500 * time.Millisecond
	maxStderrLines             = 100
)

// State represents the current state of the llama-server process.
type State int

const (
	StateStopped State = iota
	StateStarting
	StateRunning
	StateStopping
	StateFailed
)

func (s State) String() string {
	switch s {
	case StateStopped:
		return "stopped"
	case StateStarting:
		return "starting"
	case StateRunning:
		return "running"
	case StateStopping:
		return "stopping"
	case StateFailed:
		return "failed"
	default:
		return "unknown"
	}
}

// Manager manages a single llama-server process.
type Manager struct {
	cmd        *exec.Cmd
	profile    *config.LlamaCppProfile
	modelPath  string
	modelID    string
	port       int
	baseURL    string
	httpClient *http.Client
	logger     *slog.Logger

	mu           sync.RWMutex
	state        State
	startTime    time.Time
	lastHealth   time.Time
	lastError    error
	stderrBuf    *ringBuffer
	healthTicker *time.Ticker
	done         chan struct{}

	// Switching config
	startupTimeout  time.Duration
	gracefulTimeout time.Duration
}

// ringBuffer is a circular buffer for storing stderr lines.
type ringBuffer struct {
	lines []string
	pos   int
	full  bool
	mu    sync.Mutex
}

func newRingBuffer(size int) *ringBuffer {
	return &ringBuffer{
		lines: make([]string, size),
	}
}

func (rb *ringBuffer) Write(line string) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	rb.lines[rb.pos] = line
	rb.pos = (rb.pos + 1) % len(rb.lines)
	if rb.pos == 0 {
		rb.full = true
	}
}

func (rb *ringBuffer) Lines() []string {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	if !rb.full {
		return append([]string{}, rb.lines[:rb.pos]...)
	}

	result := make([]string, len(rb.lines))
	copy(result, rb.lines[rb.pos:])
	copy(result[len(rb.lines)-rb.pos:], rb.lines[:rb.pos])
	return result
}

func (rb *ringBuffer) String() string {
	return strings.Join(rb.Lines(), "\n")
}

// NewManager creates a new process manager for llama-server.
// Port is determined dynamically by finding a free port.
func NewManager(profile *config.LlamaCppProfile, cfg *config.Config) (*Manager, error) {
	port, err := findFreePort()
	if err != nil {
		return nil, fmt.Errorf("failed to find free port: %w", err)
	}

	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)

	return &Manager{
		profile: profile,
		port:    port,
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		logger:          slog.Default().With("component", "process-manager", "port", port, "profile", profile.Name),
		stderrBuf:       newRingBuffer(maxStderrLines),
		state:           StateStopped,
		startupTimeout:  cfg.LlamaCpp.Switching.StartupTimeout.Duration,
		gracefulTimeout: cfg.LlamaCpp.Switching.GracefulTimeout.Duration,
	}, nil
}

// findFreePort finds an available TCP port.
func findFreePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()

	addr := listener.Addr().(*net.TCPAddr)
	return addr.Port, nil
}

// Start starts the llama-server process with the specified model.
func (m *Manager) Start(ctx context.Context, modelPath, modelID string) error {
	m.mu.Lock()
	if m.state == StateRunning || m.state == StateStarting {
		m.mu.Unlock()
		return fmt.Errorf("process already running or starting")
	}
	m.state = StateStarting
	m.modelPath = modelPath
	m.modelID = modelID
	m.lastError = nil
	m.mu.Unlock()

	m.logger.Info("starting llama-server",
		"model", modelPath,
		"model_id", modelID,
		"binary", m.profile.LlamaServerPath,
	)

	// Validate model file exists
	if _, err := os.Stat(modelPath); os.IsNotExist(err) {
		m.setFailed(fmt.Errorf("model file not found: %s", modelPath))
		return m.lastError
	}

	// Validate binary exists
	if _, err := exec.LookPath(m.profile.LlamaServerPath); err != nil {
		m.setFailed(fmt.Errorf("llama-server binary not found: %s", m.profile.LlamaServerPath))
		return m.lastError
	}

	// Build command arguments
	args := m.buildArgs(modelPath)
	m.logger.Debug("command arguments", "args", args)

	// Create command - use Background context so process survives request completion
	// The ctx parameter is only used for startup timeout, not process lifecycle
	m.cmd = exec.Command(m.profile.LlamaServerPath, args...)

	// Set extra environment variables from profile
	if len(m.profile.ExtraEnv) > 0 {
		m.cmd.Env = append(os.Environ(), m.profile.ExtraEnv...)
	}

	// Capture stdout
	stdout, err := m.cmd.StdoutPipe()
	if err != nil {
		m.setFailed(fmt.Errorf("failed to create stdout pipe: %w", err))
		return m.lastError
	}

	// Capture stderr
	stderr, err := m.cmd.StderrPipe()
	if err != nil {
		m.setFailed(fmt.Errorf("failed to create stderr pipe: %w", err))
		return m.lastError
	}

	// Start the process
	if err := m.cmd.Start(); err != nil {
		m.setFailed(fmt.Errorf("failed to start process: %w", err))
		return m.lastError
	}

	m.mu.Lock()
	m.startTime = time.Now()
	m.done = make(chan struct{})
	m.mu.Unlock()

	// Start output capture goroutines
	go m.captureOutput("stdout", stdout)
	go m.captureOutput("stderr", stderr)

	// Start process monitor
	go m.monitorProcess()

	// Wait for the server to become ready
	readyCtx, cancel := context.WithTimeout(ctx, m.startupTimeout)
	defer cancel()

	if err := m.waitReady(readyCtx); err != nil {
		m.logger.Error("server failed to become ready", "error", err)
		_ = m.Kill()
		m.setFailed(fmt.Errorf("server failed to become ready: %w\nstderr: %s", err, m.stderrBuf.String()))
		return m.lastError
	}

	m.mu.Lock()
	m.state = StateRunning
	m.lastHealth = time.Now()
	m.mu.Unlock()

	// Start health monitoring
	go m.healthMonitor()

	m.logger.Info("llama-server started successfully",
		"model", modelPath,
		"startup_time", time.Since(m.startTime),
	)

	return nil
}

// buildArgs constructs command-line arguments for llama-server.
func (m *Manager) buildArgs(modelPath string) []string {
	args := []string{
		"--model", modelPath,
		"--port", strconv.Itoa(m.port),
		"--host", "127.0.0.1",
	}

	// Add default args from profile
	args = append(args, m.profile.DefaultArgs...)

	return args
}

// captureOutput reads from a pipe and logs/stores the output.
func (m *Manager) captureOutput(name string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()

		if name == "stderr" {
			m.stderrBuf.Write(line)
		}

		// Log at appropriate level based on content
		lower := strings.ToLower(line)
		if strings.Contains(lower, "error") {
			m.logger.Error("process output", "stream", name, "line", line)
		} else if strings.Contains(lower, "warn") {
			m.logger.Warn("process output", "stream", name, "line", line)
		} else {
			m.logger.Debug("process output", "stream", name, "line", line)
		}
	}

	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		m.logger.Debug("output scanner error", "stream", name, "error", err)
	}
}

// monitorProcess watches the process and handles crashes.
func (m *Manager) monitorProcess() {
	if m.cmd == nil || m.cmd.Process == nil {
		return
	}

	err := m.cmd.Wait()

	m.mu.Lock()
	if m.state != StateStopping {
		m.state = StateFailed
		if err != nil {
			m.lastError = err
		}
	} else {
		m.state = StateStopped
	}

	// Signal that process has exited
	if m.done != nil {
		close(m.done)
		m.done = nil
	}
	m.mu.Unlock()

	if err != nil {
		m.logger.Error("process exited",
			"error", err,
			"stderr_tail", m.stderrBuf.String(),
		)
	}
}

// healthMonitor periodically checks the server health.
func (m *Manager) healthMonitor() {
	m.mu.Lock()
	m.healthTicker = time.NewTicker(defaultHealthCheckInterval)
	done := m.done
	m.mu.Unlock()

	defer func() {
		m.mu.Lock()
		if m.healthTicker != nil {
			m.healthTicker.Stop()
			m.healthTicker = nil
		}
		m.mu.Unlock()
	}()

	for {
		select {
		case <-done:
			return
		case <-m.healthTicker.C:
			healthy, err := m.Health()
			if healthy {
				m.mu.Lock()
				m.lastHealth = time.Now()
				m.mu.Unlock()
			} else if err != nil {
				m.logger.Warn("health check failed", "error", err)
			}
		}
	}
}

// waitReady polls until the server is ready using a 1-token completion check.
func (m *Manager) waitReady(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Check if process has died
		m.mu.RLock()
		state := m.state
		lastErr := m.lastError
		m.mu.RUnlock()

		if state == StateFailed || state == StateStopped {
			if lastErr != nil {
				return fmt.Errorf("process exited before becoming ready: %w", lastErr)
			}
			return fmt.Errorf("process exited before becoming ready")
		}

		// Try a minimal completion request (1 token, non-streaming)
		// This is more reliable than /health for verifying full readiness
		ready, err := m.checkReadyViaCompletion(ctx)
		if ready {
			return nil
		}
		if err != nil {
			m.logger.Debug("readiness check not ready yet", "error", err)
		}

		time.Sleep(healthCheckRetryDelay)
	}
}

// checkReadyViaCompletion performs a 1-token completion to verify readiness.
func (m *Manager) checkReadyViaCompletion(ctx context.Context) (bool, error) {
	reqBody := map[string]interface{}{
		"model":      "local",
		"messages":   []map[string]string{{"role": "user", "content": "hi"}},
		"max_tokens": 1,
		"stream":     false,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return false, err
	}

	checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(checkCtx, http.MethodPost,
		m.baseURL+"/v1/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	// 200 = ready, any other status = not ready yet
	if resp.StatusCode == http.StatusOK {
		return true, nil
	}

	body, _ := io.ReadAll(resp.Body)
	return false, fmt.Errorf("completion returned status %d: %s", resp.StatusCode, string(body))
}

// Health checks the /health endpoint of the llama-server.
func (m *Manager) Health() (bool, error) {
	m.mu.RLock()
	if m.state != StateRunning && m.state != StateStarting {
		m.mu.RUnlock()
		return false, fmt.Errorf("process not running (state: %s)", m.state)
	}
	baseURL := m.baseURL
	m.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/health", nil)
	if err != nil {
		return false, fmt.Errorf("failed to create health request: %w", err)
	}

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("health check request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return false, fmt.Errorf("health check returned status %d: %s", resp.StatusCode, string(body))
	}

	return true, nil
}

// Stop gracefully stops the llama-server process.
func (m *Manager) Stop() error {
	m.mu.Lock()
	if m.state != StateRunning && m.state != StateStarting {
		m.mu.Unlock()
		return nil
	}

	if m.cmd == nil || m.cmd.Process == nil {
		m.state = StateStopped
		m.mu.Unlock()
		return nil
	}

	m.state = StateStopping
	done := m.done
	process := m.cmd.Process
	gracefulTimeout := m.gracefulTimeout
	m.mu.Unlock()

	m.logger.Info("stopping llama-server gracefully")

	// Send SIGTERM for graceful shutdown
	if err := process.Signal(syscall.SIGTERM); err != nil {
		m.logger.Warn("failed to send SIGTERM", "error", err)
		return m.Kill()
	}

	// Wait for graceful shutdown with timeout
	select {
	case <-done:
		m.logger.Info("llama-server stopped gracefully")
		return nil
	case <-time.After(gracefulTimeout):
		m.logger.Warn("graceful shutdown timeout, sending SIGKILL")
		return m.Kill()
	}
}

// Kill forcefully terminates the llama-server process.
func (m *Manager) Kill() error {
	m.mu.Lock()
	if m.cmd == nil || m.cmd.Process == nil {
		m.state = StateStopped
		m.mu.Unlock()
		return nil
	}

	process := m.cmd.Process
	m.state = StateStopping
	m.mu.Unlock()

	m.logger.Info("killing llama-server process")

	if err := process.Kill(); err != nil {
		// Process might have already exited
		if !strings.Contains(err.Error(), "process already finished") {
			return fmt.Errorf("failed to kill process: %w", err)
		}
	}

	m.mu.Lock()
	m.state = StateStopped
	m.mu.Unlock()

	return nil
}

// IsRunning returns true if the process is currently running.
func (m *Manager) IsRunning() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state == StateRunning
}

// State returns the current process state.
func (m *Manager) GetState() State {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.state
}

// BaseURL returns the base URL for the llama-server API.
func (m *Manager) BaseURL() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.baseURL
}

// Port returns the port the server is listening on.
func (m *Manager) Port() int {
	return m.port
}

// ModelPath returns the path to the currently loaded model.
func (m *Manager) ModelPath() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.modelPath
}

// ModelID returns the ID of the currently loaded model.
func (m *Manager) ModelID() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.modelID
}

// ProfileName returns the name of the profile being used.
func (m *Manager) ProfileName() string {
	return m.profile.Name
}

// StartTime returns when the process was started.
func (m *Manager) StartTime() time.Time {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.startTime
}

// Uptime returns how long the process has been running.
func (m *Manager) Uptime() time.Duration {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.state != StateRunning {
		return 0
	}
	return time.Since(m.startTime)
}

// LastError returns the last error that occurred.
func (m *Manager) LastError() error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.lastError
}

// StderrTail returns the last N lines of stderr output.
func (m *Manager) StderrTail() string {
	return m.stderrBuf.String()
}

// Status returns the current status of the process.
func (m *Manager) Status() *Status {
	m.mu.RLock()
	defer m.mu.RUnlock()

	status := &Status{
		State:       m.state.String(),
		ModelPath:   m.modelPath,
		ModelID:     m.modelID,
		Port:        m.port,
		BaseURL:     m.baseURL,
		ProfileName: m.profile.Name,
		BinaryPath:  m.profile.LlamaServerPath,
	}

	if m.state == StateRunning {
		status.StartTime = m.startTime
		status.LastHealth = m.lastHealth
		status.Uptime = time.Since(m.startTime).String()
	}

	if m.lastError != nil {
		status.LastError = m.lastError.Error()
	}

	return status
}

// Status contains detailed status information about the process.
type Status struct {
	State       string    `json:"state"`
	ModelPath   string    `json:"model_path,omitempty"`
	ModelID     string    `json:"model_id,omitempty"`
	Port        int       `json:"port"`
	BaseURL     string    `json:"base_url"`
	ProfileName string    `json:"profile_name"`
	BinaryPath  string    `json:"binary_path"`
	StartTime   time.Time `json:"start_time,omitempty"`
	LastHealth  time.Time `json:"last_health,omitempty"`
	Uptime      string    `json:"uptime,omitempty"`
	LastError   string    `json:"last_error,omitempty"`
}

// setFailed sets the process state to failed with an error.
func (m *Manager) setFailed(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.state = StateFailed
	m.lastError = err
	m.logger.Error("process failed", "error", err)
}
