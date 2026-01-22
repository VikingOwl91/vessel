package models

import (
	"testing"
	"time"
)

func TestGetDateGroup(t *testing.T) {
	// Fixed reference time: Wednesday, January 15, 2025 at 14:00:00 UTC
	now := time.Date(2025, 1, 15, 14, 0, 0, 0, time.UTC)

	tests := []struct {
		name     string
		input    time.Time
		expected DateGroup
	}{
		// Today
		{
			name:     "today morning",
			input:    time.Date(2025, 1, 15, 9, 0, 0, 0, time.UTC),
			expected: DateGroupToday,
		},
		{
			name:     "today midnight",
			input:    time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC),
			expected: DateGroupToday,
		},
		// Yesterday
		{
			name:     "yesterday afternoon",
			input:    time.Date(2025, 1, 14, 15, 0, 0, 0, time.UTC),
			expected: DateGroupYesterday,
		},
		{
			name:     "yesterday start",
			input:    time.Date(2025, 1, 14, 0, 0, 0, 0, time.UTC),
			expected: DateGroupYesterday,
		},
		// This Week (Monday Jan 13 - Sunday Jan 19)
		{
			name:     "this week monday",
			input:    time.Date(2025, 1, 13, 10, 0, 0, 0, time.UTC),
			expected: DateGroupThisWeek,
		},
		// Last Week (Monday Jan 6 - Sunday Jan 12)
		{
			name:     "last week friday",
			input:    time.Date(2025, 1, 10, 12, 0, 0, 0, time.UTC),
			expected: DateGroupLastWeek,
		},
		{
			name:     "last week monday",
			input:    time.Date(2025, 1, 6, 8, 0, 0, 0, time.UTC),
			expected: DateGroupLastWeek,
		},
		// This Month (January 2025)
		{
			name:     "this month early",
			input:    time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC),
			expected: DateGroupThisMonth,
		},
		// Last Month (December 2024)
		{
			name:     "last month",
			input:    time.Date(2024, 12, 15, 10, 0, 0, 0, time.UTC),
			expected: DateGroupLastMonth,
		},
		{
			name:     "last month start",
			input:    time.Date(2024, 12, 1, 0, 0, 0, 0, time.UTC),
			expected: DateGroupLastMonth,
		},
		// Older
		{
			name:     "november 2024",
			input:    time.Date(2024, 11, 20, 0, 0, 0, 0, time.UTC),
			expected: DateGroupOlder,
		},
		{
			name:     "last year",
			input:    time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC),
			expected: DateGroupOlder,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getDateGroup(tt.input, now)
			if result != tt.expected {
				t.Errorf("getDateGroup(%v, %v) = %v, want %v", tt.input, now, result, tt.expected)
			}
		})
	}
}

func TestGetDateGroupSundayEdgeCase(t *testing.T) {
	// Test edge case: Sunday should be grouped with current week
	// Reference: Sunday, January 19, 2025 at 12:00:00 UTC
	now := time.Date(2025, 1, 19, 12, 0, 0, 0, time.UTC)

	// Today (Sunday)
	sunday := time.Date(2025, 1, 19, 8, 0, 0, 0, time.UTC)
	if result := getDateGroup(sunday, now); result != DateGroupToday {
		t.Errorf("Sunday should be Today, got %v", result)
	}

	// Yesterday (Saturday)
	saturday := time.Date(2025, 1, 18, 10, 0, 0, 0, time.UTC)
	if result := getDateGroup(saturday, now); result != DateGroupYesterday {
		t.Errorf("Saturday should be Yesterday, got %v", result)
	}

	// This week (Monday of same week)
	monday := time.Date(2025, 1, 13, 10, 0, 0, 0, time.UTC)
	if result := getDateGroup(monday, now); result != DateGroupThisWeek {
		t.Errorf("Monday should be This Week, got %v", result)
	}
}
