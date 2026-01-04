package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/vikingowl91/vessel/apps/vlm/internal/api"
	"github.com/vikingowl91/vessel/apps/vlm/internal/auth"
	"github.com/vikingowl91/vessel/apps/vlm/internal/config"
	"github.com/vikingowl91/vessel/apps/vlm/internal/process"
	"github.com/vikingowl91/vessel/apps/vlm/internal/proxy"
	"github.com/vikingowl91/vessel/apps/vlm/internal/scheduler"
)

var (
	Version   = "0.1.0"
	BuildTime = "unknown"
)

func main() {
	// Parse command line flags
	configPath := flag.String("config", config.DefaultConfigFilePath(), "path to config file")
	showVersion := flag.Bool("version", false, "show version and exit")
	generateConfig := flag.Bool("generate-config", false, "generate default config and exit")
	flag.Parse()

	if *showVersion {
		fmt.Printf("VLM (Vessel Llama Manager) %s (built %s)\n", Version, BuildTime)
		os.Exit(0)
	}

	if *generateConfig {
		if err := config.EnsureDirectories(); err != nil {
			fmt.Fprintf(os.Stderr, "Error creating directories: %v\n", err)
			os.Exit(1)
		}
		if err := config.WriteDefaultConfig(*configPath); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing config: %v\n", err)
			os.Exit(1)
		}
		fmt.Printf("Config written to: %s\n", config.ExpandPath(*configPath))
		os.Exit(0)
	}

	// Set up structured logging
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	logger := slog.Default().With("component", "main")
	logger.Info("starting VLM", "version", Version, "config", *configPath)

	// Load configuration
	cfg, err := config.Load(*configPath)
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Create components
	switcher := process.NewSwitcher(cfg)

	sched := scheduler.NewScheduler(scheduler.Config{
		MaxConcurrentRequests: cfg.Scheduler.MaxConcurrentRequests,
		InteractiveReserve:    cfg.Scheduler.InteractiveReserve,
		QueueSize:             cfg.Scheduler.QueueSize,
	})

	upstream := proxy.NewUpstream("")

	tokenValidator := auth.NewTokenValidator(
		cfg.VLM.AuthToken,
		cfg.Security.RequireTokenForInference,
	)

	// Create API handlers
	controlAPI := api.NewControlAPI(cfg, switcher, sched)
	inferenceAPI := api.NewInferenceAPI(cfg, switcher, sched, upstream)

	// Create HTTP mux
	mux := http.NewServeMux()

	// Register routes
	controlAPI.Register(mux)
	inferenceAPI.Register(mux)

	// Apply middleware
	var handler http.Handler = mux
	handler = tokenValidator.Middleware(handler)

	// Create server
	server := &http.Server{
		Addr:         cfg.VLM.Bind,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 10 * time.Minute, // Long timeout for streaming
		IdleTimeout:  120 * time.Second,
	}

	// Start server in goroutine
	go func() {
		logger.Info("server listening", "addr", cfg.VLM.Bind)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down...")

	// Stop any running llama-server
	if err := switcher.Stop(); err != nil {
		logger.Warn("error stopping llama-server", "error", err)
	}

	// Graceful shutdown with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Error("server shutdown error", "error", err)
	}

	logger.Info("VLM stopped")
}
