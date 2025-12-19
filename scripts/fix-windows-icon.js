#!/usr/bin/env node
/**
 * 修复 Windows 任务栏图标显示问题
 * 确保 ICO 文件包含所有必要的尺寸
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
const iconIco = path.join(buildDir, 'icon.ico')

log('\n🔧 修复 Windows 任务栏图标...', 'cyan')
log('─'.repeat(60), 'cyan')

// 检查源图标
if (!fs.existsSync(iconPng)) {
  log('❌ 错误: build/icon.png 不存在！', 'red')
  log('请先准备一个 1024x1024 像素的 PNG 图标文件', 'yellow')
  process.exit(1)
}

try {
  // 检查是否安装了 ImageMagick
  let hasImageMagick = false
  try {
    execSync('magick -version', { stdio: 'ignore' })
    hasImageMagick = true
  } catch {
    log('⚠️  未检测到 ImageMagick，将使用 electron-icon-builder', 'yellow')
  }

  if (hasImageMagick) {
    log('\n📦 使用 ImageMagick 生成高质量 ICO 文件...', 'blue')

    // 使用 ImageMagick 生成包含所有必要尺寸的 ICO
    // Windows 任务栏需要：16x16, 32x32, 48x48, 256x256
    const command = `magick convert "${iconPng}" -define icon:auto-resize=256,128,96,64,48,32,24,16 "${iconIco}"`

    log(`执行命令: ${command}`, 'yellow')
    execSync(command, { stdio: 'inherit', cwd: path.join(__dirname, '..') })

    log('\n✅ ICO 文件已生成（包含所有必要尺寸）', 'green')
  } else {
    log('\n📦 使用 electron-icon-builder 生成图标...', 'blue')

    const command = `npx electron-icon-builder --input=${iconPng} --output=${buildDir} --flatten`
    execSync(command, { stdio: 'inherit', cwd: path.join(__dirname, '..') })

    log('\n⚠️  建议：安装 ImageMagick 以获得更好的图标质量', 'yellow')
    log('下载地址: https://imagemagick.org/script/download.php', 'yellow')
  }

  // 验证文件
  if (fs.existsSync(iconIco)) {
    const stats = fs.statSync(iconIco)
    const sizeKB = (stats.size / 1024).toFixed(2)
    log(`\n✅ 图标文件: ${path.basename(iconIco)} (${sizeKB} KB)`, 'green')

    if (parseFloat(sizeKB) < 10) {
      log('⚠️  警告: ICO 文件可能太小，可能缺少某些尺寸', 'yellow')
    }
  } else {
    log('❌ 错误: ICO 文件生成失败', 'red')
    process.exit(1)
  }

  log('\n💡 下一步:', 'cyan')
  log('  1. 重新构建应用: pnpm run build:win:fast', 'yellow')
  log('  2. 如果图标仍然显示不正确，请尝试:', 'yellow')
  log('     - 清除 Windows 图标缓存', 'yellow')
  log('     - 重启 Windows 资源管理器', 'yellow')
  log('     - 确保 ICO 文件包含 16x16, 32x32, 48x48, 256x256 尺寸', 'yellow')
  log('─'.repeat(60) + '\n', 'cyan')
} catch (error) {
  log('\n❌ 图标生成失败！', 'red')
  log(`错误: ${error.message}`, 'red')
  log('\n💡 替代方案:', 'yellow')
  log('  1. 使用在线工具手动生成:', 'yellow')
  log('     https://convertio.co/zh/png-ico/', 'yellow')
  log('     https://www.icoconverter.com/', 'yellow')
  log('  2. 确保选择包含以下尺寸: 16, 32, 48, 256', 'yellow')
  log('  3. 将生成的 ICO 文件保存为 build/icon.ico', 'yellow')
  process.exit(1)
}
