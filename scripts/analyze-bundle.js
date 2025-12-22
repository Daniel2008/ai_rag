#!/usr/bin/env node
/**
 * Bundle 分析脚本
 * 分析构建产物大小和依赖关系
 */

const fs = require('fs')
const path = require('path')

console.log('📊 开始分析构建产物...\n')

// 配置
const ANALYSIS_CONFIG = {
  // 警告阈值 (KB)
  warnings: {
    chunk: 200,
    asset: 500,
    total: 50 * 1024 // 50MB
  },
  // 需要特别关注的包
  重点关注: [
    '@lancedb/lancedb',
    '@huggingface/transformers',
    'onnxruntime-node',
    'better-sqlite3',
    'officeparser',
    'tesseract.js'
  ]
}

// 检查 dist 目录
const distPath = path.join(__dirname, '../dist')
if (!fs.existsSync(distPath)) {
  console.log('❌ dist 目录不存在，请先运行构建')
  console.log('   pnpm run build:fast')
  process.exit(1)
}

// 分析函数
function analyzeDirectory(dir, results = { files: [], totalSize: 0 }) {
  const items = fs.readdirSync(dir, { withFileTypes: true })

  for (const item of items) {
    const fullPath = path.join(dir, item.name)

    if (item.isDirectory()) {
      analyzeDirectory(fullPath, results)
    } else {
      const stats = fs.statSync(fullPath)
      const sizeKB = Math.round(stats.size / 1024)

      results.files.push({
        path: path.relative(distPath, fullPath),
        sizeKB,
        sizeMB: (sizeKB / 1024).toFixed(2)
      })

      results.totalSize += stats.size
    }
  }

  return results
}

// 执行分析
console.log('📁 扫描 dist 目录...')
const analysis = analyzeDirectory(distPath)

// 排序并显示大文件
analysis.files.sort((a, b) => b.sizeKB - a.sizeKB)

console.log('\n📦 大小排名前10的文件:')
console.log('─'.repeat(80))
analysis.files.slice(0, 10).forEach((file, i) => {
  const warning = file.sizeKB > ANALYSIS_CONFIG.warnings.asset ? '⚠️' : '  '
  console.log(`${warning} ${i + 1}. ${file.path}`)
  console.log(`    ${file.sizeKB} KB (${file.sizeMB} MB)`)
})

// 总体统计
const totalMB = (analysis.totalSize / 1024 / 1024).toFixed(2)
console.log('\n📈 总体统计:')
console.log(`   总文件数: ${analysis.files.length}`)
console.log(`   总大小: ${totalMB} MB`)
console.log(`   警告阈值: ${ANALYSIS_CONFIG.warnings.total / 1024 / 1024} MB`)

if (analysis.totalSize > ANALYSIS_CONFIG.warnings.total) {
  console.log('   ⚠️  警告: 构建产物过大！')
}

// 检查 package.json 依赖
console.log('\n🔍 分析 package.json 依赖...')
try {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  }

  // 找出大型依赖
  const largeDeps = Object.entries(allDeps).filter(([name]) =>
    ANALYSIS_CONFIG.重点关注.includes(name)
  )

  if (largeDeps.length > 0) {
    console.log('   关键依赖:')
    largeDeps.forEach(([name, version]) => {
      console.log(`   • ${name}: ${version}`)
    })
  }

  // 检查是否有优化空间
  const totalDeps = Object.keys(allDeps).length
  console.log(`\n   总依赖数: ${totalDeps}`)
  console.log(`   建议: 定期运行 'pnpm outdated' 检查可更新的包`)
} catch (e) {
  console.log('   ⚠️  无法分析 package.json:', e.message)
}

// 生成优化建议
console.log('\n💡 优化建议:')

const suggestions = []

if (analysis.totalSize > ANALYSIS_CONFIG.warnings.total) {
  suggestions.push(
    '构建产物超过 50MB，建议:',
    '  • 检查是否可以移除未使用的依赖',
    '  • 考虑使用更轻量的替代库',
    '  • 启用更激进的代码分割'
  )
}

// 检查是否有超大 chunk
const largeChunks = analysis.files.filter((f) => f.sizeKB > ANALYSIS_CONFIG.warnings.chunk)
if (largeChunks.length > 0) {
  suggestions.push(
    `发现 ${largeChunks.length} 个超大 chunk (>200KB):`,
    '  • 考虑进一步拆分手动 chunk',
    '  • 检查是否有重复导入'
  )
}

// 检查是否有未优化的文件
const unoptimizedFiles = analysis.files.filter(
  (f) => f.path.endsWith('.js') && !f.path.includes('.min.')
)
if (unoptimizedFiles.length > 0) {
  suggestions.push(
    '发现未压缩的 JS 文件:',
    '  • 确保构建配置中启用了 minify',
    '  • 检查 sourcemap 是否需要在生产环境移除'
  )
}

if (suggestions.length === 0) {
  console.log('   ✅ 构建产物状态良好！')
} else {
  suggestions.forEach((s) => console.log(`   ${s}`))
}

// 保存详细报告
const report = {
  timestamp: new Date().toISOString(),
  summary: {
    totalFiles: analysis.files.length,
    totalSizeMB: totalMB,
    largeFilesCount: analysis.files.filter((f) => f.sizeKB > 500).length
  },
  files: analysis.files,
  suggestions
}

const reportPath = path.join(__dirname, '../bundle-analysis.json')
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

console.log(`\n📄 详细报告已保存: ${reportPath}`)

// 性能提示
console.log('\n⚡ 性能提示:')
console.log('   • 使用 pnpm run build:analyze 查看详细 bundle 分析')
console.log('   • 监控启动时间和内存使用')
console.log('   • 定期清理构建缓存: pnpm run clean (如果添加了此命令)')

console.log('\n✅ 分析完成！')
