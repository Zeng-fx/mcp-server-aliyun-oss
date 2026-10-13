#!/usr/bin/env node
/**
 * 阿里云 OSS Model Context Protocol (MCP) 服务端入口
 * 
 * 本服务基于 Anthropic 官方推出的 Model Context Protocol (@modelcontextprotocol/sdk) 构建。
 * 运行方式：通过标准输入输出 (stdio) 与 AI 客户端（如 Antigravity、Cursor、Claude Desktop 等）进行 JSON-RPC 通信。
 * 
 * 支持的媒体类型：图片、视频、音频、文档、字体、动画 JSON 等各类前端静态资源。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import { z } from 'zod';
import {
  batchUploadFiles,
  checkExists,
  createFolder,
  deleteObjectOrFolder,
  listFiles,
  replaceFile,
  uploadFile,
} from './oss.js';

// 读取并加载本地 .env 环境变量文件（如果存在）
dotenv.config();

// 初始化 MCP 服务实例，声明服务名称与版本
const server = new McpServer({
  name: 'aliyun-oss',
  version: '1.0.0',
});

/**
 * --------------------------------------------------------------------------
 * 工具 1: oss_upload_file
 * 作用: 将本地文件（图片、视频、音频、文档等）上传到阿里云 OSS，返回公网/CDN 链接
 * --------------------------------------------------------------------------
 */
server.tool(
  'oss_upload_file',
  '将本地文件（图片、视频、音频、文档等各类资源）上传到阿里云 OSS，并返回公网/CDN 访问链接。',
  {
    // 本地文件绝对路径（必须提供）
    filePath: z.string().describe('本地文件的绝对路径，例如: C:/Users/xxx/Pictures/banner.png 或 C:/Users/xxx/Videos/demo.mp4'),
    // 目标存储目录（可选）
    targetDir: z.string().optional().describe('OSS 上的目标存储目录（例如: "prototypes/home/" 或 "videos/"）。未传入时默认使用环境变量 OSS_DEFAULT_PREFIX 或根目录'),
    // 自定义文件名（可选）
    fileName: z.string().optional().describe('可选的自定义文件名（需包含扩展名，如 "feature-banner.png" 或 "demo.mp4"）。若不填则沿用本地原文件名'),
    // 超大图片是否强制原图上传（可选）
    allowOversized: z.boolean().optional().describe('若上传的是图片且体积超过 20MB（OSS 图片处理服务将无法生成缩略图），是否仍然强制原图上传。视频及普通文件不受此限制。默认 false'),
  },
  async ({ filePath, targetDir, fileName, allowOversized }) => {
    try {
      const defaultPrefix = process.env.OSS_DEFAULT_PREFIX || '';
      const dir = targetDir !== undefined ? targetDir : defaultPrefix;

      const result = await uploadFile({ filePath, targetDir: dir, fileName, allowOversized });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `文件上传失败：${error.message || String(error)}`,
          },
        ],
      };
    }
  }
);

/**
 * --------------------------------------------------------------------------
 * 工具 2: oss_list_files
 * 作用: 查询并列出阿里云 OSS 中指定前缀目录下的文件（图片、视频等）与目录列表
 * --------------------------------------------------------------------------
 */
server.tool(
  'oss_list_files',
  '根据目录前缀查询并列出阿里云 OSS 中存储的文件（图片、视频、文档等）及子目录列表。',
  {
    // 目录搜索前缀（可选）
    prefix: z.string().optional().describe('搜索目录前缀（例如: "prototypes/home/" 或 "videos/"）。留空表示从根目录开始搜索'),
    // 返回数量限制（可选）
    maxKeys: z.number().optional().describe('本次查询返回的最大文件数量（范围 1-100，默认 20 条）'),
    // 分页游标（可选）
    marker: z.string().optional().describe('分页游标标记（用于获取下一页数据）'),
    // 目录折叠分隔符（可选）
    delimiter: z.string().optional().describe('目录折叠分隔符（通常传入 "/"）。传入 "/" 时只列出当前层级的文件与子文件夹，不会递归深入遍历所有子文件，速度极快'),
  },
  async ({ prefix, maxKeys, marker, delimiter }) => {
    try {
      const result = await listFiles({ prefix, maxKeys, marker, delimiter });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `查询文件列表失败：${error.message || String(error)}`,
          },
        ],
      };
    }
  }
);

/**
 * --------------------------------------------------------------------------
 * 工具 3: oss_create_folder
 * 作用: 在阿里云 OSS 中创建一个虚拟文件夹/目录
 * --------------------------------------------------------------------------
 */
server.tool(
  'oss_create_folder',
  '在阿里云 OSS 中创建一个目录/文件夹。',
  {
    folderPath: z.string().describe('需要创建的目录路径（例如: "prototypes/v2/" 或 "videos/"）。末尾斜杠会自动补齐'),
  },
  async ({ folderPath }) => {
    try {
      const result = await createFolder({ folderPath });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `创建目录失败：${error.message || String(error)}`,
          },
        ],
      };
    }
  }
);

/**
 * --------------------------------------------------------------------------
 * 工具 4: oss_batch_upload
 * 作用: 批量并发上传本地多个文件（图片、视频等）到阿里云 OSS，返回所有文件的 CDN 链接映射表
 * --------------------------------------------------------------------------
 */
server.tool(
  'oss_batch_upload',
  '批量并发上传本地多个文件（图片、视频、音频等）或扫描整个本地文件夹上传到阿里云 OSS，支持并发控制与扩展名过滤。',
  {
    // 本地多个文件路径列表（与 directoryPath 选填其一）
    filePaths: z.array(z.string()).optional().describe('本地文件的绝对路径数组，例如: ["C:/path/a.png", "C:/path/demo.mp4"]'),
    // 本地目录路径（与 filePaths 选填其一）
    directoryPath: z.string().optional().describe('本地文件夹的绝对路径（会自动扫描该目录下所有有效文件批量上传）'),
    // 允许的扩展名过滤列表（可选）
    extensions: z.array(z.string()).optional().describe('可选。扫描本地文件夹时允许的扩展名列表（例如 [".png", ".jpg", ".mp4", ".webp"]）。若不传则上传目录下所有有效文件'),
    // OSS 目标存储目录（可选）
    targetDir: z.string().optional().describe('OSS 上的目标存储目录（例如: "prototypes/home/"）。未传入时使用默认前缀'),
    // 最大并发数（可选）
    concurrency: z.number().optional().describe('最大并发上传数（默认 5，范围 1~20，平滑网络带宽峰值，防止频控）'),
    // 超大图片是否强制原图上传（可选）
    allowOversized: z.boolean().optional().describe('若存在超过 20MB 的图片（无法生成缩略图），是否仍然强制原图上传。视频及普通文件不受此限制。默认 false'),
  },
  async ({ filePaths, directoryPath, extensions, targetDir, concurrency, allowOversized }) => {
    try {
      const defaultPrefix = process.env.OSS_DEFAULT_PREFIX || '';
      const dir = targetDir !== undefined ? targetDir : defaultPrefix;
      const result = await batchUploadFiles({
        filePaths,
        directoryPath,
        extensions,
        targetDir: dir,
        concurrency,
        allowOversized,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `批量上传失败：${error.message || String(error)}`,
          },
        ],
      };
    }
  }
);

/**
 * --------------------------------------------------------------------------
 * 工具 5: oss_delete
 * 作用: 删除阿里云 OSS 中的单个文件、多个文件，或递归删除整个文件夹
 * 防护机制: 
 *   1. 严格防呆：严禁删除根目录、空路径及系统关键保护前缀
 *   2. 两阶段预检确认：首次调用仅返回受影响的文件与目录详细清单；只有经用户在聊天中明确同意后，传入 confirmed: true 才能物理删除
 * --------------------------------------------------------------------------
 */
server.tool(
  'oss_delete',
  '删除阿里云 OSS 中的文件或目录。内置两阶段安全确认机制：首次调用只做预检安全扫描，列出所有受影响的文件与目录详细清单；只有经用户核对并明确同意后，传入 confirmed: true 才能真正执行物理删除。',
  {
    // 待删除的文件路径或文件夹路径（必填）
    paths: z.union([z.string(), z.array(z.string())]).describe('待删除的 OSS 存储路径。支持单个字符串或数组，例如: "prototypes/home/banner.png" 或 ["a.png", "video.mp4"] 或 "prototypes/temp/"。严禁传空或根目录'),
    // 是否为目录（可选）
    isFolder: z.boolean().optional().describe('是否为目录删除。若为 true，会递归删除该目录下的所有文件并移除目录'),
    // 用户确认标志（必填流程项）
    confirmed: z.boolean().optional().describe('是否已得到用户的明确同意确认。首次调用绝不能传 true（必须留空或传 false），工具将输出受影响的文件明细供用户审核；只有当用户在对话中明确回复同意删除后，才传入 confirmed: true 真正执行删除'),
  },
  async ({ paths, isFolder, confirmed }) => {
    try {
      const result = await deleteObjectOrFolder({ paths, isFolder, confirmed });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `删除操作被拦截或失败：${error.message || String(error)}`,
          },
        ],
      };
    }
  }
);

/**
 * --------------------------------------------------------------------------
 * 工具 6: oss_check_exists
 * 作用: 批量或单个检查文件在阿里云 OSS 中是否存在（HTTP HEAD 零流量消耗）
 * --------------------------------------------------------------------------
 */
server.tool(
  'oss_check_exists',
  '检查一个或多个文件在阿里云 OSS 中是否存在（支持批量并发检查）。使用 HTTP HEAD 请求快速判定，零带宽消耗。',
  {
    ossKeys: z.union([z.string(), z.array(z.string())]).optional().describe('需要检查的 OSS 文件路径（单个字符串或数组，例如: "banner.png" 或 ["a.png", "demo.mp4"]）'),
    ossKey: z.string().optional().describe('旧版单路径参数（建议使用 ossKeys）'),
  },
  async ({ ossKeys, ossKey }) => {
    try {
      const targetKeys = ossKeys || ossKey;
      if (!targetKeys) {
        throw new Error('必须提供 ossKeys 参数指定要检查的路径。');
      }

      const result = await checkExists({ ossKeys: targetKeys });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `检查文件是否存在失败：${error.message || String(error)}`,
          },
        ],
      };
    }
  }
);

/**
 * --------------------------------------------------------------------------
 * 工具 7: oss_replace_file
 * 作用: 替换/更新 OSS 中已存在的文件（图片、视频等），并自动触发阿里云 CDN 单文件缓存刷新（Purge）
 * 防护机制:
 *   1. 权限预检拦截：若 AccessKey 缺少 CDN 刷新权限，暂停并提示用户决策是否覆盖
 *   2. 免费额度保护：每日 10,000 条免费刷新额度用尽时立即停止，绝不产生额外计费
 *   3. 严格单文件刷新：严禁通配符（*）与目录（/）刷新，仅刷新单张文件纯净链接
 *   4. URL 纯净：返回替换自定义域名的纯净公开链接，绝无任何 ?v= 时间戳版本号参数
 *   5. 20MB 超大图片拦截：针对图片格式继承 OSS 20MB 缩略图服务限制防护，视频不受此限制
 * --------------------------------------------------------------------------
 */
server.tool(
  'oss_replace_file',
  '替换/更新阿里云 OSS 中已存在的文件（图片、视频、音频等各类静态资源），并自动触发阿里云 CDN 单文件缓存刷新（Purge）。内置权限预检、免费额度耗尽防护与单文件严格限制，返回无版本号参数的纯净 CDN 链接。',
  {
    // 待替换的目标文件（必填）
    target: z.string().describe('待替换的目标文件（可以是完整 CDN 访问 URL，例如 "https://musetopia-us.museselect.com/prototypes/banner.webp" 或 "https://musetopia-us.museselect.com/videos/demo.mp4"，也可以是 OSS 存储路径）'),
    // 本地新文件路径（必填）
    newFilePath: z.string().describe('本地新文件的绝对路径，例如: C:/Users/xxx/Pictures/new-banner.webp 或 C:/Users/xxx/Videos/new-demo.mp4'),
    // 超大图片是否强制原图上传（可选）
    allowOversized: z.boolean().optional().describe('若上传的是图片且体积超过 20MB（OSS 图片处理将无法生成缩略图），是否仍然强制原图上传。视频及普通文件不受此限制。默认 false'),
    // CDN 异常时是否强制覆盖（可选）
    forceOverwriteWithoutCdn: z.boolean().optional().describe('若检测到缺少 CDN 刷新权限或今日免费刷新额度已用尽，是否仍然强行覆盖 OSS 原文件（跳过 CDN 缓存刷新）。默认 false（会暂停并请求用户确认）'),
  },
  async ({ target, newFilePath, allowOversized, forceOverwriteWithoutCdn }) => {
    try {
      const result = await replaceFile({
        target,
        newFilePath,
        allowOversized,
        forceOverwriteWithoutCdn,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `替换文件失败：${error.message || String(error)}`,
          },
        ],
      };
    }
  }
);

/**
 * 服务端主入口：启动 MCP 服务并通过 Stdio 标准输入输出与 AI 宿主建立通信连接
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('阿里云 OSS MCP 服务已成功启动（通信模式: stdio）');
}

// 捕获顶层未捕获的异常并安全退出
main().catch((err) => {
  console.error('阿里云 OSS MCP 服务启动异常：', err);
  process.exit(1);
});
