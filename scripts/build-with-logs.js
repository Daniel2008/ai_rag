#!/usr/bin/env node
/**
 * 带详细日志的构建脚本
 * 提供构建进度和性能分析
 */
const { spawn } = require('child_process')
const path = require('path')

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function formatTime(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 60000).toFixed(2)}m`
}

// 解析命令行参数
const args = process.argv.slice(2)
const buildType = args[0] || 'win'
const isFast = args.includes('--fast')
const isDebug = args.includes('--debug')

log('\n🚀 开始 Electron 应用构建...', 'cyan')
log(`📦 构建类型: ${buildType}`, 'blue')
log(`⚡ 快速模式: ${isFast ? '是' : '否'}`, 'blue')
log(`🐛 调试模式: ${isDebug ? '是' : '否'}`, 'blue')
log('─'.repeat(60), 'cyan')

const startTime = Date.now()
let currentStep = ''
let stepStartTime = 0

// 构建步骤
const steps = {
  typecheck: '类型检查',
  vite: 'Vite 构建',
  builder: 'Electron Builder 打包'
}

function startStep(step) {
  if (currentStep) {
    const duration = Date.now() - stepStartTime
    log(`✅ ${steps[currentStep]} 完成 (${formatTime(duration)})`, 'green')
  }
  currentStep = step
  stepStartTime = Date.now()
  log(`\n📝 开始: ${steps[step]}...`, 'yellow')
}

// 执行构建
async function build() {
  try {
    // 步骤 1: 类型检查（如果不是快速模式）
    if (!isFast) {
      startStep('typecheck')
      await runCommand('npm', ['run', 'typecheck'], {
        stdio: 'inherit',
        env: { ...process.env, FORCE_COLOR: '1' }
      })
    } else {
      log('\n⏭️  跳过类型检查（快速模式）', 'yellow')
    }

    // 步骤 2: Vite 构建
    startStep('vite')
    await runCommand('npm', ['run', 'build:fast'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        NODE_ENV: 'production',
        DEBUG: isDebug ? 'vite:*' : undefined
      }
    })

    // 步骤 3: Electron Builder
    startStep('builder')
    const builderArgs = []

    // 根据构建类型选择命令
    if (buildType === 'win') {
      builderArgs.push('run', 'build:win:fast')
    } else if (buildType === 'mac') {
      builderArgs.push('run', 'build:mac')
    } else if (buildType === 'linux') {
      builderArgs.push('run', 'build:linux')
    } else {
      builderArgs.push('run', `build:${buildType}:fast`)
    }

    if (isDebug) {
      builderArgs.push('--debug')
    }

    await runCommand('npm', builderArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        DEBUG: isDebug ? 'electron-builder' : undefined,
        ELECTRON_BUILDER_CACHE: path.join(__dirname, '../.electron-builder-cache')
      }
    })

    // 完成
    if (currentStep) {
      const duration = Date.now() - stepStartTime
      log(`✅ ${steps[currentStep]} 完成 (${formatTime(duration)})`, 'green')
    }

    const totalTime = Date.now() - startTime
    log('\n' + '═'.repeat(60), 'green')
    log(`🎉 构建完成！总耗时: ${formatTime(totalTime)}`, 'green')
    log('═'.repeat(60) + '\n', 'green')
  } catch (error) {
    const totalTime = Date.now() - startTime
    log('\n' + '═'.repeat(60), 'red')
    log(`❌ 构建失败！耗时: ${formatTime(totalTime)}`, 'red')
    log(`错误: ${error.message}`, 'red')
    log('═'.repeat(60) + '\n', 'red')
    process.exit(1)
  }
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      shell: true,
      cwd: path.join(__dirname, '..')
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`命令执行失败，退出码: ${code}`))
      }
    })

    proc.on('error', (error) => {
      reject(error)
    })
  })
}

build()
