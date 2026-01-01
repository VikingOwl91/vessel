import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
	plugins: [svelte({ hot: !process.env.VITEST })],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/tests/setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/lib/**/*.ts'],
			exclude: ['src/lib/**/*.svelte', 'src/tests/**']
		}
	},
	resolve: {
		alias: {
			$lib: resolve('./src/lib'),
			$app: resolve('./src/tests/mocks/app')
		}
	}
});
