package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestIsPrivateIP(t *testing.T) {
	tests := []struct {
		name     string
		ip       string
		expected bool
	}{
		// Loopback addresses
		{"IPv4 loopback", "127.0.0.1", true},
		{"IPv6 loopback", "::1", true},

		// Private IPv4 ranges (RFC 1918)
		{"10.x.x.x range", "10.0.0.1", true},
		{"10.x.x.x high", "10.255.255.255", true},
		{"172.16.x.x range", "172.16.0.1", true},
		{"172.31.x.x range", "172.31.255.255", true},
		{"192.168.x.x range", "192.168.0.1", true},
		{"192.168.x.x high", "192.168.255.255", true},

		// Public IPv4 addresses
		{"Google DNS", "8.8.8.8", false},
		{"Cloudflare DNS", "1.1.1.1", false},
		{"Random public IP", "203.0.113.50", false},

		// Edge cases - not in private ranges
		{"172.15.x.x not private", "172.15.0.1", false},
		{"172.32.x.x not private", "172.32.0.1", false},
		{"192.167.x.x not private", "192.167.0.1", false},

		// IPv6 private (fc00::/7)
		{"IPv6 private fc", "fc00::1", true},
		{"IPv6 private fd", "fd00::1", true},

		// IPv6 public
		{"IPv6 public", "2001:4860:4860::8888", false},

		// Invalid inputs
		{"invalid IP", "not-an-ip", false},
		{"empty string", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isPrivateIP(tt.ip)
			if result != tt.expected {
				t.Errorf("isPrivateIP(%q) = %v, want %v", tt.ip, result, tt.expected)
			}
		})
	}
}

func TestGetClientIP(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name       string
		headers    map[string]string
		remoteAddr string
		expected   string
	}{
		{
			name:       "X-Forwarded-For single IP",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.50"},
			remoteAddr: "127.0.0.1:8080",
			expected:   "203.0.113.50",
		},
		{
			name:       "X-Forwarded-For multiple IPs",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.50, 70.41.3.18, 150.172.238.178"},
			remoteAddr: "127.0.0.1:8080",
			expected:   "203.0.113.50",
		},
		{
			name:       "X-Real-IP header",
			headers:    map[string]string{"X-Real-IP": "198.51.100.178"},
			remoteAddr: "127.0.0.1:8080",
			expected:   "198.51.100.178",
		},
		{
			name:       "X-Forwarded-For takes precedence over X-Real-IP",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.50", "X-Real-IP": "198.51.100.178"},
			remoteAddr: "127.0.0.1:8080",
			expected:   "203.0.113.50",
		},
		{
			name:       "fallback to RemoteAddr",
			headers:    map[string]string{},
			remoteAddr: "192.168.1.100:54321",
			expected:   "192.168.1.100",
		},
		{
			name:       "X-Forwarded-For with whitespace",
			headers:    map[string]string{"X-Forwarded-For": "  203.0.113.50  "},
			remoteAddr: "127.0.0.1:8080",
			expected:   "203.0.113.50",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := gin.New()

			var capturedIP string
			router.GET("/test", func(c *gin.Context) {
				capturedIP = getClientIP(c)
				c.Status(http.StatusOK)
			})

			w := httptest.NewRecorder()
			req, _ := http.NewRequest("GET", "/test", nil)
			req.RemoteAddr = tt.remoteAddr

			for key, value := range tt.headers {
				req.Header.Set(key, value)
			}

			router.ServeHTTP(w, req)

			if capturedIP != tt.expected {
				t.Errorf("getClientIP() = %q, want %q", capturedIP, tt.expected)
			}
		})
	}
}
