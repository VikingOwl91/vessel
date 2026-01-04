package probe

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// ProbeResult contains the result of probing a llama-server binary.
type ProbeResult struct {
	Valid        bool     `json:"valid"`
	Path         string   `json:"path"`
	Version      string   `json:"version,omitempty"`
	Backends     []string `json:"backends,omitempty"`
	Error        string   `json:"error,omitempty"`
	SmokeTestOK  bool     `json:"smoke_test_ok"`
}

// Probe examines a llama-server binary to determine its capabilities.
func Probe(ctx context.Context, binaryPath string) (*ProbeResult, error) {
	result := &ProbeResult{
		Path: binaryPath,
	}

	// Check if binary exists
	if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
		result.Error = "binary not found"
		return result, nil
	}

	// Check if executable
	if _, err := exec.LookPath(binaryPath); err != nil {
		result.Error = "binary not executable"
		return result, nil
	}

	// Run --version or --help to get info
	versionCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(versionCtx, binaryPath, "--version")
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Try --help instead
		helpCtx, helpCancel := context.WithTimeout(ctx, 5*time.Second)
		defer helpCancel()

		cmd = exec.CommandContext(helpCtx, binaryPath, "--help")
		output, err = cmd.CombinedOutput()
		if err != nil {
			result.Error = fmt.Sprintf("failed to get version/help: %v", err)
			return result, nil
		}
	}

	result.Valid = true
	result.Version = extractVersion(string(output))
	result.Backends = extractBackends(string(output))

	return result, nil
}

// ProbeWithSmokeTest runs a full probe including a smoke test (starting the server).
func ProbeWithSmokeTest(ctx context.Context, binaryPath, modelPath string) (*ProbeResult, error) {
	// First do basic probe
	result, err := Probe(ctx, binaryPath)
	if err != nil {
		return result, err
	}

	if !result.Valid {
		return result, nil
	}

	// Find a free port for smoke test
	port, err := findFreePort()
	if err != nil {
		result.Error = fmt.Sprintf("failed to find free port: %v", err)
		return result, nil
	}

	// Start server for smoke test
	smokeCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(smokeCtx, binaryPath,
		"--model", modelPath,
		"--port", fmt.Sprintf("%d", port),
		"--host", "127.0.0.1",
		"-c", "256", // Small context for smoke test
		"--batch-size", "64",
	)

	// Start in background
	if err := cmd.Start(); err != nil {
		result.Error = fmt.Sprintf("failed to start server: %v", err)
		return result, nil
	}
	defer func() {
		cmd.Process.Kill()
		cmd.Wait()
	}()

	// Wait for server to be ready
	ready := false
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	client := &http.Client{Timeout: 2 * time.Second}

	for i := 0; i < 15; i++ {
		select {
		case <-smokeCtx.Done():
			result.Error = "smoke test timeout"
			return result, nil
		default:
		}

		resp, err := client.Get(baseURL + "/health")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				ready = true
				break
			}
		}
		time.Sleep(1 * time.Second)
	}

	if !ready {
		result.Error = "server did not become ready"
		return result, nil
	}

	// Try a minimal completion
	reqBody := map[string]interface{}{
		"model":      "local",
		"messages":   []map[string]string{{"role": "user", "content": "hi"}},
		"max_tokens": 1,
		"stream":     false,
	}
	bodyBytes, _ := json.Marshal(reqBody)

	resp, err := client.Post(baseURL+"/v1/chat/completions", "application/json", bytes.NewReader(bodyBytes))
	if err != nil {
		result.Error = fmt.Sprintf("completion request failed: %v", err)
		return result, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		result.Error = fmt.Sprintf("completion returned status %d", resp.StatusCode)
		return result, nil
	}

	result.SmokeTestOK = true
	return result, nil
}

// extractVersion tries to extract version info from output.
func extractVersion(output string) string {
	// Look for version patterns like "version: 1.0.0" or "b1234"
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`version[:\s]+([0-9]+\.[0-9]+\.?[0-9]*)`),
		regexp.MustCompile(`\bb([0-9]+)\b`), // Build number like b1234
		regexp.MustCompile(`v([0-9]+\.[0-9]+\.?[0-9]*)`),
	}

	for _, pattern := range patterns {
		if matches := pattern.FindStringSubmatch(output); len(matches) > 1 {
			return matches[1]
		}
	}

	return "unknown"
}

// extractBackends tries to detect supported backends from output.
func extractBackends(output string) []string {
	lower := strings.ToLower(output)
	var backends []string

	backendKeywords := map[string]string{
		"cuda":   "cuda",
		"metal":  "metal",
		"rocm":   "rocm",
		"vulkan": "vulkan",
		"sycl":   "sycl",
		"cpu":    "cpu",
	}

	for keyword, backend := range backendKeywords {
		if strings.Contains(lower, keyword) {
			backends = append(backends, backend)
		}
	}

	// If no backends detected, assume CPU
	if len(backends) == 0 {
		backends = []string{"cpu"}
	}

	return backends
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

// CheckGPUHints checks environment and libraries for GPU hints.
type GPUHints struct {
	CUDAVisible bool   `json:"cuda_visible"`
	MetalDevice bool   `json:"metal_device"`
	VulkanReady bool   `json:"vulkan_ready"`
	ROCmVisible bool   `json:"rocm_visible"`
	Platform    string `json:"platform"`
}

func CheckGPUHints() GPUHints {
	hints := GPUHints{}

	// Check CUDA
	if os.Getenv("CUDA_VISIBLE_DEVICES") != "" {
		hints.CUDAVisible = true
	}
	if _, err := os.Stat("/usr/lib/libcuda.so"); err == nil {
		hints.CUDAVisible = true
	}
	if _, err := os.Stat("/usr/lib64/libcuda.so"); err == nil {
		hints.CUDAVisible = true
	}

	// Check Vulkan
	if _, err := os.Stat("/usr/lib/libvulkan.so"); err == nil {
		hints.VulkanReady = true
	}
	if _, err := os.Stat("/usr/lib/libvulkan.so.1"); err == nil {
		hints.VulkanReady = true
	}

	// Check ROCm
	if os.Getenv("ROCR_VISIBLE_DEVICES") != "" {
		hints.ROCmVisible = true
	}
	if _, err := os.Stat("/opt/rocm"); err == nil {
		hints.ROCmVisible = true
	}

	// Detect platform
	if _, err := os.Stat("/System/Library/Frameworks/Metal.framework"); err == nil {
		hints.Platform = "darwin"
		hints.MetalDevice = true
	} else if _, err := os.Stat("/proc/version"); err == nil {
		hints.Platform = "linux"
	} else {
		hints.Platform = "unknown"
	}

	return hints
}
