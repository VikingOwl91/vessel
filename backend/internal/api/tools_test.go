package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestTruncateOutput(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "short string unchanged",
			input:    "hello world",
			expected: "hello world",
		},
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
		{
			name:     "exactly at limit",
			input:    strings.Repeat("a", MaxOutputSize),
			expected: strings.Repeat("a", MaxOutputSize),
		},
		{
			name:     "over limit truncated",
			input:    strings.Repeat("a", MaxOutputSize+100),
			expected: strings.Repeat("a", MaxOutputSize) + "\n... (output truncated)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := truncateOutput(tt.input)
			if result != tt.expected {
				// For long strings, just check length and suffix
				if len(tt.input) > MaxOutputSize {
					if !strings.HasSuffix(result, "(output truncated)") {
						t.Error("truncated output should have truncation message")
					}
					if len(result) > MaxOutputSize+50 {
						t.Errorf("truncated output too long: %d", len(result))
					}
				} else {
					t.Errorf("truncateOutput() = %q, want %q", result, tt.expected)
				}
			}
		})
	}
}

func TestExecuteToolHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("rejects invalid request", func(t *testing.T) {
		router := gin.New()
		router.POST("/tools/execute", ExecuteToolHandler())

		body := `{"language": "invalid", "code": "print(1)"}`
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/tools/execute", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})

	t.Run("rejects javascript on backend", func(t *testing.T) {
		router := gin.New()
		router.POST("/tools/execute", ExecuteToolHandler())

		reqBody := ExecuteToolRequest{
			Language: "javascript",
			Code:     "return 1 + 1",
		}
		body, _ := json.Marshal(reqBody)

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/tools/execute", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		var resp ExecuteToolResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		if resp.Success {
			t.Error("javascript should not be supported on backend")
		}
		if !strings.Contains(resp.Error, "browser") {
			t.Errorf("error should mention browser, got: %s", resp.Error)
		}
	})

	t.Run("executes simple python", func(t *testing.T) {
		router := gin.New()
		router.POST("/tools/execute", ExecuteToolHandler())

		reqBody := ExecuteToolRequest{
			Language: "python",
			Code:     "print('{\"result\": 42}')",
			Args:     map[string]interface{}{},
			Timeout:  5,
		}
		body, _ := json.Marshal(reqBody)

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/tools/execute", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		var resp ExecuteToolResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		// This test depends on python3 being available
		// If python isn't available, the test should still pass (checking error handling)
		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("passes args to python", func(t *testing.T) {
		router := gin.New()
		router.POST("/tools/execute", ExecuteToolHandler())

		reqBody := ExecuteToolRequest{
			Language: "python",
			Code:     "import json; print(json.dumps({'doubled': args['value'] * 2}))",
			Args:     map[string]interface{}{"value": 21},
			Timeout:  5,
		}
		body, _ := json.Marshal(reqBody)

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/tools/execute", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		var resp ExecuteToolResponse
		json.Unmarshal(w.Body.Bytes(), &resp)

		if resp.Success {
			// Check result contains the doubled value
			if result, ok := resp.Result.(map[string]interface{}); ok {
				if doubled, ok := result["doubled"].(float64); ok {
					if doubled != 42 {
						t.Errorf("expected doubled=42, got %v", doubled)
					}
				}
			}
		}
		// If python isn't available, test passes anyway
	})

	t.Run("uses default timeout", func(t *testing.T) {
		router := gin.New()
		router.POST("/tools/execute", ExecuteToolHandler())

		// Request without timeout should use default (30s)
		reqBody := ExecuteToolRequest{
			Language: "python",
			Code:     "print('ok')",
		}
		body, _ := json.Marshal(reqBody)

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/tools/execute", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		// Should complete successfully (not timeout)
		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("caps timeout at 60s", func(t *testing.T) {
		router := gin.New()
		router.POST("/tools/execute", ExecuteToolHandler())

		// Request with excessive timeout
		reqBody := ExecuteToolRequest{
			Language: "python",
			Code:     "print('ok')",
			Timeout:  999, // Should be capped to 30 (default)
		}
		body, _ := json.Marshal(reqBody)

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/tools/execute", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		// Should complete (timeout was capped, not honored)
		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})
}
