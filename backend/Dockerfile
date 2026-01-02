FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache gcc musl-dev

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o server ./cmd/server

# Final stage
FROM alpine:latest

# curl for web fetching, ca-certificates for HTTPS, python3 for tool execution
RUN apk --no-cache add ca-certificates curl python3

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/server .

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8080

# Set environment variables
ENV GIN_MODE=release

# Default environment variables (can be overridden in docker-compose)
ENV PORT=8080
ENV DB_PATH=/app/data/vessel.db
ENV OLLAMA_URL=http://localhost:11434

# Run the server (reads config from environment variables)
CMD ["./server"]
