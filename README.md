<p align="center">
  <img src="https://ollama.com/public/ollama.png" alt="Vessel" width="120" height="120">
</p>

<h1 align="center">Vessel</h1>

<p align="center">
  <strong>A modern, feature-rich web interface for Ollama</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#installation">Installation</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/SvelteKit-5.0-FF3E00?style=flat-square&logo=svelte&logoColor=white" alt="SvelteKit 5">
  <img src="https://img.shields.io/badge/Svelte-5.16-FF3E00?style=flat-square&logo=svelte&logoColor=white" alt="Svelte 5">
  <img src="https://img.shields.io/badge/Go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go 1.24">
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Tailwind-3.4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License MIT">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome">
</p>

---

## Features

### Core Chat Experience
- **Real-time streaming** — Watch responses appear token by token
- **Conversation history** — All chats stored locally in IndexedDB
- **Message editing** — Edit any message and regenerate responses with branching
- **Branch navigation** — Explore different response paths from edited messages
- **Markdown rendering** — Full GFM support with tables, lists, and formatting
- **Syntax highlighting** — Beautiful code blocks powered by Shiki with 100+ languages
- **Dark/Light mode** — Seamless theme switching with system preference detection

### Built-in Tools (Function Calling)
Vessel includes five powerful tools that models can invoke automatically:

| Tool | Description |
|------|-------------|
| **Web Search** | Search the internet for current information, news, weather, prices |
| **Fetch URL** | Read and extract content from any webpage |
| **Calculator** | Safe math expression parser with functions (sqrt, sin, cos, log, etc.) |
| **Get Location** | Detect user location via GPS or IP for local queries |
| **Get Time** | Current date/time with timezone support |

### Model Management
- **Model browser** — Browse, search, and pull models from Ollama registry
- **Live status** — See which models are currently loaded in memory
- **Quick switch** — Change models mid-conversation
- **Model metadata** — View parameters, quantization, and capabilities

### Developer Experience
- **Beautiful code generation** — Syntax-highlighted output for any language
- **Copy code blocks** — One-click copy with visual feedback
- **Scroll to bottom** — Smart auto-scroll with manual override
- **Keyboard shortcuts** — Navigate efficiently with hotkeys

---

## Screenshots

<table>
  <tr>
    <td align="center" width="50%">
      <img src="screenshots/hero-dark.png" alt="Chat Interface - Dark Mode">
      <br>
      <em>Clean, modern chat interface</em>
    </td>
    <td align="center" width="50%">
      <img src="screenshots/code-generation.png" alt="Code Generation">
      <br>
      <em>Syntax-highlighted code output</em>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="screenshots/web-search.png" alt="Web Search Results">
      <br>
      <em>Integrated web search with styled results</em>
    </td>
    <td align="center" width="50%">
      <img src="screenshots/light-mode.png" alt="Light Mode">
      <br>
      <em>Light theme for daytime use</em>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="screenshots/model-browser.png" alt="Model Browser" width="50%">
      <br>
      <em>Browse and manage Ollama models</em>
    </td>
  </tr>
</table>

---

## Quick Start

The fastest way to get running with Docker Compose:

```bash
# Clone the repository
git clone https://github.com/yourusername/vessel.git
cd vessel

# Start all services (frontend, backend, ollama)
docker compose up -d

# Open in browser
open http://localhost:7842
```

This starts:
- **Frontend** on `http://localhost:7842`
- **Backend API** on `http://localhost:9090`
- **Ollama** on `http://localhost:11434`

### First Model

Pull your first model from the UI or via command line:

```bash
# Via Ollama CLI
docker compose exec ollama ollama pull llama3.2

# Or use the Model Browser in the UI
```

---

## Installation

### Option 1: Docker Compose (Recommended)

```bash
docker compose up -d
```

#### With GPU Support (NVIDIA)

Uncomment the GPU section in `docker-compose.yml`:

```yaml
ollama:
  image: ollama/ollama:latest
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
```

Then run:
```bash
docker compose up -d
```

### Option 2: Manual Setup

#### Prerequisites
- [Node.js](https://nodejs.org/) 20+
- [Go](https://go.dev/) 1.24+
- [Ollama](https://ollama.com/) running locally

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`

#### Backend

```bash
cd backend
go mod tidy
go run cmd/server/main.go -port 9090
```

Backend API runs on `http://localhost:9090`

---

## Configuration

### Environment Variables

#### Frontend
| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_API_URL` | `http://localhost:11434` | Ollama API endpoint |
| `BACKEND_URL` | `http://localhost:9090` | Vessel backend API |

#### Backend
| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |
| `PORT` | `8080` | Backend server port |
| `GIN_MODE` | `debug` | Gin mode (`debug`, `release`) |

### Docker Compose Override

Create `docker-compose.override.yml` for local customizations:

```yaml
services:
  frontend:
    environment:
      - CUSTOM_VAR=value
    ports:
      - "3000:3000"  # Different port
```

---

## Architecture

```
vessel/
├── frontend/               # SvelteKit 5 application
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/ # UI components
│   │   │   ├── stores/     # Svelte 5 runes state
│   │   │   ├── tools/      # Built-in tool definitions
│   │   │   ├── storage/    # IndexedDB (Dexie)
│   │   │   └── api/        # API clients
│   │   └── routes/         # SvelteKit routes
│   └── Dockerfile
│
├── backend/                # Go API server
│   ├── cmd/server/         # Entry point
│   └── internal/
│       ├── api/            # HTTP handlers
│       │   ├── fetcher.go  # URL fetching with wget/curl/chromedp
│       │   ├── search.go   # Web search via DuckDuckGo
│       │   └── routes.go   # Route definitions
│       ├── database/       # SQLite storage
│       └── models/         # Data models
│
├── docker-compose.yml      # Production setup
└── docker-compose.dev.yml  # Development with hot reload
```

---

## Tech Stack

### Frontend
- **[SvelteKit 5](https://kit.svelte.dev/)** — Full-stack framework
- **[Svelte 5](https://svelte.dev/)** — Runes-based reactivity
- **[TypeScript](https://www.typescriptlang.org/)** — Type safety
- **[Tailwind CSS](https://tailwindcss.com/)** — Utility-first styling
- **[Skeleton UI](https://skeleton.dev/)** — Component library
- **[Shiki](https://shiki.matsu.io/)** — Syntax highlighting
- **[Dexie](https://dexie.org/)** — IndexedDB wrapper
- **[Marked](https://marked.js.org/)** — Markdown parser
- **[DOMPurify](https://github.com/cure53/DOMPurify)** — XSS sanitization

### Backend
- **[Go 1.24](https://go.dev/)** — Fast, compiled backend
- **[Gin](https://gin-gonic.com/)** — HTTP framework
- **[SQLite](https://sqlite.org/)** — Embedded database
- **[chromedp](https://github.com/chromedp/chromedp)** — Headless browser

---

## Development

### Running Tests

```bash
# Frontend unit tests
cd frontend
npm run test

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Type Checking

```bash
cd frontend
npm run check
```

### Development Mode

Use the dev compose file for hot reloading:

```bash
docker compose -f docker-compose.dev.yml up
```

---

## API Reference

### Backend Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/proxy/search` | Web search via DuckDuckGo |
| `POST` | `/api/v1/proxy/fetch` | Fetch URL content |
| `GET` | `/api/v1/location` | Get user location from IP |
| `GET` | `/api/v1/models/registry` | Browse Ollama model registry |
| `GET` | `/api/v1/models/search` | Search models |
| `POST` | `/api/v1/chats/sync` | Sync conversations |

### Ollama Proxy

All requests to `/ollama/*` are proxied to the Ollama API, enabling CORS.

---

## Roadmap

- [ ] System prompts per conversation
- [ ] Full-text message search
- [ ] Keyboard shortcuts help modal
- [ ] Export conversations (JSON, Markdown)
- [ ] Image generation (Stable Diffusion integration)
- [ ] Voice input/output
- [ ] Multi-user support
- [ ] Plugin system

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with <a href="https://ollama.com">Ollama</a> and <a href="https://svelte.dev">Svelte</a>
</p>
