package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"vessel-backend/internal/api"
	"vessel-backend/internal/database"
	"vessel-backend/internal/llm"
	"vessel-backend/internal/llm/backends"
)

// Version is set at build time via -ldflags, or defaults to dev
var Version = "0.4.12"

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func main() {
	var (
		port           = flag.String("port", getEnvOrDefault("PORT", "8080"), "Server port")
		dbPath         = flag.String("db", getEnvOrDefault("DB_PATH", "./data/vessel.db"), "Database file path")
		ollamaURL      = flag.String("ollama-url", getEnvOrDefault("OLLAMA_URL", "http://localhost:11434"), "Ollama API URL")
		defaultBackend = flag.String("default-backend", getEnvOrDefault("DEFAULT_BACKEND", "ollama"), "Default backend name")
	)
	// Note: LLAMA_CPP_URL and HF_TOKEN are read via llm.LoadFromEnv()
	flag.Parse()

	// Initialize database
	db, err := database.OpenDatabase(*dbPath)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// Run migrations
	if err := database.RunMigrations(db); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	// Initialize LLM backend manager
	llmManager := llm.NewManager(db)
	defer llmManager.Close()

	// Create config from environment
	llmConfig := llm.LoadFromEnv()

	// Initialize backends from config
	factory := backends.NewDefaultFactory()
	if err := llmManager.InitFromConfig(llmConfig, factory); err != nil {
		log.Printf("Warning: some backends failed to initialize: %v", err)
	}

	// Set default backend if specified
	if *defaultBackend != "" {
		if err := llmManager.SetPrimary(*defaultBackend); err != nil {
			log.Printf("Warning: could not set default backend: %v", err)
		}
	}

	// Setup Gin router
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())

	// CORS configuration
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// Register routes
	api.SetupRoutes(r, db, *ollamaURL, Version)

	// Register LLM multi-backend routes
	llmService := api.NewLLMService(llmManager)
	llmGroup := r.Group("/api/v1/llm")
	llmService.SetupRoutes(llmGroup)

	// Create server
	srv := &http.Server{
		Addr:    ":" + *port,
		Handler: r,
	}

	// Initialize fetcher and log the method being used
	fetcher := api.GetFetcher()
	log.Printf("URL fetcher method: %s (headless Chrome: %v)", fetcher.Method(), fetcher.HasChrome())

	// Graceful shutdown handling
	go func() {
		log.Printf("Server starting on port %s", *port)
		log.Printf("Ollama URL: %s (using official Go client)", *ollamaURL)
		log.Printf("Database: %s", *dbPath)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}
