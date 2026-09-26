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
            // M10: each lazily loaded world is one chunk (`src/map/bundledFiles.ts`), fetched when played.
            // world.json files and the default world stay in the main bundle (null = no group).
            {
              name: (id: string) => {
                const m = /content[\\/]maps[\\/]([^\\/]+)[\\/](.+)\.json$/.exec(id)
                return m && m[1] !== 'neighborhood-50' && m[2] !== 'world' ? `world-${m[1]}` : null
              },
              test: /content[\\/]maps[\\/]/,
            },
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
    // Tests read the frozen worlds (src/test/fixtures/maps/: the neighbourhood, the floors lab), not the live content/maps copies.
    alias: [{ find: /^\.\/bundledFiles$/, replacement: fileURLToPath(new URL('./src/test/bundledFiles.ts', import.meta.url)) }],
  },
})
