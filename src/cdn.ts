import crypto from 'node:crypto';

/**
 * 阿里云 CDN 接口调用凭证
 */
export interface CdnCredentials {
  accessKeyId: string;
  accessKeySecret: string;
}

/**
 * CDN 刷新额度查询结果
 */
export interface CdnQuotaResult {
  success: boolean;
  urlQuota: number;
  urlRemain: number;
  dirQuota: number;
  dirRemain: number;
  requestId?: string;
}

/**
 * CDN 单文件刷新执行结果
 */
export interface CdnRefreshResult {
  success: boolean;
  taskId?: string;
  requestId?: string;
  refreshedUrl: string;
  quotaRemain?: number;
}

/**
 * CDN 错误详细信息
 */
export interface CdnErrorDetails {
  code: string;
  message: string;
  status?: number;
  isPermissionDenied: boolean;
  isQuotaExhausted: boolean;
  isDomainNotAccelerated: boolean;
  recommend?: string;
  requestId?: string;
}

/**
 * 遵循 RFC 3986 规范的阿里云 OpenAPI POP 百分号编码
 * 规则：
 * 1. 字符 A-Z, a-z, 0-9 以及 '-', '_', '.', '~' 不编码
 * 2. 其他字符均转为 %XY 大写十六进制
 * 3. JS 内置的 encodeURIComponent 不会编码 ! ' ( ) *，因此需要手动转换
 */
export function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

/**
 * 计算阿里云 RPC 规范的 HMAC-SHA1 签名
 * 
 * @param params 待签名的请求参数键值对
 * @param accessKeySecret 阿里云 AccessKey Secret
 * @param httpMethod HTTP 请求方法（例如 POST）
 */
export function calculateAlibabaSignature(
  params: Record<string, string>,
  accessKeySecret: string,
  httpMethod = 'POST'
): string {
  // 1. 参数键名按 ASCII 码升序排序
  const sortedKeys = Object.keys(params).sort();
  const canonicalizedQueryString = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');

  // 2. 构造待签名字符串 StringToSign = HTTPMethod + '&' + percentEncode('/') + '&' + percentEncode(CanonicalizedQueryString)
  const stringToSign = `${httpMethod.toUpperCase()}&${percentEncode('/')}&${percentEncode(canonicalizedQueryString)}`;

  // 3. 计算 HMAC-SHA1 签名，密钥为 accessKeySecret + '&'
  const signKey = `${accessKeySecret}&`;
  return crypto
    .createHmac('sha1', signKey)
    .update(stringToSign)
    .digest('base64');
}

/**
 * 底层通用调用阿里云 CDN POP RPC OpenAPI
 * 
 * @param action 接口动作名称（例如 DescribeRefreshQuota 或 RefreshObjectCaches）
 * @param customParams 接口专属业务参数
 * @param credentials 访问凭证
 */
async function callCdnApi<T = any>(
  action: string,
  customParams: Record<string, string>,
  credentials: CdnCredentials
): Promise<{ success: true; data: T } | { success: false; error: CdnErrorDetails }> {
  // 组装公共请求参数
  const publicParams: Record<string, string> = {
    Action: action,
    Format: 'JSON',
    Version: '2018-05-10',
    AccessKeyId: credentials.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    // UTC 时间，格式 YYYY-MM-DDTHH:mm:ssZ（去除毫秒以严格遵循阿里云标准）
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    ...customParams,
  };

  // 生成签名
  const signature = calculateAlibabaSignature(publicParams, credentials.accessKeySecret, 'POST');

  // 构造 POST 表单主体
  const sortedKeys = Object.keys(publicParams).sort();
  const bodyString =
    sortedKeys.map((k) => `${percentEncode(k)}=${percentEncode(publicParams[k])}`).join('&') +
    `&Signature=${percentEncode(signature)}`;

  try {
    const response = await fetch('https://cdn.aliyuncs.com', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyString,
    });

    const data = (await response.json().catch(() => null)) as Record<string, any> | null;

    // 检查响应状态与阿里云业务错误码
    if (!response.ok || (data && data.Code)) {
      const code = data?.Code || `HTTP_${response.status}`;
      const message = data?.Message || response.statusText || 'Unknown CDN error';
      const requestId = data?.RequestId;
      const recommend = data?.Recommend;

      // 智能判定错误类型
      // 1. RAM 权限不足判断
      const isPermissionDenied =
        response.status === 403 ||
        code === 'Forbidden.RAM' ||
        code === 'NoPermission' ||
        code === 'Forbidden.NoPermission' ||
        code === 'AccessDenied' ||
        /permission/i.test(message) ||
        /not authorized/i.test(message);

      // 2. 额度耗尽判断
      const isQuotaExhausted =
        code === 'QuotaExceeded' ||
        code === 'QuotaFull' ||
        /quota/i.test(code) ||
        /quota.*exhaust/i.test(message);

      // 3. 域名未在 CDN 中加速判断
      const isDomainNotAccelerated =
        code === 'InvalidDomain.NotFound' ||
        code === 'InvalidDomain.Offline' ||
        /not found/i.test(message) && /domain/i.test(code);

      return {
        success: false,
        error: {
          code,
          message,
          status: response.status,
          isPermissionDenied,
          isQuotaExhausted,
          isDomainNotAccelerated,
          recommend,
          requestId,
        },
      };
    }

    return {
      success: true,
      data: data as T,
    };
  } catch (err: any) {
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: err.message || String(err),
        isPermissionDenied: false,
        isQuotaExhausted: false,
        isDomainNotAccelerated: false,
      },
    };
  }
}

/**
 * 【安全红线校验】校验 CDN 刷新路径是否为纯净的单个文件
 * 
 * 严格禁止：
 * 1. 根路径或空路径
 * 2. 以 / 结尾的目录路径
 * 3. 含有通配符 * 的泛路径
 */
export function validateSingleFileCdnUrl(url: string): void {
  const cleanUrl = (url || '').trim();
  if (!cleanUrl) {
    throw new Error('【安全红线拦截】待刷新的 CDN URL 不能为空。');
  }

  let parsed: URL;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    throw new Error(`【安全红线拦截】待刷新的 URL 格式非法（需包含 http:// 或 https:// 协议头）：${cleanUrl}`);
  }

  // 严禁包含通配符 *
  if (cleanUrl.includes('*')) {
    throw new Error(`【安全红线拦截】严禁在刷新路径中包含通配符 '*'（'${cleanUrl}'）！系统安全策略禁止批量或泛通配符刷新。`);
  }

  // 严禁以 / 结尾或纯根路径
  const pathname = parsed.pathname;
  if (!pathname || pathname === '/' || cleanUrl.endsWith('/')) {
    throw new Error(
      `【安全红线拦截】严禁刷新整个目录或根路径（'${cleanUrl}'）！系统安全策略严格限制仅允许刷新单张具体图片文件。`
    );
  }
}

/**
 * 查询当前阿里云账号的 CDN 刷新额度（核实免费剩余额度）
 * 阿里云 CDN 每天默认提供 10,000 条免费单 URL 刷新额度
 * 
 * @param credentials 访问密钥
 */
export async function checkCdnQuota(credentials: CdnCredentials): Promise<
  | { success: true; urlQuota: number; urlRemain: number; dirQuota: number; dirRemain: number; requestId?: string }
  | { success: false; error: CdnErrorDetails }
> {
  const res = await callCdnApi<{
    UrlQuota: string;
    UrlRemain: string;
    DirQuota: string;
    DirRemain: string;
    RequestId?: string;
  }>('DescribeRefreshQuota', {}, credentials);

  if (!res.success) {
    return { success: false, error: res.error };
  }

  const urlQuota = parseInt(res.data.UrlQuota, 10);
  const urlRemain = parseInt(res.data.UrlRemain, 10);
  const dirQuota = parseInt(res.data.DirQuota || '0', 10);
  const dirRemain = parseInt(res.data.DirRemain || '0', 10);

  return {
    success: true,
    urlQuota: isNaN(urlQuota) ? 0 : urlQuota,
    urlRemain: isNaN(urlRemain) ? 0 : urlRemain,
    dirQuota: isNaN(dirQuota) ? 0 : dirQuota,
    dirRemain: isNaN(dirRemain) ? 0 : dirRemain,
    requestId: res.data.RequestId,
  };
}

/**
 * 刷新阿里云 CDN 单张图片 URL 缓存（Purge）
 * 
 * 严格红线保护：
 * 1. 严格单文件：仅允许单张具体图片 URL，禁止目录（/）或通配符（*）
 * 2. 免费额度防护：若 UrlRemain <= 0 立即阻断停止，防止产生计费
 * 3. 权限判断：若 RAM 权限不足给出友好拦截指引
 * 4. ObjectType 强行写死为 'File'，绝不允许传入 'Directory'
 * 
 * @param url 拟刷新的单图片 CDN 完整 URL（例如: https://musetopia-us.museselect.com/prototypes/home/banner.webp）
 * @param credentials 访问凭据
 */
export async function refreshCdnSingleFile(
  url: string,
  credentials: CdnCredentials
): Promise<CdnRefreshResult> {
  const cleanUrl = url.trim();

  // 1. 安全红线校验（严禁目录刷新与通配符）
  validateSingleFileCdnUrl(cleanUrl);

  // 2. 预先检查免费额度
  const quotaCheck = await checkCdnQuota(credentials);
  if (!quotaCheck.success) {
    const err = new Error(
      quotaCheck.error.isPermissionDenied
        ? `【CDN 权限不足】当前 AccessKey 缺少阿里云 CDN 刷新权限 (RAM 策略缺少 cdn:DescribeRefreshQuota)。`
        : `【CDN 额度检查失败】${quotaCheck.error.code}: ${quotaCheck.error.message}`
    ) as any;
    err.details = quotaCheck.error;
    throw err;
  }

  // 3. 额度耗尽立即停止！
  if (quotaCheck.urlRemain <= 0) {
    const err = new Error(
      `【免费额度保护】今日阿里云 CDN 免费 URL 刷新额度已用尽（剩余 0 / 总共 ${quotaCheck.urlQuota} 条）。系统已自动停止刷新以防止产生费用。`
    ) as any;
    err.details = {
      code: 'QuotaExceeded',
      isQuotaExhausted: true,
      urlQuota: quotaCheck.urlQuota,
      urlRemain: 0,
    };
    throw err;
  }

  // 4. 执行刷新任务（ObjectType 严格写死为 'File'）
  const res = await callCdnApi<{ RefreshTaskId: string; RequestId?: string }>(
    'RefreshObjectCaches',
    {
      ObjectPath: cleanUrl,
      ObjectType: 'File', // 铁律：严格单文件刷新
    },
    credentials
  );

  if (!res.success) {
    const err = new Error(
      res.error.isPermissionDenied
        ? `【CDN 权限不足】当前 AccessKey 缺少阿里云 CDN 刷新缓存权限 (RAM 策略缺少 cdn:RefreshObjectCaches)。`
        : `【CDN 刷新失败】${res.error.code}: ${res.error.message}`
    ) as any;
    err.details = res.error;
    throw err;
  }

  return {
    success: true,
    taskId: res.data.RefreshTaskId,
    requestId: res.data.RequestId,
    refreshedUrl: cleanUrl,
    quotaRemain: Math.max(0, quotaCheck.urlRemain - 1),
  };
}
