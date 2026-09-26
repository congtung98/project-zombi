/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Đường dẫn tương đối: bản build chạy được ở root hoặc dưới sub-path (GitHub Pages /project-zombi/).
  base: './',
  build: {
    // Tách thư viện lớn thành chunk riêng để cache tốt hơn và bỏ cảnh báo "chunk > 500 kB".
    chunkSizeWarningLimit: 2400, // chunk rapier ~2,2 MB là WASM nhúng của @dimforge/rapier3d-compat, không tách nhỏ được
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'rapier', test: /node_modules\/@dimforge\// },
            { name: 'three', test: /node_modules\/three\// },
            { name: 'r3f', test: /node_modules\/@react-three\// },
            { name: 'react', test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: 'vendor', test: /node_modules\// },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Tests read the frozen neighbourhood (src/test/fixtures/maps/), not the live content/maps copy.
    alias: [{ find: /^\.\/bundledFiles$/, replacement: fileURLToPath(new URL('./src/test/bundledFiles.ts', import.meta.url)) }],
  },
})
