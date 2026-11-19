import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// UI-only test build: replaces supabase-js with an in-memory mock.
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://mock'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('mock'),
  },
  resolve: { alias: { '@supabase/supabase-js': fileURLToPath(new URL('./mock-supabase.ts', import.meta.url)) } },
});
