package backends

import (
	"testing"
)

func TestBackendType_String(t *testing.T) {
	tests := []struct {
		name     string
		bt       BackendType
		expected string
	}{
		{"ollama type", BackendTypeOllama, "ollama"},
		{"llamacpp type", BackendTypeLlamaCpp, "llamacpp"},
		{"lmstudio type", BackendTypeLMStudio, "lmstudio"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.bt.String(); got != tt.expected {
				t.Errorf("BackendType.String() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestParseBackendType(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		expected  BackendType
		expectErr bool
	}{
		{"parse ollama", "ollama", BackendTypeOllama, false},
		{"parse llamacpp", "llamacpp", BackendTypeLlamaCpp, false},
		{"parse lmstudio", "lmstudio", BackendTypeLMStudio, false},
		{"parse llama.cpp alias", "llama.cpp", BackendTypeLlamaCpp, false},
		{"parse llama-cpp alias", "llama-cpp", BackendTypeLlamaCpp, false},
		{"parse unknown", "unknown", "", true},
		{"parse empty", "", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseBackendType(tt.input)
			if (err != nil) != tt.expectErr {
				t.Errorf("ParseBackendType() error = %v, expectErr %v", err, tt.expectErr)
				return
			}
			if got != tt.expected {
				t.Errorf("ParseBackendType() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestBackendCapabilities(t *testing.T) {
	t.Run("ollama capabilities", func(t *testing.T) {
		caps := OllamaCapabilities()

		if !caps.CanListModels {
			t.Error("Ollama should be able to list models")
		}
		if !caps.CanPullModels {
			t.Error("Ollama should be able to pull models")
		}
		if !caps.CanDeleteModels {
			t.Error("Ollama should be able to delete models")
		}
		if !caps.CanCreateModels {
			t.Error("Ollama should be able to create models")
		}
		if !caps.CanStreamChat {
			t.Error("Ollama should be able to stream chat")
		}
		if !caps.CanEmbed {
			t.Error("Ollama should be able to embed")
		}
	})

	t.Run("llamacpp capabilities", func(t *testing.T) {
		caps := LlamaCppCapabilities()

		if !caps.CanListModels {
			t.Error("llama.cpp should be able to list models")
		}
		if caps.CanPullModels {
			t.Error("llama.cpp should NOT be able to pull models")
		}
		if caps.CanDeleteModels {
			t.Error("llama.cpp should NOT be able to delete models")
		}
		if caps.CanCreateModels {
			t.Error("llama.cpp should NOT be able to create models")
		}
		if !caps.CanStreamChat {
			t.Error("llama.cpp should be able to stream chat")
		}
		if !caps.CanEmbed {
			t.Error("llama.cpp should be able to embed")
		}
	})

	t.Run("lmstudio capabilities", func(t *testing.T) {
		caps := LMStudioCapabilities()

		if !caps.CanListModels {
			t.Error("LM Studio should be able to list models")
		}
		if caps.CanPullModels {
			t.Error("LM Studio should NOT be able to pull models")
		}
		if caps.CanDeleteModels {
			t.Error("LM Studio should NOT be able to delete models")
		}
		if caps.CanCreateModels {
			t.Error("LM Studio should NOT be able to create models")
		}
		if !caps.CanStreamChat {
			t.Error("LM Studio should be able to stream chat")
		}
		if !caps.CanEmbed {
			t.Error("LM Studio should be able to embed")
		}
	})
}

func TestBackendConfig_Validate(t *testing.T) {
	tests := []struct {
		name      string
		config    BackendConfig
		expectErr bool
	}{
		{
			name: "valid ollama config",
			config: BackendConfig{
				Type:    BackendTypeOllama,
				BaseURL: "http://localhost:11434",
			},
			expectErr: false,
		},
		{
			name: "valid llamacpp config",
			config: BackendConfig{
				Type:    BackendTypeLlamaCpp,
				BaseURL: "http://localhost:8081",
			},
			expectErr: false,
		},
		{
			name: "empty base URL",
			config: BackendConfig{
				Type:    BackendTypeOllama,
				BaseURL: "",
			},
			expectErr: true,
		},
		{
			name: "invalid URL",
			config: BackendConfig{
				Type:    BackendTypeOllama,
				BaseURL: "not-a-url",
			},
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.config.Validate()
			if (err != nil) != tt.expectErr {
				t.Errorf("BackendConfig.Validate() error = %v, expectErr %v", err, tt.expectErr)
			}
		})
	}
}

func TestModel_HasCapability(t *testing.T) {
	model := Model{
		ID:           "llama3.2:8b",
		Name:         "llama3.2:8b",
		Capabilities: []string{"chat", "vision", "tools"},
	}

	tests := []struct {
		name       string
		capability string
		expected   bool
	}{
		{"has chat", "chat", true},
		{"has vision", "vision", true},
		{"has tools", "tools", true},
		{"no thinking", "thinking", false},
		{"no code", "code", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := model.HasCapability(tt.capability); got != tt.expected {
				t.Errorf("Model.HasCapability(%q) = %v, want %v", tt.capability, got, tt.expected)
			}
		})
	}
}

func TestChatMessage_Validation(t *testing.T) {
	tests := []struct {
		name      string
		msg       ChatMessage
		expectErr bool
	}{
		{
			name:      "valid user message",
			msg:       ChatMessage{Role: "user", Content: "Hello"},
			expectErr: false,
		},
		{
			name:      "valid assistant message",
			msg:       ChatMessage{Role: "assistant", Content: "Hi there"},
			expectErr: false,
		},
		{
			name:      "valid system message",
			msg:       ChatMessage{Role: "system", Content: "You are helpful"},
			expectErr: false,
		},
		{
			name:      "invalid role",
			msg:       ChatMessage{Role: "invalid", Content: "Hello"},
			expectErr: true,
		},
		{
			name:      "empty role",
			msg:       ChatMessage{Role: "", Content: "Hello"},
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.msg.Validate()
			if (err != nil) != tt.expectErr {
				t.Errorf("ChatMessage.Validate() error = %v, expectErr %v", err, tt.expectErr)
			}
		})
	}
}

func TestChatRequest_Validation(t *testing.T) {
	streaming := true

	tests := []struct {
		name      string
		req       ChatRequest
		expectErr bool
	}{
		{
			name: "valid request",
			req: ChatRequest{
				Model: "llama3.2:8b",
				Messages: []ChatMessage{
					{Role: "user", Content: "Hello"},
				},
				Stream: &streaming,
			},
			expectErr: false,
		},
		{
			name: "empty model",
			req: ChatRequest{
				Model: "",
				Messages: []ChatMessage{
					{Role: "user", Content: "Hello"},
				},
			},
			expectErr: true,
		},
		{
			name: "empty messages",
			req: ChatRequest{
				Model:    "llama3.2:8b",
				Messages: []ChatMessage{},
			},
			expectErr: true,
		},
		{
			name: "nil messages",
			req: ChatRequest{
				Model:    "llama3.2:8b",
				Messages: nil,
			},
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.req.Validate()
			if (err != nil) != tt.expectErr {
				t.Errorf("ChatRequest.Validate() error = %v, expectErr %v", err, tt.expectErr)
			}
		})
	}
}

func TestBackendInfo(t *testing.T) {
	info := BackendInfo{
		Type:         BackendTypeOllama,
		BaseURL:      "http://localhost:11434",
		Status:       BackendStatusConnected,
		Capabilities: OllamaCapabilities(),
		Version:      "0.1.0",
	}

	if !info.IsConnected() {
		t.Error("BackendInfo.IsConnected() should be true when status is connected")
	}

	info.Status = BackendStatusDisconnected
	if info.IsConnected() {
		t.Error("BackendInfo.IsConnected() should be false when status is disconnected")
	}
}
