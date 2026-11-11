import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // 编辑器体积较大，单独成块，首屏只加载主包
        manualChunks: {
          codemirror: [
            '@uiw/react-codemirror',
            '@codemirror/lang-cpp',
            '@codemirror/lang-java',
            '@codemirror/lang-python',
            '@codemirror/lang-javascript',
          ],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
