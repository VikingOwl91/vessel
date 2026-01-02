/**
 * Version state management for update notifications
 * Checks for new versions on app load and periodically
 */

/** Version info from the backend */
interface VersionInfo {
	current: string;
	latest?: string;
	updateUrl?: string;
	hasUpdate: boolean;
}

/** localStorage keys */
const STORAGE_KEYS = {
	dismissedVersion: 'vessel-dismissed-version',
	lastCheck: 'vessel-last-update-check'
} as const;

/** Check interval: 12 hours in milliseconds */
const CHECK_INTERVAL = 12 * 60 * 60 * 1000;

/** Version state class with reactive properties */
export class VersionState {
	/** Current app version */
	current = $state<string>('');

	/** Latest available version (if known) */
	latest = $state<string | null>(null);

	/** URL to release page */
	updateUrl = $state<string | null>(null);

	/** Whether an update is available */
	hasUpdate = $state(false);

	/** Timestamp of last check */
	lastChecked = $state<number>(0);

	/** Version that was dismissed by user */
	dismissedVersion = $state<string | null>(null);

	/** Whether currently checking */
	isChecking = $state(false);

	/** Interval handle for periodic checks */
	private intervalId: ReturnType<typeof setInterval> | null = null;

	/** Whether notification should be shown */
	get shouldShowNotification(): boolean {
		return this.hasUpdate && this.latest !== null && this.latest !== this.dismissedVersion;
	}

	/**
	 * Initialize version checking
	 * Loads dismissed version from localStorage and starts periodic checks
	 */
	initialize(): void {
		if (typeof window === 'undefined') return;

		// Load dismissed version from localStorage
		try {
			this.dismissedVersion = localStorage.getItem(STORAGE_KEYS.dismissedVersion);
			const lastCheckStr = localStorage.getItem(STORAGE_KEYS.lastCheck);
			this.lastChecked = lastCheckStr ? parseInt(lastCheckStr, 10) : 0;
		} catch {
			// localStorage not available
		}

		// Check if we should check now (12 hours since last check)
		const timeSinceLastCheck = Date.now() - this.lastChecked;
		if (timeSinceLastCheck >= CHECK_INTERVAL || this.lastChecked === 0) {
			this.checkForUpdates();
		}

		// Set up periodic checking
		this.intervalId = setInterval(() => {
			this.checkForUpdates();
		}, CHECK_INTERVAL);
	}

	/**
	 * Check for updates from the backend
	 */
	async checkForUpdates(): Promise<void> {
		if (this.isChecking) return;

		this.isChecking = true;

		try {
			const response = await fetch('/api/v1/version');
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const info: VersionInfo = await response.json();

			this.current = info.current;
			this.latest = info.latest || null;
			this.updateUrl = info.updateUrl || null;
			this.hasUpdate = info.hasUpdate;
			this.lastChecked = Date.now();

			// Save last check time
			try {
				localStorage.setItem(STORAGE_KEYS.lastCheck, this.lastChecked.toString());
			} catch {
				// localStorage not available
			}
		} catch (error) {
			// Silently fail - don't bother user with update check errors
			console.debug('Version check failed:', error);
		} finally {
			this.isChecking = false;
		}
	}

	/**
	 * Dismiss the update notification for a specific version
	 * Saves to localStorage so it persists across sessions
	 */
	dismissUpdate(version: string): void {
		this.dismissedVersion = version;

		try {
			localStorage.setItem(STORAGE_KEYS.dismissedVersion, version);
		} catch {
			// localStorage not available
		}
	}

	/**
	 * Clear dismissed version (useful for settings/debugging)
	 */
	clearDismissed(): void {
		this.dismissedVersion = null;

		try {
			localStorage.removeItem(STORAGE_KEYS.dismissedVersion);
		} catch {
			// localStorage not available
		}
	}

	/**
	 * Clean up interval on destroy
	 */
	destroy(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}
}

/** Singleton version state instance */
export const versionState = new VersionState();
