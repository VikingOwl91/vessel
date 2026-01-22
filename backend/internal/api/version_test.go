package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		name     string
		current  string
		latest   string
		expected bool
	}{
		// Basic comparisons
		{"newer major version", "1.0.0", "2.0.0", true},
		{"newer minor version", "1.0.0", "1.1.0", true},
		{"newer patch version", "1.0.0", "1.0.1", true},
		{"same version", "1.0.0", "1.0.0", false},
		{"older version", "2.0.0", "1.0.0", false},

		// With v prefix
		{"v prefix on both", "v1.0.0", "v1.1.0", true},
		{"v prefix on current only", "v1.0.0", "1.1.0", true},
		{"v prefix on latest only", "1.0.0", "v1.1.0", true},

		// Different segment counts
		{"more segments in latest", "1.0", "1.0.1", true},
		{"more segments in current", "1.0.1", "1.1", true},
		{"single segment", "1", "2", true},

		// Pre-release versions (strips suffix after -)
		{"pre-release current", "1.0.0-beta", "1.0.0", false},
		{"pre-release latest", "1.0.0", "1.0.1-beta", true},

		// Edge cases
		{"empty latest", "1.0.0", "", false},
		{"empty current", "", "1.0.0", false},
		{"both empty", "", "", false},

		// Real-world scenarios
		{"typical update", "0.5.1", "0.5.2", true},
		{"major bump", "0.9.9", "1.0.0", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := compareVersions(tt.current, tt.latest)
			if result != tt.expected {
				t.Errorf("compareVersions(%q, %q) = %v, want %v",
					tt.current, tt.latest, result, tt.expected)
			}
		})
	}
}

func TestVersionHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("returns current version", func(t *testing.T) {
		router := gin.New()
		router.GET("/version", VersionHandler("1.2.3"))

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/version", nil)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var info VersionInfo
		if err := json.Unmarshal(w.Body.Bytes(), &info); err != nil {
			t.Fatalf("failed to unmarshal response: %v", err)
		}

		if info.Current != "1.2.3" {
			t.Errorf("expected current version '1.2.3', got '%s'", info.Current)
		}
	})
}
