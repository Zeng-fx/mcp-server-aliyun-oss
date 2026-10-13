# 🚀 mcp-server-aliyun-oss

[![npm version](https://img.shields.io/npm/v/mcp-server-aliyun-oss.svg?style=flat-square)](https://www.npmjs.com/package/mcp-server-aliyun-oss)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![MCP Compliant](https://img.shields.io/badge/MCP-Compatible-blue.svg?style=flat-square)](https://modelcontextprotocol.io/)

专为 AI Agent（Cursor / Antigravity / Claude Desktop / Windsurf 等）量身打造的**阿里云 OSS & CDN 静态资产全能管理插件**。

支持前端网页、移动端开发及设计原型中的各类静态资源（图片、视频、音频、文档、Lottie 动画等）的**上传、批量导入、路径探测、安全删除与智能替换**，并原生支持**阿里云 CDN 缓存自动刷新（Purge）与免费额度熔断保护**。

---

## ✨ 核心特性

- ⚡ **零安装即用（npx 支持）**：通过 `npx -y mcp-server-aliyun-oss` 即可在各大 AI 编辑器中一键运行。
- 🔄 **智能替换 & CDN 缓存即时刷新**：更新原图或视频后，自动调用阿里云 CDN 单文件刷新接口（全球节点 5~10 秒内生效），**返回纯净 URL，绝不拼接丑陋的 `?v=timestamp` 版本号参数**。
- 🛡️ **双重安全防线**：
  - **免费额度防护**：严格单文件刷新（禁止通配符 `*` 与目录 `/` 刷新），每日 10,000 条免费额度耗尽自动拦截，绝不偷偷产生额外账单。
  - **20MB 超大图片拦截**：针对图片格式继承阿里云 OSS 图片处理服务（缩略图、WebP、裁剪）的 20MB 上限防护。
  - **路径黑名单防呆**：根目录与系统保护目录禁止误删。
- 📦 **高性能批量并发**：支持批量并发上传、目录深度扫描、扩展名过滤与并发流控。

---

## 🛠️ 包含的 7 大工具

| 工具名称 | 功能描述 |
| :--- | :--- |
| `oss_upload_file` | 本地单文件上传，返回公网/CDN 链接（图片内置 20MB 限制拦截） |
| `oss_batch_upload` | 批量并发上传文件或扫描本地文件夹上传，支持并发控制与扩展名过滤 |
| `oss_replace_file` | 替换/更新已存在的文件，并自动触发阿里云 CDN 单文件缓存刷新 |
| `oss_check_exists` | 基于 HTTP HEAD 请求并发探测文件是否存在，**零带宽消耗** |
| `oss_list_files` | 根据前缀查询文件列表，支持目录折叠（`delimiter: "/"`）快速获取结构 |
| `oss_create_folder` | 在 OSS 中创建虚拟目录/文件夹 |
| `oss_delete` | 删除单文件、批量文件或递归删除目录（内置两阶段安全确认防呆） |

---

## ⚡ 快速接入配置

无需手动克隆代码，直接在您使用的 AI 客户端配置文件中添加以下配置即可：

### 1. Cursor (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "aliyun-oss": {
      "command": "npx",
      "args": ["-y", "mcp-server-aliyun-oss"],
      "env": {
        "OSS_ACCESS_KEY_ID": "你的AccessKeyId",
        "OSS_ACCESS_KEY_SECRET": "你的AccessKeySecret",
        "OSS_BUCKET": "你的Bucket名称",
        "OSS_REGION": "oss-cn-hangzhou",
        "OSS_CUSTOM_DOMAIN": "https://img.yourdomain.com"
      }
    }
  }
}
```

### 2. Antigravity (`~/.gemini/config/mcp_config.json`)
```json
{
  "mcpServers": {
    "aliyun-oss": {
      "command": "npx",
      "args": ["-y", "mcp-server-aliyun-oss"],
      "env": {
        "OSS_ACCESS_KEY_ID": "你的AccessKeyId",
        "OSS_ACCESS_KEY_SECRET": "你的AccessKeySecret",
        "OSS_BUCKET": "你的Bucket名称",
        "OSS_REGION": "oss-cn-hangzhou",
        "OSS_CUSTOM_DOMAIN": "https://img.yourdomain.com"
      }
    }
  }
}
```

### 3. Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "aliyun-oss": {
      "command": "npx",
      "args": ["-y", "mcp-server-aliyun-oss"],
      "env": {
        "OSS_ACCESS_KEY_ID": "你的AccessKeyId",
        "OSS_ACCESS_KEY_SECRET": "你的AccessKeySecret",
        "OSS_BUCKET": "你的Bucket名称",
        "OSS_REGION": "oss-cn-hangzhou",
        "OSS_CUSTOM_DOMAIN": "https://img.yourdomain.com"
      }
    }
  }
}
```

### 4. Claude Code (CLI 终端交互)

**方式 A：终端一键添加（推荐）**
```bash
claude mcp add aliyun-oss npx -y mcp-server-aliyun-oss \
  -e OSS_ACCESS_KEY_ID="你的AccessKeyId" \
  -e OSS_ACCESS_KEY_SECRET="你的AccessKeySecret" \
  -e OSS_BUCKET="你的Bucket名称" \
  -e OSS_REGION="oss-cn-hangzhou" \
  -e OSS_CUSTOM_DOMAIN="https://img.yourdomain.com"
```

**方式 B：项目级配置（`.mcp.json`）**  
在项目根目录新建 `.mcp.json`，Claude Code 启动时会自动加载：
```json
{
  "mcpServers": {
    "aliyun-oss": {
      "command": "npx",
      "args": ["-y", "mcp-server-aliyun-oss"],
      "env": {
        "OSS_ACCESS_KEY_ID": "你的AccessKeyId",
        "OSS_ACCESS_KEY_SECRET": "你的AccessKeySecret",
        "OSS_BUCKET": "你的Bucket名称",
        "OSS_REGION": "oss-cn-hangzhou",
        "OSS_CUSTOM_DOMAIN": "https://img.yourdomain.com"
      }
    }
  }
}
```

### 5. Codex (`~/.codex/config.json` 或 `.codex/mcp.json`)
```json
{
  "mcpServers": {
    "aliyun-oss": {
      "command": "npx",
      "args": ["-y", "mcp-server-aliyun-oss"],
      "env": {
        "OSS_ACCESS_KEY_ID": "你的AccessKeyId",
        "OSS_ACCESS_KEY_SECRET": "你的AccessKeySecret",
        "OSS_BUCKET": "你的Bucket名称",
        "OSS_REGION": "oss-cn-hangzhou",
        "OSS_CUSTOM_DOMAIN": "https://img.yourdomain.com"
      }
    }
  }
}
```

---

## 💬 实际使用交互示例（Claude Code / Codex / Cursor）

配置完成后，AI Agent 会自动感知并调用这 7 项工具。您可以在终端或聊天框中直接发送日常自然语言指令：

### 场景 1：上传前端素材并自动替换组件中的路径
> **User**：  
> `帮我把本地 src/assets/hero-banner.png 上传到 OSS 的 home 目录下，并把 Banner.vue 里的本地图片路径替换为生成的 CDN 地址。`  
>  
> **Agent**：  
> 1. 调用 `oss_upload_file`，上传至 `home/hero-banner.png`；  
> 2. 获取纯净 CDN 链接：`https://img.yourdomain.com/home/hero-banner.png`；  
> 3. 自动修改 `Banner.vue` 中的 `<img src="..." />` 并保存。

### 场景 2：更新已有图片并秒级刷新 CDN 缓存
> **User**：  
> `设计同学给我发了新版登录背景图 new-bg.png，帮我替换线上已有的 https://img.yourdomain.com/auth/bg.png，并且刷新 CDN。`  
>  
> **Agent**：  
> 1. 调用 `oss_replace_file`，安全覆盖 OSS 原图；  
> 2. 自动检查 RAM 权限与每日免费刷新额度；  
> 3. 触发阿里云 CDN 单文件 Purge 任务（全球节点 5~10 秒内生效，无需拼接任何 `?v=123` 时间戳）；  
> 4. 输出替换确认与新老文件体积对比。

### 场景 3：批量导入本地文件夹资源
> **User**：  
> `把 public/icons 目录下的所有 svg 和 png 图标批量并发上传到 OSS 的 common/icons/ 目录下，返回 URL 映射字典。`  
>  
> **Agent**：  
> 调用 `oss_batch_upload`，按指定并发数上传并自动返回 `{ "home.svg": "https://...", "user.png": "https://..." }`。

---

## ⚙️ 环境变量说明

| 环境变量 | 必填 | 默认值 | 说明 |
| :--- | :---: | :--- | :--- |
| `OSS_ACCESS_KEY_ID` | **是** | - | 阿里云 RAM 访问密钥 AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | **是** | - | 阿里云 RAM 访问密钥 AccessKey Secret |
| `OSS_BUCKET` | **是** | - | OSS 存储空间（Bucket）名称 |
| `OSS_REGION` | **是** | `oss-cn-hangzhou` | 数据中心地域代码（如 `oss-cn-shanghai`、`oss-cn-beijing`） |
| `OSS_CUSTOM_DOMAIN` | 否 | - | 自定义绑定的 CDN 加速域名（如 `https://img.yourdomain.com`） |
| `OSS_DEFAULT_PREFIX` | 否 | - | 默认存储目录前缀（如 `prototypes/`） |
| `OSS_PROTECTED_PREFIXES` | 否 | - | 受保护的目录黑名单（逗号分隔，禁止删除或覆盖） |

> [!TIP]
> 若需使用 `oss_replace_file` 的自动刷新 CDN 功能，请确保 RAM 账号策略包含 `cdn:DescribeRefreshQuota` 和 `cdn:RefreshObjectCaches`（或直接授予 `AliyunCDNFullAccess` 权限）。

---

## 💻 本地源码开发与调试

如果您希望克隆源码并在本地进行二次开发：

```bash
# 1. 克隆仓库
git clone https://github.com/Zeng-fx/mcp-server-aliyun-oss.git
cd mcp-server-aliyun-oss

# 2. 安装依赖
npm install

# 3. 编译 TypeScript
npm run build

# 4. 本地运行调试
node dist/index.js
```

---

## 📄 开源许可

本项目遵循 [MIT License](LICENSE) 开源协议。
