package api

import (
	"testing"
)

func TestCleanHTML(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "removes simple tags",
			input:    "<b>bold</b> text",
			expected: "bold text",
		},
		{
			name:     "removes nested tags",
			input:    "<div><span>nested</span></div>",
			expected: "nested",
		},
		{
			name:     "decodes html entities",
			input:    "&amp; &lt; &gt; &quot;",
			expected: "& < > \"",
		},
		{
			name:     "decodes apostrophe",
			input:    "it&#39;s working",
			expected: "it's working",
		},
		{
			name:     "replaces nbsp with space",
			input:    "word&nbsp;word",
			expected: "word word",
		},
		{
			name:     "normalizes whitespace",
			input:    "  multiple   spaces  ",
			expected: "multiple spaces",
		},
		{
			name:     "handles empty string",
			input:    "",
			expected: "",
		},
		{
			name:     "handles plain text",
			input:    "no html here",
			expected: "no html here",
		},
		{
			name:     "handles complex html",
			input:    "<a href=\"https://example.com\">Link &amp; Text</a>",
			expected: "Link & Text",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := cleanHTML(tt.input)
			if result != tt.expected {
				t.Errorf("cleanHTML(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestDecodeURL(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "extracts url from uddg parameter",
			input:    "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpath&rut=abc",
			expected: "https://example.com/path",
		},
		{
			name:     "adds https to protocol-relative urls",
			input:    "//example.com/path",
			expected: "https://example.com/path",
		},
		{
			name:     "returns normal urls unchanged",
			input:    "https://example.com/page",
			expected: "https://example.com/page",
		},
		{
			name:     "handles http urls",
			input:    "http://example.com",
			expected: "http://example.com",
		},
		{
			name:     "handles empty string",
			input:    "",
			expected: "",
		},
		{
			name:     "handles uddg with special chars",
			input:    "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsearch%3Fq%3Dtest",
			expected: "https://example.com/search?q=test",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := decodeURL(tt.input)
			if result != tt.expected {
				t.Errorf("decodeURL(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestParseDuckDuckGoResults(t *testing.T) {
	// Test with realistic DuckDuckGo HTML structure
	html := `
	<div class="result results_links results_links_deep web-result">
		<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1">Example Page 1</a>
		<a class="result__snippet">This is the first result snippet.</a>
	</div>
	</div>
	<div class="result results_links results_links_deep web-result">
		<a class="result__a" href="https://example.org/page2">Example Page 2</a>
		<a class="result__snippet">Second result snippet here.</a>
	</div>
	</div>
	`

	results := parseDuckDuckGoResults(html, 10)

	if len(results) < 1 {
		t.Fatalf("expected at least 1 result, got %d", len(results))
	}

	// Check first result
	if results[0].Title != "Example Page 1" {
		t.Errorf("first result title = %q, want %q", results[0].Title, "Example Page 1")
	}
	if results[0].URL != "https://example.com/page1" {
		t.Errorf("first result URL = %q, want %q", results[0].URL, "https://example.com/page1")
	}
}

func TestParseDuckDuckGoResultsMaxResults(t *testing.T) {
	// Create HTML with many results
	html := ""
	for i := 0; i < 20; i++ {
		html += `<div class="result results_links results_links_deep web-result">
			<a class="result__a" href="https://example.com/page">Title</a>
			<a class="result__snippet">Snippet</a>
		</div></div>`
	}

	results := parseDuckDuckGoResults(html, 5)

	if len(results) > 5 {
		t.Errorf("expected max 5 results, got %d", len(results))
	}
}

func TestParseDuckDuckGoResultsSkipsDuckDuckGoLinks(t *testing.T) {
	html := `
	<div class="result results_links results_links_deep web-result">
		<a class="result__a" href="https://duckduckgo.com/something">DDG Internal</a>
		<a class="result__snippet">Internal link</a>
	</div>
	</div>
	<div class="result results_links results_links_deep web-result">
		<a class="result__a" href="https://example.com/page">External Page</a>
		<a class="result__snippet">External snippet</a>
	</div>
	</div>
	`

	results := parseDuckDuckGoResults(html, 10)

	for _, r := range results {
		if r.URL == "https://duckduckgo.com/something" {
			t.Error("should have filtered out duckduckgo.com link")
		}
	}
}
