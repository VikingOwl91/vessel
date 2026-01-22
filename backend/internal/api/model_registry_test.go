package api

import (
	"strings"
	"testing"
	"time"
)

func TestParsePullCount(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int64
	}{
		{"plain number", "1000", 1000},
		{"thousands K", "1.5K", 1500},
		{"millions M", "2.3M", 2300000},
		{"billions B", "1B", 1000000000},
		{"whole K", "500K", 500000},
		{"decimal M", "60.3M", 60300000},
		{"with whitespace", " 100K ", 100000},
		{"empty string", "", 0},
		{"invalid", "abc", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parsePullCount(tt.input)
			if result != tt.expected {
				t.Errorf("parsePullCount(%q) = %d, want %d", tt.input, result, tt.expected)
			}
		})
	}
}

func TestDecodeHTMLEntities(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"apostrophe numeric", "It&#39;s", "It's"},
		{"quote numeric", "&#34;Hello&#34;", "\"Hello\""},
		{"quote named", "&quot;World&quot;", "\"World\""},
		{"ampersand", "A &amp; B", "A & B"},
		{"less than", "1 &lt; 2", "1 < 2"},
		{"greater than", "2 &gt; 1", "2 > 1"},
		{"nbsp", "Hello&nbsp;World", "Hello World"},
		{"multiple entities", "&lt;div&gt;&amp;&lt;/div&gt;", "<div>&</div>"},
		{"no entities", "Plain text", "Plain text"},
		{"empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := decodeHTMLEntities(tt.input)
			if result != tt.expected {
				t.Errorf("decodeHTMLEntities(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestParseRelativeTime(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name       string
		input      string
		wantEmpty  bool
		checkDelta time.Duration
	}{
		{"2 weeks ago", "2 weeks ago", false, 14 * 24 * time.Hour},
		{"1 month ago", "1 month ago", false, 30 * 24 * time.Hour},
		{"3 days ago", "3 days ago", false, 3 * 24 * time.Hour},
		{"5 hours ago", "5 hours ago", false, 5 * time.Hour},
		{"30 minutes ago", "30 minutes ago", false, 30 * time.Minute},
		{"1 year ago", "1 year ago", false, 365 * 24 * time.Hour},
		{"empty string", "", true, 0},
		{"invalid format", "recently", true, 0},
		{"uppercase", "2 WEEKS AGO", false, 14 * 24 * time.Hour},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseRelativeTime(tt.input)

			if tt.wantEmpty {
				if result != "" {
					t.Errorf("parseRelativeTime(%q) = %q, want empty string", tt.input, result)
				}
				return
			}

			// Parse the result as RFC3339
			parsed, err := time.Parse(time.RFC3339, result)
			if err != nil {
				t.Fatalf("failed to parse result %q: %v", result, err)
			}

			// Check that the delta is approximately correct (within 1 minute tolerance)
			expectedTime := now.Add(-tt.checkDelta)
			diff := parsed.Sub(expectedTime)
			if diff < -time.Minute || diff > time.Minute {
				t.Errorf("parseRelativeTime(%q) = %v, expected around %v", tt.input, parsed, expectedTime)
			}
		})
	}
}

func TestParseSizeToBytes(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int64
	}{
		{"gigabytes", "2.0GB", 2 * 1024 * 1024 * 1024},
		{"megabytes", "500MB", 500 * 1024 * 1024},
		{"kilobytes", "100KB", 100 * 1024},
		{"decimal GB", "1.5GB", int64(1.5 * 1024 * 1024 * 1024)},
		{"plain number", "1024", 1024},
		{"with whitespace", " 1GB ", 1 * 1024 * 1024 * 1024},
		{"empty", "", 0},
		{"invalid", "abc", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseSizeToBytes(tt.input)
			if result != tt.expected {
				t.Errorf("parseSizeToBytes(%q) = %d, want %d", tt.input, result, tt.expected)
			}
		})
	}
}

func TestFormatParamCount(t *testing.T) {
	tests := []struct {
		name     string
		input    int64
		expected string
	}{
		{"billions", 13900000000, "13.9B"},
		{"single billion", 1000000000, "1.0B"},
		{"millions", 500000000, "500.0M"},
		{"single million", 1000000, "1.0M"},
		{"thousands", 500000, "500.0K"},
		{"single thousand", 1000, "1.0K"},
		{"small number", 500, "500"},
		{"zero", 0, "0"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatParamCount(tt.input)
			if result != tt.expected {
				t.Errorf("formatParamCount(%d) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestParseParamSizeToFloat(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected float64
	}{
		{"8b", "8b", 8.0},
		{"70b", "70b", 70.0},
		{"1.5b", "1.5b", 1.5},
		{"500m to billions", "500m", 0.5},
		{"uppercase B", "8B", 8.0},
		{"uppercase M", "500M", 0.5},
		{"with whitespace", " 8b ", 8.0},
		{"empty", "", 0},
		{"invalid", "abc", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseParamSizeToFloat(tt.input)
			if result != tt.expected {
				t.Errorf("parseParamSizeToFloat(%q) = %f, want %f", tt.input, result, tt.expected)
			}
		})
	}
}

func TestGetSizeRange(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"small 1b", "1b", "small"},
		{"small 3b", "3b", "small"},
		{"medium 4b", "4b", "medium"},
		{"medium 8b", "8b", "medium"},
		{"medium 13b", "13b", "medium"},
		{"large 14b", "14b", "large"},
		{"large 70b", "70b", "large"},
		{"xlarge 405b", "405b", "xlarge"},
		{"empty", "", ""},
		{"invalid", "abc", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getSizeRange(tt.input)
			if result != tt.expected {
				t.Errorf("getSizeRange(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestGetContextRange(t *testing.T) {
	tests := []struct {
		name     string
		input    int64
		expected string
	}{
		{"standard 4K", 4096, "standard"},
		{"standard 8K", 8192, "standard"},
		{"extended 16K", 16384, "extended"},
		{"extended 32K", 32768, "extended"},
		{"large 64K", 65536, "large"},
		{"large 128K", 131072, "large"},
		{"unlimited 256K", 262144, "unlimited"},
		{"unlimited 1M", 1048576, "unlimited"},
		{"zero", 0, ""},
		{"negative", -1, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getContextRange(tt.input)
			if result != tt.expected {
				t.Errorf("getContextRange(%d) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestExtractFamily(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"llama3.2", "llama3.2", "llama"},
		{"qwen2.5", "qwen2.5", "qwen"},
		{"mistral", "mistral", "mistral"},
		{"deepseek-r1", "deepseek-r1", "deepseek"},
		{"phi_3", "phi_3", "phi"},
		{"community model", "username/custom-llama", "custom"},
		{"with version", "llama3.2:8b", "llama"},
		{"numbers only", "123model", ""},
		{"empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractFamily(tt.input)
			if result != tt.expected {
				t.Errorf("extractFamily(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestInferModelType(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"official llama", "llama3.2", "official"},
		{"official mistral", "mistral", "official"},
		{"community model", "username/model", "community"},
		{"nested community", "org/subdir/model", "community"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := inferModelType(tt.input)
			if result != tt.expected {
				t.Errorf("inferModelType(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestModelMatchesSizeRanges(t *testing.T) {
	tests := []struct {
		name       string
		tags       []string
		sizeRanges []string
		expected   bool
	}{
		{
			name:       "matches small",
			tags:       []string{"1b", "3b"},
			sizeRanges: []string{"small"},
			expected:   true,
		},
		{
			name:       "matches medium",
			tags:       []string{"8b", "14b"},
			sizeRanges: []string{"medium"},
			expected:   true,
		},
		{
			name:       "matches large",
			tags:       []string{"70b"},
			sizeRanges: []string{"large"},
			expected:   true,
		},
		{
			name:       "matches multiple ranges",
			tags:       []string{"8b", "70b"},
			sizeRanges: []string{"medium", "large"},
			expected:   true,
		},
		{
			name:       "no match",
			tags:       []string{"8b"},
			sizeRanges: []string{"large", "xlarge"},
			expected:   false,
		},
		{
			name:       "empty tags",
			tags:       []string{},
			sizeRanges: []string{"medium"},
			expected:   false,
		},
		{
			name:       "empty ranges",
			tags:       []string{"8b"},
			sizeRanges: []string{},
			expected:   false,
		},
		{
			name:       "non-size tags",
			tags:       []string{"latest", "fp16"},
			sizeRanges: []string{"medium"},
			expected:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := modelMatchesSizeRanges(tt.tags, tt.sizeRanges)
			if result != tt.expected {
				t.Errorf("modelMatchesSizeRanges(%v, %v) = %v, want %v", tt.tags, tt.sizeRanges, result, tt.expected)
			}
		})
	}
}

func TestParseOllamaParams(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected map[string]any
	}{
		{
			name:  "temperature",
			input: "temperature 0.8",
			expected: map[string]any{
				"temperature": 0.8,
			},
		},
		{
			name:  "multiple params",
			input: "temperature 0.8\nnum_ctx 4096\nstop <|im_end|>",
			expected: map[string]any{
				"temperature": 0.8,
				"num_ctx":     float64(4096),
				"stop":        "<|im_end|>",
			},
		},
		{
			name:     "empty input",
			input:    "",
			expected: map[string]any{},
		},
		{
			name:     "whitespace only",
			input:    "   \n   \n   ",
			expected: map[string]any{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseOllamaParams(tt.input)
			if len(result) != len(tt.expected) {
				t.Errorf("parseOllamaParams result length = %d, want %d", len(result), len(tt.expected))
				return
			}
			for k, v := range tt.expected {
				if result[k] != v {
					t.Errorf("parseOllamaParams[%q] = %v, want %v", k, result[k], v)
				}
			}
		})
	}
}

func TestParseLibraryHTML(t *testing.T) {
	// Test with minimal valid HTML structure
	html := `
		<a href="/library/llama3.2" class="group flex">
			<p class="text-neutral-800">A foundation model</p>
			<span x-test-pull-count>1.5M</span>
			<span x-test-size>8b</span>
			<span x-test-size>70b</span>
			<span x-test-capability>vision</span>
			<span x-test-updated>2 weeks ago</span>
		</a>
		<a href="/library/mistral" class="group flex">
			<p class="text-neutral-800">Fast model</p>
			<span x-test-pull-count>500K</span>
			<span x-test-size>7b</span>
		</a>
	`

	models, err := parseLibraryHTML(html)
	if err != nil {
		t.Fatalf("parseLibraryHTML failed: %v", err)
	}

	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}

	// Find llama3.2 model
	var llama *ScrapedModel
	for i := range models {
		if models[i].Slug == "llama3.2" {
			llama = &models[i]
			break
		}
	}

	if llama == nil {
		t.Fatal("llama3.2 model not found")
	}

	if llama.Description != "A foundation model" {
		t.Errorf("description = %q, want %q", llama.Description, "A foundation model")
	}

	if llama.PullCount != 1500000 {
		t.Errorf("pull count = %d, want 1500000", llama.PullCount)
	}

	if len(llama.Tags) != 2 || llama.Tags[0] != "8b" || llama.Tags[1] != "70b" {
		t.Errorf("tags = %v, want [8b, 70b]", llama.Tags)
	}

	if len(llama.Capabilities) != 1 || llama.Capabilities[0] != "vision" {
		t.Errorf("capabilities = %v, want [vision]", llama.Capabilities)
	}

	if !strings.HasPrefix(llama.URL, "https://ollama.com/library/") {
		t.Errorf("URL = %q, want prefix https://ollama.com/library/", llama.URL)
	}
}

func TestParseModelPageForSizes(t *testing.T) {
	html := `
		<a href="/library/llama3.2:8b">
			<span>8b</span>
			<span>2.0GB</span>
		</a>
		<a href="/library/llama3.2:70b">
			<span>70b</span>
			<span>40.5GB</span>
		</a>
		<a href="/library/llama3.2:1b">
			<span>1b</span>
			<span>500MB</span>
		</a>
	`

	sizes, err := parseModelPageForSizes(html)
	if err != nil {
		t.Fatalf("parseModelPageForSizes failed: %v", err)
	}

	expected := map[string]int64{
		"8b":  int64(2.0 * 1024 * 1024 * 1024),
		"70b": int64(40.5 * 1024 * 1024 * 1024),
		"1b":  int64(500 * 1024 * 1024),
	}

	for tag, expectedSize := range expected {
		if sizes[tag] != expectedSize {
			t.Errorf("sizes[%q] = %d, want %d", tag, sizes[tag], expectedSize)
		}
	}
}

func TestStripHTML(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple tags", "<p>Hello</p>", " Hello "},
		{"nested tags", "<div><span>Text</span></div>", "  Text  "},
		{"self-closing", "<br/>Line<br/>", " Line "},
		{"no tags", "Plain text", "Plain text"},
		{"empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := stripHTML(tt.input)
			if result != tt.expected {
				t.Errorf("stripHTML(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}
