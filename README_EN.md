<div align="right">
  <b>Language:</b> <a href="./README.md"><b>中文</b></a> | <a href="./README_EN.md"><b>English</b></a>
</div>

# 🚀 mcp-server-aliyun-oss

[![npm version](https://img.shields.io/npm/v/mcp-server-aliyun-oss.svg?style=flat-square)](https://www.npmjs.com/package/mcp-server-aliyun-oss)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![MCP Compliant](https://img.shields.io/badge/MCP-Compatible-blue.svg?style=flat-square)](https://modelcontextprotocol.io/)

A production-ready **Model Context Protocol (MCP)** server for **Alibaba Cloud OSS & CDN** designed specifically for AI Agents (Cursor, Antigravity, Claude Code, Codex, Claude Desktop, Windsurf, etc.).

It empowers AI assistants with full-lifecycle management of frontend static assets (images, videos, audios, documents, Lottie JSON, etc.), including **upload, batch concurrent processing, existence probing, safe deletion, and smart file replacement with automatic Alibaba Cloud CDN single-file cache purge (Purge) and free quota safeguard**.

---

## 📑 Table of Contents

* [✨ Key Features](#-key-features)
* [⚡ Quick Start Configuration for AI Clients](#-quick-start-configuration-for-ai-clients)
  * [1. Cursor](#1-cursor-cursormcpjson)
  * [2. Antigravity](#2-antigravity-geminiconfigmcp_configjson)
  * [3. Claude Code (Terminal CLI)](#3-claude-code-terminal-cli)
  * [4. Codex](#4-codex-codexconfigjson-or-codexmcpjson)
  * [5. Claude Desktop](#5-claude-desktop-claude_desktop_configjson)
* [🛠️ Included 7 Core Tools & Detailed Examples](#️-included-7-core-tools--detailed-examples)
* [💬 Real-World Prompt Examples](#-real-world-prompt-examples-claude-code--codex--cursor)
* [⚙️ Environment Variables Reference](#️-environment-variables-reference)
* [💻 Local Development & Debugging](#-local-development--debugging)
* [📄 License](#-license)

---

## ✨ Key Features

- ⚡ **Zero-Install (npx Support)**: Run instantly with `npx -y mcp-server-aliyun-oss` in any modern AI IDE or CLI agent without cloning or installing dependencies.
- 🔄 **Smart Replace & Instant CDN Purge**: When overwriting an asset, it automatically calls the Alibaba Cloud CDN single-file purge API (takes effect globally within 5~10s). **Returns clean URLs with zero dirty `?v=timestamp` query strings**.
- 🛡️ **Dual Security Safeguards**:
  - **Free Quota Guard**: Strict single-file purge (wildcard `*` and directory `/` purges are strictly forbidden). Automatically halts if daily free 10,000 URL purge quota is exhausted, preventing unexpected cloud billing.
  - **20MB Image Size Guard**: Inherits Alibaba Cloud OSS image processing service's 20MB upper limit, preventing loss of thumbnail/WebP/crop processing capabilities.
  - **Protected Paths**: Root and critical blacklisted prefixes are protected from accidental deletion or overwrite.
- 📦 **High-Performance Batch Concurrency**: Supports recursive directory scanning, file extension filtering, and smooth concurrency throttling.

---

## ⚡ Quick Start Configuration for AI Clients

Add the following configuration to your AI client's settings:

### 1. Cursor (`.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "aliyun-oss": {
      "command": "npx",
      "args": ["-y", "mcp-server-aliyun-oss"],
      "env": {
        "OSS_ACCESS_KEY_ID": "YourAccessKeyId",
        "OSS_ACCESS_KEY_SECRET": "YourAccessKeySecret",
        "OSS_BUCKET": "YourBucketName",
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
        "OSS_ACCESS_KEY_ID": "YourAccessKeyId",
        "OSS_ACCESS_KEY_SECRET": "YourAccessKeySecret",
        "OSS_BUCKET": "YourBucketName",
        "OSS_REGION": "oss-cn-hangzhou",
        "OSS_CUSTOM_DOMAIN": "https://img.yourdomain.com"
      }
    }
  }
}
```

### 3. Claude Code (Terminal CLI)

**Method A: One-line CLI Command (Recommended)**
```bash
claude mcp add aliyun-oss npx -y mcp-server-aliyun-oss \
  -e OSS_ACCESS_KEY_ID="YourAccessKeyId" \
  -e OSS_ACCESS_KEY_SECRET="YourAccessKeySecret" \
  -e OSS_BUCKET="YourBucketName" \
  -e OSS_REGION="oss-cn-hangzhou" \
  -e OSS_CUSTOM_DOMAIN="https://img.yourdomain.com"
```

**Method B: Project-level configuration (`.mcp.json`)**  
Place `.mcp.json` in your project root; Claude Code will load it automatically on startup:
```json
{
  "mcpServers": {
    "aliyun-oss": {
      "command": "npx",
      "args": ["-y", "mcp-server-aliyun-oss"],
      "env": {
        "OSS_ACCESS_KEY_ID": "YourAccessKeyId",
        "OSS_ACCESS_KEY_SECRET": "YourAccessKeySecret",
        "OSS_BUCKET": "YourBucketName",
        "OSS_REGION": "oss-cn-hangzhou",
        "OSS_CUSTOM_DOMAIN": "https://img.yourdomain.com"
      }
    }
  }
}
```

### 4. Codex (`~/.codex/config.json` or `.codex/mcp.json`)
```json
{
  "mcpServers": {
    "aliyun-oss": {
      "command": "npx",
      "args": ["-y", "mcp-server-aliyun-oss"],
      "env": {
        "OSS_ACCESS_KEY_ID": "YourAccessKeyId",
        "OSS_ACCESS_KEY_SECRET": "YourAccessKeySecret",
        "OSS_BUCKET": "YourBucketName",
        "OSS_REGION": "oss-cn-hangzhou",
        "OSS_CUSTOM_DOMAIN": "https://img.yourdomain.com"
      }
    }
  }
}
```

### 5. Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "aliyun-oss": {
      "command": "npx",
      "args": ["-y", "mcp-server-aliyun-oss"],
      "env": {
        "OSS_ACCESS_KEY_ID": "YourAccessKeyId",
        "OSS_ACCESS_KEY_SECRET": "YourAccessKeySecret",
        "OSS_BUCKET": "YourBucketName",
        "OSS_REGION": "oss-cn-hangzhou",
        "OSS_CUSTOM_DOMAIN": "https://img.yourdomain.com"
      }
    }
  }
}
```

---

## 🛠️ Included 7 Core Tools & Detailed Examples

| Tool Name | Description |
| :--- | :--- |
| `oss_upload_file` | Upload a local file to OSS, returning a clean public/CDN URL (with 20MB image guard) |
| `oss_batch_upload` | Batch upload multiple files or recursively scan a local directory with concurrency control |
| `oss_replace_file` | Replace an existing file in OSS and auto-purge Alibaba Cloud CDN edge cache |
| `oss_check_exists` | Probe whether one or more files exist in OSS via HTTP HEAD requests (**zero bandwidth**) |
| `oss_list_files` | List files and folders with prefix filtering and folder collapse (`delimiter: "/"`) |
| `oss_create_folder` | Create a virtual directory/folder in the OSS bucket |
| `oss_delete` | Safely delete single/batch files or directories with a two-phase approval mechanism |

---

### 1. `oss_upload_file`: Single File Upload
Uploads a single local file (image, video, audio, document, Lottie animation, etc.) to OSS and returns a clean public/CDN URL.

* **Parameters**:
  * `filePath` (required, `string`): Absolute path to the local file.
  * `targetDir` (optional, `string`): Destination directory in OSS. Defaults to `OSS_DEFAULT_PREFIX`.
  * `fileName` (optional, `string`): Custom file name (including extension). Defaults to original file name.
  * `allowOversized` (optional, `boolean`): Force upload if an image exceeds 20MB. Default `false`.
* **Prompt Example**:
  > "Upload local file `C:/Users/xxx/Pictures/banner.webp` to OSS folder `prototypes/home/` as `main-banner.webp`"
* **AI Tool Call**:
  ```json
  {
    "filePath": "C:/Users/xxx/Pictures/banner.webp",
    "targetDir": "prototypes/home/",
    "fileName": "main-banner.webp"
  }
  ```

---

### 2. `oss_batch_upload`: Batch Concurrent Upload
Uploads multiple explicit file paths or recursively scans an entire local folder.

* **Parameters**:
  * `directoryPath` (optional, `string`): Local directory path to recursively scan and upload.
  * `filePaths` (optional, `string[]`): Array of explicit local file paths.
  * `extensions` (optional, `string[]`): File extension whitelist (e.g. `[".png", ".webp", ".svg"]`).
  * `targetDir` (optional, `string`): Destination OSS directory.
  * `concurrency` (optional, `number`): Maximum concurrent uploads (default `5`, range `1~20`).
* **Prompt Example**:
  > "Batch upload all `.svg` and `.png` icons in `D:/project/assets/icons` to OSS folder `common/icons/` with concurrency 5"
* **AI Tool Call**:
  ```json
  {
    "directoryPath": "D:/project/assets/icons",
    "extensions": [".svg", ".png"],
    "targetDir": "common/icons/",
    "concurrency": 5
  }
  ```
* **Result**: Returns a structured mapping dictionary: `{ "icon1.svg": "https://...", "icon2.png": "https://..." }`.

---

### 3. `oss_replace_file`: Smart File Replace & CDN Cache Purge
Replaces an existing file in OSS and automatically triggers a single-file cache purge on Alibaba Cloud CDN.

* **Parameters**:
  * `target` (required, `string`): Target file to replace (accepts full CDN URL or relative OSS path).
  * `newFilePath` (required, `string`): Absolute path to the new local file.
  * `allowOversized` (optional, `boolean`): Allow overwrite if new image exceeds 20MB. Default `false`.
  * `forceOverwriteWithoutCdn` (optional, `boolean`): Overwrite OSS file even if CDN purge fails or quota is exhausted. Default `false`.
* **Prompt Example**:
  > "Replace online image `https://img.yourdomain.com/banners/hero.jpg` with local file `C:/export/hero-v2.jpg` and purge CDN cache"
* **AI Tool Call**:
  ```json
  {
    "target": "https://img.yourdomain.com/banners/hero.jpg",
    "newFilePath": "C:/export/hero-v2.jpg"
  }
  ```
* **Advantage**: The returned URL is clean without ugly `?v=timestamp` hacks. Global CDN edge nodes update within 5~10 seconds.

---

### 4. `oss_check_exists`: Zero-Bandwidth File Probing
Uses HTTP HEAD requests to quickly verify if files exist in OSS without consuming download traffic.

* **Parameters**:
  * `ossKeys` (required, `string | string[]`): Single file path or array of paths to check.
* **Prompt Example**:
  > "Check if `videos/demo.mp4` and `videos/tutorial.mp4` exist in OSS"
* **AI Tool Call**:
  ```json
  {
    "ossKeys": ["videos/demo.mp4", "videos/tutorial.mp4"]
  }
  ```
* **Result**: `{ total: 2, existsCount: 1, summaryMap: { "videos/demo.mp4": true, "videos/tutorial.mp4": false } }`.

---

### 5. `oss_list_files`: Query Files & Folders
Supports delimiter mode to browse directory hierarchies like a local filesystem.

* **Parameters**:
  * `prefix` (optional, `string`): Directory prefix (e.g. `"prototypes/"`).
  * `maxKeys` (optional, `number`): Maximum results to return (default `20`, max `100`).
  * `delimiter` (optional, `string`): Delimiter character (pass `"/"` to group folders without deep recursion).
  * `marker` (optional, `string`): Pagination cursor.
* **Prompt Example**:
  > "List all files and subdirectories under `prototypes/` in OSS"
* **AI Tool Call**:
  ```json
  {
    "prefix": "prototypes/",
    "delimiter": "/",
    "maxKeys": 30
  }
  ```

---

### 6. `oss_create_folder`: Create Virtual Folder
Creates a virtual directory structure in the OSS bucket.

* **Parameters**:
  * `folderPath` (required, `string`): Target directory path (automatically ensures trailing `/`).
* **Prompt Example**:
  > "Create a new folder `marketing/2026-spring/` in OSS"
* **AI Tool Call**:
  ```json
  {
    "folderPath": "marketing/2026-spring/"
  }
  ```

---

### 7. `oss_delete`: Safe Deletion with Two-Phase Approval
Deletes single files, batch files, or entire folders. Enforces a **two-phase confirmation safety mechanism** to prevent accidental data loss.

* **Parameters**:
  * `paths` (required, `string | string[]`): File path(s) or folder path to delete.
  * `isFolder` (optional, `boolean`): Set to `true` to recursively delete all files in the directory.
  * `confirmed` (optional, `boolean`): User confirmation flag. Must be `false` on initial call to output affected file preview; set to `true` only after user explicitly agrees.
* **Prompt Interaction Flow**:
  1. **User**: "Clean up test folder `test/cache/` in OSS"
  2. **AI (Phase 1: Pre-check Scan)**:  
     Calls `oss_delete(paths: "test/cache/", isFolder: true, confirmed: false)` and lists the 6 affected files, asking for user confirmation.
  3. **User**: "Confirmed, proceed with deletion"
  4. **AI (Phase 2: Execution)**:  
     Calls `oss_delete(paths: "test/cache/", isFolder: true, confirmed: true)` to physically remove the files.

---

## 💬 Real-World Prompt Examples (Claude Code / Codex / Cursor)

Once configured, your AI Agent will automatically detect and invoke the MCP tools using standard natural language requests:

### Scenario 1: Uploading UI Assets & Auto-Replacing Code References
> **User**:  
> `Upload local file src/assets/hero-banner.png to OSS folder home/ and replace the local image path in Banner.vue with the generated CDN URL.`  
>  
> **Agent**:  
> 1. Invokes `oss_upload_file` to upload `home/hero-banner.png`;  
> 2. Retrieves clean CDN URL: `https://img.yourdomain.com/home/hero-banner.png`;  
> 3. Updates `<img src="..." />` in `Banner.vue` and saves the file.

### Scenario 2: Overwriting Existing Asset with Instant CDN Cache Purge
> **User**:  
> `The designer sent a new login background new-bg.png. Replace the existing https://img.yourdomain.com/auth/bg.png and purge CDN cache.`  
>  
> **Agent**:  
> 1. Invokes `oss_replace_file` to overwrite the OSS object;  
> 2. Verifies RAM permissions and remaining daily free purge quota;  
> 3. Triggers Alibaba Cloud CDN single-file Purge task (active globally in 5~10s with no URL timestamps);  
> 4. Outputs file size comparison and confirmation.

### Scenario 3: Batch Importing Assets Directory
> **User**:  
> `Batch upload all svg and png icons in public/icons to OSS common/icons/ and return the URL mapping dictionary.`  
>  
> **Agent**:  
> Invokes `oss_batch_upload` with concurrency throttling and returns `{ "home.svg": "https://...", "user.png": "https://..." }`.

---

## ⚙️ Environment Variables Reference

| Environment Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `OSS_ACCESS_KEY_ID` | **Yes** | - | Alibaba Cloud RAM AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | **Yes** | - | Alibaba Cloud RAM AccessKey Secret |
| `OSS_BUCKET` | **Yes** | - | OSS Bucket name |
| `OSS_REGION` | **Yes** | `oss-cn-hangzhou` | Data center region code (e.g. `oss-cn-shanghai`, `oss-cn-beijing`) |
| `OSS_CUSTOM_DOMAIN` | No | - | Custom CDN acceleration domain (e.g. `https://img.yourdomain.com`) |
| `OSS_DEFAULT_PREFIX` | No | - | Default upload directory prefix (e.g. `prototypes/`) |
| `OSS_PROTECTED_PREFIXES` | No | - | Comma-separated blacklisted prefixes protected from deletion or overwrite |

> [!TIP]
> For automatic CDN purge with `oss_replace_file`, ensure your RAM credentials have `cdn:DescribeRefreshQuota` and `cdn:RefreshObjectCaches` permissions (or `AliyunCDNFullAccess`).

---

## 💻 Local Development & Debugging

If you wish to clone the repository and develop locally:

```bash
# 1. Clone the repository
git clone https://github.com/Zeng-fx/mcp-server-aliyun-oss.git
cd mcp-server-aliyun-oss

# 2. Install dependencies
npm install

# 3. Build TypeScript
npm run build

# 4. Run locally
node dist/index.js
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
