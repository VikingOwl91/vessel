package config

import (
	"os"
	"path/filepath"
)

// WriteDefaultConfig writes a default config file if one doesn't exist
// This is used by the installer - VLM itself uses Load() which handles migrations
func WriteDefaultConfig(path string) error {
	path = ExpandPath(path)

	// Don't overwrite existing config
	if _, err := os.Stat(path); err == nil {
		return nil
	}

	cfg := &Config{}
	cfg.ApplyDefaults()

	// Generate a fresh auth token for new installs
	cfg.VLM.AuthToken = GenerateToken()

	return cfg.Save(path)
}

// EnsureDirectories creates all required VLM directories
func EnsureDirectories() error {
	dirs := []string{
		"~/.vessel",
		"~/.vessel/logs",
		"~/.vessel/state",
		"~/.vessel/models",
		"~/.vessel/bin",
	}

	for _, dir := range dirs {
		expanded := ExpandPath(dir)
		if err := os.MkdirAll(expanded, 0755); err != nil {
			return err
		}
	}

	return nil
}

// DefaultConfigPath returns the default config file path
func DefaultConfigFilePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "/tmp/vlm/llm.toml"
	}
	return filepath.Join(home, ".vessel", "llm.toml")
}

// DefaultStateDir returns the default state directory path
func DefaultStateDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "/tmp/vlm/state"
	}
	return filepath.Join(home, ".vessel", "state")
}

// DefaultLogDir returns the default log directory path
func DefaultLogDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "/tmp/vlm/logs"
	}
	return filepath.Join(home, ".vessel", "logs")
}
