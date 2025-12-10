# 应用图标生成指南

## 📱 图标要求

### Windows
- **格式**: `.ico`
- **尺寸**: 至少包含 256x256 像素
- **位置**: `build/icon.ico`
- **推荐**: 包含多个尺寸（16x16, 32x32, 48x48, 256x256）

### macOS
- **格式**: `.icns`
- **尺寸**: 至少 512x512 像素
- **位置**: `build/icon.icns`
- **推荐**: 包含多个尺寸（16x16 到 1024x1024）

### Linux
- **格式**: `.png`
- **尺寸**: 至少 512x512 像素
- **位置**: `build/icon.png`

## 🎨 准备源图标

1. **准备一个高质量的 PNG 图片**
   - 尺寸：**1024x1024 像素**（推荐）
   - 格式：PNG（透明背景）
   - 内容：应用 Logo，居中显示
   - 文件位置：`build/icon.png`

2. **设计建议**
   - 使用简洁、易识别的设计
   - 确保在小尺寸下也能清晰可见
   - 避免过多细节
   - 使用高对比度颜色

## 🚀 自动生成图标

### 方法 1: 使用内置脚本（推荐）

如果你已经有一个 `build/icon.png` 文件：

```bash
pnpm run icon:generate
```

这个命令会：
- 从 `build/icon.png` 生成所有平台所需的图标
- 自动生成 `icon.ico`（Windows）
- 自动生成 `icon.icns`（macOS）
- 输出到 `build/` 目录

### 方法 2: 手动生成

#### Windows (.ico)

**使用在线工具**:
1. 访问 https://convertio.co/zh/png-ico/ 或 https://www.icoconverter.com/
2. 上传 `build/icon.png`
3. 选择多个尺寸（16, 32, 48, 256）
4. 下载并保存为 `build/icon.ico`

**使用 ImageMagick**:
```bash
# 安装 ImageMagick 后
magick convert build/icon.png -define icon:auto-resize=256,128,96,64,48,32,16 build/icon.ico
```

#### macOS (.icns)

**使用 iconutil** (macOS 系统工具):
```bash
# 创建 iconset 目录
mkdir build/icon.iconset

# 生成各种尺寸
sips -z 16 16     build/icon.png --out build/icon.iconset/icon_16x16.png
sips -z 32 32     build/icon.png --out build/icon.iconset/icon_16x16@2x.png
sips -z 32 32     build/icon.png --out build/icon.iconset/icon_32x32.png
sips -z 64 64     build/icon.png --out build/icon.iconset/icon_32x32@2x.png
sips -z 128 128   build/icon.png --out build/icon.iconset/icon_128x128.png
sips -z 256 256   build/icon.png --out build/icon.iconset/icon_128x128@2x.png
sips -z 256 256   build/icon.png --out build/icon.iconset/icon_256x256.png
sips -z 512 512   build/icon.png --out build/icon.iconset/icon_256x256@2x.png
sips -z 512 512   build/icon.png --out build/icon.iconset/icon_512x512.png
sips -z 1024 1024 build/icon.png --out build/icon.iconset/icon_512x512@2x.png

# 转换为 icns
iconutil -c icns build/icon.iconset -o build/icon.icns

# 清理临时文件
rm -rf build/icon.iconset
```

**使用在线工具**:
- https://cloudconvert.com/png-to-icns
- https://convertio.co/zh/png-icns/

## 📝 更新配置

图标文件生成后，确保 `package.json` 中的配置正确：

```json
{
  "build": {
    "win": {
      "icon": "build/icon.ico"
    },
    "mac": {
      "icon": "build/icon.icns"
    },
    "linux": {
      "icon": "build/icon.png"
    }
  }
}
```

## ✅ 验证图标

### 检查文件是否存在
```bash
# Windows
ls build/icon.ico

# macOS
ls build/icon.icns

# Linux
ls build/icon.png
```

### 测试图标
1. **Windows**: 双击 `icon.ico` 文件，应该能看到图标预览
2. **macOS**: 在 Finder 中查看 `icon.icns`，应该显示为图标
3. **构建测试**: 运行 `pnpm run build:win:dir` 查看生成的应用程序图标

## 🔄 替换现有图标

1. **备份当前图标**（可选）
   ```bash
   cp build/icon.ico build/icon.ico.backup
   cp build/icon.icns build/icon.icns.backup
   cp build/icon.png build/icon.png.backup
   ```

2. **替换源图标**
   - 将新图标保存为 `build/icon.png`（1024x1024 PNG）

3. **重新生成图标**
   ```bash
   pnpm run icon:generate
   ```

4. **重新构建应用**
   ```bash
   pnpm run build:win:fast
   ```

## 🎯 最佳实践

1. **使用矢量图**: 如果有 SVG，先转换为 PNG（1024x1024）
2. **保持一致性**: 确保所有平台的图标设计一致
3. **测试小尺寸**: 确保图标在 16x16 像素时仍然清晰
4. **使用透明背景**: PNG 格式支持透明，效果更好
5. **定期更新**: 随着应用更新，考虑更新图标设计

## 🛠️ 工具推荐

- **在线转换**: 
  - https://convertio.co/
  - https://cloudconvert.com/
  - https://www.icoconverter.com/

- **设计工具**:
  - Figma（免费，在线）
  - Adobe Illustrator
  - GIMP（免费）

- **图标生成器**:
  - electron-icon-builder（已集成）
  - electron-icon-maker

## 📦 图标文件结构

```
build/
├── icon.png      # 源图标（1024x1024）
├── icon.ico      # Windows 图标
├── icon.icns     # macOS 图标
└── icon.svg      # 矢量源文件（可选）
```

## ⚠️ 常见问题

### 图标不显示
1. 检查文件路径是否正确
2. 确认文件格式正确（.ico, .icns, .png）
3. 重新构建应用

### 图标模糊
1. 确保源图标至少 1024x1024 像素
2. 使用高质量的源图片
3. 检查图标是否包含多个尺寸

### 图标生成失败
1. 确保 `build/icon.png` 存在
2. 检查图片尺寸是否足够大
3. 尝试手动生成图标

