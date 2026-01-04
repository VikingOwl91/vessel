package llm

import (
	"fmt"
	"os"
	"time"
)

const (
	defaultTimeout   = 120 * time.Second
	defaultOllamaURL = "http://localhost:11434"
)

// BackendConfig holds configuration for a single LLM backend
type BackendConfig struct {
	Type     BackendType       `json:"type"`
	Name     string            `json:"name"`
	Enabled  bool              `json:"enabled"`
	Primary  bool              `json:"primary"`
	Endpoint string            `json:"endpoint"`
	APIKey   string            `json:"-"` // Hidden from JSON serialization
	Timeout  time.Duration     `json:"timeout"`
	Options  map[string]any    `json:"options,omitempty"`
	// LlamaCpp contains llama.cpp-specific configuration (only used for llama-cpp-* backends).
	LlamaCpp *LlamaCppConfig   `json:"llamacpp,omitempty"`
}

// LlamaCppConfig contains llama.cpp-specific configuration options.
// These map directly to llama-server command-line flags.
type LlamaCppConfig struct {
	// ContextSize is the context window size (-c flag).
	// Validate: must not exceed model's max context.
	ContextSize int `json:"context_size"`
	// BatchSize is the batch size for prompt processing (-b flag).
	BatchSize int `json:"batch_size"`
	// UnbatchedSize is the unbatched size (-ub flag).
	UnbatchedSize int `json:"unbatched_size"`
	// GPULayers is the number of layers to offload to GPU (-ngl flag).
	// Use 999 for all layers.
	GPULayers int `json:"gpu_layers"`
	// UseMMQ enables matrix-matrix multiply for better performance (--mmq flag).
	UseMMQ bool `json:"use_mmq"`
	// FlashAttention enables flash attention (-fa flag).
	FlashAttention bool `json:"flash_attention"`
	// NoMmap disables memory mapping for consistent performance (--no-mmap flag).
	NoMmap bool `json:"no_mmap"`
	// Threads is the number of CPU threads to use (-t flag).
	Threads int `json:"threads,omitempty"`
	// Version is the pinned llama.cpp build version/hash.
	Version string `json:"version,omitempty"`
}

// Validate checks llama.cpp configuration for common issues.
func (c *LlamaCppConfig) Validate(modelContextLength int) error {
	if c.ContextSize > modelContextLength && modelContextLength > 0 {
		return fmt.Errorf("context size %d exceeds model maximum %d", c.ContextSize, modelContextLength)
	}
	if c.ContextSize > 131072 {
		return fmt.Errorf("context size %d is unreasonably large (max 128k)", c.ContextSize)
	}
	if c.BatchSize <= 0 {
		return fmt.Errorf("batch size must be positive")
	}
	if c.GPULayers < 0 {
		return fmt.Errorf("gpu layers cannot be negative")
	}
	return nil
}

// ToArgs converts the config to llama-server command-line arguments.
func (c *LlamaCppConfig) ToArgs() []string {
	args := []string{}

	if c.ContextSize > 0 {
		args = append(args, "-c", fmt.Sprintf("%d", c.ContextSize))
	}
	if c.BatchSize > 0 {
		args = append(args, "-b", fmt.Sprintf("%d", c.BatchSize))
	}
	if c.UnbatchedSize > 0 {
		args = append(args, "-ub", fmt.Sprintf("%d", c.UnbatchedSize))
	}
	if c.GPULayers > 0 {
		args = append(args, "-ngl", fmt.Sprintf("%d", c.GPULayers))
	}
	if c.UseMMQ {
		args = append(args, "--mmq")
	}
	if c.FlashAttention {
		args = append(args, "-fa")
	}
	if c.NoMmap {
		args = append(args, "--no-mmap")
	}
	if c.Threads > 0 {
		args = append(args, "-t", fmt.Sprintf("%d", c.Threads))
	}

	return args
}

// VulkanOptimizedPreset is optimized for Vulkan GPU acceleration.
var VulkanOptimizedPreset = LlamaCppConfig{
	ContextSize:    2048,
	BatchSize:      512,
	UnbatchedSize:  512,
	GPULayers:      999, // All layers to GPU
	UseMMQ:         true,
	FlashAttention: false, // Not always supported on Vulkan
	NoMmap:         false,
}

// DockerOptimizedPreset is optimized for Docker deployments with CUDA.
var DockerOptimizedPreset = LlamaCppConfig{
	ContextSize:    4096,
	BatchSize:      512,
	UnbatchedSize:  512,
	GPULayers:      999,
	UseMMQ:         true,  // Critical for speed
	FlashAttention: true,
	NoMmap:         true,  // More consistent in containers
}

// CPUOnlyPreset is for systems without GPU acceleration.
var CPUOnlyPreset = LlamaCppConfig{
	ContextSize:    2048,
	BatchSize:      512,
	UnbatchedSize:  512,
	GPULayers:      0, // No GPU
	UseMMQ:         false,
	FlashAttention: false,
	NoMmap:         false,
}

// Validate checks the configuration and sets defaults
func (c *BackendConfig) Validate() error {
	// Set default timeout
	if c.Timeout == 0 {
		c.Timeout = defaultTimeout
	}

	switch c.Type {
	case BackendOllama:
		// Default endpoint for Ollama
		if c.Endpoint == "" {
			c.Endpoint = defaultOllamaURL
		}

	case BackendLlamaCppServer:
		if c.Endpoint == "" {
			return fmt.Errorf("llama-cpp-server backend requires endpoint")
		}
		// Apply default preset if no config provided
		if c.LlamaCpp == nil {
			preset := VulkanOptimizedPreset
			c.LlamaCpp = &preset
		}

	case BackendLlamaCppNative:
		if c.Options == nil {
			return fmt.Errorf("llama-cpp-native backend requires options with model_path")
		}
		if _, ok := c.Options["model_path"]; !ok {
			return fmt.Errorf("llama-cpp-native backend requires model_path option")
		}

	case BackendHuggingFace:
		// Allow fallback to HF_TOKEN environment variable
		if c.APIKey == "" {
			c.APIKey = os.Getenv("HF_TOKEN")
		}
		if c.APIKey == "" {
			return fmt.Errorf("huggingface backend requires API key (set HF_TOKEN or provide api_key)")
		}
		if c.Endpoint == "" {
			c.Endpoint = "https://api-inference.huggingface.co"
		}

	case BackendVLM:
		// VLM (Vessel Llama Manager) - host-native llama.cpp orchestrator
		if c.Endpoint == "" {
			c.Endpoint = "http://localhost:32789"
		}
		// Token is optional but recommended

	default:
		return fmt.Errorf("unknown backend type: %s", c.Type)
	}

	return nil
}

// Config holds the complete LLM configuration
type Config struct {
	Backends       []BackendConfig `json:"backends"`
	DefaultBackend string          `json:"default_backend"`
}

// Validate checks all backend configurations
func (c *Config) Validate() error {
	if len(c.Backends) == 0 {
		return fmt.Errorf("at least one backend must be configured")
	}

	names := make(map[string]bool)
	hasPrimary := false

	for i := range c.Backends {
		if err := c.Backends[i].Validate(); err != nil {
			return fmt.Errorf("backend %q: %w", c.Backends[i].Name, err)
		}

		if c.Backends[i].Name == "" {
			return fmt.Errorf("backend at index %d has no name", i)
		}

		if names[c.Backends[i].Name] {
			return fmt.Errorf("duplicate backend name: %s", c.Backends[i].Name)
		}
		names[c.Backends[i].Name] = true

		if c.Backends[i].Primary {
			if hasPrimary {
				return fmt.Errorf("multiple backends marked as primary")
			}
			hasPrimary = true
		}
	}

	// Validate default backend exists
	if c.DefaultBackend != "" {
		if !names[c.DefaultBackend] {
			return fmt.Errorf("default backend %q not found in backends list", c.DefaultBackend)
		}
	}

	return nil
}

// LoadFromEnv creates a Config from environment variables
func LoadFromEnv() *Config {
	cfg := &Config{
		Backends: make([]BackendConfig, 0),
	}

	// Always create Ollama backend
	ollamaURL := getEnvOrDefault("OLLAMA_URL", defaultOllamaURL)
	ollamaBackend := BackendConfig{
		Type:     BackendOllama,
		Name:     "ollama",
		Enabled:  true,
		Primary:  true,
		Endpoint: ollamaURL,
		Timeout:  defaultTimeout,
	}
	cfg.Backends = append(cfg.Backends, ollamaBackend)
	cfg.DefaultBackend = "ollama"

	// Optionally create llama.cpp server backend
	if llamaCppURL := os.Getenv("LLAMA_CPP_URL"); llamaCppURL != "" {
		llamaCppBackend := BackendConfig{
			Type:     BackendLlamaCppServer,
			Name:     "llama-cpp",
			Enabled:  true,
			Primary:  false,
			Endpoint: llamaCppURL,
			Timeout:  defaultTimeout,
		}
		cfg.Backends = append(cfg.Backends, llamaCppBackend)
	}

	// Optionally create HuggingFace backend
	if hfToken := os.Getenv("HF_TOKEN"); hfToken != "" {
		hfBackend := BackendConfig{
			Type:     BackendHuggingFace,
			Name:     "huggingface",
			Enabled:  true,
			Primary:  false,
			Endpoint: "https://api-inference.huggingface.co",
			APIKey:   hfToken,
			Timeout:  defaultTimeout,
		}
		cfg.Backends = append(cfg.Backends, hfBackend)
	}

	// Optionally create VLM (Vessel Llama Manager) backend
	vlmEnabled := os.Getenv("VLM_ENABLED")
	if vlmEnabled == "true" || vlmEnabled == "1" {
		vlmURL := getEnvOrDefault("VLM_URL", "http://localhost:32789")
		vlmToken := os.Getenv("VLM_TOKEN")
		vlmBackend := BackendConfig{
			Type:     BackendVLM,
			Name:     "vlm",
			Enabled:  true,
			Primary:  false,
			Endpoint: vlmURL,
			Timeout:  120 * time.Second, // Longer timeout for llama.cpp inference
			Options: map[string]interface{}{
				"token": vlmToken,
			},
		}
		cfg.Backends = append(cfg.Backends, vlmBackend)
	}

	return cfg
}

// getEnvOrDefault returns the value of an environment variable or a default
func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}
