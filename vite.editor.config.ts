import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Map editor build (M3): its own entry and output folder, so the game build (`npm run build`,
// index.html only) never contains editor code. In dev, `npm run dev` also serves /editor.html.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist-editor',
    chunkSizeWarningLimit: 2400,
    rolldownOptions: {
      input: { editor: 'editor.html' },
    },
  },
})
