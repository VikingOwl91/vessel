/**
 * Built-in tools that come with the application
 */

import type { ToolDefinition, BuiltinToolHandler, ToolRegistryEntry } from './types.js';

// ============================================================================
// Get Current Time Tool
// ============================================================================

interface GetTimeArgs {
	timezone?: string;
	format?: 'iso' | 'locale' | 'unix';
}

const getTimeDefinition: ToolDefinition = {
	type: 'function',
	function: {
		name: 'get_current_time',
		description: 'Returns the current date and time. Use when you need to know what time or date it is now.',
		parameters: {
			type: 'object',
			properties: {
				timezone: {
					type: 'string',
					description: 'Optional IANA timezone (e.g., "America/New_York", "Europe/Berlin"). Defaults to local.'
				},
				format: {
					type: 'string',
					description: 'Output format: "iso" (default), "locale", or "unix" timestamp.',
					enum: ['iso', 'locale', 'unix']
				}
			}
		}
	}
};

const getTimeHandler: BuiltinToolHandler<GetTimeArgs> = (args) => {
	const now = new Date();
	const format = args.format ?? 'iso';

	try {
		if (args.timezone) {
			const options: Intl.DateTimeFormatOptions = {
				timeZone: args.timezone,
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: false
			};

			if (format === 'locale') {
				return new Intl.DateTimeFormat('en-US', {
					...options,
					dateStyle: 'full',
					timeStyle: 'long'
				}).format(now);
			}

			const formatter = new Intl.DateTimeFormat('en-CA', options);
			const parts = formatter.formatToParts(now);
			const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
			return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
		}

		switch (format) {
			case 'unix':
				return Math.floor(now.getTime() / 1000);
			case 'locale':
				return now.toLocaleString();
			case 'iso':
			default:
				return now.toISOString();
		}
	} catch {
		return { error: `Invalid timezone: ${args.timezone}` };
	}
};

// ============================================================================
// Calculate Tool (Safe Math Expression Parser)
// ============================================================================

interface CalculateArgs {
	expression: string;
	precision?: number;
}

const calculateDefinition: ToolDefinition = {
	type: 'function',
	function: {
		name: 'calculate',
		description: 'Evaluates a math expression and returns the numeric result. Use for any calculations, unit conversions, or math problems. Supports: +, -, *, /, %, ^ (power). Functions: sqrt, abs, sign, sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, asinh, acosh, atanh, log, log10, log2, exp, round, floor, ceil, trunc. Constants: PI, E, TAU, PHI, LN2, LN10.',
		parameters: {
			type: 'object',
			properties: {
				expression: {
					type: 'string',
					description: 'Math expression to evaluate. Examples: "2+2", "sqrt(16)", "sin(PI/2)", "log2(1024)", "atan(1)*4"'
				},
				precision: {
					type: 'number',
					description: 'Decimal places in result (default: 10)'
				}
			},
			required: ['expression']
		}
	}
};

/**
 * Safe math expression parser using recursive descent
 * Parses and computes expressions without using dynamic code execution
 */
class MathParser {
	private pos = 0;
	private expr = '';

	private readonly functions: Record<string, (x: number) => number> = {
		// Basic
		sqrt: Math.sqrt,
		abs: Math.abs,
		sign: Math.sign,
		// Trigonometric
		sin: Math.sin,
		cos: Math.cos,
		tan: Math.tan,
		// Inverse trigonometric
		asin: Math.asin,
		acos: Math.acos,
		atan: Math.atan,
		// Hyperbolic
		sinh: Math.sinh,
		cosh: Math.cosh,
		tanh: Math.tanh,
		asinh: Math.asinh,
		acosh: Math.acosh,
		atanh: Math.atanh,
		// Logarithmic & exponential
		log: Math.log,
		log10: Math.log10,
		log2: Math.log2,
		exp: Math.exp,
		// Rounding
		round: Math.round,
		floor: Math.floor,
		ceil: Math.ceil,
		trunc: Math.trunc
	};

	private readonly constants: Record<string, number> = {
		PI: Math.PI,
		pi: Math.PI,
		E: Math.E,
		e: Math.E,
		TAU: Math.PI * 2,
		tau: Math.PI * 2,
		PHI: (1 + Math.sqrt(5)) / 2, // Golden ratio
		phi: (1 + Math.sqrt(5)) / 2,
		LN2: Math.LN2,
		LN10: Math.LN10
	};

	parse(expression: string): number {
		this.expr = expression.replace(/\s+/g, '');
		this.pos = 0;
		const result = this.parseExpression();
		if (this.pos < this.expr.length) {
			throw new Error(`Unexpected character at position ${this.pos}: ${this.expr[this.pos]}`);
		}
		return result;
	}

	private parseExpression(): number {
		return this.parseAddSub();
	}

	private parseAddSub(): number {
		let left = this.parseMulDiv();
		while (this.pos < this.expr.length) {
			const op = this.expr[this.pos];
			if (op === '+') {
				this.pos++;
				left = left + this.parseMulDiv();
			} else if (op === '-') {
				this.pos++;
				left = left - this.parseMulDiv();
			} else {
				break;
			}
		}
		return left;
	}

	private parseMulDiv(): number {
		let left = this.parsePower();
		while (this.pos < this.expr.length) {
			const op = this.expr[this.pos];
			if (op === '*') {
				this.pos++;
				left = left * this.parsePower();
			} else if (op === '/') {
				this.pos++;
				const right = this.parsePower();
				if (right === 0) throw new Error('Division by zero');
				left = left / right;
			} else if (op === '%') {
				this.pos++;
				left = left % this.parsePower();
			} else {
				break;
			}
		}
		return left;
	}

	private parsePower(): number {
		const left = this.parseUnary();
		if (this.pos < this.expr.length && (this.expr[this.pos] === '^' || this.expr.slice(this.pos, this.pos + 2) === '**')) {
			if (this.expr[this.pos] === '^') {
				this.pos++;
			} else {
				this.pos += 2;
			}
			return Math.pow(left, this.parsePower());
		}
		return left;
	}

	private parseUnary(): number {
		if (this.expr[this.pos] === '-') {
			this.pos++;
			return -this.parseUnary();
		}
		if (this.expr[this.pos] === '+') {
			this.pos++;
			return this.parseUnary();
		}
		return this.parsePrimary();
	}

	private parsePrimary(): number {
		if (this.expr[this.pos] === '(') {
			this.pos++;
			const result = this.parseExpression();
			if (this.expr[this.pos] !== ')') {
				throw new Error('Missing closing parenthesis');
			}
			this.pos++;
			return result;
		}

		const funcMatch = this.expr.slice(this.pos).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
		if (funcMatch) {
			const name = funcMatch[1];
			this.pos += name.length;

			if (this.constants[name] !== undefined) {
				return this.constants[name];
			}

			const fn = this.functions[name.toLowerCase()];
			if (!fn) {
				throw new Error(`Unknown function or constant: ${name}`);
			}

			if (this.expr[this.pos] !== '(') {
				throw new Error(`Expected '(' after function ${name}`);
			}
			this.pos++;
			const arg = this.parseExpression();
			if (this.expr[this.pos] !== ')') {
				throw new Error('Missing closing parenthesis for function');
			}
			this.pos++;
			return fn(arg);
		}

		const numMatch = this.expr.slice(this.pos).match(/^(\d+\.?\d*|\.\d+)/);
		if (numMatch) {
			this.pos += numMatch[1].length;
			return parseFloat(numMatch[1]);
		}

		throw new Error(`Unexpected character at position ${this.pos}: ${this.expr[this.pos] || 'end of expression'}`);
	}
}

const mathParser = new MathParser();

const calculateHandler: BuiltinToolHandler<CalculateArgs> = (args) => {
	const { expression, precision = 10 } = args;

	try {
		const result = mathParser.parse(expression);

		if (typeof result !== 'number' || !isFinite(result)) {
			return { error: 'Expression resulted in invalid number (infinity or NaN)' };
		}

		return Number(result.toFixed(precision));
	} catch (error) {
		return { error: `Failed to compute expression: ${error instanceof Error ? error.message : 'Unknown error'}` };
	}
};

// ============================================================================
// Fetch URL Tool (Web Content Retrieval)
// ============================================================================

interface FetchUrlArgs {
	url: string;
	extract?: 'text' | 'title' | 'links' | 'all';
	maxLength?: number;
	timeout?: number;
}

const fetchUrlDefinition: ToolDefinition = {
	type: 'function',
	function: {
		name: 'fetch_url',
		description: 'Fetches and reads content from a URL. If content is truncated, you can retry with a larger maxLength. Use after web_search to read full content, or when user provides a URL directly.',
		parameters: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description: 'The URL to fetch (e.g., "https://example.com/page")'
				},
				extract: {
					type: 'string',
					description: 'What to extract: "text" (default), "title", "links", or "all"',
					enum: ['text', 'title', 'links', 'all']
				},
				maxLength: {
					type: 'number',
					description: 'Max content length in bytes. Start with 50000, increase to 200000 or 500000 if truncated. Max: 2000000'
				},
				timeout: {
					type: 'number',
					description: 'Request timeout in seconds (default: 30, max: 120). Increase for slow sites.'
				}
			},
			required: ['url']
		}
	}
};

interface ProxyFetchResult {
	html: string;
	finalUrl: string;
	truncated?: boolean;
	originalSize?: number;
	returnedSize?: number;
}

/**
 * Try to fetch URL via backend proxy first (bypasses CORS), fall back to direct fetch
 */
async function fetchViaProxy(url: string, maxLength: number, timeout: number): Promise<ProxyFetchResult | { error: string }> {
	// Try backend proxy first
	try {
		const proxyResponse = await fetch('/api/v1/proxy/fetch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url, maxLength, timeout })
		});

		if (proxyResponse.ok) {
			const data = await proxyResponse.json();
			return {
				html: data.content,
				finalUrl: data.url,
				truncated: data.truncated,
				originalSize: data.originalSize,
				returnedSize: data.returnedSize
			};
		}

		// If proxy returns an error, extract it
		const errorData = await proxyResponse.json().catch(() => null);
		if (errorData?.error) {
			return { error: errorData.error };
		}
	} catch {
		// Proxy not available, try direct fetch
	}

	// Fall back to direct fetch (may fail due to CORS)
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10000);

		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
			}
		});

		clearTimeout(timeout);

		if (!response.ok) {
			return { error: `HTTP ${response.status}: ${response.statusText}` };
		}

		const html = await response.text();
		return { html, finalUrl: response.url };
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			return { error: 'Request timed out after 10 seconds' };
		}
		// Provide helpful error message for CORS issues
		const message = error instanceof Error ? error.message : 'Unknown error';
		if (message.includes('NetworkError') || message.includes('CORS')) {
			return { error: `Cannot fetch external URL due to browser security restrictions. The backend proxy is not available. Start the backend server to enable URL fetching.` };
		}
		return { error: `Failed to fetch URL: ${message}` };
	}
}

const fetchUrlHandler: BuiltinToolHandler<FetchUrlArgs> = async (args) => {
	const { url, extract = 'text', maxLength = 50000, timeout = 30 } = args;

	try {
		const parsedUrl = new URL(url);
		if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
			return { error: 'Only HTTP and HTTPS URLs are supported' };
		}

		// Fetch via proxy or direct
		const result = await fetchViaProxy(url, maxLength, timeout);
		if ('error' in result) {
			return result;
		}

		const { html, finalUrl, truncated, originalSize, returnedSize } = result;

		const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
		const title = titleMatch ? titleMatch[1].trim() : null;

		if (extract === 'title') {
			return title ?? 'No title found';
		}

		const stripHtml = (str: string) => {
			return str
				.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
				.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
		};

		const linkMatches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi)];
		const links = linkMatches.slice(0, 50).map(match => ({
			url: match[1],
			text: match[2].trim()
		})).filter(link => link.url && !link.url.startsWith('#'));

		if (extract === 'links') {
			return truncated
				? { links, warning: `Content was truncated (${returnedSize ?? maxLength} bytes). Some links may be missing.` }
				: links;
		}

		const text = stripHtml(html).substring(0, maxLength);

		// Build response with truncation info
		const buildResponse = (data: unknown) => {
			if (!truncated) return data;
			const suggestedSize = originalSize ? Math.min(originalSize * 2, 2000000) : maxLength * 2;
			return {
				...(typeof data === 'object' ? data : { content: data }),
				_truncated: true,
				_hint: `Content truncated to ${returnedSize ?? maxLength} bytes. ${originalSize ? `Original was ${originalSize} bytes. ` : ''}Retry with larger maxLength (e.g., ${suggestedSize}) to get full content.`
			};
		};

		if (extract === 'text') {
			return buildResponse(text);
		}

		return buildResponse({
			title,
			text,
			links: links.slice(0, 20),
			url: finalUrl
		});
	} catch (error) {
		return { error: `Failed to fetch URL: ${error instanceof Error ? error.message : 'Unknown error'}` };
	}
};

// ============================================================================
// Get Location Tool
// ============================================================================

interface GetLocationArgs {
	highAccuracy?: boolean;
}

interface LocationResult {
	latitude: number;
	longitude: number;
	accuracy: number;
	city?: string;
	country?: string;
}

const getLocationDefinition: ToolDefinition = {
	type: 'function',
	function: {
		name: 'get_location',
		description: 'ALWAYS call this first when user asks about weather, local news, nearby places, or anything location-dependent WITHOUT specifying a city. Automatically detects user\'s city via GPS or IP. Only ask user for location if this tool returns an error.',
		parameters: {
			type: 'object',
			properties: {
				highAccuracy: {
					type: 'boolean',
					description: 'Request high accuracy GPS (slower). Default: false'
				}
			}
		}
	}
};

/**
 * Try IP-based geolocation via backend as fallback
 */
async function tryIPGeolocation(): Promise<LocationResult | null> {
	try {
		const response = await fetch('/api/v1/location');
		if (!response.ok) return null;

		const data = await response.json();
		if (!data.success) return null;

		return {
			latitude: data.latitude,
			longitude: data.longitude,
			accuracy: -1, // IP geolocation has no accuracy metric
			city: data.city,
			country: data.country
		};
	} catch {
		return null;
	}
}

const getLocationHandler: BuiltinToolHandler<GetLocationArgs> = async (args) => {
	const { highAccuracy = false } = args;

	// Try browser geolocation first (most accurate)
	if (navigator.geolocation) {
		try {
			const position = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, {
					enableHighAccuracy: highAccuracy,
					timeout: 15000, // 15 seconds for browser geolocation
					maximumAge: 300000 // Cache for 5 minutes
				});
			});

			const result: LocationResult = {
				latitude: position.coords.latitude,
				longitude: position.coords.longitude,
				accuracy: Math.round(position.coords.accuracy)
			};

			// Try to get city/country via reverse geocoding (using a free service)
			try {
				const geoResponse = await fetch(
					`https://nominatim.openstreetmap.org/reverse?lat=${result.latitude}&lon=${result.longitude}&format=json`,
					{
						headers: {
							'User-Agent': 'OllamaWebUI/1.0'
						}
					}
				);

				if (geoResponse.ok) {
					const geoData = await geoResponse.json();
					if (geoData.address) {
						result.city = geoData.address.city || geoData.address.town || geoData.address.village || geoData.address.municipality;
						result.country = geoData.address.country;
					}
				}
			} catch {
				// Reverse geocoding failed, but we still have coordinates
			}

			return {
				location: result,
				source: 'gps',
				message: result.city
					? `User is located in ${result.city}${result.country ? ', ' + result.country : ''}`
					: `User is at coordinates ${result.latitude.toFixed(4)}, ${result.longitude.toFixed(4)}`
			};
		} catch {
			// Browser geolocation failed, try IP fallback
		}
	}

	// Fallback: IP-based geolocation via backend
	const ipResult = await tryIPGeolocation();
	if (ipResult) {
		return {
			location: ipResult,
			source: 'ip',
			message: ipResult.city
				? `User is approximately located in ${ipResult.city}${ipResult.country ? ', ' + ipResult.country : ''} (based on IP address)`
				: `Could not determine city from IP address`
		};
	}

	// Both methods failed
	return {
		error: 'Could not determine location (browser geolocation unavailable and backend not reachable)',
		suggestion: 'Ask the user for their city/location directly, then use web_search with that location.'
	};
};

// ============================================================================
// Web Search Tool
// ============================================================================

interface WebSearchArgs {
	query: string;
	maxResults?: number;
	site?: string;
	freshness?: 'day' | 'week' | 'month' | 'year';
	region?: string;
	timeout?: number;
}

interface WebSearchResult {
	title: string;
	url: string;
	snippet: string;
}

const webSearchDefinition: ToolDefinition = {
	type: 'function',
	function: {
		name: 'web_search',
		description: 'Searches the internet and returns results with titles, URLs, and snippets. Use for weather, news, current events, facts, prices, or any real-time information. Include location in query for local results. Can call fetch_url on result URLs to get full content.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'The search query (e.g., "weather Berlin tomorrow", "latest news", "Bitcoin price")'
				},
				maxResults: {
					type: 'number',
					description: 'Maximum number of results to return (1-10, default 5)'
				},
				site: {
					type: 'string',
					description: 'Limit search to a specific site (e.g., "reddit.com", "stackoverflow.com", "github.com")'
				},
				freshness: {
					type: 'string',
					description: 'Filter by recency: "day" (last 24h), "week", "month", or "year"',
					enum: ['day', 'week', 'month', 'year']
				},
				region: {
					type: 'string',
					description: 'Region for localized results (e.g., "us-en", "de-de", "uk-en", "fr-fr")'
				},
				timeout: {
					type: 'number',
					description: 'Request timeout in seconds (default: 20, max: 60)'
				}
			},
			required: ['query']
		}
	}
};

const webSearchHandler: BuiltinToolHandler<WebSearchArgs> = async (args) => {
	const { query, maxResults = 5, site, freshness, region, timeout } = args;

	if (!query || query.trim() === '') {
		return { error: 'Search query is required' };
	}

	// Try backend proxy first
	try {
		const proxyResponse = await fetch('/api/v1/proxy/search', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query,
				maxResults: Math.min(Math.max(1, maxResults), 10),
				site,
				freshness,
				region,
				timeout
			})
		});

		if (proxyResponse.ok) {
			const data = await proxyResponse.json();
			const results = data.results as WebSearchResult[];

			if (results.length === 0) {
				return { message: 'No search results found for the query.', query };
			}

			// Format results for the AI
			return {
				query,
				resultCount: results.length,
				results: results.map((r, i) => ({
					rank: i + 1,
					title: r.title,
					url: r.url,
					snippet: r.snippet || '(no snippet available)'
				}))
			};
		}

		// If proxy returns an error, extract it
		const errorData = await proxyResponse.json().catch(() => null);
		if (errorData?.error) {
			return { error: errorData.error };
		}
	} catch {
		// Proxy not available
	}

	return {
		error: 'Web search is not available. Please start the backend server to enable web search functionality.',
		hint: 'Run the backend server with: cd backend && go run cmd/server/main.go'
	};
};

// ============================================================================
// Registry of Built-in Tools
// ============================================================================

export const builtinTools: Map<string, ToolRegistryEntry> = new Map([
	['get_current_time', {
		definition: getTimeDefinition,
		handler: getTimeHandler as unknown as BuiltinToolHandler,
		isBuiltin: true
	}],
	['calculate', {
		definition: calculateDefinition,
		handler: calculateHandler as unknown as BuiltinToolHandler,
		isBuiltin: true
	}],
	['fetch_url', {
		definition: fetchUrlDefinition,
		handler: fetchUrlHandler as unknown as BuiltinToolHandler,
		isBuiltin: true
	}],
	['get_location', {
		definition: getLocationDefinition,
		handler: getLocationHandler as unknown as BuiltinToolHandler,
		isBuiltin: true
	}],
	['web_search', {
		definition: webSearchDefinition,
		handler: webSearchHandler as unknown as BuiltinToolHandler,
		isBuiltin: true
	}]
]);

/** Get all built-in tool definitions for Ollama API */
export function getBuiltinToolDefinitions(): ToolDefinition[] {
	return Array.from(builtinTools.values()).map(entry => entry.definition);
}
