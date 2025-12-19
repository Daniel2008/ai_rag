/**
 * 快速构建脚本
 * 跳过类型检查，使用缓存，优化并行构建
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// 配置
const CONFIG = {
  // 跳过类型检查（如果确定代码无类型错误）
  skipTypeCheck: process.env.SKIP_TYPECHECK === 'true',

  // 使用缓存
  useCache: true,

  // 并行构建
  parallel: true,

  // 电子构建器选项
  builderArgs: [
    '--config.compression=normal', // 使用普通压缩而不是 maximum
    '--config.asar=true',
    '--config.win.target=nsis',
    '--config.win.arch=x64'
  ]
}

console.log('🚀 开始快速构建...')

// 1. 清理之前的构建缓存（可选）
if (process.env.CLEAN === 'true') {
  console.log('🧹 清理构建缓存...')
  const cacheDirs = ['dist', 'out', 'node_modules/.vite', 'node_modules/.cache']

  cacheDirs.forEach((dir) => {
    const fullPath = path.resolve(dir)
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true })
      console.log(`  已删除: ${dir}`)
    }
  })
}

// 2. 构建主进程和渲染进程
console.log('📦 构建应用代码...')

try {
  // 使用 electron-vite 快速构建（跳过类型检查）
  const buildCmd = CONFIG.skipTypeCheck ? 'npm run build:fast' : 'npm run build'

  console.log(`  执行: ${buildCmd}`)
  execSync(buildCmd, {
    stdio: 'inherit',
    env: {
      ...process.env,
      // 优化 Vite 构建
      VITE_CACHE_DIR: '.vite-cache',
      // 启用并行
      NODE_OPTIONS: '--max-old-space-size=4096'
    }
  })

  console.log('✅ 应用代码构建完成')
} catch (error) {
  console.error('❌ 应用代码构建失败:', error.message)
  process.exit(1)
}

// 3. 打包成可执行文件
console.log('📦 打包成可执行文件...')

try {
  const builderCmd = `electron-builder --win --x64 ${CONFIG.builderArgs.join(' ')}`
  console.log(`  执行: ${builderCmd}`)
  execSync(builderCmd, {
    stdio: 'inherit',
    env: {
      ...process.env,
      // 优化电子构建器
      ELECTRON_BUILDER_CACHE: '.electron-builder-cache',
      // 并行处理
      NPMPROCESS: '4'
    }
  })

  console.log('✅ 打包完成')
} catch (error) {
  console.error('❌ 打包失败:', error.message)
  process.exit(1)
}

console.log('🎉 构建成功！')
