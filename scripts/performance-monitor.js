#!/usr/bin/env node
/**
 * 高级性能监控脚本
 * 实时监控内存、CPU使用情况和应用性能指标
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const os = require('os')

console.log('🔍 开始高级性能监控...\n')

// 配置
const CONFIG = {
  // 监控间隔（毫秒）
  interval: 5000,

  // 警告阈值
  thresholds: {
    memory: 80, // 80% 内存使用率
    cpu: 70, // 70% CPU 使用率
    disk: 85 // 85% 磁盘使用率
  },

  // 需要监控的进程
  targetProcesses: ['electron', 'node', 'ZhiHui']
}

// 系统信息收集
function getSystemInfo() {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const memUsage = (usedMem / totalMem) * 100

  const cpus = os.cpus()
  const cpuUsage = getCPUUsage()

  return {
    timestamp: new Date().toISOString(),
    memory: {
      total: (totalMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      used: (usedMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      free: (freeMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      usage: memUsage.toFixed(2) + '%'
    },
    cpu: {
      usage: cpuUsage.toFixed(2) + '%',
      cores: cpus.length,
      model: cpus[0].model
    },
    load: os.loadavg()
  }
}

// 获取 CPU 使用率（跨平台）
function getCPUUsage() {
  try {
    // Windows 特定的 CPU 监控
    if (process.platform === 'win32') {
      return getWindowsCPUUsage()
    }
    // macOS/Linux 使用 os.loadavg
    const load = os.loadavg()[0]
    return Math.min((load / os.cpus().length) * 100, 100)
  } catch (_e) {
    return 0
  }
}

// Windows CPU 使用率
function getWindowsCPUUsage() {
  try {
    // 使用 wmic 命令获取 CPU 使用率
    const output = execSync('wmic cpu get loadpercentage', { encoding: 'utf8' })
    const match = output.match(/(\d+)/)
    return match ? parseFloat(match[1]) : 0
  } catch (_e) {
    return 0
  }
}

// 获取进程信息
function getProcessInfo() {
  try {
    let command
    if (process.platform === 'win32') {
      command = 'tasklist /FO CSV /NH'
    } else if (process.platform === 'darwin') {
      command = 'ps -eo pid,%cpu,%mem,comm | grep -E "(electron|node)"'
    } else {
      command = 'ps -eo pid,%cpu,%mem,comm | grep -E "(electron|node)"'
    }

    const output = execSync(command, { encoding: 'utf8' })
    const lines = output.split('\n').filter((line) => line.trim())

    const processes = lines
      .filter((line) =>
        CONFIG.targetProcesses.some((proc) => line.toLowerCase().includes(proc.toLowerCase()))
      )
      .map((line) => {
        const parts = line.split(',').map((p) => p.replace(/"/g, '').trim())
        if (process.platform === 'win32') {
          return {
            name: parts[0],
            pid: parts[1],
            memory: parts[4],
            cpu: 'N/A' // Windows tasklist 不显示 CPU
          }
        } else {
          return {
            pid: parts[0],
            cpu: parts[1] + '%',
            memory: parts[2] + '%',
            name: parts[3]
          }
        }
      })

    return processes
  } catch (_e) {
    return []
  }
}

// 检查磁盘空间
function getDiskInfo() {
  try {
    if (process.platform === 'win32') {
      const output = execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf8' })
      const lines = output.split('\n').filter((l) => l.trim())
      const drives = lines
        .slice(1)
        .map((line) => {
          const parts = line.trim().split(/\s+/)
          if (parts.length >= 3) {
            const total = parseFloat(parts[1]) || 0
            const free = parseFloat(parts[2]) || 0
            const used = total - free
            const usage = total > 0 ? (used / total) * 100 : 0
            return {
              drive: parts[0],
              total: (total / 1024 / 1024 / 1024).toFixed(2) + ' GB',
              free: (free / 1024 / 1024 / 1024).toFixed(2) + ' GB',
              usage: usage.toFixed(2) + '%'
            }
          }
          return null
        })
        .filter((d) => d)
      return drives
    }
    return []
  } catch (_e) {
    return []
  }
}

// 检查项目特定指标
function getProjectMetrics() {
  const metrics = {
    nodeModulesSize: '0 MB',
    distSize: '0 MB',
    cacheSize: '0 MB'
  }

  try {
    // 计算 node_modules 大小
    const nodeModulesPath = path.join(__dirname, '../node_modules')
    if (fs.existsSync(nodeModulesPath)) {
      const size = getDirectorySize(nodeModulesPath)
      metrics.nodeModulesSize = (size / 1024 / 1024).toFixed(2) + ' MB'
    }

    // 计算 dist 大小
    const distPath = path.join(__dirname, '../dist')
    if (fs.existsSync(distPath)) {
      const size = getDirectorySize(distPath)
      metrics.distSize = (size / 1024 / 1024).toFixed(2) + ' MB'
    }

    // 计算缓存大小
    const cachePaths = [
      path.join(__dirname, '../node_modules/.vite'),
      path.join(__dirname, '../node_modules/.cache'),
      path.join(__dirname, '../.electron-builder-cache')
    ]

    let cacheSize = 0
    cachePaths.forEach((cachePath) => {
      if (fs.existsSync(cachePath)) {
        cacheSize += getDirectorySize(cachePath)
      }
    })
    metrics.cacheSize = (cacheSize / 1024 / 1024).toFixed(2) + ' MB'
  } catch (_e) {
    // 忽略错误
  }

  return metrics
}

// 递归计算目录大小
function getDirectorySize(dir) {
  let size = 0
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true })
    for (const item of items) {
      const fullPath = path.join(dir, item.name)
      if (item.isDirectory()) {
        size += getDirectorySize(fullPath)
      } else {
        try {
          const stats = fs.statSync(fullPath)
          size += stats.size
        } catch (_e) {
          // 忽略无法访问的文件
        }
      }
    }
  } catch (_e) {
    // 忽略错误
  }
  return size
}

// 检查警告
function checkWarnings(systemInfo, processes, diskInfo, projectMetrics) {
  const warnings = []

  // 内存警告
  const memUsage = parseFloat(systemInfo.memory.usage)
  if (memUsage > CONFIG.thresholds.memory) {
    warnings.push(`⚠️ 内存使用率过高: ${systemInfo.memory.usage}`)
  }

  // CPU 警告
  const cpuUsage = parseFloat(systemInfo.cpu.usage)
  if (cpuUsage > CONFIG.thresholds.cpu) {
    warnings.push(`⚠️ CPU 使用率过高: ${systemInfo.cpu.usage}`)
  }

  // 磁盘警告
  diskInfo.forEach((disk) => {
    const usage = parseFloat(disk.usage)
    if (usage > CONFIG.thresholds.disk) {
      warnings.push(`⚠️ 磁盘使用率过高 (${disk.drive}): ${disk.usage}`)
    }
  })

  // 项目大小警告
  const distSizeMB = parseFloat(projectMetrics.distSize)
  if (distSizeMB > 500) {
    warnings.push(`⚠️ 构建产物过大: ${projectMetrics.distSize}`)
  }

  const cacheSizeMB = parseFloat(projectMetrics.cacheSize)
  if (cacheSizeMB > 200) {
    warnings.push(`⚠️ 缓存过大: ${projectMetrics.cacheSize}`)
  }

  return warnings
}

// 生成优化建议
function generateSuggestions(systemInfo, processes, diskInfo, projectMetrics, warnings) {
  const suggestions = []

  if (warnings.length === 0) {
    suggestions.push('✅ 系统状态良好！')
    return suggestions
  }

  // 基于警告生成建议
  if (warnings.some((w) => w.includes('内存'))) {
    suggestions.push('💡 内存优化建议:')
    suggestions.push('   • 运行: node scripts/clean.js 清理缓存')
    suggestions.push('   • 重启应用释放内存')
    suggestions.push('   • 检查是否有内存泄漏')
  }

  if (warnings.some((w) => w.includes('CPU'))) {
    suggestions.push('💡 CPU 优化建议:')
    suggestions.push('   • 关闭不必要的应用')
    suggestions.push('   • 检查后台进程')
    suggestions.push('   • 降低并发处理数量')
  }

  if (warnings.some((w) => w.includes('磁盘'))) {
    suggestions.push('💡 磁盘优化建议:')
    suggestions.push('   • 清理系统临时文件')
    suggestions.push('   • 删除旧的构建产物')
    suggestions.push('   • 检查下载目录')
  }

  if (warnings.some((w) => w.includes('构建产物'))) {
    suggestions.push('💡 构建优化建议:')
    suggestions.push('   • 运行: pnpm run clean')
    suggestions.push('   • 检查 electron-builder 配置')
    suggestions.push('   • 考虑使用更激进的压缩')
  }

  if (warnings.some((w) => w.includes('缓存'))) {
    suggestions.push('💡 缓存优化建议:')
    suggestions.push('   • 运行: node scripts/clean.js')
    suggestions.push('   • 定期清理构建缓存')
    suggestions.push('   • 监控缓存增长趋势')
  }

  return suggestions
}

// 实时监控模式
function startRealtimeMonitoring() {
  console.log('🔄 启动实时监控模式...')
  console.log(`监控间隔: ${CONFIG.interval}ms`)
  console.log('按 Ctrl+C 退出\n')

  let cycle = 0

  const monitor = setInterval(() => {
    cycle++
    console.log(`\n📊 监控周期 #${cycle} - ${new Date().toLocaleTimeString()}`)
    console.log('═'.repeat(60))

    // 收集数据
    const systemInfo = getSystemInfo()
    const processes = getProcessInfo()
    const diskInfo = getDiskInfo()
    const projectMetrics = getProjectMetrics()
    const warnings = checkWarnings(systemInfo, processes, diskInfo, projectMetrics)
    const suggestions = generateSuggestions(
      systemInfo,
      processes,
      diskInfo,
      projectMetrics,
      warnings
    )

    // 显示系统信息
    console.log('\n🖥️  系统状态:')
    console.log(
      `   内存: ${systemInfo.memory.used} / ${systemInfo.memory.total} (${systemInfo.memory.usage})`
    )
    console.log(`   CPU: ${systemInfo.cpu.usage} (${systemInfo.cpu.cores} 核心)`)
    console.log(`   负载: ${systemInfo.load.map((v) => v.toFixed(2)).join(', ')}`)

    // 显示进程信息
    if (processes.length > 0) {
      console.log('\n🔧 相关进程:')
      processes.forEach((proc) => {
        console.log(`   ${proc.name} (PID: ${proc.pid}) - CPU: ${proc.cpu}, 内存: ${proc.memory}`)
      })
    }

    // 显示磁盘信息
    if (diskInfo.length > 0) {
      console.log('\n💾 磁盘使用:')
      diskInfo.forEach((disk) => {
        console.log(`   ${disk.drive}: ${disk.free} 可用 / ${disk.total} 总计 (${disk.usage})`)
      })
    }

    // 显示项目指标
    console.log('\n📁 项目指标:')
    console.log(`   node_modules: ${projectMetrics.nodeModulesSize}`)
    console.log(`   dist: ${projectMetrics.distSize}`)
    console.log(`   缓存: ${projectMetrics.cacheSize}`)

    // 显示警告和建议
    if (warnings.length > 0) {
      console.log('\n⚠️  警告:')
      warnings.forEach((w) => console.log(`   ${w}`))
    }

    console.log('\n💡 建议:')
    suggestions.forEach((s) => console.log(`   ${s}`))

    console.log('\n' + '═'.repeat(60))
  }, CONFIG.interval)

  // 处理退出
  process.on('SIGINT', () => {
    clearInterval(monitor)
    console.log('\n\n🛑 监控已停止')
    process.exit(0)
  })
}

// 单次检查模式
function singleCheck() {
  console.log('🔍 执行单次性能检查...\n')

  const systemInfo = getSystemInfo()
  const processes = getProcessInfo()
  const diskInfo = getDiskInfo()
  const projectMetrics = getProjectMetrics()
  const warnings = checkWarnings(systemInfo, processes, diskInfo, projectMetrics)
  const suggestions = generateSuggestions(systemInfo, processes, diskInfo, projectMetrics, warnings)

  // 生成报告
  const report = {
    timestamp: new Date().toISOString(),
    systemInfo,
    processes,
    diskInfo,
    projectMetrics,
    warnings,
    suggestions
  }

  // 保存报告
  const reportPath = path.join(__dirname, '../performance-report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  // 显示摘要
  console.log('📊 性能检查摘要:')
  console.log(`   内存使用: ${systemInfo.memory.usage}`)
  console.log(`   CPU 使用: ${systemInfo.cpu.usage}`)
  console.log(`   警告数量: ${warnings.length}`)
  console.log(`   建议数量: ${suggestions.length}`)

  if (warnings.length > 0) {
    console.log('\n⚠️  发现的问题:')
    warnings.forEach((w) => console.log(`   ${w}`))
  }

  console.log('\n💡 优化建议:')
  suggestions.forEach((s) => console.log(`   ${s}`))

  console.log(`\n📄 详细报告已保存: ${reportPath}`)
}

// 解析命令行参数
const args = process.argv.slice(2)
const isRealtime = args.includes('--realtime') || args.includes('-r')
const intervalArg = args.find((arg) => arg.startsWith('--interval='))
if (intervalArg) {
  CONFIG.interval = parseInt(intervalArg.split('=')[1]) || 5000
}

if (isRealtime) {
  startRealtimeMonitoring()
} else {
  singleCheck()
}
