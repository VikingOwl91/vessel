package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"time"

	"github.com/gin-gonic/gin"
)

// ExecuteToolRequest represents a tool execution request
type ExecuteToolRequest struct {
	Language string                 `json:"language" binding:"required,oneof=python javascript"`
	Code     string                 `json:"code" binding:"required"`
	Args     map[string]interface{} `json:"args"`
	Timeout  int                    `json:"timeout"` // seconds, default 30
}

// ExecuteToolResponse represents the tool execution response
type ExecuteToolResponse struct {
	Success bool        `json:"success"`
	Result  interface{} `json:"result,omitempty"`
	Error   string      `json:"error,omitempty"`
	Stdout  string      `json:"stdout,omitempty"`
	Stderr  string      `json:"stderr,omitempty"`
}

// MaxOutputSize is the maximum size of tool output (100KB)
const MaxOutputSize = 100 * 1024

// ExecuteToolHandler handles tool execution requests
func ExecuteToolHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req ExecuteToolRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, ExecuteToolResponse{
				Success: false,
				Error:   "Invalid request: " + err.Error(),
			})
			return
		}

		// Default timeout
		timeout := req.Timeout
		if timeout <= 0 || timeout > 60 {
			timeout = 30
		}

		var resp ExecuteToolResponse

		switch req.Language {
		case "python":
			resp = executePython(req.Code, req.Args, timeout)
		case "javascript":
			// JavaScript execution not supported on backend (runs in browser)
			resp = ExecuteToolResponse{
				Success: false,
				Error:   "JavaScript tools should be executed in the browser",
			}
		default:
			resp = ExecuteToolResponse{
				Success: false,
				Error:   "Unsupported language: " + req.Language,
			}
		}

		c.JSON(http.StatusOK, resp)
	}
}

// executePython executes Python code with the given arguments
func executePython(code string, args map[string]interface{}, timeout int) ExecuteToolResponse {
	// Create a wrapper script that reads args from stdin
	wrapperScript := `
import json
import sys

# Read args from stdin
args = json.loads(sys.stdin.read())

# Execute user code
` + code

	// Create temp file for the script
	tmpFile, err := os.CreateTemp("", "tool-*.py")
	if err != nil {
		return ExecuteToolResponse{
			Success: false,
			Error:   "Failed to create temp file: " + err.Error(),
		}
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(wrapperScript); err != nil {
		return ExecuteToolResponse{
			Success: false,
			Error:   "Failed to write script: " + err.Error(),
		}
	}
	tmpFile.Close()

	// Marshal args to JSON for stdin
	argsJSON, err := json.Marshal(args)
	if err != nil {
		return ExecuteToolResponse{
			Success: false,
			Error:   "Failed to serialize args: " + err.Error(),
		}
	}

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()

	// Execute Python (using exec.Command, not shell)
	cmd := exec.CommandContext(ctx, "python3", tmpFile.Name())
	cmd.Stdin = bytes.NewReader(argsJSON)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()

	// Check for timeout
	if ctx.Err() == context.DeadlineExceeded {
		return ExecuteToolResponse{
			Success: false,
			Error:   "Execution timed out after " + string(rune(timeout)) + " seconds",
			Stderr:  truncateOutput(stderr.String()),
		}
	}

	// Truncate output if needed
	stdoutStr := truncateOutput(stdout.String())
	stderrStr := truncateOutput(stderr.String())

	if err != nil {
		return ExecuteToolResponse{
			Success: false,
			Error:   "Execution failed: " + err.Error(),
			Stdout:  stdoutStr,
			Stderr:  stderrStr,
		}
	}

	// Try to parse stdout as JSON
	var result interface{}
	if stdoutStr != "" {
		if err := json.Unmarshal([]byte(stdoutStr), &result); err != nil {
			// If not valid JSON, return as string
			result = stdoutStr
		}
	}

	return ExecuteToolResponse{
		Success: true,
		Result:  result,
		Stdout:  stdoutStr,
		Stderr:  stderrStr,
	}
}

// truncateOutput truncates output to MaxOutputSize
func truncateOutput(s string) string {
	if len(s) > MaxOutputSize {
		return s[:MaxOutputSize] + "\n... (output truncated)"
	}
	return s
}
