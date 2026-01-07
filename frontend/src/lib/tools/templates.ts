/**
 * Tool templates - Starter templates for custom tools
 */

import type { JSONSchema, ToolImplementation } from './types';

export interface ToolTemplate {
	id: string;
	name: string;
	description: string;
	category: 'api' | 'data' | 'utility' | 'integration' | 'agentic';
	language: ToolImplementation;
	code: string;
	parameters: JSONSchema;
}

export const toolTemplates: ToolTemplate[] = [
	// JavaScript Templates
	{
		id: 'js-api-fetch',
		name: 'API Request',
		description: 'Fetch data from an external REST API',
		category: 'api',
		language: 'javascript',
		code: `// Fetch data from an API endpoint
const response = await fetch(args.url, {
  method: args.method || 'GET',
  headers: {
    'Content-Type': 'application/json',
    ...(args.headers || {})
  },
  ...(args.body ? { body: JSON.stringify(args.body) } : {})
});

if (!response.ok) {
  throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
}

return await response.json();`,
		parameters: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'The API endpoint URL' },
				method: { type: 'string', description: 'HTTP method (GET, POST, etc.)' },
				headers: { type: 'object', description: 'Additional headers' },
				body: { type: 'object', description: 'Request body for POST/PUT' }
			},
			required: ['url']
		}
	},
	{
		id: 'js-json-transform',
		name: 'JSON Transform',
		description: 'Transform and filter JSON data',
		category: 'data',
		language: 'javascript',
		code: `// Transform JSON data
const data = args.data;
const fields = args.fields || Object.keys(data[0] || data);

// Handle both arrays and single objects
const items = Array.isArray(data) ? data : [data];

const result = items.map(item => {
  const filtered = {};
  for (const field of fields) {
    if (field in item) {
      filtered[field] = item[field];
    }
  }
  return filtered;
});

return Array.isArray(data) ? result : result[0];`,
		parameters: {
			type: 'object',
			properties: {
				data: { type: 'object', description: 'JSON data to transform' },
				fields: { type: 'array', description: 'Fields to keep (optional)' }
			},
			required: ['data']
		}
	},
	{
		id: 'js-string-utils',
		name: 'String Utilities',
		description: 'Common string manipulation operations',
		category: 'utility',
		language: 'javascript',
		code: `// String manipulation utilities
const text = args.text;
const operation = args.operation;

switch (operation) {
  case 'uppercase':
    return text.toUpperCase();
  case 'lowercase':
    return text.toLowerCase();
  case 'capitalize':
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  case 'reverse':
    return text.split('').reverse().join('');
  case 'word_count':
    return { count: text.split(/\\s+/).filter(w => w).length };
  case 'char_count':
    return { count: text.length };
  case 'slug':
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  default:
    return { text, error: 'Unknown operation' };
}`,
		parameters: {
			type: 'object',
			properties: {
				text: { type: 'string', description: 'Input text to process' },
				operation: { type: 'string', description: 'Operation: uppercase, lowercase, capitalize, reverse, word_count, char_count, slug' }
			},
			required: ['text', 'operation']
		}
	},
	{
		id: 'js-date-utils',
		name: 'Date Utilities',
		description: 'Date formatting and calculations',
		category: 'utility',
		language: 'javascript',
		code: `// Date utilities
const date = args.date ? new Date(args.date) : new Date();
const format = args.format || 'iso';

const formatDate = (d, fmt) => {
  const pad = n => String(n).padStart(2, '0');

  switch (fmt) {
    case 'iso':
      return d.toISOString();
    case 'date':
      return d.toLocaleDateString();
    case 'time':
      return d.toLocaleTimeString();
    case 'unix':
      return Math.floor(d.getTime() / 1000);
    case 'relative':
      const diff = Date.now() - d.getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 60) return \`\${mins} minutes ago\`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return \`\${hours} hours ago\`;
      return \`\${Math.floor(hours / 24)} days ago\`;
    default:
      return d.toISOString();
  }
};

return {
  formatted: formatDate(date, format),
  timestamp: date.getTime(),
  iso: date.toISOString()
};`,
		parameters: {
			type: 'object',
			properties: {
				date: { type: 'string', description: 'Date string or timestamp (default: now)' },
				format: { type: 'string', description: 'Format: iso, date, time, unix, relative' }
			}
		}
	},

	{
		id: 'js-design-brief',
		name: 'Design Brief Generator',
		description: 'Generate structured design briefs from project requirements',
		category: 'utility',
		language: 'javascript',
		code: `// Generate a structured design brief from requirements
const projectType = args.project_type || 'website';
const style = args.style_preferences || 'modern, clean';
const features = args.key_features || '';
const audience = args.target_audience || 'general users';
const brand = args.brand_keywords || '';

const brief = {
  project_type: projectType,
  design_direction: {
    style: style,
    mood: style.includes('playful') ? 'energetic and fun' :
          style.includes('corporate') ? 'professional and trustworthy' :
          style.includes('minimal') ? 'clean and focused' :
          'balanced and approachable',
    inspiration_keywords: [
      ...style.split(',').map(s => s.trim()),
      projectType,
      ...(brand ? brand.split(',').map(s => s.trim()) : [])
    ].filter(Boolean)
  },
  target_audience: audience,
  key_sections: features ? features.split(',').map(f => f.trim()) : [
    'Hero section with clear value proposition',
    'Features/Benefits overview',
    'Social proof or testimonials',
    'Call to action'
  ],
  ui_recommendations: {
    typography: style.includes('modern') ? 'Sans-serif (Inter, Geist, or similar)' :
                style.includes('elegant') ? 'Serif accents with sans-serif body' :
                'Clean sans-serif for readability',
    color_approach: style.includes('minimal') ? 'Monochromatic with single accent' :
                    style.includes('bold') ? 'High contrast with vibrant accents' :
                    'Balanced palette with primary and secondary colors',
    spacing: 'Generous whitespace for visual breathing room',
    imagery: style.includes('corporate') ? 'Professional photography or abstract graphics' :
             style.includes('playful') ? 'Illustrations or playful iconography' :
             'High-quality, contextual imagery'
  },
  accessibility_notes: [
    'Ensure 4.5:1 contrast ratio for text',
    'Include focus states for keyboard navigation',
    'Use semantic HTML structure',
    'Provide alt text for all images'
  ]
};

return brief;`,
		parameters: {
			type: 'object',
			properties: {
				project_type: {
					type: 'string',
					description: 'Type of project (landing page, dashboard, mobile app, e-commerce, portfolio, etc.)'
				},
				style_preferences: {
					type: 'string',
					description: 'Preferred style keywords (modern, minimal, playful, corporate, elegant, bold, etc.)'
				},
				key_features: {
					type: 'string',
					description: 'Comma-separated list of main features or sections needed'
				},
				target_audience: {
					type: 'string',
					description: 'Description of target users (developers, enterprise, consumers, etc.)'
				},
				brand_keywords: {
					type: 'string',
					description: 'Keywords that describe the brand personality'
				}
			},
			required: ['project_type']
		}
	},
	{
		id: 'js-color-palette',
		name: 'Color Palette Generator',
		description: 'Generate harmonious color palettes from a base color',
		category: 'utility',
		language: 'javascript',
		code: `// Generate color palette from base color
const hexToHsl = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
};

const hslToHex = (h, s, l) => {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
};

const baseColor = args.base_color || '#3b82f6';
const harmony = args.harmony || 'complementary';

const base = hexToHsl(baseColor);
const colors = { primary: baseColor };

switch (harmony) {
  case 'complementary':
    colors.secondary = hslToHex((base.h + 180) % 360, base.s, base.l);
    colors.accent = hslToHex((base.h + 30) % 360, base.s, base.l);
    break;
  case 'analogous':
    colors.secondary = hslToHex((base.h + 30) % 360, base.s, base.l);
    colors.accent = hslToHex((base.h - 30 + 360) % 360, base.s, base.l);
    break;
  case 'triadic':
    colors.secondary = hslToHex((base.h + 120) % 360, base.s, base.l);
    colors.accent = hslToHex((base.h + 240) % 360, base.s, base.l);
    break;
  case 'split-complementary':
    colors.secondary = hslToHex((base.h + 150) % 360, base.s, base.l);
    colors.accent = hslToHex((base.h + 210) % 360, base.s, base.l);
    break;
}

// Add neutrals
colors.background = hslToHex(base.h, 10, 98);
colors.surface = hslToHex(base.h, 10, 95);
colors.text = hslToHex(base.h, 10, 15);
colors.muted = hslToHex(base.h, 10, 45);

// Add primary shades
colors.primary_light = hslToHex(base.h, base.s, Math.min(base.l + 20, 95));
colors.primary_dark = hslToHex(base.h, base.s, Math.max(base.l - 20, 15));

return {
  harmony,
  palette: colors,
  css_variables: Object.entries(colors).map(([k, v]) => \`--color-\${k.replace('_', '-')}: \${v};\`).join('\\n')
};`,
		parameters: {
			type: 'object',
			properties: {
				base_color: {
					type: 'string',
					description: 'Base color in hex format (e.g., #3b82f6)'
				},
				harmony: {
					type: 'string',
					description: 'Color harmony: complementary, analogous, triadic, split-complementary'
				}
			},
			required: ['base_color']
		}
	},

	// Python Templates
	{
		id: 'py-api-fetch',
		name: 'API Request (Python)',
		description: 'Fetch data from an external REST API using Python',
		category: 'api',
		language: 'python',
		code: `# Fetch data from an API endpoint
import json
import urllib.request
import urllib.error

url = args.get('url')
method = args.get('method', 'GET')
headers = args.get('headers', {})
body = args.get('body')

req = urllib.request.Request(url, method=method)
req.add_header('Content-Type', 'application/json')
for key, value in headers.items():
    req.add_header(key, value)

data = json.dumps(body).encode() if body else None

try:
    with urllib.request.urlopen(req, data=data) as response:
        result = json.loads(response.read().decode())
        print(json.dumps(result))
except urllib.error.HTTPError as e:
    print(json.dumps({"error": f"HTTP {e.code}: {e.reason}"}))`,
		parameters: {
			type: 'object',
			properties: {
				url: { type: 'string', description: 'The API endpoint URL' },
				method: { type: 'string', description: 'HTTP method (GET, POST, etc.)' },
				headers: { type: 'object', description: 'Additional headers' },
				body: { type: 'object', description: 'Request body for POST/PUT' }
			},
			required: ['url']
		}
	},
	{
		id: 'py-data-analysis',
		name: 'Data Analysis (Python)',
		description: 'Basic statistical analysis of numeric data',
		category: 'data',
		language: 'python',
		code: `# Basic data analysis
import json
import math

data = args.get('data', [])
if not data:
    print(json.dumps({"error": "No data provided"}))
else:
    n = len(data)
    total = sum(data)
    mean = total / n

    sorted_data = sorted(data)
    mid = n // 2
    median = sorted_data[mid] if n % 2 else (sorted_data[mid-1] + sorted_data[mid]) / 2

    variance = sum((x - mean) ** 2 for x in data) / n
    std_dev = math.sqrt(variance)

    result = {
        "count": n,
        "sum": total,
        "mean": round(mean, 4),
        "median": median,
        "min": min(data),
        "max": max(data),
        "std_dev": round(std_dev, 4),
        "variance": round(variance, 4)
    }
    print(json.dumps(result))`,
		parameters: {
			type: 'object',
			properties: {
				data: { type: 'array', description: 'Array of numbers to analyze' }
			},
			required: ['data']
		}
	},
	{
		id: 'py-text-analysis',
		name: 'Text Analysis (Python)',
		description: 'Analyze text for word frequency, sentiment indicators',
		category: 'data',
		language: 'python',
		code: `# Text analysis
import json
import re
from collections import Counter

text = args.get('text', '')
top_n = args.get('top_n', 10)

# Tokenize and count
words = re.findall(r'\\b\\w+\\b', text.lower())
word_freq = Counter(words)

# Basic stats
sentences = re.split(r'[.!?]+', text)
sentences = [s.strip() for s in sentences if s.strip()]

result = {
    "word_count": len(words),
    "unique_words": len(word_freq),
    "sentence_count": len(sentences),
    "avg_word_length": round(sum(len(w) for w in words) / len(words), 2) if words else 0,
    "top_words": dict(word_freq.most_common(top_n)),
    "char_count": len(text),
    "char_count_no_spaces": len(text.replace(' ', ''))
}
print(json.dumps(result))`,
		parameters: {
			type: 'object',
			properties: {
				text: { type: 'string', description: 'Text to analyze' },
				top_n: { type: 'number', description: 'Number of top words to return (default: 10)' }
			},
			required: ['text']
		}
	},
	{
		id: 'py-hash-encode',
		name: 'Hash & Encode (Python)',
		description: 'Hash strings and encode/decode base64',
		category: 'utility',
		language: 'python',
		code: `# Hash and encoding utilities
import json
import hashlib
import base64

text = args.get('text', '')
operation = args.get('operation', 'md5')

result = {}

if operation == 'md5':
    result['hash'] = hashlib.md5(text.encode()).hexdigest()
elif operation == 'sha256':
    result['hash'] = hashlib.sha256(text.encode()).hexdigest()
elif operation == 'sha512':
    result['hash'] = hashlib.sha512(text.encode()).hexdigest()
elif operation == 'base64_encode':
    result['encoded'] = base64.b64encode(text.encode()).decode()
elif operation == 'base64_decode':
    try:
        result['decoded'] = base64.b64decode(text.encode()).decode()
    except Exception as e:
        result['error'] = str(e)
else:
    result['error'] = f'Unknown operation: {operation}'

result['operation'] = operation
result['input_length'] = len(text)

print(json.dumps(result))`,
		parameters: {
			type: 'object',
			properties: {
				text: { type: 'string', description: 'Text to process' },
				operation: { type: 'string', description: 'Operation: md5, sha256, sha512, base64_encode, base64_decode' }
			},
			required: ['text', 'operation']
		}
	},

	// Agentic Templates
	{
		id: 'js-task-manager',
		name: 'Task Manager',
		description: 'Create, update, list, and complete tasks with persistent storage',
		category: 'agentic',
		language: 'javascript',
		code: `// Task Manager with localStorage persistence
const STORAGE_KEY = 'vessel_agent_tasks';

const loadTasks = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
};

const saveTasks = (tasks) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
};

const action = args.action;
let tasks = loadTasks();

switch (action) {
  case 'create': {
    const task = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: args.title,
      description: args.description || '',
      priority: args.priority || 'medium',
      status: 'pending',
      created: new Date().toISOString(),
      due: args.due || null,
      tags: args.tags || []
    };
    tasks.push(task);
    saveTasks(tasks);
    return { success: true, task, message: 'Task created' };
  }

  case 'list': {
    let filtered = tasks;
    if (args.status) filtered = filtered.filter(t => t.status === args.status);
    if (args.priority) filtered = filtered.filter(t => t.priority === args.priority);
    if (args.tag) filtered = filtered.filter(t => t.tags?.includes(args.tag));
    return {
      tasks: filtered,
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      completed: tasks.filter(t => t.status === 'completed').length
    };
  }

  case 'update': {
    const idx = tasks.findIndex(t => t.id === args.id);
    if (idx === -1) return { error: 'Task not found' };
    if (args.title) tasks[idx].title = args.title;
    if (args.description !== undefined) tasks[idx].description = args.description;
    if (args.priority) tasks[idx].priority = args.priority;
    if (args.status) tasks[idx].status = args.status;
    if (args.due !== undefined) tasks[idx].due = args.due;
    if (args.tags) tasks[idx].tags = args.tags;
    tasks[idx].updated = new Date().toISOString();
    saveTasks(tasks);
    return { success: true, task: tasks[idx], message: 'Task updated' };
  }

  case 'complete': {
    const idx = tasks.findIndex(t => t.id === args.id);
    if (idx === -1) return { error: 'Task not found' };
    tasks[idx].status = 'completed';
    tasks[idx].completedAt = new Date().toISOString();
    saveTasks(tasks);
    return { success: true, task: tasks[idx], message: 'Task completed' };
  }

  case 'delete': {
    const idx = tasks.findIndex(t => t.id === args.id);
    if (idx === -1) return { error: 'Task not found' };
    const deleted = tasks.splice(idx, 1)[0];
    saveTasks(tasks);
    return { success: true, deleted, message: 'Task deleted' };
  }

  case 'clear_completed': {
    const before = tasks.length;
    tasks = tasks.filter(t => t.status !== 'completed');
    saveTasks(tasks);
    return { success: true, removed: before - tasks.length, remaining: tasks.length };
  }

  default:
    return { error: 'Unknown action. Use: create, list, update, complete, delete, clear_completed' };
}`,
		parameters: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					description: 'Action: create, list, update, complete, delete, clear_completed'
				},
				id: { type: 'string', description: 'Task ID (for update/complete/delete)' },
				title: { type: 'string', description: 'Task title (for create/update)' },
				description: { type: 'string', description: 'Task description' },
				priority: { type: 'string', description: 'Priority: low, medium, high, urgent' },
				status: { type: 'string', description: 'Filter/set status: pending, in_progress, completed' },
				due: { type: 'string', description: 'Due date (ISO format)' },
				tags: { type: 'array', description: 'Tags for categorization' },
				tag: { type: 'string', description: 'Filter by tag (for list)' }
			},
			required: ['action']
		}
	},
	{
		id: 'js-memory-store',
		name: 'Memory Store',
		description: 'Store and recall information across conversation turns',
		category: 'agentic',
		language: 'javascript',
		code: `// Memory Store - persistent key-value storage for agent context
const STORAGE_KEY = 'vessel_agent_memory';

const loadMemory = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch { return {}; }
};

const saveMemory = (mem) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mem));
};

const action = args.action;
let memory = loadMemory();

switch (action) {
  case 'store': {
    const key = args.key;
    const value = args.value;
    const category = args.category || 'general';

    // Validate required fields
    if (!key) return { error: 'Key is required for store action' };
    if (value === undefined || value === null) return { error: 'Value is required for store action' };

    if (!memory[category]) memory[category] = {};
    memory[category][key] = {
      value,
      stored: new Date().toISOString(),
      accessCount: 0
    };
    saveMemory(memory);
    return { success: true, key, category, value, message: 'Memory stored' };
  }

  case 'recall': {
    const key = args.key;
    const category = args.category;

    if (category && key) {
      const item = memory[category]?.[key];
      if (!item) return { found: false, key, category };
      item.accessCount++;
      item.lastAccess = new Date().toISOString();
      saveMemory(memory);
      return { found: true, key, category, value: item.value, stored: item.stored };
    }

    if (category) {
      // Return formatted entries for category (consistent with list)
      const items = memory[category] || {};
      const entries = Object.entries(items).map(([k, data]) => ({
        key: k,
        value: data.value,
        stored: data.stored
      }));
      return { found: entries.length > 0, category, entries, count: entries.length };
    }

    if (key) {
      // Search across all categories
      for (const cat in memory) {
        if (memory[cat][key]) {
          memory[cat][key].accessCount++;
          saveMemory(memory);
          return { found: true, key, category: cat, value: memory[cat][key].value };
        }
      }
      return { found: false, key };
    }

    // No key or category provided - return all memories (like list)
    const allMemories = {};
    for (const cat in memory) {
      allMemories[cat] = Object.entries(memory[cat]).map(([k, data]) => ({
        key: k,
        value: data.value,
        stored: data.stored
      }));
    }
    return {
      memories: allMemories,
      totalCategories: Object.keys(memory).length,
      totalEntries: Object.values(memory).reduce((sum, cat) => sum + Object.keys(cat).length, 0)
    };
  }

  case 'list': {
    const category = args.category;
    if (category) {
      const items = memory[category] || {};
      const entries = Object.entries(items).map(([key, data]) => ({
        key,
        value: data.value,
        stored: data.stored
      }));
      return {
        category,
        entries,
        count: entries.length
      };
    }
    // List all categories with their entries
    const allMemories = {};
    for (const cat in memory) {
      allMemories[cat] = Object.entries(memory[cat]).map(([key, data]) => ({
        key,
        value: data.value,
        stored: data.stored
      }));
    }
    return {
      memories: allMemories,
      totalCategories: Object.keys(memory).length,
      totalEntries: Object.values(memory).reduce((sum, cat) => sum + Object.keys(cat).length, 0)
    };
  }

  case 'forget': {
    const key = args.key;
    const category = args.category;

    if (category && key) {
      if (memory[category]?.[key]) {
        delete memory[category][key];
        if (Object.keys(memory[category]).length === 0) delete memory[category];
        saveMemory(memory);
        return { success: true, forgotten: key, category };
      }
      return { error: 'Memory not found', key, category };
    }

    if (category) {
      if (!memory[category]) {
        return { error: 'Category not found', category };
      }
      const count = Object.keys(memory[category]).length;
      delete memory[category];
      saveMemory(memory);
      return { success: true, forgotten: category, type: 'category', entriesRemoved: count };
    }

    return { error: 'Provide key and/or category to forget' };
  }

  case 'clear': {
    const before = Object.keys(memory).length;
    memory = {};
    saveMemory(memory);
    return { success: true, cleared: before, message: 'All memory cleared' };
  }

  default:
    return { error: 'Unknown action. Use: store, recall, list, forget, clear' };
}`,
		parameters: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					description: 'Action: store, recall, list, forget, clear'
				},
				key: { type: 'string', description: 'Memory key/identifier' },
				value: { type: 'string', description: 'Value to store (for store action)' },
				category: { type: 'string', description: 'Category for organizing memories (facts, preferences, context, etc.)' }
			},
			required: ['action']
		}
	},
	{
		id: 'js-think-step-by-step',
		name: 'Structured Thinking',
		description: 'Break down problems into explicit reasoning steps',
		category: 'agentic',
		language: 'javascript',
		code: `// Structured Thinking - explicit step-by-step reasoning
const problem = args.problem;
const steps = args.steps || [];
const conclusion = args.conclusion;
const confidence = args.confidence || 'medium';

const analysis = {
  problem: problem,
  reasoning: {
    steps: steps.map((step, i) => ({
      step: i + 1,
      thought: step,
      type: step.toLowerCase().includes('assume') ? 'assumption' :
            step.toLowerCase().includes('if') ? 'conditional' :
            step.toLowerCase().includes('because') ? 'justification' :
            step.toLowerCase().includes('therefore') ? 'inference' :
            'observation'
    })),
    stepCount: steps.length
  },
  conclusion: conclusion,
  confidence: confidence,
  confidenceScore: confidence === 'high' ? 0.9 :
                   confidence === 'medium' ? 0.7 :
                   confidence === 'low' ? 0.4 : 0.5,
  metadata: {
    hasAssumptions: steps.some(s => s.toLowerCase().includes('assume')),
    hasConditionals: steps.some(s => s.toLowerCase().includes('if')),
    timestamp: new Date().toISOString()
  }
};

// Add quality indicators
analysis.quality = {
  hasMultipleSteps: steps.length >= 3,
  hasConclusion: !!conclusion,
  isWellStructured: steps.length >= 2 && !!conclusion,
  suggestions: []
};

if (steps.length < 2) {
  analysis.quality.suggestions.push('Consider breaking down into more steps');
}
if (!conclusion) {
  analysis.quality.suggestions.push('Add a clear conclusion');
}
if (confidence === 'low') {
  analysis.quality.suggestions.push('Identify what additional information would increase confidence');
}

return analysis;`,
		parameters: {
			type: 'object',
			properties: {
				problem: {
					type: 'string',
					description: 'The problem or question to reason about'
				},
				steps: {
					type: 'array',
					description: 'Array of reasoning steps, each a string explaining one step of thought'
				},
				conclusion: {
					type: 'string',
					description: 'The final conclusion reached'
				},
				confidence: {
					type: 'string',
					description: 'Confidence level: low, medium, high'
				}
			},
			required: ['problem', 'steps']
		}
	},
	{
		id: 'js-decision-matrix',
		name: 'Decision Matrix',
		description: 'Evaluate options against weighted criteria for better decisions',
		category: 'agentic',
		language: 'javascript',
		code: `// Decision Matrix - weighted multi-criteria decision analysis
const options = args.options || [];
const criteria = args.criteria || [];
const scores = args.scores || {};

if (options.length === 0) {
  return { error: 'Provide at least one option' };
}
if (criteria.length === 0) {
  return { error: 'Provide at least one criterion with name and weight' };
}

// Normalize weights
const totalWeight = criteria.reduce((sum, c) => sum + (c.weight || 1), 0);
const normalizedCriteria = criteria.map(c => ({
  name: c.name,
  weight: (c.weight || 1) / totalWeight,
  originalWeight: c.weight || 1
}));

// Calculate weighted scores for each option
const results = options.map(option => {
  let totalScore = 0;
  const breakdown = [];

  for (const criterion of normalizedCriteria) {
    const score = scores[option]?.[criterion.name] ?? 5; // Default to 5/10
    const weighted = score * criterion.weight;
    totalScore += weighted;
    breakdown.push({
      criterion: criterion.name,
      rawScore: score,
      weight: Math.round(criterion.weight * 100) + '%',
      weightedScore: Math.round(weighted * 100) / 100
    });
  }

  return {
    option,
    totalScore: Math.round(totalScore * 100) / 100,
    maxPossible: 10,
    percentage: Math.round(totalScore * 10) + '%',
    breakdown
  };
});

// Sort by score
results.sort((a, b) => b.totalScore - a.totalScore);

// Identify winner and insights
const winner = results[0];
const runnerUp = results[1];
const margin = runnerUp ? Math.round((winner.totalScore - runnerUp.totalScore) * 100) / 100 : null;

return {
  recommendation: winner.option,
  confidence: margin > 1.5 ? 'high' : margin > 0.5 ? 'medium' : 'low',
  margin: margin,
  rankings: results,
  criteria: normalizedCriteria.map(c => ({
    name: c.name,
    weight: Math.round(c.weight * 100) + '%'
  })),
  insight: margin && margin < 0.5 ?
    'Options are very close - consider additional criteria or qualitative factors' :
    margin && margin > 2 ?
    \`\${winner.option} is a clear winner with significant margin\` :
    'Decision is reasonably clear but review the breakdown for nuance'
};`,
		parameters: {
			type: 'object',
			properties: {
				options: {
					type: 'array',
					description: 'Array of option names to evaluate (e.g., ["Option A", "Option B"])'
				},
				criteria: {
					type: 'array',
					description: 'Array of criteria objects with name and weight (e.g., [{"name": "Cost", "weight": 3}, {"name": "Quality", "weight": 2}])'
				},
				scores: {
					type: 'object',
					description: 'Scores object: { "Option A": { "Cost": 8, "Quality": 7 }, "Option B": { "Cost": 6, "Quality": 9 } }'
				}
			},
			required: ['options', 'criteria', 'scores']
		}
	},
	{
		id: 'js-project-planner',
		name: 'Project Planner',
		description: 'Break down projects into phases, tasks, and dependencies',
		category: 'agentic',
		language: 'javascript',
		code: `// Project Planner - decompose projects into actionable plans
const projectName = args.project_name;
const goal = args.goal;
const phases = args.phases || [];
const constraints = args.constraints || [];

if (!projectName || !goal) {
  return { error: 'Provide project_name and goal' };
}

const plan = {
  project: projectName,
  goal: goal,
  created: new Date().toISOString(),
  constraints: constraints,
  phases: phases.map((phase, phaseIdx) => ({
    id: \`phase-\${phaseIdx + 1}\`,
    name: phase.name,
    description: phase.description || '',
    order: phaseIdx + 1,
    tasks: (phase.tasks || []).map((task, taskIdx) => ({
      id: \`\${phaseIdx + 1}.\${taskIdx + 1}\`,
      title: task.title || task,
      description: task.description || '',
      dependencies: task.dependencies || [],
      status: 'pending',
      priority: task.priority || 'medium'
    })),
    deliverables: phase.deliverables || []
  })),
  summary: {
    totalPhases: phases.length,
    totalTasks: phases.reduce((sum, p) => sum + (p.tasks?.length || 0), 0),
    hasConstraints: constraints.length > 0
  }
};

// Identify critical path (tasks with most dependents)
const allTasks = plan.phases.flatMap(p => p.tasks);
const dependencyCounts = {};
allTasks.forEach(t => {
  t.dependencies.forEach(dep => {
    dependencyCounts[dep] = (dependencyCounts[dep] || 0) + 1;
  });
});

plan.criticalTasks = Object.entries(dependencyCounts)
  .filter(([_, count]) => count > 1)
  .map(([id, count]) => ({ taskId: id, dependentCount: count }))
  .sort((a, b) => b.dependentCount - a.dependentCount);

// Generate next actions (tasks with no pending dependencies)
const completedTasks = new Set();
plan.nextActions = allTasks
  .filter(t => t.dependencies.every(d => completedTasks.has(d)))
  .slice(0, 5)
  .map(t => ({ id: t.id, title: t.title, phase: t.id.split('.')[0] }));

// Validation
plan.validation = {
  isValid: phases.length > 0 && plan.summary.totalTasks > 0,
  warnings: []
};

if (phases.length === 0) {
  plan.validation.warnings.push('No phases defined');
}
if (plan.summary.totalTasks === 0) {
  plan.validation.warnings.push('No tasks defined');
}
if (constraints.length === 0) {
  plan.validation.warnings.push('Consider adding constraints (time, budget, resources)');
}

return plan;`,
		parameters: {
			type: 'object',
			properties: {
				project_name: {
					type: 'string',
					description: 'Name of the project'
				},
				goal: {
					type: 'string',
					description: 'The main goal or outcome of the project'
				},
				phases: {
					type: 'array',
					description: 'Array of phase objects: [{ name, description, tasks: [{ title, dependencies, priority }], deliverables }]'
				},
				constraints: {
					type: 'array',
					description: 'Array of constraints (e.g., ["Budget: $10k", "Timeline: 2 weeks"])'
				}
			},
			required: ['project_name', 'goal']
		}
	}
];

export function getTemplatesByLanguage(language: ToolImplementation): ToolTemplate[] {
	return toolTemplates.filter(t => t.language === language);
}

export function getTemplatesByCategory(category: ToolTemplate['category']): ToolTemplate[] {
	return toolTemplates.filter(t => t.category === category);
}

export function getTemplateById(id: string): ToolTemplate | undefined {
	return toolTemplates.find(t => t.id === id);
}
