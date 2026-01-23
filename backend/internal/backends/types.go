package backends

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// BackendType identifies the type of LLM backend
type BackendType string

const (
	BackendTypeOllama   BackendType = "ollama"
	BackendTypeLlamaCpp BackendType = "llamacpp"
	BackendTypeLMStudio BackendType = "lmstudio"
)

// String returns the string representation of the backend type
func (bt BackendType) String() string {
	return string(bt)
}

// ParseBackendType parses a string into a BackendType
func ParseBackendType(s string) (BackendType, error) {
	switch strings.ToLower(s) {
	case "ollama":
		return BackendTypeOllama, nil
	case "llamacpp", "llama.cpp", "llama-cpp":
		return BackendTypeLlamaCpp, nil
	case "lmstudio", "lm-studio", "lm_studio":
		return BackendTypeLMStudio, nil
	default:
		return "", fmt.Errorf("unknown backend type: %q", s)
	}
}

// BackendCapabilities describes what features a backend supports
type BackendCapabilities struct {
	CanListModels   bool `json:"canListModels"`
	CanPullModels   bool `json:"canPullModels"`
	CanDeleteModels bool `json:"canDeleteModels"`
	CanCreateModels bool `json:"canCreateModels"`
	CanStreamChat   bool `json:"canStreamChat"`
	CanEmbed        bool `json:"canEmbed"`
}

// OllamaCapabilities returns the capabilities for Ollama backend
func OllamaCapabilities() BackendCapabilities {
	return BackendCapabilities{
		CanListModels:   true,
		CanPullModels:   true,
		CanDeleteModels: true,
		CanCreateModels: true,
		CanStreamChat:   true,
		CanEmbed:        true,
	}
}

// LlamaCppCapabilities returns the capabilities for llama.cpp backend
func LlamaCppCapabilities() BackendCapabilities {
	return BackendCapabilities{
		CanListModels:   true,
		CanPullModels:   false,
		CanDeleteModels: false,
		CanCreateModels: false,
		CanStreamChat:   true,
		CanEmbed:        true,
	}
}

// LMStudioCapabilities returns the capabilities for LM Studio backend
func LMStudioCapabilities() BackendCapabilities {
	return BackendCapabilities{
		CanListModels:   true,
		CanPullModels:   false,
		CanDeleteModels: false,
		CanCreateModels: false,
		CanStreamChat:   true,
		CanEmbed:        true,
	}
}

// BackendStatus represents the connection status of a backend
type BackendStatus string

const (
	BackendStatusConnected    BackendStatus = "connected"
	BackendStatusDisconnected BackendStatus = "disconnected"
	BackendStatusUnknown      BackendStatus = "unknown"
)

// BackendConfig holds configuration for a backend
type BackendConfig struct {
	Type    BackendType `json:"type"`
	BaseURL string      `json:"baseUrl"`
	Enabled bool        `json:"enabled"`
}

// Validate checks if the backend config is valid
func (c BackendConfig) Validate() error {
	if c.BaseURL == "" {
		return errors.New("base URL is required")
	}

	u, err := url.Parse(c.BaseURL)
	if err != nil {
		return fmt.Errorf("invalid base URL: %w", err)
	}

	if u.Scheme == "" || u.Host == "" {
		return errors.New("invalid URL: missing scheme or host")
	}

	return nil
}

// BackendInfo describes a configured backend and its current state
type BackendInfo struct {
	Type         BackendType         `json:"type"`
	BaseURL      string              `json:"baseUrl"`
	Status       BackendStatus       `json:"status"`
	Capabilities BackendCapabilities `json:"capabilities"`
	Version      string              `json:"version,omitempty"`
	Error        string              `json:"error,omitempty"`
}

// IsConnected returns true if the backend is connected
func (bi BackendInfo) IsConnected() bool {
	return bi.Status == BackendStatusConnected
}

// Model represents an LLM model available from a backend
type Model struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Size         int64             `json:"size,omitempty"`
	ModifiedAt   string            `json:"modifiedAt,omitempty"`
	Family       string            `json:"family,omitempty"`
	QuantLevel   string            `json:"quantLevel,omitempty"`
	Capabilities []string          `json:"capabilities,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// HasCapability checks if the model has a specific capability
func (m Model) HasCapability(cap string) bool {
	for _, c := range m.Capabilities {
		if c == cap {
			return true
		}
	}
	return false
}

// ChatMessage represents a message in a chat conversation
type ChatMessage struct {
	Role       string       `json:"role"`
	Content    string       `json:"content"`
	Images     []string     `json:"images,omitempty"`
	ToolCalls  []ToolCall   `json:"tool_calls,omitempty"`
	ToolCallID string       `json:"tool_call_id,omitempty"`
	Name       string       `json:"name,omitempty"`
}

var validRoles = map[string]bool{
	"user":      true,
	"assistant": true,
	"system":    true,
	"tool":      true,
}

// Validate checks if the chat message is valid
func (m ChatMessage) Validate() error {
	if m.Role == "" {
		return errors.New("role is required")
	}
	if !validRoles[m.Role] {
		return fmt.Errorf("invalid role: %q", m.Role)
	}
	return nil
}

// ToolCall represents a tool invocation
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// Tool represents a tool definition
type Tool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string                 `json:"name"`
		Description string                 `json:"description"`
		Parameters  map[string]interface{} `json:"parameters"`
	} `json:"function"`
}

// ChatRequest represents a chat completion request
type ChatRequest struct {
	Model       string         `json:"model"`
	Messages    []ChatMessage  `json:"messages"`
	Stream      *bool          `json:"stream,omitempty"`
	Temperature *float64       `json:"temperature,omitempty"`
	TopP        *float64       `json:"top_p,omitempty"`
	MaxTokens   *int           `json:"max_tokens,omitempty"`
	Tools       []Tool         `json:"tools,omitempty"`
	Options     map[string]any `json:"options,omitempty"`
}

// Validate checks if the chat request is valid
func (r ChatRequest) Validate() error {
	if r.Model == "" {
		return errors.New("model is required")
	}
	if len(r.Messages) == 0 {
		return errors.New("at least one message is required")
	}
	for i, msg := range r.Messages {
		if err := msg.Validate(); err != nil {
			return fmt.Errorf("message %d: %w", i, err)
		}
	}
	return nil
}

// ChatChunk represents a streaming chat response chunk
type ChatChunk struct {
	Model      string       `json:"model"`
	CreatedAt  string       `json:"created_at,omitempty"`
	Message    *ChatMessage `json:"message,omitempty"`
	Done       bool         `json:"done"`
	DoneReason string       `json:"done_reason,omitempty"`

	// Token counts (final chunk only)
	PromptEvalCount int `json:"prompt_eval_count,omitempty"`
	EvalCount       int `json:"eval_count,omitempty"`

	// Error information
	Error string `json:"error,omitempty"`
}
