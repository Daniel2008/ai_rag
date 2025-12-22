#!/usr/bin/env node
/**
 * 清理脚本
 * 移除所有构建产物和缓存文件
 */

const fs = require('fs')
const path = require('path')

console.log('🧹 开始清理项目...\n')

// 需要清理的目录和文件
const cleanTargets = [
  // 构建产物
  'dist',
  'out',
  
  // 缓存目录
  'node_modules/.vite',
  'node_modules/.cache',
  '.electron-builder-cache',
  '.vite-cache',
  
  // 临时文件
  'coverage',
  '.nyc_output',
  
  // 分析报告
  'performance-report.json',
  'bundle-analysis.json',
  
  // TypeScript 构建缓存
  'tsconfig.web.tsbuildinfo',
  'tsconfig.node.tsbuildinfo'
]

// 需要保留的文件模式
const keepPatterns = [
  'node_modules',  // 保留依赖
  '.git',          // 保留 Git
  'src',           // 保留源码
  'resources',     // 保留资源
  'build',         // 保留构建资源
  'scripts',       // 保留脚本
  'wiki',          // 保留文档
  'README.md',     // 保留文档
  'package.json',  // 保留配置
  'pnpm-lock.yaml',
  'tsconfig.json',
  'electron-builder.yml',
  'electron.vite.config.ts'
]

let cleanedCount = 0
let skippedCount = 0

cleanTargets.forEach(target => {
  const fullPath = path.resolve(target)
  
  if (fs.existsSync(fullPath)) {
    try {
      if (fs.statSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true })
        console.log(`✅ 已删除目录: ${target}`)
      } else {
        fs.unlinkSync(fullPath)
        console.log(`✅ 已删除文件: ${target}`)
      }
      cleanedCount++
    } catch (e) {
      console.log(`❌ 删除失败: ${target} (${e.message})`)
    }
  } else {
    console.log(`⊘ 跳过不存在: ${target}`)
    skippedCount++
  }
})

// 额外清理：检查是否有 .DS_Store、Thumbs.db 等系统文件
console.log('\n🔍 检查系统临时文件...')
const tempFiles = []
const walkDir = (dir) => {
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true })
    for (const item of items) {
      const fullPath = path.join(dir, item.name)
      
      if (item.isDirectory()) {
        if (!keepPatterns.includes(item.name) && !item.name.startsWith('.')) {
          walkDir(fullPath)
        }
      } else {
        // 检查系统文件
        if (['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(item.name)) {
          tempFiles.push(fullPath)
        }
      }
    }
  } catch (_e) {
    // 忽略权限错误
  }
}

walkDir(__dirname)

tempFiles.forEach(file => {
  try {
    fs.unlinkSync(file)
    console.log(`✅ 已删除系统文件: ${path.relative(__dirname, file)}`)
    cleanedCount++
  } catch (_e) {
    console.log(`❌ 无法删除: ${file}`)
  }
})

// 显示清理结果
console.log('\n📊 清理结果:')
console.log(`   已删除: ${cleanedCount} 项`)
console.log(`   已跳过: ${skippedCount} 项`)

// 显示剩余空间估算
try {
  const stats = fs.statSync(__dirname)
  console.log(`   项目大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`)
} catch (_e) {
  // 忽略
}

console.log('\n💡 清理完成后建议:')
console.log('   1. 运行: pnpm install (如果需要)')
console.log('   2. 运行: pnpm run build:fast (重新构建)')
console.log('   3. 检查: dist/ 目录大小')

console.log('\n✅ 清理完成！')

