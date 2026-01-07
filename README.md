<p align="center">
  <img src="frontend/static/favicon.svg" alt="Vessel" width="120" height="120">
</p>

<h1 align="center">Vessel</h1>

<p align="center">
  <strong>A modern, feature-rich web interface for Ollama</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="https://github.com/VikingOwl91/vessel/wiki">Documentation</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/SvelteKit-5.0-FF3E00?style=flat-square&logo=svelte&logoColor=white" alt="SvelteKit 5">
  <img src="https://img.shields.io/badge/Go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go 1.24">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" alt="License GPL-3.0">
</p>

---

## Why Vessel

**Vessel** is intentionally focused on:

- A clean, local-first UI for **Ollama**
- Minimal configuration
- Low visual and cognitive overhead
- Doing a small set of things well

If you want a **universal, highly configurable platform** → [open-webui](https://github.com/open-webui/open-webui) is a great choice.
If you want a **small, focused UI for local Ollama usage** → Vessel is built for that.

---

## Features

### Chat
- Real-time streaming responses with token metrics
- **Message branching** — edit any message to create alternative conversation paths
- Markdown rendering with syntax highlighting
- **Thinking mode** — native support for reasoning models (DeepSeek-R1, etc.)
- Dark/Light themes

### Projects & Organization
- **Projects** — group related conversations together
- Pin and archive conversations
- Smart title generation from conversation content
- **Global search** — semantic, title, and content search across all chats

### Knowledge Base (RAG)
- Upload documents (text, markdown, PDF) to build a knowledge base
- **Semantic search** using embeddings for context-aware retrieval
- Project-specific or global knowledge bases
- Automatic context injection into conversations

### Tools
- **5 built-in tools**: web search, URL fetching, calculator, location, time
- **Custom tools**: Create your own in JavaScript, Python, or HTTP
- Agentic tool calling with chain-of-thought reasoning
- Test tools before saving with the built-in testing panel

### Models
- Browse and pull models from ollama.com
- Create custom models with embedded system prompts
- **Per-model parameters** — customize temperature, context size, top_k/top_p
- Track model updates and capability detection (vision, tools, code)

### Prompts
- Save and organize system prompts
- Assign default prompts to specific models
- Capability-based auto-selection (vision, code, tools, thinking)

📖 **[Full documentation on the Wiki →](https://github.com/VikingOwl91/vessel/wiki)**

---

## Screenshots

<table>
  <tr>
    <td align="center" width="50%">
      <img src="screenshots/hero-dark.png" alt="Chat Interface">
      <br><em>Clean chat interface</em>
    </td>
    <td align="center" width="50%">
      <img src="screenshots/code-generation.png" alt="Code Generation">
      <br><em>Syntax-highlighted code</em>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="screenshots/web-search.png" alt="Web Search">
      <br><em>Integrated web search</em>
    </td>
    <td align="center" width="50%">
      <img src="screenshots/model-browser.png" alt="Model Browser">
      <br><em>Model browser</em>
    </td>
  </tr>
</table>

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Ollama](https://ollama.com/download) running locally

### Configure Ollama

Ollama must listen on all interfaces for Docker to connect:

```bash
# Option A: systemd (Linux)
sudo systemctl edit ollama
# Add: Environment="OLLAMA_HOST=0.0.0.0"
sudo systemctl restart ollama

# Option B: Manual
OLLAMA_HOST=0.0.0.0 ollama serve
```

### Install

```bash
# One-line install
curl -fsSL https://somegit.dev/vikingowl/vessel/raw/main/install.sh | bash

# Or clone and run
git clone https://github.com/VikingOwl91/vessel.git
cd vessel
./install.sh
```

Open **http://localhost:7842** in your browser.

### Update / Uninstall

```bash
./install.sh --update     # Update to latest
./install.sh --uninstall  # Remove
```

📖 **[Detailed installation guide →](https://github.com/VikingOwl91/vessel/wiki/Getting-Started)**

---

## Documentation

Full documentation is available on the **[GitHub Wiki](https://github.com/VikingOwl91/vessel/wiki)**:

| Guide | Description |
|-------|-------------|
| [Getting Started](https://github.com/VikingOwl91/vessel/wiki/Getting-Started) | Installation and configuration |
| [Projects](https://github.com/VikingOwl91/vessel/wiki/Projects) | Organize conversations into projects |
| [Knowledge Base](https://github.com/VikingOwl91/vessel/wiki/Knowledge-Base) | RAG with document upload and semantic search |
| [Search](https://github.com/VikingOwl91/vessel/wiki/Search) | Semantic and content search across chats |
| [Custom Tools](https://github.com/VikingOwl91/vessel/wiki/Custom-Tools) | Create JavaScript, Python, or HTTP tools |
| [System Prompts](https://github.com/VikingOwl91/vessel/wiki/System-Prompts) | Manage prompts with model defaults |
| [Custom Models](https://github.com/VikingOwl91/vessel/wiki/Custom-Models) | Create models with embedded prompts |
| [Built-in Tools](https://github.com/VikingOwl91/vessel/wiki/Built-in-Tools) | Reference for web search, calculator, etc. |
| [API Reference](https://github.com/VikingOwl91/vessel/wiki/API-Reference) | Backend endpoints |
| [Development](https://github.com/VikingOwl91/vessel/wiki/Development) | Contributing and architecture |
| [Troubleshooting](https://github.com/VikingOwl91/vessel/wiki/Troubleshooting) | Common issues and solutions |

---

## Roadmap

Vessel prioritizes **usability and simplicity** over feature breadth.

**Completed:**
- [x] Model browser with filtering and update detection
- [x] Custom tools (JavaScript, Python, HTTP)
- [x] System prompt library with model-specific defaults
- [x] Custom model creation with embedded prompts
- [x] Projects for conversation organization
- [x] Knowledge base with RAG (semantic retrieval)
- [x] Global search (semantic, title, content)
- [x] Thinking mode for reasoning models
- [x] Message branching and conversation trees

**Planned:**
- [ ] Keyboard-first workflows
- [ ] UX polish and stability improvements
- [ ] Optional voice input/output

**Non-Goals:**
- Multi-user systems
- Cloud sync
- Plugin ecosystems
- Support for every LLM runtime

> *Do one thing well. Keep the UI out of the way.*

---

## Contributing

Contributions are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push and open a Pull Request

📖 **[Development guide →](https://github.com/VikingOwl91/vessel/wiki/Development)**

**Issues:** [github.com/VikingOwl91/vessel/issues](https://github.com/VikingOwl91/vessel/issues)

---

## License

GPL-3.0 — See [LICENSE](LICENSE) for details.

<p align="center">
  Made with <a href="https://ollama.com">Ollama</a> and <a href="https://svelte.dev">Svelte</a>
</p>
