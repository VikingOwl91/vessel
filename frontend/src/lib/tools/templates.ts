/**
 * Tool templates - Starter templates for custom tools
 */

import type { JSONSchema, ToolImplementation } from './types';

export interface ToolTemplate {
	id: string;
	name: string;
	description: string;
	category: 'api' | 'data' | 'utility' | 'integration';
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
