import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const IS_ANALYZE = process.env.ANALYZE === 'true'
const IS_DEV = process.env.NODE_ENV === 'development'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // 生产环境优化
      minify: IS_DEV ? false : 'esbuild',
      sourcemap: IS_ANALYZE ? true : false,

      // 内存优化
      rollupOptions: {
        external: ['better-sqlite3'],
        input: {
          index: resolve('src/main/index.ts'),
          worker: resolve('src/main/rag/worker.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js',
          // 优化 chunk 策略
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              // 将大型依赖拆分
              if (id.includes('@langchain')) return 'langchain-vendor'
              if (id.includes('@huggingface')) return 'huggingface-vendor'
              if (id.includes('onnxruntime')) return 'onnx-vendor'
              if (id.includes('lancedb')) return 'lancedb-vendor'
              if (id.includes('officeparser')) return 'office-vendor'
              if (id.includes('tesseract')) return 'tesseract-vendor'
              return 'vendor'
            }
            return undefined
          }
        }
      },
      // 性能优化选项
      chunkSizeWarningLimit: 500,
      reportCompressedSize: false
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      minify: !IS_DEV,
      sourcemap: IS_ANALYZE,
      rollupOptions: {
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js'
        }
      }
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
            const entries = Object.values(bundle) as unknown[]
            const report = entries
              .filter((entry) => {
                if (!entry || typeof entry !== 'object') return false
                return (entry as Record<string, unknown>).type === 'chunk'
              })
              .map((entry) => {
                const chunk = entry as Record<string, unknown>
                const code = typeof chunk.code === 'string' ? chunk.code : ''
                const fileName = typeof chunk.fileName === 'string' ? chunk.fileName : ''
                const imports = Array.isArray(chunk.imports) ? (chunk.imports as string[]) : []
                const modulesCount =
                  chunk.modules && typeof chunk.modules === 'object'
                    ? Object.keys(chunk.modules as Record<string, unknown>).length
                    : 0
                return {
                  fileName,
                  sizeKB: +(code.length / 1024).toFixed(2),
                  imports,
                  modules: modulesCount
                }
              })
              .sort((a, b) => b.sizeKB - a.sizeKB)
            console.log('Renderer bundle report:', report)
          }
        }
        : null
    ].filter(Boolean),
    build: {
      // 优化渲染进程构建
      minify: IS_DEV ? false : 'esbuild',
      sourcemap: IS_ANALYZE,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 500,
      reportCompressedSize: false,

      rollupOptions: {
        output: {
          // 简化 chunk 策略：只分离大型且不依赖 React 的库
          // React 相关的库让 Vite 自动处理依赖关系
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              // 只分离大型 AI 依赖（这些不依赖 React）
              if (id.includes('@langchain')) return 'langchain-vendor'
              if (id.includes('@huggingface')) return 'huggingface-vendor'
              if (id.includes('onnxruntime')) return 'onnx-vendor'
              if (id.includes('lancedb')) return 'lancedb-vendor'
              if (id.includes('officeparser')) return 'office-vendor'
              if (id.includes('tesseract')) return 'tesseract-vendor'
              // 其他库不手动分割，让 Vite 自动处理
            }
            return undefined
          }
        }
      }
    }
  }
})
