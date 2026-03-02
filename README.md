# constansino Bilibili Subtitle Extractor Pro

一个用于 B 站视频字幕提取的 Tampermonkey 油猴脚本，支持字幕可视化、搜索、复制与导出。

## 功能特性

- 自动识别当前视频的字幕轨道
- 支持多语言轨道切换
- 支持字幕关键字搜索
- 一键复制：纯文本、时间轴文本、SRT
- 一键导出：TXT、SRT、VTT、JSON
- 支持 B 站单页切换（不刷新页面）自动重新拉取字幕
- 已修复常见的 `Failed to fetch` 字幕正文拉取失败问题

## 兼容环境

- 浏览器：Chrome、Edge（最新版优先）
- 扩展：Tampermonkey（油猴）
- 站点：`https://www.bilibili.com/video/*`

## 安装方法

### 方法一：从 GitHub 直接安装（推荐）

1. 打开脚本原始地址：  
   `https://raw.githubusercontent.com/constansino/constansino-bilibili-subtitle-extractor-pro/main/bilibili-subtitle-extractor-pro.user.js`
2. 浏览器会自动唤起 Tampermonkey 安装页面
3. 点击“安装”或“重新安装”

### 方法二：本地导入

1. 打开 Tampermonkey 管理面板
2. 新建脚本并粘贴 `bilibili-subtitle-extractor-pro.user.js` 全部内容
3. 保存并启用脚本

## 使用说明

1. 打开任意 B 站视频页
2. 页面右下角点击“字幕提取”悬浮按钮
3. 在面板顶部选择字幕轨道
4. 在搜索框输入关键字进行过滤
5. 使用底部按钮复制或导出字幕

## 导出格式说明

- TXT：仅字幕正文
- SRT：标准字幕格式，适合剪映/PR 等工具
- VTT：WebVTT 格式，适合网页播放器
- JSON：结构化字幕数据，适合二次开发

## 常见问题

### 1. 提示“字幕正文拉取失败: Failed to fetch”

通常由跨域凭据策略或 `http` 字幕链接引起。当前版本已做以下修复：

- API 请求与字幕正文请求分离凭据策略
- 字幕 URL 自动升级到 `https`
- 避免不必要请求头导致的跨域问题

### 2. 面板显示“无可用字幕轨”

这通常表示视频本身没有可用字幕（含人工字幕和 AI 字幕）。

## 更新日志

### v1.1.0

- 改名为 `constansino Bilibili Subtitle Extractor Pro`
- 作者信息改为 `constansino`
- 新增项目文档
- 修复字幕正文 `Failed to fetch` 问题

## 免责声明

本项目仅供学习和个人效率用途，请遵守 B 站相关服务条款与当地法律法规。
