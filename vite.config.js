import { defineConfig } from 'vite';
const proxy = { '/api': 'http://127.0.0.1:3001' };
export default defineConfig({ server: { proxy }, preview: { proxy } });
