package scheduler

import (
	"context"
	"log/slog"
	"net/http"
	"sync/atomic"
)

// Scheduler manages request concurrency with two-semaphore design.
// Interactive requests get priority access to dedicated slots.
type Scheduler struct {
	interactiveSlots chan struct{}
	workerSlots      chan struct{}
	queueSize        int
	queue            chan *queuedRequest

	logger *slog.Logger

	// Metrics
	activeInteractive atomic.Int32
	activeWorker      atomic.Int32
	queued            atomic.Int32
	totalProcessed    atomic.Int64
	totalRejected     atomic.Int64
}

type queuedRequest struct {
	ctx         context.Context
	interactive bool
	ready       chan struct{}
	rejected    chan struct{}
}

// Config holds scheduler configuration.
type Config struct {
	MaxConcurrentRequests int
	InteractiveReserve    int
	QueueSize             int
}

// NewScheduler creates a new request scheduler.
func NewScheduler(cfg Config) *Scheduler {
	if cfg.MaxConcurrentRequests < 1 {
		cfg.MaxConcurrentRequests = 2
	}
	if cfg.InteractiveReserve < 0 {
		cfg.InteractiveReserve = 0
	}
	if cfg.InteractiveReserve > cfg.MaxConcurrentRequests {
		cfg.InteractiveReserve = cfg.MaxConcurrentRequests
	}
	if cfg.QueueSize < 1 {
		cfg.QueueSize = 64
	}

	workerCount := cfg.MaxConcurrentRequests - cfg.InteractiveReserve

	s := &Scheduler{
		interactiveSlots: make(chan struct{}, cfg.InteractiveReserve),
		workerSlots:      make(chan struct{}, workerCount),
		queueSize:        cfg.QueueSize,
		queue:            make(chan *queuedRequest, cfg.QueueSize),
		logger:           slog.Default().With("component", "scheduler"),
	}

	// Fill semaphores
	for i := 0; i < cfg.InteractiveReserve; i++ {
		s.interactiveSlots <- struct{}{}
	}
	for i := 0; i < workerCount; i++ {
		s.workerSlots <- struct{}{}
	}

	// Start queue processor
	go s.processQueue()

	return s
}

// Acquire attempts to acquire a slot for the request.
// Returns a release function if successful, or an error if queue is full.
func (s *Scheduler) Acquire(ctx context.Context, interactive bool) (release func(), err error) {
	// Try to acquire slot directly first (non-blocking)
	slot, acquired := s.tryAcquireSlot(interactive)
	if acquired {
		if interactive {
			s.activeInteractive.Add(1)
		} else {
			s.activeWorker.Add(1)
		}
		return s.makeRelease(slot, interactive), nil
	}

	// Queue the request
	req := &queuedRequest{
		ctx:         ctx,
		interactive: interactive,
		ready:       make(chan struct{}),
		rejected:    make(chan struct{}),
	}

	// Try to queue (non-blocking)
	select {
	case s.queue <- req:
		s.queued.Add(1)
	default:
		// Queue is full
		s.totalRejected.Add(1)
		return nil, ErrQueueFull
	}

	// Wait for slot to become available
	select {
	case <-ctx.Done():
		// Request cancelled while waiting
		s.queued.Add(-1)
		return nil, ctx.Err()
	case <-req.rejected:
		// Request was rejected (queue overflow during wait)
		s.queued.Add(-1)
		s.totalRejected.Add(1)
		return nil, ErrQueueFull
	case <-req.ready:
		// Slot acquired
		s.queued.Add(-1)
		if interactive {
			s.activeInteractive.Add(1)
		} else {
			s.activeWorker.Add(1)
		}
		return s.makeRelease(nil, interactive), nil
	}
}

// tryAcquireSlot attempts to acquire a slot without blocking.
func (s *Scheduler) tryAcquireSlot(interactive bool) (slot interface{}, acquired bool) {
	if interactive {
		// Try interactive slot first
		select {
		case token := <-s.interactiveSlots:
			return token, true
		default:
		}
		// Fall back to worker slot
		select {
		case token := <-s.workerSlots:
			return token, true
		default:
		}
	} else {
		// Worker requests only use worker slots
		select {
		case token := <-s.workerSlots:
			return token, true
		default:
		}
	}
	return nil, false
}

func (s *Scheduler) makeRelease(slot interface{}, interactive bool) func() {
	released := false
	return func() {
		if released {
			return
		}
		released = true

		s.totalProcessed.Add(1)

		if interactive {
			s.activeInteractive.Add(-1)
			// Return to appropriate pool
			select {
			case s.interactiveSlots <- struct{}{}:
			default:
				s.workerSlots <- struct{}{}
			}
		} else {
			s.activeWorker.Add(-1)
			s.workerSlots <- struct{}{}
		}
	}
}

// processQueue handles queued requests in FIFO order.
func (s *Scheduler) processQueue() {
	for req := range s.queue {
		// Check if request is still valid
		select {
		case <-req.ctx.Done():
			continue
		default:
		}

		// Wait for a slot
		slot, _ := s.waitForSlot(req.ctx, req.interactive)
		if slot == nil {
			// Context cancelled
			continue
		}

		// Signal ready
		close(req.ready)
	}
}

func (s *Scheduler) waitForSlot(ctx context.Context, interactive bool) (interface{}, bool) {
	if interactive {
		// Try interactive slot first, then worker
		select {
		case <-ctx.Done():
			return nil, false
		case token := <-s.interactiveSlots:
			return token, true
		case token := <-s.workerSlots:
			return token, true
		}
	} else {
		select {
		case <-ctx.Done():
			return nil, false
		case token := <-s.workerSlots:
			return token, true
		}
	}
}

// Stats returns current scheduler statistics.
type Stats struct {
	ActiveInteractive int32  `json:"active_interactive"`
	ActiveWorker      int32  `json:"active_worker"`
	ActiveTotal       int32  `json:"active_total"`
	Queued            int32  `json:"queued_requests"`
	TotalProcessed    int64  `json:"total_processed"`
	TotalRejected     int64  `json:"total_rejected"`
}

func (s *Scheduler) Stats() Stats {
	interactive := s.activeInteractive.Load()
	worker := s.activeWorker.Load()
	return Stats{
		ActiveInteractive: interactive,
		ActiveWorker:      worker,
		ActiveTotal:       interactive + worker,
		Queued:            s.queued.Load(),
		TotalProcessed:    s.totalProcessed.Load(),
		TotalRejected:     s.totalRejected.Load(),
	}
}

// Middleware returns an HTTP middleware that enforces scheduling.
func (s *Scheduler) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check for interactive header
		interactive := r.Header.Get("X-VLM-Interactive") == "1"

		release, err := s.Acquire(r.Context(), interactive)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "5")
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"error":"queue full, try again later","code":"QUEUE_FULL"}`))
			return
		}
		defer release()

		next.ServeHTTP(w, r)
	})
}

// Error types
type schedulerError string

func (e schedulerError) Error() string { return string(e) }

const (
	ErrQueueFull schedulerError = "scheduler queue is full"
)

// IsInteractiveRequest checks if the request should be treated as interactive.
func IsInteractiveRequest(r *http.Request) bool {
	return r.Header.Get("X-VLM-Interactive") == "1"
}
