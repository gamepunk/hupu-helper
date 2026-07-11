# 虎扑助手

全网表情包收藏工具 — 在任何网站的图片上右键保存为表情包，在虎扑评论区快速上传使用。

## 功能

| 功能 | 说明 |
|------|------|
| **全网收藏** | 在**任意网站**的图片上右键 →「保存为表情包」，自动存入本地 |
| **表情选择器** | 虎扑评论区工具栏点击「表情包」按钮 → 选择表情 → 自动上传 |
| **最近使用** | 虎扑评论区底部显示最近使用的表情，点击直接上传 |
| **导入导出** | Popup 页面支持批量导入/导出表情包，方便备份和迁移 |
| **表情管理** | Popup 页面查看/删除表情，点击图片跳转原始来源，悬停显示删除按钮 |

## 安装

### Chrome 网上应用店

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-立即安装-4285F4?logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore/detail/hupu-helper)

### 开发者模式加载

```bash
# 1. 克隆仓库
git clone https://github.com/gamepunk/hupu-helper.git
cd hupu-helper

# 2. 安装依赖
bun install

# 3. 构建
bun run build

# 4. 加载到 Chrome
#    打开 chrome://extensions → 开启开发者模式 → 加载已解压的扩展 → 选择 dist/ 目录
```

## 使用指南

1. 在**任意网站**上看到喜欢的图片 → **右键** → **保存为表情包**
2. 打开虎扑帖子，进入评论区
3. 点击工具栏的 **表情包** 按钮 → 选择表情 → 自动上传
4. 也可以在评论区底部的 **最近使用** 栏直接点击上传
5. 点击扩展图标 → Popup 弹窗管理所有收藏的表情

## 隐私

本扩展**不会收集任何用户数据**。所有表情数据仅存储在浏览器本地（IndexedDB），不会上传到任何服务器。

## 开发

```bash
# 安装依赖
bun install

# 开发模式（监听文件变化自动构建）
bun run dev

# 构建
bun run build

# 类型检查
bun run typecheck

# 打包（生成 hupu-helper.zip）
bun run zip
```

## 更新日志

### v1.0.1

- � **全网收藏**：右键菜单已不限域名，任意网站图片都可保存为表情包
- 🎨 Popup 页面白底改版，表情网格布局优化
- 🗑️ 删除按钮改为右上角 SVG 垃圾桶图标，悬停显示
- 👆 点击表情图片跳转到原始来源页面
- 📥 支持表情包的导入/导出（保留时间戳）
- 💬 表情选择器改为弹出面板风格（圆角卡片）
- 🖼️ 支持 `bbsactivity.hupu.com`、`m.hupu.com` 右键保存
- 🧹 清理死代码，修复 `sorted` 未定义 bug
- 🔧 右键菜单保存失败时自动降级到后台直接保存
- 🛡️ 权限限定 `bbs.hupu.com`，`hoopchina.com.cn` 仅作图片 CDN

### v1.0.0

- 初始发布：右键保存表情包、评论区表情选择器、最近使用、Popup 管理

## 技术栈

- **语言**：TypeScript
- **构建**：Bun
- **框架**：Chrome Extension Manifest V3
- **存储**：IndexedDB（本地存储）

## 许可

MIT
