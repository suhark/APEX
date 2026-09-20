import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    headers: {
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://cloudflareinsights.com https://openrouter.ai https://*.openrouter.ai https://pnvddbkfxemntbxtmkhm.supabase.co wss://pnvddbkfxemntbxtmkhm.supabase.co https://*.supabase.co wss://*.derivws.com wss://*.binary.com https://*.deriv.com https://api.derivws.com https://auth.deriv.com; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'"
    }
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime
          'vendor-react': ['react', 'react-dom'],
          // Supabase client
          'vendor-supabase': ['@supabase/supabase-js'],
          // Lucide icons (largest single dep)
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
});
