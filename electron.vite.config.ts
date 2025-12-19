import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const IS_ANALYZE = process.env.ANALYZE === 'true'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // 启用详细日志
      minify: 'esbuild', // 使用 esbuild 更快
      sourcemap: false, // 生产环境关闭 sourcemap 加速构建
      rollupOptions: {
        external: ['better-sqlite3'],
        input: {
          index: resolve('src/main/index.ts'),
          worker: resolve('src/main/rag/worker.ts')
        },
        output: {
          // 优化输出
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js'
        }
      },
      // 并行构建
      chunkSizeWarningLimit: 1000
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: 'esbuild',
      sourcemap: false
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      IS_ANALYZE
        ? {
            name: 'bundle-analyze-log',
            generateBundle(_, bundle) {
              const entries = Object.values(bundle) as any[]
              const report = entries
                .filter((entry) => entry && entry.type === 'chunk')
                .map((chunk) => ({
                  fileName: chunk.fileName,
                  sizeKB: +(chunk.code.length / 1024).toFixed(2),
                  imports: chunk.imports,
                  modules: Object.keys(chunk.modules || {}).length
                }))
                .sort((a, b) => b.sizeKB - a.sizeKB)
              console.log('Renderer bundle report:', report)
            }
          }
        : null
    ].filter(Boolean),
    build: {
      // 优化渲染进程构建
      minify: 'esbuild',
      sourcemap: IS_ANALYZE ? true : false,
      // 启用 CSS 代码分割
      cssCodeSplit: true,
      // 优化 chunk 大小
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          // 手动分割 chunk
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'antd-vendor': ['antd', '@ant-design/icons'],
            'langchain-vendor': [
              '@langchain/core',
              '@langchain/community',
              '@langchain/openai',
              '@langchain/ollama'
            ]
          }
        }
      }
    }
  }
})
