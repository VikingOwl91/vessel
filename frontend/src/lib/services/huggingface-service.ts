/**
 * HuggingFace Service
 *
 * Frontend service for interacting with the HuggingFace API endpoints.
 * Provides model search, GGUF file listing, and download management with
 * real-time progress updates via SSE.
 */

// Types

export interface HFModel {
	id: string; // e.g., "TheBloke/Llama-2-7B-GGUF"
	name: string;
	author: string;
	downloads: number;
	likes: number;
	tags: string[];
	lastModified: Date;
	private: boolean;
}

export interface HFGGUFFile {
	name: string;
	size: number;
	quantization: string; // e.g., "Q4_K_M"
	sizeLabel: string; // e.g., "4.08 GB"
}

export interface DownloadProgress {
	id: string;
	repo: string;
	filename: string;
	status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
	progress: number; // 0-100
	downloadedBytes: number;
	totalBytes: number;
	speed: number; // bytes/sec
	error?: string;
}

export interface SearchOptions {
	query: string;
	limit?: number;
	sort?: 'downloads' | 'likes' | 'trending';
}

export interface LocalModel {
	filename: string;
	size: number;
	sizeFormatted: string;
	quantType: string;
	modifiedAt: Date;
	path: string;
}

// API response types (matching backend)

interface HFModelAPIResponse {
	id: string;
	modelId?: string;
	author?: string;
	downloads: number;
	likes: number;
	tags: string[];
	lastModified: string;
	private?: boolean;
}

interface HFGGUFFileAPIResponse {
	filename: string;
	size: number;
	sizeFormatted: string;
	quantType: string;
	paramSize: string;
	baseModel: string;
	downloadUrl: string;
}

interface DownloadStartResponse {
	id: string;
	status: string;
}

interface DownloadProgressAPIResponse {
	id: string;
	repo: string;
	filename: string;
	status: string;
	downloaded: number;
	total: number;
	speed: number;
	percentage: number;
	error?: string;
}

interface LocalModelAPIResponse {
	filename: string;
	size: number;
	sizeFormatted: string;
	quantType: string;
	modifiedAt: string;
	path: string;
}

interface LocalModelsResponse {
	models: LocalModelAPIResponse[];
	count: number;
	directory: string;
}

// Helper functions

/**
 * Format bytes into human-readable size string.
 */
function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 B';

	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const base = 1024;
	const exponent = Math.floor(Math.log(bytes) / Math.log(base));
	const value = bytes / Math.pow(base, exponent);

	// Use 2 decimal places for GB and above, 1 for MB, 0 for smaller
	const decimals = exponent >= 3 ? 2 : exponent >= 2 ? 1 : 0;
	return `${value.toFixed(decimals)} ${units[exponent]}`;
}

/**
 * Extract model name from repo ID.
 */
function extractModelName(repoId: string): string {
	const parts = repoId.split('/');
	return parts.length > 1 ? parts[1] : repoId;
}

/**
 * Extract author from repo ID.
 */
function extractAuthor(repoId: string): string {
	const parts = repoId.split('/');
	return parts.length > 1 ? parts[0] : '';
}

// Service class

class HuggingFaceService {
	private readonly apiBase = '/api/v1/huggingface';

	/** Active SSE connections for download progress */
	private progressSubscriptions = new Map<string, EventSource>();

	/**
	 * Search for GGUF models on HuggingFace.
	 *
	 * @param options - Search options including query, limit, and sort
	 * @returns Array of matching models
	 */
	async searchModels(options: SearchOptions): Promise<HFModel[]> {
		const params = new URLSearchParams();
		params.set('query', options.query);

		if (options.limit !== undefined) {
			params.set('limit', String(options.limit));
		}

		if (options.sort) {
			params.set('sort', options.sort);
		}

		const response = await fetch(`${this.apiBase}/models?${params.toString()}`);

		if (!response.ok) {
			const error = await this.parseErrorResponse(response);
			throw new Error(`Failed to search models: ${error}`);
		}

		const data: { models: HFModelAPIResponse[]; count: number } = await response.json();

		return data.models.map((model) => this.mapModelResponse(model));
	}

	/**
	 * Get list of GGUF files in a HuggingFace repository.
	 *
	 * @param repo - Repository ID (e.g., "TheBloke/Llama-2-7B-GGUF")
	 * @returns Array of GGUF files with metadata
	 */
	async getModelFiles(repo: string): Promise<HFGGUFFile[]> {
		// Backend expects /models/:owner/:repo/files, so we pass the repo as-is (with slash)
		const response = await fetch(`${this.apiBase}/models/${repo}/files`);

		if (!response.ok) {
			const error = await this.parseErrorResponse(response);
			throw new Error(`Failed to get model files: ${error}`);
		}

		const data: { files: HFGGUFFileAPIResponse[]; count: number } = await response.json();

		return data.files.map((file) => ({
			name: file.filename,
			size: file.size,
			quantization: file.quantType || this.extractQuantization(file.filename),
			sizeLabel: file.sizeFormatted || formatFileSize(file.size)
		}));
	}

	/**
	 * Start downloading a GGUF file from HuggingFace.
	 *
	 * @param repo - Repository ID
	 * @param filename - Name of the GGUF file to download
	 * @param destDir - Optional destination directory
	 * @returns Download ID for tracking progress
	 */
	async startDownload(repo: string, filename: string, destDir?: string): Promise<string> {
		const body: { repo: string; filename: string; dest_dir?: string } = {
			repo,
			filename
		};

		if (destDir) {
			body.dest_dir = destDir;
		}

		const response = await fetch(`${this.apiBase}/download`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const error = await this.parseErrorResponse(response);
			throw new Error(`Failed to start download: ${error}`);
		}

		const data: DownloadStartResponse = await response.json();
		return data.id;
	}

	/**
	 * Get list of all active downloads.
	 *
	 * @returns Array of download progress objects
	 */
	async getDownloads(): Promise<DownloadProgress[]> {
		const response = await fetch(`${this.apiBase}/downloads`);

		if (!response.ok) {
			const error = await this.parseErrorResponse(response);
			throw new Error(`Failed to get downloads: ${error}`);
		}

		const data: DownloadProgressAPIResponse[] = await response.json();

		return data.map((download) => this.mapDownloadProgress(download));
	}

	/**
	 * Cancel an active download.
	 *
	 * @param id - Download ID to cancel
	 */
	async cancelDownload(id: string): Promise<void> {
		const response = await fetch(`${this.apiBase}/downloads/${id}`, {
			method: 'DELETE'
		});

		if (!response.ok) {
			const error = await this.parseErrorResponse(response);
			throw new Error(`Failed to cancel download: ${error}`);
		}

		// Clean up any active SSE subscription for this download
		this.unsubscribeFromProgress(id);
	}

	/**
	 * Get list of locally stored GGUF models.
	 *
	 * @returns Array of local model info with directory path
	 */
	async getLocalModels(): Promise<{ models: LocalModel[]; directory: string }> {
		const response = await fetch(`${this.apiBase}/local`);

		if (!response.ok) {
			const error = await this.parseErrorResponse(response);
			throw new Error(`Failed to get local models: ${error}`);
		}

		const data: LocalModelsResponse = await response.json();

		return {
			models: data.models.map((m) => ({
				filename: m.filename,
				size: m.size,
				sizeFormatted: m.sizeFormatted,
				quantType: m.quantType,
				modifiedAt: new Date(m.modifiedAt),
				path: m.path
			})),
			directory: data.directory
		};
	}

	/**
	 * Delete a local GGUF model file.
	 *
	 * @param filename - Name of the model file to delete
	 */
	async deleteLocalModel(filename: string): Promise<void> {
		const response = await fetch(`${this.apiBase}/local/${encodeURIComponent(filename)}`, {
			method: 'DELETE'
		});

		if (!response.ok) {
			const error = await this.parseErrorResponse(response);
			throw new Error(`Failed to delete model: ${error}`);
		}
	}

	/**
	 * Subscribe to real-time progress updates for a download via SSE.
	 *
	 * @param id - Download ID to subscribe to
	 * @param callback - Callback function called with progress updates
	 * @returns Unsubscribe function
	 */
	subscribeToProgress(id: string, callback: (progress: DownloadProgress) => void): () => void {
		// Clean up existing subscription if any
		this.unsubscribeFromProgress(id);

		const eventSource = new EventSource(`${this.apiBase}/downloads/${id}/stream`);

		eventSource.onmessage = (event) => {
			try {
				const data: DownloadProgressAPIResponse = JSON.parse(event.data);
				const progress = this.mapDownloadProgress(data);
				callback(progress);

				// Auto-close on terminal states
				if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled') {
					this.unsubscribeFromProgress(id);
				}
			} catch (error) {
				console.error('[HuggingFaceService] Failed to parse progress event:', error);
			}
		};

		eventSource.onerror = (error) => {
			console.error('[HuggingFaceService] SSE error for download', id, ':', error);
			// Attempt to report the error via callback
			callback({
				id,
				repo: '',
				filename: '',
				status: 'failed',
				progress: 0,
				downloadedBytes: 0,
				totalBytes: 0,
				speed: 0,
				error: 'Connection lost'
			});
			this.unsubscribeFromProgress(id);
		};

		this.progressSubscriptions.set(id, eventSource);

		return () => this.unsubscribeFromProgress(id);
	}

	/**
	 * Unsubscribe from progress updates for a download.
	 */
	private unsubscribeFromProgress(id: string): void {
		const eventSource = this.progressSubscriptions.get(id);
		if (eventSource) {
			eventSource.close();
			this.progressSubscriptions.delete(id);
		}
	}

	/**
	 * Close all active SSE connections.
	 * Call this when the service is no longer needed.
	 */
	cleanup(): void {
		for (const [id] of this.progressSubscriptions) {
			this.unsubscribeFromProgress(id);
		}
	}

	// Private helper methods

	/**
	 * Map API model response to HFModel interface.
	 */
	private mapModelResponse(model: HFModelAPIResponse): HFModel {
		return {
			id: model.id,
			name: model.modelId || extractModelName(model.id),
			author: model.author || extractAuthor(model.id),
			downloads: model.downloads,
			likes: model.likes,
			tags: model.tags || [],
			lastModified: new Date(model.lastModified),
			private: model.private ?? false
		};
	}

	/**
	 * Map API download progress response to DownloadProgress interface.
	 */
	private mapDownloadProgress(download: DownloadProgressAPIResponse): DownloadProgress {
		return {
			id: download.id,
			repo: download.repo,
			filename: download.filename,
			status: this.mapDownloadStatus(download.status),
			progress: download.percentage,
			downloadedBytes: download.downloaded,
			totalBytes: download.total,
			speed: download.speed,
			error: download.error
		};
	}

	/**
	 * Map backend status string to typed status.
	 */
	private mapDownloadStatus(status: string): DownloadProgress['status'] {
		switch (status.toLowerCase()) {
			case 'pending':
				return 'pending';
			case 'downloading':
				return 'downloading';
			case 'complete':
			case 'completed':
				return 'completed';
			case 'failed':
			case 'error':
				return 'failed';
			case 'cancelled':
			case 'canceled':
				return 'cancelled';
			default:
				return 'pending';
		}
	}

	/**
	 * Extract quantization type from filename.
	 * Fallback for when the backend doesn't provide it.
	 */
	private extractQuantization(filename: string): string {
		// Common quantization patterns
		const patterns = [
			/[_.-](Q\d+_K_[A-Z]+)/i, // Q4_K_M, Q5_K_S, etc.
			/[_.-](Q\d+_[A-Z0-9]+)/i, // Q4_0, Q5_1, etc.
			/[_.-](IQ\d+_[A-Z]+)/i, // IQ4_XS, IQ3_XXS, etc.
			/[_.-](F\d+)/i, // F16, F32
			/[_.-](BF\d+)/i // BF16
		];

		for (const pattern of patterns) {
			const match = filename.match(pattern);
			if (match?.[1]) {
				return match[1].toUpperCase();
			}
		}

		return '';
	}

	/**
	 * Parse error response from the API.
	 */
	private async parseErrorResponse(response: Response): Promise<string> {
		try {
			const data = await response.json();
			return data.error || data.message || response.statusText;
		} catch {
			return response.statusText;
		}
	}
}

/** Singleton instance */
export const huggingfaceService = new HuggingFaceService();
