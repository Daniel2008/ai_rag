# Windows 任务栏图标修复指南

## 🔍 问题描述

应用打开后，任务栏图标显示一半或不完整。这通常是因为 ICO 文件缺少必要的尺寸或格式不正确。

## 🎯 解决方案

### 方法 1: 使用修复脚本（推荐）

```bash
pnpm run icon:fix-windows
```

这个脚本会：
- 检查源图标文件
- 使用 ImageMagick（如果已安装）生成高质量的 ICO 文件
- 确保包含所有必要的尺寸：16x16, 32x32, 48x48, 256x256
- 如果 ImageMagick 未安装，会回退到 electron-icon-builder

### 方法 2: 手动生成 ICO 文件

#### 使用 ImageMagick（最佳质量）

1. **安装 ImageMagick**
   - 下载：https://imagemagick.org/script/download.php
   - 选择 Windows 版本并安装

2. **生成 ICO 文件**
   ```bash
   magick convert build/icon.png -define icon:auto-resize=256,128,96,64,48,32,24,16 build/icon.ico
   ```

#### 使用在线工具

1. 访问以下任一工具：
   - https://convertio.co/zh/png-ico/
   - https://www.icoconverter.com/
   - https://cloudconvert.com/png-to-ico

2. 上传 `build/icon.png`（1024x1024 像素）

3. **重要**：选择包含以下尺寸：
   - 16x16（任务栏小图标）
   - 32x32（任务栏标准图标）
   - 48x48（桌面图标）
   - 256x256（高分辨率显示）

4. 下载并保存为 `build/icon.ico`

### 方法 3: 使用专业工具

- **IcoFX**: https://icofx.ro/
- **Greenfish Icon Editor Pro**: http://greenfishsoftware.org/gfie.php
- **GIMP** (免费): https://www.gimp.org/

## ✅ 验证修复

### 1. 检查 ICO 文件

```bash
# 检查文件是否存在
ls -lh build/icon.ico

# Windows PowerShell
Get-Item build/icon.ico | Select-Object Name, Length
```

### 2. 预览图标

- 双击 `build/icon.ico` 文件
- 应该能看到图标预览，显示多个尺寸

### 3. 重新构建应用

```bash
pnpm run build:win:fast
```

### 4. 测试任务栏图标

1. 运行构建后的应用
2. 检查任务栏图标是否完整显示
3. 如果仍然有问题，继续下面的步骤

## 🔧 清除 Windows 图标缓存

如果重新构建后图标仍然不正确，可能需要清除 Windows 图标缓存：

### 方法 1: 使用命令（推荐）

```powershell
# 以管理员身份运行 PowerShell

# 停止资源管理器
taskkill /f /im explorer.exe

# 删除图标缓存
Remove-Item "$env:LOCALAPPDATA\IconCache.db" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache*.db" -Force -ErrorAction SilentlyContinue

# 重启资源管理器
Start-Process explorer.exe
```

### 方法 2: 手动删除

1. 按 `Win + R`，输入 `%LOCALAPPDATA%`
2. 删除 `IconCache.db` 文件
3. 进入 `Microsoft\Windows\Explorer\` 目录
4. 删除所有 `iconcache*.db` 文件
5. 重启资源管理器（任务管理器 → 资源管理器 → 重新启动）

## 📋 ICO 文件要求

### 必需尺寸

Windows 任务栏和系统需要以下尺寸：

| 尺寸 | 用途 |
|------|------|
| 16x16 | 任务栏小图标、系统托盘 |
| 24x24 | 任务栏中等图标（高 DPI） |
| 32x32 | 任务栏标准图标 |
| 48x48 | 桌面图标、快捷方式 |
| 64x64 | 高 DPI 桌面图标 |
| 96x96 | 高 DPI 显示 |
| 128x128 | 大图标视图 |
| 256x256 | 高分辨率显示、Windows 10/11 |

### 推荐配置

- **最小配置**: 16, 32, 48, 256
- **推荐配置**: 16, 24, 32, 48, 64, 96, 128, 256
- **最佳配置**: 16, 24, 32, 48, 64, 96, 128, 256, 512

## 🐛 常见问题

### Q: 图标仍然显示一半

**A**: 尝试以下步骤：
1. 确保 ICO 文件包含 16x16 和 32x32 尺寸
2. 清除 Windows 图标缓存（见上方）
3. 重启应用
4. 检查 ICO 文件大小（应该 > 10KB）

### Q: 图标模糊

**A**: 
1. 确保源 PNG 文件至少 1024x1024 像素
2. 使用 ImageMagick 生成 ICO（质量更好）
3. 确保包含 256x256 尺寸

### Q: 图标不显示

**A**:
1. 检查 `build/icon.ico` 文件是否存在
2. 验证 `package.json` 中的 `icon` 路径正确
3. 重新构建应用
4. 检查构建日志是否有错误

### Q: 不同 DPI 显示不一致

**A**:
1. 确保 ICO 文件包含多个尺寸（16, 32, 48, 256）
2. 使用 ImageMagick 的 `auto-resize` 选项
3. 测试不同 DPI 设置（100%, 125%, 150%, 200%）

## 💡 最佳实践

1. **使用高质量源图**: 1024x1024 像素 PNG，透明背景
2. **包含所有尺寸**: 确保 ICO 文件包含 16, 32, 48, 256 尺寸
3. **测试不同 DPI**: 在不同缩放比例下测试图标显示
4. **清除缓存**: 构建后清除 Windows 图标缓存
5. **使用专业工具**: ImageMagick 或专业图标编辑器

## 📚 相关资源

- [Electron Builder 图标配置](https://www.electron.build/icons)
- [Windows 图标指南](https://docs.microsoft.com/en-us/windows/win32/uxguide/vis-icons)
- [ImageMagick 文档](https://imagemagick.org/script/command-line-options.php#define)

