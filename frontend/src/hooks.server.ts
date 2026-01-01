/**
 * SvelteKit server hooks for API proxying
 * In production, proxies /api/* requests to Ollama and backend services
 */

import type { Handle } from '@sveltejs/kit';

// Get service URLs from environment (set in docker-compose)
const OLLAMA_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:9090';

/**
 * Proxy a request to a target URL
 */
async function proxyRequest(request: Request, targetBase: string, path: string): Promise<Response> {
	const targetUrl = `${targetBase}${path}`;

	const headers = new Headers(request.headers);
	// Remove host header to avoid issues
	headers.delete('host');

	try {
		const response = await fetch(targetUrl, {
			method: request.method,
			headers,
			body: request.method !== 'GET' && request.method !== 'HEAD'
				? await request.arrayBuffer()
				: undefined,
			// @ts-expect-error - duplex is needed for streaming but not in types
			duplex: 'half'
		});

		// Create new response with CORS headers
		const responseHeaders = new Headers(response.headers);
		responseHeaders.set('Access-Control-Allow-Origin', '*');

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: responseHeaders
		});
	} catch (error) {
		console.error(`[Proxy] Error proxying to ${targetUrl}:`, error);
		return new Response(JSON.stringify({ error: `Failed to reach ${targetBase}` }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	// Handle CORS preflight
	if (event.request.method === 'OPTIONS') {
		return new Response(null, {
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization'
			}
		});
	}

	// Proxy /health to backend
	if (pathname === '/health') {
		return proxyRequest(event.request, BACKEND_URL, '/health');
	}

	// Include query string for all API proxying
	const fullPath = pathname + event.url.search;

	// Proxy /api/v1/* to backend (must come before /api/* check)
	if (pathname.startsWith('/api/v1/')) {
		return proxyRequest(event.request, BACKEND_URL, fullPath);
	}

	// Proxy /api/* to Ollama
	if (pathname.startsWith('/api/')) {
		return proxyRequest(event.request, OLLAMA_URL, fullPath);
	}

	// All other requests go to SvelteKit
	return resolve(event);
};
