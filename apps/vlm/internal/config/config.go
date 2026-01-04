package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

const (
	CurrentSchemaVersion = 1
	DefaultConfigPath    = "~/.vessel/llm.toml"
	DefaultBind          = "127.0.0.1:32789"
)

// Config is the root configuration structure for VLM
type Config struct {
	Meta      MetaConfig      `toml:"meta"`
	VLM       VLMConfig       `toml:"vlm"`
	Security  SecurityConfig  `toml:"security"`
	Scheduler SchedulerConfig `toml:"scheduler"`
	Models    ModelsConfig    `toml:"models"`
	LlamaCpp  LlamaCppConfig  `toml:"llamacpp"`
}

// MetaConfig contains schema versioning info
type MetaConfig struct {
	SchemaVersion int `toml:"schema_version"`
}

// VLMConfig contains VLM daemon settings
type VLMConfig struct {
	Bind      string `toml:"bind"`
	AuthToken string `toml:"auth_token"`
	LogDir    string `toml:"log_dir"`
	StateDir  string `toml:"state_dir"`
}

// SecurityConfig contains security settings
type SecurityConfig struct {
	RequireTokenForInference bool `toml:"require_token_for_inference"`
}

// SchedulerConfig contains request scheduler settings
type SchedulerConfig struct {
	MaxConcurrentRequests int `toml:"max_concurrent_requests"`
	QueueSize             int `toml:"queue_size"`
	InteractiveReserve    int `toml:"interactive_reserve"`
}

// ModelsConfig contains model discovery settings
type ModelsConfig struct {
	Directories  []string `toml:"directories"`
	ScanInterval Duration `toml:"scan_interval"`
}

// LlamaCppConfig contains llama.cpp specific settings
type LlamaCppConfig struct {
	ActiveProfile string             `toml:"active_profile"`
	ActiveModelID string             `toml:"active_model_id"`
	Switching     SwitchingConfig    `toml:"switching"`
	Profiles      []LlamaCppProfile  `toml:"profiles"`
}

// SwitchingConfig contains model switching settings
type SwitchingConfig struct {
	StartupTimeout   Duration `toml:"startup_timeout"`
	GracefulTimeout  Duration `toml:"graceful_timeout"`
	KeepOldUntilReady bool    `toml:"keep_old_until_ready"`
}

// LlamaCppProfile defines a llama-server binary configuration
type LlamaCppProfile struct {
	Name             string   `toml:"name"`
	LlamaServerPath  string   `toml:"llama_server_path"`
	PreferredBackend string   `toml:"preferred_backend"`
	ExtraEnv         []string `toml:"extra_env"`
	DefaultArgs      []string `toml:"default_args"`
}

// Duration wraps time.Duration for TOML parsing
type Duration struct {
	time.Duration
}

func (d *Duration) UnmarshalText(text []byte) error {
	var err error
	d.Duration, err = time.ParseDuration(string(text))
	return err
}

func (d Duration) MarshalText() ([]byte, error) {
	return []byte(d.Duration.String()), nil
}

// Load loads configuration from the given path, applying defaults and migrations
func Load(path string) (*Config, error) {
	path = ExpandPath(path)

	cfg := &Config{}
	cfg.ApplyDefaults()

	// Check if file exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		// No config file, use defaults
		return cfg, nil
	}

	// Load existing config
	if _, err := toml.DecodeFile(path, cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	// Apply migrations if needed
	if cfg.Meta.SchemaVersion < CurrentSchemaVersion {
		if err := cfg.migrate(path); err != nil {
			return nil, fmt.Errorf("failed to migrate config: %w", err)
		}
	}

	return cfg, nil
}

// ApplyDefaults sets default values for all config fields
func (c *Config) ApplyDefaults() {
	c.Meta.SchemaVersion = CurrentSchemaVersion

	c.VLM.Bind = DefaultBind
	c.VLM.LogDir = "~/.vessel/logs"
	c.VLM.StateDir = "~/.vessel/state"

	c.Security.RequireTokenForInference = true

	c.Scheduler.MaxConcurrentRequests = 2
	c.Scheduler.QueueSize = 64
	c.Scheduler.InteractiveReserve = 1

	c.Models.Directories = []string{"~/.vessel/models", "~/Models/gguf"}
	c.Models.ScanInterval = Duration{30 * time.Second}

	c.LlamaCpp.ActiveProfile = "default"
	c.LlamaCpp.Switching.StartupTimeout = Duration{60 * time.Second}
	c.LlamaCpp.Switching.GracefulTimeout = Duration{8 * time.Second}
	c.LlamaCpp.Switching.KeepOldUntilReady = true

	// Default profile
	if len(c.LlamaCpp.Profiles) == 0 {
		c.LlamaCpp.Profiles = []LlamaCppProfile{
			{
				Name:             "default",
				LlamaServerPath:  "/usr/local/bin/llama-server",
				PreferredBackend: "auto",
				DefaultArgs:      []string{"-c", "8192", "--batch-size", "512"},
			},
		}
	}
}

// migrate applies schema migrations and writes backup
func (c *Config) migrate(path string) error {
	// Create backup before migration
	backupPath := fmt.Sprintf("%s.bak.%d", path, time.Now().Unix())
	if err := copyFile(path, backupPath); err != nil {
		return fmt.Errorf("failed to create backup: %w", err)
	}

	// Apply migrations in order
	for v := c.Meta.SchemaVersion; v < CurrentSchemaVersion; v++ {
		switch v {
		case 0:
			c.migrateV0toV1()
		// Future migrations go here
		// case 1:
		//     c.migrateV1toV2()
		}
	}

	c.Meta.SchemaVersion = CurrentSchemaVersion

	// Write migrated config
	if err := c.Save(path); err != nil {
		return fmt.Errorf("failed to save migrated config: %w", err)
	}

	return nil
}

// migrateV0toV1 handles migration from v0 (pre-schema) to v1
func (c *Config) migrateV0toV1() {
	// v1 is the initial schema, nothing to migrate
	// Future: add actual migrations here
}

// Save writes the configuration to the given path
func (c *Config) Save(path string) error {
	path = ExpandPath(path)

	// Ensure parent directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("failed to create config file: %w", err)
	}
	defer f.Close()

	encoder := toml.NewEncoder(f)
	if err := encoder.Encode(c); err != nil {
		return fmt.Errorf("failed to encode config: %w", err)
	}

	return nil
}

// GetProfile returns the profile with the given name, or nil if not found
func (c *Config) GetProfile(name string) *LlamaCppProfile {
	for i := range c.LlamaCpp.Profiles {
		if c.LlamaCpp.Profiles[i].Name == name {
			return &c.LlamaCpp.Profiles[i]
		}
	}
	return nil
}

// GetActiveProfile returns the currently active profile
func (c *Config) GetActiveProfile() *LlamaCppProfile {
	return c.GetProfile(c.LlamaCpp.ActiveProfile)
}

// ExpandPath expands ~ to home directory
func ExpandPath(path string) string {
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[2:])
	}
	return path
}

// ExpandedDirs returns model directories with ~ expanded
func (c *Config) ExpandedDirs() []string {
	dirs := make([]string, len(c.Models.Directories))
	for i, d := range c.Models.Directories {
		dirs[i] = ExpandPath(d)
	}
	return dirs
}

// GenerateToken generates a secure random auth token
func GenerateToken() string {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		// Fallback to timestamp-based if crypto/rand fails (shouldn't happen)
		return fmt.Sprintf("vlm_%d", time.Now().UnixNano())
	}
	return "vlm_" + hex.EncodeToString(bytes)
}

// copyFile copies a file from src to dst
func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0644)
}
