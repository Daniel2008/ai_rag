#!/usr/bin/env node
/**
 * 性能优化脚本
 * 自动执行多项性能优化措施
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

console.log('🔧 开始性能优化...\n')

// 1. 清理构建缓存
console.log('🧹 1. 清理构建缓存...')
const cacheDirs = [
  'dist',
  'out',
  'node_modules/.vite',
  'node_modules/.cache',
  '.electron-builder-cache',
  '.vite-cache'
]

cacheDirs.forEach((dir) => {
  const fullPath = path.resolve(dir)
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true })
    console.log(`   ✓ 已删除: ${dir}`)
  }
})

// 2. 优化 node_modules
console.log('\n📦 2. 优化依赖...')
try {
  // 移除未使用的依赖
  execSync('pnpm prune', { stdio: 'inherit' })
  console.log('   ✓ 依赖清理完成')
} catch (e) {
  console.log('   ⚠️  跳过依赖清理:', e.message)
}

// 3. 重建原生模块
console.log('\n🔧 3. 重建原生模块...')
try {
  execSync('pnpm rebuild', { stdio: 'inherit' })
  console.log('   ✓ 原生模块重建完成')
} catch (e) {
  console.log('   ⚠️  重建失败:', e.message)
}

// 4. 生成性能报告
console.log('\n📊 4. 生成性能报告...')
const report = {
  timestamp: new Date().toISOString(),
  dependencies: {},
  buildConfig: {}
}

// 分析依赖大小
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const deps = Object.keys(packageJson.dependencies || {})

  report.dependencies.count = deps.length
  report.dependencies.list = deps.slice(0, 10) // 只显示前10个

  console.log(`   ✓ 依赖数量: ${deps.length}`)
} catch (e) {
  console.log('   ⚠️  无法分析依赖:', e.message)
}

// 检查构建配置
try {
  const viteConfig = fs.readFileSync('electron.vite.config.ts', 'utf8')
  const hasOptimization = viteConfig.includes('minify') || viteConfig.includes('manualChunks')

  report.buildConfig.optimized = hasOptimization
  console.log(`   ✓ 构建优化: ${hasOptimization ? '已配置' : '未配置'}`)
} catch (e) {
  console.log('   ⚠️  无法检查构建配置:', e.message)
}

// 保存报告
const reportPath = path.join(__dirname, '../performance-report.json')
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(`   ✓ 报告已保存: ${reportPath}`)

// 5. 内存优化建议
console.log('\n💡 5. 内存优化建议:')
console.log('   • 开发时使用: NODE_OPTIONS="--max-old-space-size=8192"')
console.log('   • 生产构建时使用: --max-old-space-size=4096')
console.log('   • 监控内存使用: 任务管理器 / 活动监视器')

console.log('\n✅ 性能优化完成！')
console.log('\n下一步建议:')
console.log('   1. 运行: pnpm run build:fast 测试构建速度')
console.log('   2. 查看: performance-report.json 了解项目状态')
console.log('   3. 监控: 运行时内存使用情况')
