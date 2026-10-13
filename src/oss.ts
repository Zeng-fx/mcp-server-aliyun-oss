import OSS from 'ali-oss';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkCdnQuota,
  refreshCdnSingleFile,
  validateSingleFileCdnUrl,
} from './cdn.js';

/**
 * 阿里云 OSS 配置项接口定义
 */
export interface OssConfig {
  /** 阿里云 AccessKey ID */
  accessKeyId: string;
  /** 阿里云 AccessKey Secret */
  accessKeySecret: string;
  /** OSS 存储空间（Bucket）名称 */
  bucket: string;
  /** 数据中心地域（例如: oss-cn-hangzhou、oss-cn-beijing） */
  region: string;
  /** 自定义绑定的 CDN/域名（例如: https://img.museselect.com） */
  customDomain?: string;
  /** 自定义 OSS 访问 Endpoint（非必填） */
  endpoint?: string;
}

// 缓存全局 OSS 客户端实例与配置，避免频繁重复实例化
let ossClient: OSS | null = null;
let currentConfig: OssConfig | null = null;

/**
 * 从系统环境变量中读取并校验 OSS 配置
 * 支持从 process.env 或项目根目录下的 .env 文件中注入
 */
export function getOssConfig(): OssConfig {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID || '';
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || '';
  const bucket = process.env.OSS_BUCKET || '';
  const region = process.env.OSS_REGION || 'oss-cn-hangzhou';
  const customDomain = process.env.OSS_CUSTOM_DOMAIN || process.env.OSS_REPLACE_DOMAIN || '';
  const endpoint = process.env.OSS_ENDPOINT || '';

  // 校验必要凭证
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('缺少阿里云凭证：请配置 OSS_ACCESS_KEY_ID 和 OSS_ACCESS_KEY_SECRET 环境变量。');
  }

  // 校验 Bucket 名称
  if (!bucket) {
    throw new Error('缺少存储空间配置：请配置 OSS_BUCKET 环境变量。');
  }

  return {
    accessKeyId,
    accessKeySecret,
    bucket,
    region,
    customDomain,
    endpoint: endpoint || undefined,
  };
}

/**
 * 获取或初始化 OSS 客户端实例（单例模式）
 */
export function getClient(): OSS {
  const config = getOssConfig();

  // 若尚未初始化或配置发生了变更，则重新创建客户端实例
  if (!ossClient || JSON.stringify(config) !== JSON.stringify(currentConfig)) {
    currentConfig = config;
    ossClient = new OSS({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      bucket: config.bucket,
      region: config.region,
      endpoint: config.endpoint,
      secure: true, // 默认强制使用 HTTPS
    });
  }

  return ossClient;
}

/**
 * 格式化资源最终访问链接（全局域名替换核心）
 * 如果配置了 OSS_CUSTOM_DOMAIN 或 OSS_REPLACE_DOMAIN（自定义 CDN/项目业务域名），
 * 则全局自动将默认的 oss 域名（如 musetopia-cn.oss-cn-hangzhou.aliyuncs.com）
 * 替换为项目实际使用的业务域名（如 musetopia-us.museselect.com）
 * 
 * @param key OSS 上的对象路径，例如 "tiangong_000018ee138c43c2bee141df7d6c2cbb.webp"
 * @param rawUrl 阿里云 SDK 默认生成的原始访问链接
 */
export function formatUrl(key: string, rawUrl: string): string {
  const config = currentConfig || getOssConfig();
  const targetDomain = (
    process.env.OSS_CUSTOM_DOMAIN ||
    process.env.OSS_REPLACE_DOMAIN ||
    config.customDomain ||
    ''
  ).trim();

  if (targetDomain) {
    let domain = targetDomain.replace(/\/+$/, '');
    // 自动补全 https:// 协议头（防止用户未写协议头导致解析错误）
    if (!/^https?:\/\//i.test(domain)) {
      domain = `https://${domain}`;
    }
    const cleanKey = (key || '').trim().replace(/^\/+/, '');
    return `${domain}/${cleanKey}`;
  }

  return rawUrl;
}

/**
/**
 * 阿里云 OSS 图片处理服务（x-oss-process=image）单图最大支持体积（20MB）
 * 超过 20MB 的原图将无法使用任何缩略图 resize、WebP 转换或裁剪等样式处理
 */
export const OSS_IMAGE_PROCESS_MAX_SIZE = 20 * 1024 * 1024; // 20 MB

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.avif', '.bmp', '.tiff', '.ico']);

/**
 * 【功能 1：上传文件（支持图片、视频、音频、文档等所有静态资源）】
 * 将本地文件上传到指定的 OSS 存储目录中，并返回可访问的完整 URL
 * 
 * @param params.filePath 本地文件绝对路径（必须真实存在）
 * @param params.targetDir 目标目录前缀（例如 "prototypes/home/"，会自动规范化斜杠）
 * @param params.fileName 可选的自定义文件名。如果不传，默认使用原文件名
 * @param params.allowOversized 可选。针对图片格式，若超过 20MB（无法生成缩略图），是否仍然强制原图上传（默认 false）
 */
export async function uploadFile(params: {
  filePath: string;
  targetDir?: string;
  fileName?: string;
  allowOversized?: boolean;
}) {
  const { filePath, targetDir = '', fileName, allowOversized = false } = params;

  // 1. 校验本地文件是否存在
  if (!fs.existsSync(filePath)) {
    throw new Error(`本地文件不存在：${filePath}`);
  }

  // 2. 确保路径指向的是文件而非文件夹
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`指定路径不是有效的文件：${filePath}`);
  }

  const baseName = fileName || path.basename(filePath);
  const ext = path.extname(baseName).toLowerCase();
  const isImage = IMAGE_EXTENSIONS.has(ext);
  let warning: string | undefined = undefined;

  // 3. 校验阿里云 OSS 图片处理 20MB 限制与告警拦截
  if (isImage && stat.size > OSS_IMAGE_PROCESS_MAX_SIZE) {
    const sizeInMB = (stat.size / (1024 * 1024)).toFixed(2);
    if (!allowOversized) {
      throw new Error(
        `【超大图片拦截】图片 '${baseName}' 体积为 ${sizeInMB}MB，超过了阿里云 OSS 图片处理服务（缩略图、WebP转换、裁剪等）允许的最大体积限制（20MB）！\n` +
        `上传后该图片将【无法使用任何缩略图或样式处理】。\n` +
        `请先向用户确认是否必须原图上传。若用户同意继续，请在参数中传入 allowOversized: true。`
      );
    } else {
      warning = `该图片体积（${sizeInMB}MB）超过了阿里云 OSS 20MB 限制，后续将无法对其使用缩略图或图片样式处理服务。`;
    }
  }

  const client = getClient();

  // 4. 规范化目标目录格式：去除开头的 /，并保证以 / 结尾
  let dir = targetDir.trim().replace(/^\/+/, '');
  if (dir && !dir.endsWith('/')) {
    dir += '/';
  }

  // 5. 拼接在 OSS 中的完整 Object Key（例如 "prototypes/home/header.png"）
  const ossKey = `${dir}${baseName}`;

  // 6. 执行上传
  const result = await client.put(ossKey, filePath);

  // 7. 转换为 CDN 或标准公开链接
  const publicUrl = formatUrl(ossKey, result.url);

  return {
    success: true,
    key: ossKey,         // OSS 内部存储路径
    url: publicUrl,       // 最终公网/CDN 图片访问链接
    size: stat.size,      // 文件大小（字节）
    name: baseName,       // 最终文件名
    warning,              // 超大图片无法缩略图的提示警告（如果有）
  };
}

/**
 * 【功能 2：查询文件列表】
 * 根据目录前缀检索 OSS 中已上传的文件列表，便于检查重复或获取已有链接
 * 
 * @param params.prefix 目录搜索前缀（例如 "prototypes/"）
 * @param params.maxKeys 单次返回的最大条数（限制 1-100 条）
 * @param params.marker 分页游标（当 isTruncated 为 true 时传入用于下一页）
 * @param params.delimiter 目录折叠分隔符（通常传入 "/"，只查询当前层级文件夹与文件，不深入遍历子文件）
 */
export async function listFiles(params: {
  prefix?: string;
  maxKeys?: number;
  marker?: string;
  delimiter?: string;
}) {
  const { prefix = '', maxKeys = 20, marker, delimiter } = params;
  const client = getClient();

  // 组装查询参数
  const query: OSS.ListV2ObjectsQuery = {
    prefix: prefix.replace(/^\/+/, ''), // 去除开头斜杠
    'max-keys': Math.min(Math.max(1, maxKeys), 100), // 限制在 1 ~ 100 之间
  };

  // 支持目录折叠，传入 "/" 可快速提取当前层级的子文件夹列表（prefixes）
  if (delimiter) {
    query.delimiter = delimiter;
  }

  if (marker) {
    query['continuation-token'] = marker;
  }

  // 执行 V2 分页查询
  const result = await client.listV2(query, {});

  // 格式化查询结果列表
  const objects = (result.objects || []).map((obj) => ({
    name: obj.name,
    size: obj.size,
    lastModified: obj.lastModified,
    url: formatUrl(obj.name, obj.url),
  }));

  return {
    objects,                                   // 文件列表明细
    prefixes: result.prefixes || [],           // 当前前缀下的子文件夹列表
    isTruncated: result.isTruncated,           // 是否还有下一页未展示
    nextMarker: result.nextContinuationToken,  // 下一页的游标
  };
}

/**
 * 【功能 3：创建目录】
 * 在 OSS 中创建一个虚拟文件夹
 * 
 * 原理解释：OSS 等对象存储本质上是扁平的键值存储，并没有实体文件夹概念。
 * 按照阿里云官方规范，创建一个以 / 结尾的 0 字节 Object，即可在 oss-browser2 和控制台呈现为文件夹。
 * 
 * @param params.folderPath 拟创建的文件夹路径，例如 "prototypes/feature-a/"
 */
export async function createFolder(params: { folderPath: string }) {
  let { folderPath } = params;

  // 清洗路径：去除开头斜杠，确保末尾带 /
  folderPath = folderPath.trim().replace(/^\/+/, '');
  if (!folderPath.endsWith('/')) {
    folderPath += '/';
  }

  const client = getClient();

  // 写入 0 字节的 Buffer，占位形成目录结构
  await client.put(folderPath, Buffer.alloc(0));

  return {
    success: true,
    folder: folderPath,
    message: `目录 '${folderPath}' 已成功创建。`,
  };
}

/**
 * 轻量通用异步并发控制器（零外部依赖）
 * 避免瞬时大量 HTTP 请求阻塞网络或触发云厂商频控
 * 
 * @param items 待处理任务数组
 * @param concurrency 最大并发数
 * @param worker 处理单个任务的异步函数
 */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  const pool = Array.from({ length: poolSize }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(pool);
  return results;
}

/**
 * 【功能 4：批量上传文件（支持图片、视频等各类静态资源，带并发控制）】
 * 支持传入本地文件路径数组，或指定本地文件夹，通过并发池批量上传所有文件至 OSS
 * 
 * @param params.filePaths 本地文件绝对路径列表（与 directoryPath 选填其一）
 * @param params.directoryPath 本地文件夹路径（若提供，会自动扫描该目录下所有文件）
 * @param params.targetDir OSS 目标存储目录（例如 "prototypes/home/"）
 * @param params.concurrency 最大并发上传数（默认 5，范围 1~20，防止高并发打满网络或触发限频）
 * @param params.allowOversized 若图片超过 20MB（无法生成缩略图），是否仍然强制原图上传（默认 false）
 * @param params.extensions 可选。扫描本地文件夹时允许的扩展名过滤列表（例如 [".png", ".mp4", ".webp"]），默认不过滤（上传目录下所有有效文件）
 */
export async function batchUploadFiles(params: {
  filePaths?: string[];
  directoryPath?: string;
  targetDir?: string;
  concurrency?: number;
  allowOversized?: boolean;
  extensions?: string[];
}) {
  const { directoryPath, targetDir = '', concurrency = 5, allowOversized = false, extensions } = params;
  let filesToUpload: string[] = [];

  if (params.filePaths && params.filePaths.length > 0) {
    filesToUpload = [...params.filePaths];
  } else if (directoryPath) {
    if (!fs.existsSync(directoryPath)) {
      throw new Error(`本地目录不存在: ${directoryPath}`);
    }
    const entries = fs.readdirSync(directoryPath);
    const filterExts = extensions && extensions.length > 0
      ? new Set(extensions.map((e) => (e.toLowerCase().startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)))
      : null;

    filesToUpload = entries
      .filter((file) => {
        // 排除隐藏文件与系统临时文件
        if (file.startsWith('.') || file === 'Thumbs.db' || file === 'desktop.ini') return false;
        const fullPath = path.join(directoryPath, file);
        if (!fs.statSync(fullPath).isFile()) return false;
        if (filterExts) {
          return filterExts.has(path.extname(file).toLowerCase());
        }
        return true;
      })
      .map((file) => path.join(directoryPath, file));
  } else {
    throw new Error('必须提供 filePaths（文件路径列表）或 directoryPath（本地目录路径）之一。');
  }

  if (filesToUpload.length === 0) {
    return {
      success: true,
      total: 0,
      results: [],
      urlMap: {},
      message: '未发现需要上传的文件。',
    };
  }

  // 限制合理并发区间（1 ~ 20）
  const safeConcurrency = Math.min(Math.max(1, concurrency), 20);

  // 通过并发池执行上传，平滑网络峰值
  const results = await runWithConcurrency(filesToUpload, safeConcurrency, async (filePath) => {
    try {
      const res = await uploadFile({ filePath, targetDir, allowOversized });
      return {
        success: true as const,
        filePath,
        fileName: path.basename(filePath),
        key: res.key,
        url: res.url,
        size: res.size,
        warning: res.warning,
      };
    } catch (err: any) {
      return {
        success: false as const,
        filePath,
        fileName: path.basename(filePath),
        error: err.message || String(err),
      };
    }
  });

  // 生成 文件名 -> 远程CDN URL 的映射字典，方便前端代码批量查找与替换
  const urlMap: Record<string, string> = {};
  const oversizedWarnings: Array<{ file: string; warning: string }> = [];

  for (const item of results) {
    if (item.success && 'url' in item && item.url) {
      urlMap[item.fileName] = item.url;
    }
    if ('warning' in item && item.warning) {
      oversizedWarnings.push({ file: item.fileName, warning: item.warning });
    }
  }

  return {
    success: true,
    total: results.length,
    successCount: results.filter((r) => r.success).length,
    failCount: results.filter((r) => !r.success).length,
    urlMap,              // 文件名到远程URL的映射表
    oversizedWarnings,   // 超过 20MB 无法使用缩略图的文件告警列表
    results,             // 每个文件的详细上传结果
  };
}

/**
 * 获取受保护的目录前缀集合（黑名单）
 * 默认基础兜底仅拦截纯根路径与危险通配符；业务层前缀完全由环境变量 OSS_PROTECTED_PREFIXES 动态配置（默认无任何业务前缀限制）
 */
export function getProtectedPrefixes(): string[] {
  const envVal = (process.env.OSS_PROTECTED_PREFIXES || '').trim();
  if (!envVal) return [];

  // 解析逗号或分号隔开的自定义受保护前缀
  return envVal
    .split(/[,;]/)
    .map((p) => p.trim().replace(/^[\/\\]+/, '').toLowerCase())
    .filter(Boolean);
}

/**
 * 获取允许删除的目录前缀集合（白名单）
 * 默认不限制（空表示不开启白名单限制）；若配置了 OSS_ALLOW_DELETE_PREFIXES，则仅允许删除指定前缀下的内容
 */
export function getAllowedDeletePrefixes(): string[] {
  const envVal = (process.env.OSS_ALLOW_DELETE_PREFIXES || '').trim();
  if (!envVal) return [];

  return envVal
    .split(/[,;]/)
    .map((p) => p.trim().replace(/^[\/\\]+/, '').toLowerCase())
    .filter(Boolean);
}

/**
 * 【功能 5：删除文件或目录（带高危防呆安全防护 & 用户两阶段确认机制）】
 * 
 * 安全机制：
 * 1. 严格禁止删除根目录、空路径；
 * 2. 支持环境变量 OSS_PROTECTED_PREFIXES（黑名单拦截，默认空）与 OSS_ALLOW_DELETE_PREFIXES（白名单限制）；
 * 3. 两阶段确认（Dry-Run Preview）：
 *    - 阶段一（confirmed !== true）：仅进行只读预检扫描，汇总列出受影响的全部文件、子目录、文件数和总占用空间，绝不执行物理删除！
 *    - 阶段二（confirmed === true）：只有当用户在对话中明确确认后，方可二次调用并真正执行删除。
 * 
 * @param params.paths 待删除的单个路径或路径数组（OSS 存储路径，例如 "prototypes/home/banner.png" 或 "prototypes/temp/"）
 * @param params.isFolder 是否为目录。若为 true，会自动递归扫描并清空该目录
 * @param params.confirmed 是否已获得用户明确授权确认（默认 false，必须经用户核对清单同意后方可传 true）
 */
export async function deleteObjectOrFolder(params: {
  paths: string | string[];
  isFolder?: boolean;
  confirmed?: boolean;
}) {
  const { paths, isFolder = false, confirmed = false } = params;
  const client = getClient();
  const pathList = Array.isArray(paths) ? paths : [paths];

  if (pathList.length === 0) {
    throw new Error('【安全拦截】请至少指定一个待删除的文件或目录路径。');
  }

  // 获取动态配置的黑名单与白名单前缀
  const protectedPrefixes = getProtectedPrefixes();
  const allowedPrefixes = getAllowedDeletePrefixes();

  // 1. 高危安全防呆检查：严防任何清空根目录或误删受保护目录的操作
  for (const rawPath of pathList) {
    const trimmed = (rawPath || '').trim();
    const clean = trimmed.replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '');
    const cleanLower = clean.toLowerCase();

    // 严禁根目录、空路径、纯斜杠、通配符
    if (!trimmed || clean === '' || clean === '*' || clean === '.') {
      throw new Error(
        `【高危安全拦截】禁止传入根目录或空路径！操作被拒绝。危险路径: '${rawPath}'`
      );
    }

    // 目录删除安全校验
    if (isFolder || trimmed.endsWith('/')) {
      if (clean.length < 2) {
        throw new Error(
          `【高危安全拦截】目录名过短（'${rawPath}'），存在误清空大范围数据的风险！目录名称至少需2个字符。`
        );
      }
    }

    // 校验黑名单：若配置了 OSS_PROTECTED_PREFIXES
    for (const prefix of protectedPrefixes) {
      const cleanPrefix = prefix.replace(/[\/\\]+$/, '');
      if (cleanLower === cleanPrefix || cleanLower.startsWith(cleanPrefix + '/')) {
        throw new Error(
          `【安全拦截】路径 '${rawPath}' 命中了受保护的黑名单前缀 '${prefix}'（来自环境变量 OSS_PROTECTED_PREFIXES），禁止删除！`
        );
      }
    }

    // 校验白名单：若配置了 OSS_ALLOW_DELETE_PREFIXES
    if (allowedPrefixes.length > 0) {
      const isAllowed = allowedPrefixes.some((prefix) => {
        const cleanPrefix = prefix.replace(/[\/\\]+$/, '');
        return cleanLower === cleanPrefix || cleanLower.startsWith(cleanPrefix + '/');
      });
      if (!isAllowed) {
        throw new Error(
          `【安全拦截】路径 '${rawPath}' 不在允许删除的白名单（来自 OSS_ALLOW_DELETE_PREFIXES）中！仅允许删除以 [${allowedPrefixes.join(', ')}] 开头的路径。`
        );
      }
    }
  }

  // 2. 预检扫描：梳理受影响的文件与文件夹详细清单（只读，不产生破坏性修改）
  const targetFiles: Array<{ name: string; size: number; lastModified: string }> = [];
  const targetFolders = new Set<string>();
  const isDirectoryDelete = isFolder || pathList.some((p) => p.endsWith('/'));

  if (isDirectoryDelete) {
    for (let folderKey of pathList) {
      folderKey = folderKey.trim().replace(/^\/+/, '');
      if (!folderKey.endsWith('/')) {
        folderKey += '/';
      }
      targetFolders.add(folderKey);

      let continuationToken: string | undefined = undefined;
      do {
        const query: OSS.ListV2ObjectsQuery = {
          prefix: folderKey,
          'max-keys': 1000,
        };
        if (continuationToken) {
          query['continuation-token'] = continuationToken;
        }
        const listRes = await client.listV2(query, {});
        for (const obj of listRes.objects || []) {
          targetFiles.push({
            name: obj.name,
            size: obj.size,
            lastModified: obj.lastModified,
          });
          // 记录中间包含的子目录路径
          const subDirMatch = obj.name.match(/^(.*\/)[^\/]+$/);
          if (subDirMatch && subDirMatch[1]) {
            targetFolders.add(subDirMatch[1]);
          }
        }
        continuationToken = listRes.isTruncated ? listRes.nextContinuationToken : undefined;
      } while (continuationToken);
    }
  } else {
    // 单文件或多个离散文件：逐个检查是否存在并获取大小元数据
    for (const rawKey of pathList) {
      const cleanKey = rawKey.trim().replace(/^\/+/, '');
      try {
        const headRes = await client.head(cleanKey);
        const headers = (headRes.res?.headers || {}) as Record<string, any>;
        const size = headers['content-length'] ? Number(headers['content-length']) : 0;
        const lastModified = (headers['last-modified'] as string) || '';
        targetFiles.push({ name: cleanKey, size, lastModified });
      } catch (err: any) {
        // 如果文件已不存在，跳过
      }
    }
  }

  const totalSize = targetFiles.reduce((acc, curr) => acc + curr.size, 0);

  // 若目标路径下无任何文件
  if (targetFiles.length === 0) {
    return {
      status: 'NOT_FOUND',
      success: true,
      message: '目标路径下未发现任何现有文件，无需执行删除。',
      totalCount: 0,
    };
  }

  // 3. 阶段一：未确认（confirmed !== true） -> 拦截并输出待确认的详细清单
  if (!confirmed) {
    const formattedTotalSize =
      totalSize > 1024 * 1024
        ? `${(totalSize / (1024 * 1024)).toFixed(2)} MB`
        : `${(totalSize / 1024).toFixed(1)} KB`;

    return {
      status: 'REQUIRES_USER_CONFIRMATION',
      requiresConfirmation: true,
      message:
        '⚠️【高危删除操作：需要用户二次确认】\n' +
        '系统已扫描出待删除的全部文件与目录明细（当前未执行任何删除）。\n' +
        '【必须遵守的规则】：请将以下删除范围、涉及文件总数、总大小及清单完整列出展示给用户，由用户在聊天中明确同意后，再重新调用本工具并传入 confirmed: true 真正执行删除！',
      summary: {
        totalFiles: targetFiles.length,
        totalSizeFormatted: formattedTotalSize,
        totalSizeBytes: totalSize,
        affectedFolders: Array.from(targetFolders),
      },
      // 提供最多前 100 个文件的明细列表供用户审核
      fileListPreview: targetFiles.slice(0, 100).map((f) => ({
        name: f.name,
        size:
          f.size > 1024 * 1024
            ? `${(f.size / (1024 * 1024)).toFixed(2)} MB`
            : `${(f.size / 1024).toFixed(1)} KB`,
        lastModified: f.lastModified,
      })),
      hasMoreFiles: targetFiles.length > 100,
    };
  }

  // 4. 阶段二：用户已确认（confirmed === true） -> 真正执行删除
  const keysToDelete = targetFiles.map((f) => f.name);

  // 阿里云 deleteMulti 单次最大允许 1000 个 Key，分批删除
  const chunkSize = 1000;
  for (let i = 0; i < keysToDelete.length; i += chunkSize) {
    const chunk = keysToDelete.slice(i, i + chunkSize);
    await client.deleteMulti(chunk, { quiet: true });
  }

  // 若为目录删除，额外清理所有目录占位符
  if (isDirectoryDelete) {
    for (const folder of targetFolders) {
      try {
        await client.delete(folder);
      } catch {
        // 忽略不存在
      }
    }
  }

  return {
    status: 'DELETED',
    success: true,
    message: `用户已确认授权，成功删除 ${keysToDelete.length} 个文件及相关目录。`,
    deletedCount: keysToDelete.length,
    deletedFolders: Array.from(targetFolders),
    deletedKeys: keysToDelete,
  };
}

/**
 * 【功能 6：检查文件是否存在（支持多文件批量检测）】
 * 发送 HTTP HEAD 请求检测 OSS 中是否存在指定文件（不拉取文件内容，零流量消耗）
 * 
 * @param params.ossKeys 拟检查的 OSS 对象路径，支持单个字符串或字符串数组（例如 "banner.png" 或 ["a.png", "b.png"]）
 */
export async function checkExists(params: { ossKeys: string | string[] }) {
  const { ossKeys } = params;
  const client = getClient();
  const keyList = (Array.isArray(ossKeys) ? ossKeys : [ossKeys])
    .map((k) => (k || '').trim().replace(/^\/+/, ''))
    .filter(Boolean);

  if (keyList.length === 0) {
    throw new Error('请至少指定一个待检查的 OSS 文件路径。');
  }

  // 使用并发控制器并发检测，限制单次最多 10 个 HEAD 请求
  const results = await runWithConcurrency(keyList, 10, async (key) => {
    try {
      const res = await client.head(key);
      const headers = (res.res?.headers || {}) as Record<string, any>;
      const size = headers['content-length']
        ? Number(headers['content-length'])
        : undefined;
      const lastModified = (headers['last-modified'] as string) || undefined;
      const requestUrls = (res.res as any)?.requestUrls as string[] | undefined;

      return {
        key,
        exists: true,
        url: formatUrl(key, requestUrls?.[0] || ''),
        size,
        lastModified,
      };
    } catch (error: any) {
      if (error.status === 404 || error.code === 'NoSuchKey') {
        return {
          key,
          exists: false,
        };
      }
      return {
        key,
        exists: false,
        error: error.message || String(error),
      };
    }
  });

  const existsCount = results.filter((r) => r.exists).length;
  const notExistsCount = results.filter((r) => !r.exists).length;

  return {
    total: keyList.length,
    existsCount,
    notExistsCount,
    allExist: existsCount === keyList.length,
    noneExist: existsCount === 0,
    summaryMap: Object.fromEntries(results.map((r) => [r.key, r.exists])), // 极简映射表 { "a.png": true, "b.png": false }
    results, // 详细数据
  };
}

/**
 * 从输入的 target 中解析出纯净的 OSS 对象存储 Key
 * 支持解析：
 * - 完整自定义 CDN 链接（例如 https://musetopia-us.museselect.com/prototypes/banner.webp?x-oss-process=...）
 * - 完整 OSS 原生链接（例如 https://musetopia-cn.oss-cn-hangzhou.aliyuncs.com/prototypes/banner.webp）
 * - 相对路径或带前导斜杠路径（例如 /prototypes/banner.webp 或 prototypes/banner.webp）
 */
export function extractOssKeyFromTarget(target: string): string {
  let cleaned = (target || '').trim();
  if (!cleaned) {
    throw new Error('目标图片 target 不能为空。');
  }

  // 若传入的是完整 URL
  if (/^https?:\/\//i.test(cleaned)) {
    try {
      const parsed = new URL(cleaned);
      cleaned = parsed.pathname;
    } catch {
      const match = cleaned.match(/^https?:\/\/[^\/]+(\/.*)$/i);
      cleaned = match ? match[1] : cleaned;
    }
  }

  // 去除查询参数与 hash
  cleaned = cleaned.split('?')[0].split('#')[0];

  // 清洗首尾斜杠与多余斜杠
  cleaned = cleaned.replace(/^\/+/, '');

  if (!cleaned) {
    throw new Error(`无法从目标 target '${target}' 中解析出有效的 OSS 对象路径。`);
  }

  return cleaned;
}

/**
 * 【功能 7：替换/更新文件（支持图片、视频等各类静态资源，带阿里云 CDN 自动单文件刷新与三重安全防线）】
 * 
 * 核心特性：
 * 1. 严格单文件刷新：严禁通配符或目录刷新，只刷新待更新的单张文件纯净链接；
 * 2. 免费额度保护：每日 10,000 条免费刷新额度用尽时立即停止操作，绝不产生额外计费；
 * 3. 权限预检与确认：若 RAM 凭证缺少 CDN 刷新权限，暂停覆盖并向用户提示决策；
 * 4. 纯净 URL：返回替换域名的纯净公网/CDN 链接，绝无任何 ?v= 时间戳版本号参数；
 * 5. 20MB 超大图片拦截：针对图片格式继承 OSS 图片处理服务 20MB 限制防护；
 * 6. 受保护前缀拦截：继承 OSS_PROTECTED_PREFIXES 黑名单防护。
 * 
 * @param params.target 待替换的目标文件（完整 CDN 访问 URL 或 OSS 存储 Key）
 * @param params.newFilePath 本地新文件绝对路径
 * @param params.allowOversized 若新图片超过 20MB，是否允许强制原图覆盖（默认 false）
 * @param params.forceOverwriteWithoutCdn 若 CDN 无权限或额度用尽，是否仍然强行覆盖 OSS 原文件（默认 false）
 */
export async function replaceFile(params: {
  target: string;
  newFilePath: string;
  allowOversized?: boolean;
  forceOverwriteWithoutCdn?: boolean;
}) {
  const { target, newFilePath, allowOversized = false, forceOverwriteWithoutCdn = false } = params;

  // 1. 校验本地新文件是否存在
  if (!fs.existsSync(newFilePath)) {
    throw new Error(`本地新图片文件不存在：${newFilePath}`);
  }

  const stat = fs.statSync(newFilePath);
  if (!stat.isFile()) {
    throw new Error(`指定的新图片路径不是有效文件：${newFilePath}`);
  }

  const baseName = path.basename(newFilePath);
  const ext = path.extname(baseName).toLowerCase();
  const isImage = IMAGE_EXTENSIONS.has(ext);
  let warning: string | undefined = undefined;

  // 2. 校验 20MB 超大图片限制
  if (isImage && stat.size > OSS_IMAGE_PROCESS_MAX_SIZE) {
    const sizeInMB = (stat.size / (1024 * 1024)).toFixed(2);
    if (!allowOversized) {
      throw new Error(
        `【超大图片拦截】新图片 '${baseName}' 体积为 ${sizeInMB}MB，超过了阿里云 OSS 图片处理服务（缩略图、WebP转换、裁剪等）允许的最大体积限制（20MB）！\n` +
        `上传覆盖后该图片将【无法使用任何缩略图或样式处理】。\n` +
        `请先向用户确认是否必须原图上传。若用户同意继续，请在参数中传入 allowOversized: true。`
      );
    } else {
      warning = `该新图片体积（${sizeInMB}MB）超过了阿里云 OSS 20MB 限制，后续将无法对其使用缩略图或图片样式处理服务。`;
    }
  }

  // 3. 从 target 中提取规范化的 OSS Object Key
  const targetKey = extractOssKeyFromTarget(target);

  // 4. 受保护前缀黑名单校验（防误改关键线上资源）
  const protectedPrefixes = getProtectedPrefixes();
  const keyLower = targetKey.toLowerCase();
  for (const prefix of protectedPrefixes) {
    const cleanPrefix = prefix.replace(/[\/\\]+$/, '');
    if (keyLower === cleanPrefix || keyLower.startsWith(cleanPrefix + '/')) {
      throw new Error(
        `【安全拦截】目标图片路径 '${targetKey}' 命中了受保护的黑名单前缀 '${prefix}'（来自环境变量 OSS_PROTECTED_PREFIXES），禁止替换！`
      );
    }
  }

  const client = getClient();
  const config = currentConfig || getOssConfig();

  // 5. 预检目标图片在 OSS 中是否存在，并获取旧文件元数据（大小、最后修改时间）
  let oldMeta: { size: number; lastModified: string } | null = null;
  try {
    const headRes = await client.head(targetKey);
    const headers = (headRes.res?.headers || {}) as Record<string, any>;
    oldMeta = {
      size: headers['content-length'] ? Number(headers['content-length']) : 0,
      lastModified: (headers['last-modified'] as string) || '',
    };
  } catch (err: any) {
    if (err.status === 404 || err.code === 'NoSuchKey') {
      return {
        status: 'TARGET_NOT_FOUND',
        success: false,
        message: `目标图片 '${targetKey}' 在 OSS 存储桶中未找到。如果您是要上传新图片，请使用 oss_upload_image 工具。`,
        targetKey,
      };
    }
    throw err;
  }

  // 6. 确定替换后的纯净访问 URL 与是否需要 CDN 刷新
  const targetUrl = formatUrl(targetKey, '');
  let finalCdnUrl = targetUrl;
  let isCdnDomain = false;

  if (targetUrl && !targetUrl.includes('.aliyuncs.com')) {
    isCdnDomain = true;
    finalCdnUrl = targetUrl;
  } else if (/^https?:\/\//i.test(target)) {
    try {
      const parsed = new URL(target);
      if (!parsed.hostname.includes('.aliyuncs.com')) {
        isCdnDomain = true;
        finalCdnUrl = `${parsed.origin}/${targetKey}`;
      }
    } catch {
      // 保持默认
    }
  }

  const cdnCredentials = {
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
  };

  // 格式化文件大小辅助函数
  const formatBytes = (bytes: number) =>
    bytes > 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
      : `${(bytes / 1024).toFixed(1)} KB`;

  // 7. CDN 预检与用户决策拦截
  // 若当前使用了 CDN 域名，且用户尚未传 forceOverwriteWithoutCdn
  if (isCdnDomain && !forceOverwriteWithoutCdn) {
    // 预检 CDN 额度与 RAM 权限
    const quotaCheck = await checkCdnQuota(cdnCredentials);

    // 预检失败：缺少权限或接口报错
    if (!quotaCheck.success) {
      if (quotaCheck.error.isPermissionDenied) {
        return {
          status: 'CDN_PERMISSION_DENIED',
          success: false,
          requiresUserDecision: true,
          message:
            `⚠️【权限预检拦截：当前 AccessKey 无权刷新 CDN 缓存】\n` +
            `检测到当前 AccessKey 具备 OSS 读写权限，但缺少阿里云 CDN 的刷新权限（RAM 策略需包含 cdn:DescribeRefreshQuota 及 cdn:RefreshObjectCaches）。\n\n` +
            `【风险提示】：\n` +
            `若此时强行覆盖，OSS 原图将被更新，但由于无法刷新 CDN 边缘节点缓存，线上用户和浏览器在缓存过期前将继续看到旧图片！\n\n` +
            `【请用户决定】：\n` +
            `请向用户说明情况并征询其决定：\n` +
            `1. 若用户同意在不刷新 CDN 的情况下直接覆盖，请重新调用本工具并传入 forceOverwriteWithoutCdn: true。\n` +
            `2. 若用户希望新图片立即在 CDN 生效，请在阿里云 RAM 控制台为该 AccessKey 授予 cdn:RefreshObjectCaches 权限后再试。`,
          key: targetKey,
          url: finalCdnUrl,
          fileSizeComparison: {
            oldSizeFormatted: oldMeta ? formatBytes(oldMeta.size) : '未知',
            newSizeFormatted: formatBytes(stat.size),
            oldSizeBytes: oldMeta?.size,
            newSizeBytes: stat.size,
          },
          errorDetails: quotaCheck.error,
        };
      }
    } else {
      // 预检成功，但免费额度已用尽
      if (quotaCheck.urlRemain <= 0) {
        return {
          status: 'CDN_QUOTA_EXHAUSTED',
          success: false,
          requiresUserDecision: true,
          message:
            `⚠️【免费额度保护：今日阿里云 CDN 免费刷新额度已用尽】\n` +
            `今日免费 URL 刷新额度剩余 0 条（每天免费 10,000 条）。为防止产生计费或由于无法刷新导致线上图片未生效，系统已暂停覆盖。\n\n` +
            `【请用户决定】：\n` +
            `请向用户确认：是否仍要强行覆盖原图（不刷新 CDN）？\n` +
            `- 若用户确认覆盖，请重新调用本工具并传入 forceOverwriteWithoutCdn: true。\n` +
            `- 若放弃更新，可取消本次操作。`,
          key: targetKey,
          url: finalCdnUrl,
          quota: {
            urlQuota: quotaCheck.urlQuota,
            urlRemain: 0,
          },
          fileSizeComparison: {
            oldSizeFormatted: oldMeta ? formatBytes(oldMeta.size) : '未知',
            newSizeFormatted: formatBytes(stat.size),
            oldSizeBytes: oldMeta?.size,
            newSizeBytes: stat.size,
          },
        };
      }
    }
  }

  // 8. 执行 OSS 覆盖写入
  const putResult = await client.put(targetKey, newFilePath);
  const cleanPublicUrl = formatUrl(targetKey, putResult.url);

  // 9. 执行 CDN 缓存刷新（如果适用且未被跳过）
  let cdnPurgeInfo: Record<string, any> = {};

  if (!isCdnDomain) {
    cdnPurgeInfo = {
      skipped: true,
      reason: '当前未配置自定义 CDN 加速域名（使用 OSS 原生域名直连），更新已实时生效，无需刷新 CDN。',
    };
  } else if (forceOverwriteWithoutCdn) {
    cdnPurgeInfo = {
      skipped: true,
      reason: '已按用户明确授权跳过 CDN 缓存刷新（强制覆盖）。',
    };
  } else {
    // 严格单文件刷新
    try {
      const purgeRes = await refreshCdnSingleFile(finalCdnUrl, cdnCredentials);
      cdnPurgeInfo = {
        success: true,
        refreshedUrl: purgeRes.refreshedUrl,
        taskId: purgeRes.taskId,
        requestId: purgeRes.requestId,
        quotaRemain: purgeRes.quotaRemain,
        note: 'CDN 单文件缓存刷新任务已提交，全球边缘节点约在 5~10 秒内生效，直接访问 URL 即可看到最新图片，无需在代码中添加时间戳版本号等参数。',
      };
    } catch (purgeErr: any) {
      cdnPurgeInfo = {
        success: false,
        error: purgeErr.message || String(purgeErr),
        note: 'OSS 原图已成功覆盖，但 CDN 缓存刷新时遇到异常。',
      };
    }
  }

  return {
    status: 'SUCCESS',
    success: true,
    message: `图片 '${targetKey}' 已成功替换并覆盖！${cdnPurgeInfo.success ? '且已自动刷新阿里云 CDN 缓存。' : ''}`,
    key: targetKey,
    url: cleanPublicUrl, // 纯净链接，绝无任何 ?v= 参数
    name: baseName,
    oldSize: oldMeta?.size,
    newSize: stat.size,
    fileSizeComparison: {
      oldSizeFormatted: oldMeta ? formatBytes(oldMeta.size) : '未知',
      newSizeFormatted: formatBytes(stat.size),
      sizeDiffFormatted: oldMeta
        ? `${stat.size - oldMeta.size > 0 ? '+' : ''}${formatBytes(stat.size - oldMeta.size)}`
        : undefined,
    },
    warning,
    cdnPurge: cdnPurgeInfo,
  };
}

// ==============================================================================
// 向下兼容别名导出（兼容 _image 旧命名习惯）
// ==============================================================================
export const uploadImage = uploadFile;
export const listImages = listFiles;
export const batchUploadImages = batchUploadFiles;
export const replaceImage = replaceFile;


