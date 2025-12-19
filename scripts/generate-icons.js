#!/usr/bin/env node
/**
 * 图标生成脚本
 * 从 build/icon.png 生成所有平台所需的图标格式
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

const buildDir = path.join(__dirname, '..', 'build')
const iconPng = path.join(buildDir, 'icon.png')

// 检查源图标是否存在
if (!fs.existsSync(iconPng)) {
  log('❌ 错误: build/icon.png 不存在！', 'red')
  log('请先准备一个 1024x1024 像素的 PNG 图标文件', 'yellow')
  process.exit(1)
}

log('\n🎨 开始生成应用图标...', 'cyan')
log('─'.repeat(60), 'cyan')

try {
  // 使用 electron-icon-builder 生成图标
  log('\n📦 使用 electron-icon-builder 生成图标...', 'blue')

  const command = `npx electron-icon-builder --input=${iconPng} --output=${buildDir} --flatten`

  log(`执行命令: ${command}`, 'yellow')

  execSync(command, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  })

  log('\n✅ 图标生成完成！', 'green')
  log('─'.repeat(60), 'cyan')

  // 检查生成的文件
  const files = {
    'Windows (.ico)': path.join(buildDir, 'icon.ico'),
    'macOS (.icns)': path.join(buildDir, 'icon.icns'),
    'Linux (.png)': iconPng
  }

  log('\n📋 生成的图标文件:', 'cyan')
  for (const [platform, filePath] of Object.entries(files)) {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath)
      const sizeKB = (stats.size / 1024).toFixed(2)
      log(`  ✅ ${platform}: ${path.basename(filePath)} (${sizeKB} KB)`, 'green')
    } else {
      log(`  ⚠️  ${platform}: 未生成`, 'yellow')
    }
  }

  log('\n💡 提示:', 'cyan')
  log('  1. 如果某些图标未生成，请检查 electron-icon-builder 是否正确安装', 'yellow')
  log('  2. 确保源图标 (icon.png) 至少为 1024x1024 像素', 'yellow')
  log('  3. 可以手动使用在线工具生成缺失的图标格式', 'yellow')
  log('  4. 重新构建应用以应用新图标: pnpm run build:win:fast', 'yellow')
  log('─'.repeat(60) + '\n', 'cyan')
} catch (error) {
  log('\n❌ 图标生成失败！', 'red')
  log(`错误: ${error.message}`, 'red')
  log('\n💡 替代方案:', 'yellow')
  log('  1. 使用在线工具手动生成:', 'yellow')
  log('     - Windows: https://convertio.co/zh/png-ico/', 'yellow')
  log('     - macOS: https://convertio.co/zh/png-icns/', 'yellow')
  log('  2. 将生成的图标保存到 build/ 目录', 'yellow')
  log('  3. 确保文件名为 icon.ico (Windows) 和 icon.icns (macOS)', 'yellow')
  process.exit(1)
}
