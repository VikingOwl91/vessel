package api

import (
	"testing"
)

func TestDefaultFetchOptions(t *testing.T) {
	opts := DefaultFetchOptions()

	if opts.MaxLength != 500000 {
		t.Errorf("expected MaxLength 500000, got %d", opts.MaxLength)
	}
	if opts.Timeout.Seconds() != 30 {
		t.Errorf("expected Timeout 30s, got %v", opts.Timeout)
	}
	if opts.UserAgent == "" {
		t.Error("expected non-empty UserAgent")
	}
	if opts.Headers == nil {
		t.Error("expected Headers to be initialized")
	}
	if !opts.FollowRedirects {
		t.Error("expected FollowRedirects to be true")
	}
	if opts.WaitTime.Seconds() != 2 {
		t.Errorf("expected WaitTime 2s, got %v", opts.WaitTime)
	}
}

func TestStripHTMLTags(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "removes simple tags",
			input:    "<p>Hello World</p>",
			expected: "Hello World",
		},
		{
			name:     "removes nested tags",
			input:    "<div><span>Nested</span> content</div>",
			expected: "Nested content",
		},
		{
			name:     "removes script tags with content",
			input:    "<p>Before</p><script>alert('xss')</script><p>After</p>",
			expected: "Before After",
		},
		{
			name:     "removes style tags with content",
			input:    "<p>Text</p><style>.foo{color:red}</style><p>More</p>",
			expected: "Text More",
		},
		{
			name:     "collapses whitespace",
			input:    "<p>Lots    of   spaces</p>",
			expected: "Lots of spaces",
		},
		{
			name:     "handles empty input",
			input:    "",
			expected: "",
		},
		{
			name:     "handles plain text",
			input:    "No HTML here",
			expected: "No HTML here",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := stripHTMLTags(tt.input)
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestIsJSRenderedPage(t *testing.T) {
	f := &Fetcher{}

	tests := []struct {
		name     string
		content  string
		expected bool
	}{
		{
			name:     "short content indicates JS rendering",
			content:  "<html><body><div id=\"app\"></div></body></html>",
			expected: true,
		},
		{
			name:     "React root div with minimal content",
			content:  "<html><body><div id=\"root\"></div><script>window.__INITIAL_STATE__={}</script></body></html>",
			expected: true,
		},
		{
			name:     "Next.js pattern",
			content:  "<html><body><div id=\"__next\"></div></body></html>",
			expected: true,
		},
		{
			name:     "Nuxt.js pattern",
			content:  "<html><body><div id=\"__nuxt\"></div></body></html>",
			expected: true,
		},
		{
			name:     "noscript indicator",
			content:  "<html><body><noscript>Enable JS</noscript><div></div></body></html>",
			expected: true,
		},
		{
			name:     "substantial content is not JS-rendered",
			content:  generateLongContent(2000),
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := f.isJSRenderedPage(tt.content)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

// generateLongContent creates content of specified length
func generateLongContent(length int) string {
	base := "<html><body><article>"
	content := ""
	word := "word "
	for len(content) < length {
		content += word
	}
	return base + content + "</article></body></html>"
}

func TestFetchMethod_String(t *testing.T) {
	tests := []struct {
		method   FetchMethod
		expected string
	}{
		{FetchMethodCurl, "curl"},
		{FetchMethodWget, "wget"},
		{FetchMethodChrome, "chrome"},
		{FetchMethodNative, "native"},
	}

	for _, tt := range tests {
		t.Run(string(tt.method), func(t *testing.T) {
			if string(tt.method) != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, string(tt.method))
			}
		})
	}
}

func TestFetchResult_Fields(t *testing.T) {
	result := FetchResult{
		Content:      "test content",
		ContentType:  "text/html",
		FinalURL:     "https://example.com",
		StatusCode:   200,
		Method:       FetchMethodNative,
		Truncated:    true,
		OriginalSize: 1000000,
	}

	if result.Content != "test content" {
		t.Errorf("Content mismatch")
	}
	if result.ContentType != "text/html" {
		t.Errorf("ContentType mismatch")
	}
	if result.FinalURL != "https://example.com" {
		t.Errorf("FinalURL mismatch")
	}
	if result.StatusCode != 200 {
		t.Errorf("StatusCode mismatch")
	}
	if result.Method != FetchMethodNative {
		t.Errorf("Method mismatch")
	}
	if !result.Truncated {
		t.Errorf("Truncated should be true")
	}
	if result.OriginalSize != 1000000 {
		t.Errorf("OriginalSize mismatch")
	}
}
