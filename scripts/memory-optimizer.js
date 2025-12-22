#!/usr/bin/env node
/**
 * 内存优化脚本
 * 优化应用内存使用，提供内存泄漏检测和修复建议
 */

const fs = require('fs')
const path = require('path')
// const { execSync } = require('child_process') // 未使用，已注释

console.log('🧠 开始内存优化...\n')

// 配置（保留用于未来扩展）
// const CONFIG = {
//   thresholds: { warning: 2048, critical: 4096, max: 8192 },
//   checkPatterns: [...]
// }

// 1. 分析内存使用情况
function analyzeMemoryUsage() {
  console.log('📊 1. 分析内存使用情况...')

  const used = process.memoryUsage()
  const metrics = {
    rss: (used.rss / 1024 / 1024).toFixed(2) + ' MB', // 常驻内存
    heapTotal: (used.heapTotal / 1024 / 1024).toFixed(2) + ' MB', // 堆总大小
    heapUsed: (used.heapUsed / 1024 / 1024).toFixed(2) + ' MB', // 已使用堆
    external: (used.external / 1024 / 1024).toFixed(2) + ' MB' // 外部内存
  }

  console.log(`   常驻内存: ${metrics.rss}`)
  console.log(`   堆总大小: ${metrics.heapTotal}`)
  console.log(`   已使用堆: ${metrics.heapUsed}`)
  console.log(`   外部内存: ${metrics.external}`)

  return metrics
}

// 2. 检查大型依赖
function checkLargeDependencies() {
  console.log('\n📦 2. 检查大型依赖...')

  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  }

  // 已知的大型依赖
  const largeDeps = [
    '@huggingface/transformers',
    'onnxruntime-node',
    '@lancedb/lancedb',
    'officeparser',
    'tesseract.js',
    'apache-arrow',
    'better-sqlite3',
    'canvas'
  ]

  const found = []
  largeDeps.forEach((dep) => {
    if (allDeps[dep]) {
      found.push({ name: dep, version: allDeps[dep] })
    }
  })

  if (found.length > 0) {
    console.log('   发现大型依赖:')
    found.forEach((dep) => {
      console.log(`   • ${dep.name}: ${dep.version}`)
    })
  } else {
    console.log('   ✅ 未发现已知的大型依赖')
  }

  return found
}

// 3. 检查内存泄漏风险
function checkMemoryLeaks() {
  console.log('\n🔍 3. 检查内存泄漏风险...')

  const risks = []

  // 检查常见的内存泄漏模式
  const leakPatterns = [
    {
      pattern: /addEventListener.*without.*removeEventListener/i,
      risk: '事件监听器未清理',
      files: []
    },
    {
      pattern: /setInterval|setTimeout.*without.*clearInterval|clearTimeout/i,
      risk: '定时器未清理',
      files: []
    },
    {
      pattern: /global.*cache|window.*cache/i,
      risk: '全局缓存未清理',
      files: []
    }
  ]

  // 检查关键文件
  const checkFiles = [
    'src/main/rag/workerManager.ts',
    'src/main/rag/worker.ts',
    'src/main/rag/store/cache.ts',
    'src/main/rag/store/embeddings.ts',
    'src/main/rag/localEmbeddings.ts'
  ]

  checkFiles.forEach((file) => {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8')
      leakPatterns.forEach((pattern) => {
        if (pattern.pattern.test(content)) {
          pattern.files.push(file)
        }
      })
    }
  })

  leakPatterns.forEach((pattern) => {
    if (pattern.files.length > 0) {
      risks.push({
        risk: pattern.risk,
        files: pattern.files
      })
    }
  })

  if (risks.length > 0) {
    console.log('   ⚠️  发现潜在内存泄漏风险:')
    risks.forEach((risk) => {
      console.log(`   • ${risk.risk}:`)
      risk.files.forEach((file) => console.log(`     - ${file}`))
    })
  } else {
    console.log('   ✅ 未发现明显的内存泄漏模式')
  }

  return risks
}

// 4. 优化建议
function generateOptimizationSuggestions(largeDeps, risks) {
  console.log('\n💡 4. 生成优化建议...')

  const suggestions = []

  // 基于依赖的建议
  if (largeDeps.length > 0) {
    suggestions.push('📦 依赖优化:')
    largeDeps.forEach((dep) => {
      switch (dep.name) {
        case '@huggingface/transformers':
          suggestions.push(`   • ${dep.name}: 考虑使用远程 API 替代本地模型`)
          suggestions.push('     或使用更小的模型 (bge-small-zh-v1.5)')
          break
        case 'onnxruntime-node':
          suggestions.push(`   • ${dep.name}: 按需加载，避免预加载所有模型`)
          break
        case '@lancedb/lancedb':
          suggestions.push(`   • ${dep.name}: 优化向量索引，减少内存占用`)
          break
        case 'officeparser':
          suggestions.push(`   • ${dep.name}: 流式解析大文件，避免一次性加载`)
          break
        case 'tesseract.js':
          suggestions.push(`   • ${dep.name}: 按需初始化 OCR 引擎`)
          break
        case 'canvas':
          suggestions.push(`   • ${dep.name}: 及时释放 Canvas 上下文`)
          break
      }
    })
  }

  // 基于风险的建议
  if (risks.length > 0) {
    suggestions.push('\n🔧 内存泄漏修复:')
    risks.forEach((risk) => {
      if (risk.risk.includes('事件监听器')) {
        suggestions.push(`   • ${risk.risk}:`)
        suggestions.push('     - 在组件卸载时调用 removeEventListener')
        suggestions.push('     - 使用 useEffect 的清理函数')
      } else if (risk.risk.includes('定时器')) {
        suggestions.push(`   • ${risk.risk}:`)
        suggestions.push('     - 在组件卸载时清除定时器')
        suggestions.push('     - 使用 useRef 保存定时器 ID')
      } else if (risk.risk.includes('缓存')) {
        suggestions.push(`   • ${risk.risk}:`)
        suggestions.push('     - 实现缓存大小限制')
        suggestions.push('     - 定期清理过期缓存')
        suggestions.push('     - 使用 LRU 算法')
      }
    })
  }

  // 通用建议
  suggestions.push('\n⚡ 通用优化:')
  suggestions.push('   • 使用 NODE_OPTIONS="--max-old-space-size=4096" 限制内存')
  suggestions.push('   • 定期运行: node scripts/clean.js 清理缓存')
  suggestions.push('   • 监控内存使用: node scripts/performance-monitor.js')
  suggestions.push('   • 优化 Worker 进程管理，及时释放资源')

  return suggestions
}

// 5. 应用内存优化配置
function applyMemoryOptimizations() {
  console.log('\n⚙️  5. 应用内存优化配置...')

  const optimizations = []

  // 检查并优化 package.json 脚本
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))

  // 确保有内存优化的启动脚本
  if (!packageJson.scripts['start:optimized']) {
    packageJson.scripts['start:optimized'] =
      'NODE_OPTIONS="--max-old-space-size=4096" electron-forge start'
    optimizations.push('   ✓ 添加优化的启动脚本')
  }

  if (!packageJson.scripts['build:optimized']) {
    packageJson.scripts['build:optimized'] =
      'NODE_OPTIONS="--max-old-space-size=4096" electron-vite build'
    optimizations.push('   ✓ 添加优化的构建脚本')
  }

  // 保存更新
  fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2))

  // 创建内存优化的环境变量文件
  const envContent = `# 内存优化配置
NODE_OPTIONS="--max-old-space-size=4096"
ELECTRON_BUILDER_CACHE=".electron-builder-cache"
VITE_CACHE_DIR=".vite-cache"
`
  fs.writeFileSync('.env.memory', envContent)
  optimizations.push('   ✓ 创建 .env.memory 配置文件')

  return optimizations
}

// 6. 生成内存报告
function generateMemoryReport(metrics, largeDeps, risks, suggestions, optimizations) {
  console.log('\n📄 6. 生成内存优化报告...')

  const reportData = {
    timestamp: new Date().toISOString(),
    summary: {
      memoryUsage: metrics,
      largeDependencies: largeDeps.length,
      memoryRisks: risks.length,
      optimizations: optimizations.length
    },
    details: {
      memoryMetrics: metrics,
      largeDependencies: largeDeps,
      memoryRisks: risks,
      suggestions: suggestions,
      appliedOptimizations: optimizations
    },
    recommendations: suggestions
  }

  const reportPath = path.join(__dirname, '../memory-optimization-report.json')
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2))

  console.log(`   ✓ 报告已保存: ${reportPath}`)

  return reportData
}

// 主函数
function main() {
  console.log('🚀 内存优化流程开始\n')

  // 执行优化步骤
  const metrics = analyzeMemoryUsage()
  const largeDeps = checkLargeDependencies()
  const risks = checkMemoryLeaks()
  const suggestions = generateOptimizationSuggestions(largeDeps, risks)
  const optimizations = applyMemoryOptimizations()
  generateMemoryReport(metrics, largeDeps, risks, suggestions, optimizations)

  // 显示总结
  console.log('\n' + '═'.repeat(60))
  console.log('🎯 内存优化总结')
  console.log('═'.repeat(60))

  console.log(`📊 内存使用: ${metrics.rss}`)
  console.log(`📦 大型依赖: ${largeDeps.length} 个`)
  console.log(`⚠️ 内存风险: ${risks.length} 个`)
  console.log(`💡 优化建议: ${suggestions.length} 条`)
  console.log(`✅ 已应用: ${optimizations.length} 项`)

  console.log('\n💡 关键建议:')
  suggestions.slice(0, 5).forEach((s) => {
    if (s.trim()) console.log(`   ${s}`)
  })

  console.log('\n⚡ 下一步:')
  console.log('   1. 查看详细报告: memory-optimization-report.json')
  console.log('   2. 使用优化脚本: pnpm run start:optimized')
  console.log('   3. 监控内存: node scripts/performance-monitor.js --realtime')
  console.log('   4. 定期清理: node scripts/clean.js')

  console.log('\n✅ 内存优化完成！')
}

// 运行主函数
main()
