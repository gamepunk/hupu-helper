# 虎扑助手

虎扑社区评论区的表情包助手 — 一键保存帖子中的图片为表情包，快速上传到评论区。

## 功能

| 功能              | 说明                                                   |
| ----------------- | ------------------------------------------------------ |
| 💾 **保存表情包** | 在虎扑帖子图片上右键 → 「保存为表情包」                |
| 😜 **表情选择器** | 评论区工具栏点击 😜 按钮 → 选择已保存的表情 → 自动上传 |
| ⏱ **最近使用**    | 评论区底部显示最近使用的表情，点击直接上传             |
| 📦 **表情管理**   | 点击扩展图标 → Popup 页面查看/删除表情                 |

## 安装

### Chrome 网上应用店

[![Chrome Web Store](https://img.shields.io/badge/Chrome-安装-4285F4?logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore/detail/hupu-helper)

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

1. 打开任意虎扑帖子
2. 在图片上 **右键** → **保存为表情包**
3. 进入评论区，点击工具栏的 **😜 表情包** 按钮
4. 选择表情 → 自动添加到上传队列
5. 也可以在评论区底部的 **最近使用** 栏直接点击上传

## 隐私

所有数据仅存储在本地浏览器（IndexedDB），不会上传到任何服务器。

详见 [隐私政策](./privacy.html)。

## 开发

```bash
# 开发模式（监听文件变化自动构建）
bun run dev

# 构建
bun run build

# 类型检查
bun run typecheck

# 打包（生成 hupu-helper.zip）
bun run zip
```

## 技术栈

- **语言**：TypeScript
- **构建**：Bun
- **框架**：Chrome Extension Manifest V3
- **存储**：IndexedDB

## 许可

MIT
