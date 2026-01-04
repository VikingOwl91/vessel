package backends

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"vessel-backend/internal/llm"
)

const (
	defaultHealthCheckInterval = 10 * time.Second
	defaultGracefulStopTimeout = 5 * time.Second
	defaultStartupTimeout      = 60 * time.Second
	healthCheckRetryDelay      = 500 * time.Millisecond
	maxStderrLines             = 100
)

// ProcessState represents the current state of the llama-server process.
type ProcessState int

const (
	ProcessStateStopped ProcessState = iota
	ProcessStateStarting
	ProcessStateRunning
	ProcessStateStopping
	ProcessStateFailed
)

func (s ProcessState) String() string {
	switch s {
	case ProcessStateStopped:
		return "stopped"
	case ProcessStateStarting:
		return "starting"
	case ProcessStateRunning:
		return "running"
	case ProcessStateStopping:
		return "stopping"
	case ProcessStateFailed:
		return "failed"
	default:
		return "unknown"
	}
}

// LlamaCppProcess manages a single llama-server process.
type LlamaCppProcess struct {
	cmd          *exec.Cmd
	config       *llm.LlamaCppConfig
	binaryPath   string
	modelPath    string
	port         int
	baseURL      string
	httpClient   *http.Client
	logger       *slog.Logger

	mu           sync.RWMutex
	state        ProcessState
	startTime    time.Time
	lastHealth   time.Time
	lastError    error
	stderrBuf    *ringBuffer
	healthTicker *time.Ticker
	done         chan struct{}
	autoRestart  bool
}

// ringBuffer is a simple circular buffer for storing stderr lines.
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

// NewLlamaCppProcess creates a new process manager for llama-server.
func NewLlamaCppProcess(config *llm.LlamaCppConfig, port int) *LlamaCppProcess {
	if config == nil {
		preset := llm.VulkanOptimizedPreset
		config = &preset
	}

	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)

	return &LlamaCppProcess{
		config:     config,
		port:       port,
		baseURL:    baseURL,
		binaryPath: findLlamaServerBinary(),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		logger:    slog.Default().With("component", "llamacpp-process", "port", port),
		stderrBuf: newRingBuffer(maxStderrLines),
		state:     ProcessStateStopped,
	}
}

// findLlamaServerBinary searches for the llama-server binary in common locations.
func findLlamaServerBinary() string {
	candidates := []string{
		"llama-server",
		"/usr/local/bin/llama-server",
		"/usr/bin/llama-server",
		"./llama-server",
		"./bin/llama-server",
	}

	// Check LLAMA_SERVER_PATH environment variable first
	if path := os.Getenv("LLAMA_SERVER_PATH"); path != "" {
		return path
	}

	for _, candidate := range candidates {
		if path, err := exec.LookPath(candidate); err == nil {
			return path
		}
	}

	return "llama-server"
}

// SetBinaryPath sets a custom path for the llama-server binary.
func (p *LlamaCppProcess) SetBinaryPath(path string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.binaryPath = path
}

// SetAutoRestart enables or disables automatic restart on crash.
func (p *LlamaCppProcess) SetAutoRestart(enabled bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.autoRestart = enabled
}

// Start starts the llama-server process with the specified model.
func (p *LlamaCppProcess) Start(ctx context.Context, modelPath string) error {
	p.mu.Lock()
	if p.state == ProcessStateRunning || p.state == ProcessStateStarting {
		p.mu.Unlock()
		return fmt.Errorf("process already running or starting")
	}
	p.state = ProcessStateStarting
	p.modelPath = modelPath
	p.lastError = nil
	p.mu.Unlock()

	p.logger.Info("starting llama-server",
		"model", modelPath,
		"binary", p.binaryPath,
	)

	// Validate model file exists
	if _, err := os.Stat(modelPath); os.IsNotExist(err) {
		p.setFailed(fmt.Errorf("model file not found: %s", modelPath))
		return p.lastError
	}

	// Validate binary exists
	if _, err := exec.LookPath(p.binaryPath); err != nil {
		p.setFailed(llm.NewCategorizedError(
			llm.BackendLlamaCppServer,
			"Start",
			fmt.Errorf("llama-server binary not found: %s", p.binaryPath),
			llm.ErrCategoryBackendInit,
			"Install llama.cpp or set LLAMA_SERVER_PATH environment variable",
		))
		return p.lastError
	}

	// Build command arguments
	args := p.buildArgs(modelPath)
	p.logger.Debug("command arguments", "args", args)

	// Create command
	p.cmd = exec.CommandContext(ctx, p.binaryPath, args...)

	// Capture stdout
	stdout, err := p.cmd.StdoutPipe()
	if err != nil {
		p.setFailed(fmt.Errorf("failed to create stdout pipe: %w", err))
		return p.lastError
	}

	// Capture stderr
	stderr, err := p.cmd.StderrPipe()
	if err != nil {
		p.setFailed(fmt.Errorf("failed to create stderr pipe: %w", err))
		return p.lastError
	}

	// Start the process
	if err := p.cmd.Start(); err != nil {
		errCategory := classifyStartError(err)
		p.setFailed(llm.NewCategorizedError(
			llm.BackendLlamaCppServer,
			"Start",
			err,
			errCategory,
			getSuggestionForCategory(errCategory),
		))
		return p.lastError
	}

	p.mu.Lock()
	p.startTime = time.Now()
	p.done = make(chan struct{})
	p.mu.Unlock()

	// Start output capture goroutines
	go p.captureOutput("stdout", stdout)
	go p.captureOutput("stderr", stderr)

	// Start process monitor
	go p.monitorProcess()

	// Wait for the server to become ready
	readyCtx, cancel := context.WithTimeout(ctx, defaultStartupTimeout)
	defer cancel()

	if err := p.WaitReady(readyCtx, defaultStartupTimeout); err != nil {
		p.logger.Error("server failed to become ready", "error", err)
		_ = p.Kill()
		p.setFailed(llm.NewCategorizedError(
			llm.BackendLlamaCppServer,
			"Start",
			fmt.Errorf("server failed to become ready: %w", err),
			llm.ErrCategoryLoadFailure,
			"Check model file format and system resources",
		).WithContext(&llm.ErrorContext{
			ModelID:    modelPath,
			FlagsUsed:  args,
			StderrTail: p.stderrBuf.String(),
		}))
		return p.lastError
	}

	p.mu.Lock()
	p.state = ProcessStateRunning
	p.lastHealth = time.Now()
	p.mu.Unlock()

	// Start health monitoring
	go p.healthMonitor()

	p.logger.Info("llama-server started successfully",
		"model", modelPath,
		"startup_time", time.Since(p.startTime),
	)

	return nil
}

// buildArgs constructs command-line arguments for llama-server.
func (p *LlamaCppProcess) buildArgs(modelPath string) []string {
	args := []string{
		"--model", modelPath,
		"--port", strconv.Itoa(p.port),
		"--host", "127.0.0.1",
	}

	// Add config-based arguments
	args = append(args, p.config.ToArgs()...)

	return args
}

// captureOutput reads from a pipe and logs/stores the output.
func (p *LlamaCppProcess) captureOutput(name string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()

		if name == "stderr" {
			p.stderrBuf.Write(line)
		}

		// Log at appropriate level based on content
		if strings.Contains(strings.ToLower(line), "error") {
			p.logger.Error("process output", "stream", name, "line", line)
		} else if strings.Contains(strings.ToLower(line), "warn") {
			p.logger.Warn("process output", "stream", name, "line", line)
		} else {
			p.logger.Debug("process output", "stream", name, "line", line)
		}
	}

	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		p.logger.Debug("output scanner error", "stream", name, "error", err)
	}
}

// monitorProcess watches the process and handles crashes.
func (p *LlamaCppProcess) monitorProcess() {
	if p.cmd == nil || p.cmd.Process == nil {
		return
	}

	err := p.cmd.Wait()

	p.mu.Lock()
	wasRunning := p.state == ProcessStateRunning
	autoRestart := p.autoRestart
	modelPath := p.modelPath

	if p.state != ProcessStateStopping {
		p.state = ProcessStateFailed
		if err != nil {
			p.lastError = err
		}
	} else {
		p.state = ProcessStateStopped
	}

	// Signal that process has exited
	if p.done != nil {
		close(p.done)
		p.done = nil
	}
	p.mu.Unlock()

	if wasRunning && err != nil {
		p.logger.Error("process crashed unexpectedly",
			"error", err,
			"stderr_tail", p.stderrBuf.String(),
		)

		// Auto-restart if enabled
		if autoRestart {
			p.logger.Info("attempting auto-restart")
			ctx, cancel := context.WithTimeout(context.Background(), defaultStartupTimeout)
			defer cancel()
			if restartErr := p.Start(ctx, modelPath); restartErr != nil {
				p.logger.Error("auto-restart failed", "error", restartErr)
			}
		}
	}
}

// healthMonitor periodically checks the server health.
func (p *LlamaCppProcess) healthMonitor() {
	p.mu.Lock()
	p.healthTicker = time.NewTicker(defaultHealthCheckInterval)
	done := p.done
	p.mu.Unlock()

	defer func() {
		p.mu.Lock()
		if p.healthTicker != nil {
			p.healthTicker.Stop()
			p.healthTicker = nil
		}
		p.mu.Unlock()
	}()

	for {
		select {
		case <-done:
			return
		case <-p.healthTicker.C:
			healthy, err := p.Health()
			if healthy {
				p.mu.Lock()
				p.lastHealth = time.Now()
				p.mu.Unlock()
			} else if err != nil {
				p.logger.Warn("health check failed", "error", err)
			}
		}
	}
}

// WaitReady polls the health endpoint until the server is ready.
func (p *LlamaCppProcess) WaitReady(ctx context.Context, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if time.Now().After(deadline) {
			return fmt.Errorf("timeout waiting for server to become ready")
		}

		healthy, err := p.Health()
		if healthy {
			return nil
		}

		// Check if process has died
		p.mu.RLock()
		state := p.state
		lastErr := p.lastError
		p.mu.RUnlock()

		if state == ProcessStateFailed || state == ProcessStateStopped {
			if lastErr != nil {
				return fmt.Errorf("process exited before becoming ready: %w", lastErr)
			}
			return fmt.Errorf("process exited before becoming ready")
		}

		if err != nil {
			p.logger.Debug("health check not ready yet", "error", err)
		}

		time.Sleep(healthCheckRetryDelay)
	}
}

// Health checks the /health endpoint of the llama-server.
func (p *LlamaCppProcess) Health() (bool, error) {
	p.mu.RLock()
	if p.state != ProcessStateRunning && p.state != ProcessStateStarting {
		p.mu.RUnlock()
		return false, fmt.Errorf("process not running (state: %s)", p.state)
	}
	baseURL := p.baseURL
	p.mu.RUnlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/health", nil)
	if err != nil {
		return false, fmt.Errorf("failed to create health request: %w", err)
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("health check request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return false, fmt.Errorf("health check returned status %d: %s", resp.StatusCode, string(body))
	}

	// Parse health response
	var healthResp struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&healthResp); err != nil {
		// Some versions of llama-server just return 200 without JSON
		return true, nil
	}

	// llama-server returns "ok" when ready
	if healthResp.Status == "ok" || healthResp.Status == "" {
		return true, nil
	}

	return false, fmt.Errorf("server not ready: %s", healthResp.Status)
}

// Stop gracefully stops the llama-server process.
func (p *LlamaCppProcess) Stop() error {
	p.mu.Lock()
	if p.state != ProcessStateRunning && p.state != ProcessStateStarting {
		p.mu.Unlock()
		return nil
	}

	if p.cmd == nil || p.cmd.Process == nil {
		p.state = ProcessStateStopped
		p.mu.Unlock()
		return nil
	}

	p.state = ProcessStateStopping
	done := p.done
	process := p.cmd.Process
	p.mu.Unlock()

	p.logger.Info("stopping llama-server gracefully")

	// Send SIGTERM for graceful shutdown
	if err := process.Signal(syscall.SIGTERM); err != nil {
		p.logger.Warn("failed to send SIGTERM", "error", err)
		return p.Kill()
	}

	// Wait for graceful shutdown with timeout
	select {
	case <-done:
		p.logger.Info("llama-server stopped gracefully")
		return nil
	case <-time.After(defaultGracefulStopTimeout):
		p.logger.Warn("graceful shutdown timeout, sending SIGKILL")
		return p.Kill()
	}
}

// Kill forcefully terminates the llama-server process.
func (p *LlamaCppProcess) Kill() error {
	p.mu.Lock()
	if p.cmd == nil || p.cmd.Process == nil {
		p.state = ProcessStateStopped
		p.mu.Unlock()
		return nil
	}

	process := p.cmd.Process
	p.state = ProcessStateStopping
	p.mu.Unlock()

	p.logger.Info("killing llama-server process")

	if err := process.Kill(); err != nil {
		// Process might have already exited
		if !strings.Contains(err.Error(), "process already finished") {
			return fmt.Errorf("failed to kill process: %w", err)
		}
	}

	p.mu.Lock()
	p.state = ProcessStateStopped
	p.mu.Unlock()

	return nil
}

// Restart stops and restarts the process with a new model (or same if empty).
func (p *LlamaCppProcess) Restart(ctx context.Context, modelPath string) error {
	p.mu.RLock()
	if modelPath == "" {
		modelPath = p.modelPath
	}
	p.mu.RUnlock()

	if modelPath == "" {
		return fmt.Errorf("no model path specified and no previous model loaded")
	}

	p.logger.Info("restarting llama-server", "model", modelPath)

	if err := p.Stop(); err != nil {
		p.logger.Warn("error during stop for restart", "error", err)
	}

	// Brief pause to ensure port is released
	time.Sleep(100 * time.Millisecond)

	return p.Start(ctx, modelPath)
}

// IsRunning returns true if the process is currently running.
func (p *LlamaCppProcess) IsRunning() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.state == ProcessStateRunning
}

// State returns the current process state.
func (p *LlamaCppProcess) State() ProcessState {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.state
}

// BaseURL returns the base URL for the llama-server API.
func (p *LlamaCppProcess) BaseURL() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.baseURL
}

// Port returns the port the server is listening on.
func (p *LlamaCppProcess) Port() int {
	return p.port
}

// ModelPath returns the path to the currently loaded model.
func (p *LlamaCppProcess) ModelPath() string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.modelPath
}

// StartTime returns when the process was started.
func (p *LlamaCppProcess) StartTime() time.Time {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.startTime
}

// LastHealthCheck returns the time of the last successful health check.
func (p *LlamaCppProcess) LastHealthCheck() time.Time {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.lastHealth
}

// LastError returns the last error that occurred.
func (p *LlamaCppProcess) LastError() error {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.lastError
}

// StderrTail returns the last N lines of stderr output.
func (p *LlamaCppProcess) StderrTail() string {
	return p.stderrBuf.String()
}

// Status returns the current status of the process.
func (p *LlamaCppProcess) Status() *ProcessStatus {
	p.mu.RLock()
	defer p.mu.RUnlock()

	status := &ProcessStatus{
		State:        p.state,
		ModelPath:    p.modelPath,
		Port:         p.port,
		BaseURL:      p.baseURL,
		BinaryPath:   p.binaryPath,
		AutoRestart:  p.autoRestart,
	}

	if p.state == ProcessStateRunning {
		status.StartTime = p.startTime
		status.LastHealth = p.lastHealth
		status.Uptime = time.Since(p.startTime)
	}

	if p.lastError != nil {
		status.LastError = p.lastError.Error()
	}

	return status
}

// ProcessStatus contains detailed status information about the process.
type ProcessStatus struct {
	State       ProcessState  `json:"state"`
	ModelPath   string        `json:"model_path,omitempty"`
	Port        int           `json:"port"`
	BaseURL     string        `json:"base_url"`
	BinaryPath  string        `json:"binary_path"`
	StartTime   time.Time     `json:"start_time,omitempty"`
	LastHealth  time.Time     `json:"last_health,omitempty"`
	Uptime      time.Duration `json:"uptime,omitempty"`
	LastError   string        `json:"last_error,omitempty"`
	AutoRestart bool          `json:"auto_restart"`
}

// setFailed sets the process state to failed with an error.
func (p *LlamaCppProcess) setFailed(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.state = ProcessStateFailed
	p.lastError = err
	p.logger.Error("process failed", "error", err)
}

// classifyStartError categorizes process startup errors.
func classifyStartError(err error) llm.ErrorCategory {
	errStr := strings.ToLower(err.Error())

	switch {
	case strings.Contains(errStr, "executable file not found"):
		return llm.ErrCategoryBackendInit
	case strings.Contains(errStr, "permission denied"):
		return llm.ErrCategoryBackendInit
	case strings.Contains(errStr, "address already in use"):
		return llm.ErrCategoryNetwork
	default:
		return llm.ClassifyError(err)
	}
}

// getSuggestionForCategory returns a user-friendly suggestion for an error category.
func getSuggestionForCategory(category llm.ErrorCategory) string {
	switch category {
	case llm.ErrCategoryBackendInit:
		return "Install llama.cpp or set LLAMA_SERVER_PATH environment variable"
	case llm.ErrCategoryNetwork:
		return "Port may be in use; try a different port"
	case llm.ErrCategoryLoadFailure:
		return "Verify the model file is a valid GGUF file"
	case llm.ErrCategoryVRAM:
		return "Reduce GPU layers or use a smaller model"
	default:
		return "Check the logs for more details"
	}
}
