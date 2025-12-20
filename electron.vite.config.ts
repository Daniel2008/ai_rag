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
