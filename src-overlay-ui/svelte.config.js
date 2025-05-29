import adapter from '@sveltejs/adapter-static';

import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const dev = process.argv.includes('dev');

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	onwarn: (warning, handler) => {
		if (warning.code.startsWith('a11y-')) {
			return;
		}
		handler(warning);
	},
	kit: {
		adapter: adapter({
			fallback: 'index.html'
		}),
		paths: {
			base: dev ? '' : '/static'
		}
	}
};

export default config;
