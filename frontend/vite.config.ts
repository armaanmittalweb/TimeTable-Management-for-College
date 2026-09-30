import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API's CORS list includes http://localhost:5173, so the dev server must stay on that port.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
