/**
 * S3 上传模块
 * 使用 aws4fetch 实现，兼容 S3Drive / MinIO / AWS S3 等
 *
 * 关键要求：
 * 1. 必须设置 User-Agent: S3Drive/1.0（通过 background declarativeNetRequest 动态规则实现）
 * 2. S3Drive 等第三方服务对 AWS SDK v2/v3 的签名/header 兼容性不佳，使用原生 fetch + aws4fetch 签名最稳定
 */

import { AwsV4Signer } from "aws4fetch";

// S3 配置存储 key
const STORAGE_KEY_S3_CONFIG = "wereader_s3_config";

/**
 * S3 配置接口
 */
export interface S3Config {
  endpoint: string; // 例如: https://s3.example.com
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string; // 默认 us-east-1
  key?: string; // 对象键名，默认 wereader_notes.db
  forcePathStyle?: boolean; // 是否使用路径样式（对于 MinIO 等私有 S3 通常需要）
}

/**
 * 默认 S3 配置
 */
const DEFAULT_S3_CONFIG: Partial<S3Config> = {
  region: "us-east-1",
  key: "wereader_notes.db",
  forcePathStyle: true,
};

/**
 * 规范 endpoint：补全协议头、去掉末尾斜杠
 */
function normalizeEndpoint(raw: string): string {
  let endpoint = raw.trim();
  if (!/^https?:\/\//i.test(endpoint)) {
    endpoint = "https://" + endpoint;
  }
  return endpoint.replace(/\/$/, "");
}

/**
 * 通过 background service worker 更新 declarativeNetRequest 规则，
 * 将发往该 S3 endpoint 的请求 User-Agent 强制设为 S3Drive/1.0
 */
async function updateUARuleInBackground(endpoint: string): Promise<boolean> {
  const normalized = normalizeEndpoint(endpoint);

  // 如果当前就在 background/service worker 上下文中（没有 window），直接本地更新规则
  if (typeof window === "undefined" && typeof (chrome as any) !== "undefined" && (chrome as any).declarativeNetRequest) {
    try {
      const S3_UA_RULE_ID = 100;
      const hostname = new URL(normalized).hostname;
      await (chrome as any).declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [S3_UA_RULE_ID],
        addRules: [
          {
            id: S3_UA_RULE_ID,
            priority: 1,
            action: {
              type: (chrome as any).declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              requestHeaders: [
                {
                  header: "User-Agent",
                  operation: (chrome as any).declarativeNetRequest.HeaderOperation.SET,
                  value: "S3Drive/1.0",
                },
              ],
            },
            condition: {
              urlFilter: `||${hostname}`,
              resourceTypes: [
                (chrome as any).declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
              ],
            },
          },
        ],
      });
      console.log("[S3] S3 UA 规则已更新（本地）:", hostname);
      return true;
    } catch (err) {
      console.error("[S3] 本地更新 UA 规则失败:", err);
      return false;
    }
  }

  try {
    if (typeof browser === "undefined" || !browser.runtime?.sendMessage) {
      console.warn("[S3] browser.runtime.sendMessage 不可用，跳过 UA 规则更新");
      return false;
    }
    const resp = await browser.runtime.sendMessage({
      type: "UPDATE_S3_UA_RULE",
      payload: { endpoint: normalized },
    });
    return resp?.success ?? false;
  } catch (err) {
    console.error("[S3] 更新 UA 规则失败:", err);
    return false;
  }
}

/**
 * 对 S3 请求进行 AWS Signature V4 签名
 */
async function signedFetch(
  url: string,
  config: S3Config,
  options: { method?: string; headers?: HeadersInit; body?: any } = {}
): Promise<Response> {
  const signer = new AwsV4Signer({
    url,
    method: options.method,
    headers: options.headers,
    body: options.body,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region || DEFAULT_S3_CONFIG.region,
  });

  const signed = await signer.sign();
  return fetch(signed.url, {
    method: signed.method,
    headers: signed.headers,
    body: signed.body,
  });
}

/**
 * 测试 S3 连接
 * @returns 测试结果和错误信息
 */
export async function testS3Connection(
  config: S3Config
): Promise<{ success: boolean; message: string }> {
  try {
    await updateUARuleInBackground(config.endpoint);

    const mergedConfig = { ...DEFAULT_S3_CONFIG, ...config };
    const endpoint = normalizeEndpoint(mergedConfig.endpoint || "");
    const url = `${endpoint}/${mergedConfig.bucket}?list-type=2&max-keys=1`;

    console.log("[S3] 测试连接:", url);

    const resp = await signedFetch(url, mergedConfig, {
      method: "GET",
    });

    if (resp.ok) {
      return { success: true, message: "连接成功" };
    }

    const body = await resp.text();
    console.error("[S3] 连接失败，状态:", resp.status, "响应:", body);

    // 尝试解析 S3 XML 错误
    const codeMatch = body.match(/<Code>([^<]+)<\/Code>/);
    const messageMatch = body.match(/<Message>([^<]+)<\/Message>/);
    const errCode = codeMatch?.[1] || "";
    const errMsg = messageMatch?.[1] || body;

    let message = "连接失败";
    if (errCode === "SignatureDoesNotMatch" || errMsg.includes("SignatureDoesNotMatch")) {
      message = "签名不匹配，请检查 Secret Access Key 是否正确";
    } else if (errCode === "InvalidAccessKeyId" || errMsg.includes("InvalidAccessKeyId")) {
      message = "Access Key ID 无效，请检查是否正确";
    } else if (errCode === "NoSuchBucket" || errMsg.includes("NoSuchBucket") || resp.status === 404) {
      message = "Bucket 不存在";
    } else if (errCode === "AccessDenied" || errMsg.includes("AccessDenied") || resp.status === 403) {
      message = "访问被拒绝，请检查 Access Key 和 Secret Key";
    } else {
      message = `连接失败 [HTTP ${resp.status}${errCode ? ` / ${errCode}` : ""}]: ${errMsg || "未知错误"}`;
    }

    return { success: false, message };
  } catch (error: any) {
    console.error("[S3] 连接测试异常:", error);

    let message = "连接失败";
    if (error?.message?.includes("ENOTFOUND") || error?.message?.includes("ECONNREFUSED") || error?.message?.includes("fetch")) {
      message = `网络错误或无法访问 Endpoint。\n可能原因：\n1. Endpoint 地址不正确（已自动补全为 ${normalizeEndpoint(config.endpoint || "")}）\n2. S3 服务端未开启 CORS\n3. 浏览器扩展权限不足，请确保已在扩展详情中授予"允许访问所有网站"权限`;
    } else {
      message = `错误: ${error?.message || String(error)}`;
    }

    return { success: false, message };
  }
}

/**
 * 从 S3 下载 SQLite 数据库
 * @param config S3 配置
 * @returns 数据库数据 (Uint8Array) 或 null（表示文件不存在或下载失败）
 */
export async function downloadFromS3(config: S3Config): Promise<Uint8Array | null> {
  try {
    await updateUARuleInBackground(config.endpoint);

    const mergedConfig = { ...DEFAULT_S3_CONFIG, ...config };
    const endpoint = normalizeEndpoint(mergedConfig.endpoint || "");
    const key = mergedConfig.key || DEFAULT_S3_CONFIG.key!;
    const url = `${endpoint}/${mergedConfig.bucket}/${key}`;

    console.log("[S3] 开始下载:", url);

    const resp = await signedFetch(url, mergedConfig, {
      method: "GET",
    });

    if (resp.status === 404) {
      console.log("[S3] 远程数据库不存在，将创建新数据库");
      return null;
    }

    if (!resp.ok) {
      const body = await resp.text();
      console.error("[S3] 下载失败，状态:", resp.status, "响应:", body);
      return null;
    }

    const arrayBuffer = await resp.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    console.log("[S3] 下载成功，大小:", data.byteLength, "字节");
    return data;
  } catch (error: any) {
    console.error("[S3] 下载异常:", error);
    return null;
  }
}

/**
 * 上传 SQLite 数据库到 S3
 * @param config S3 配置
 * @param data 数据库数据 (Uint8Array)
 * @returns 上传结果
 */
export async function uploadToS3(
  config: S3Config,
  data: Uint8Array
): Promise<{ success: boolean; message: string; url?: string }> {
  try {
    await updateUARuleInBackground(config.endpoint);

    const mergedConfig = { ...DEFAULT_S3_CONFIG, ...config };
    const endpoint = normalizeEndpoint(mergedConfig.endpoint || "");
    const key = mergedConfig.key || DEFAULT_S3_CONFIG.key!;
    const url = `${endpoint}/${mergedConfig.bucket}/${key}`;

    console.log("[S3] 开始上传:", url, "大小:", data.byteLength, "字节");

    const resp = await signedFetch(url, mergedConfig, {
      method: "PUT",
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Cache-Control": "no-cache",
      },
      body: data,
    });

    if (resp.ok) {
      const fileUrl = buildS3Url(config, key);
      return {
        success: true,
        message: `成功上传到 ${config.bucket}/${key}`,
        url: fileUrl,
      };
    }

    const body = await resp.text();
    console.error("[S3] 上传失败，状态:", resp.status, "响应:", body);

    const codeMatch = body.match(/<Code>([^<]+)<\/Code>/);
    const messageMatch = body.match(/<Message>([^<]+)<\/Message>/);
    const errCode = codeMatch?.[1] || "";
    const errMsg = messageMatch?.[1] || body;

    let message = "上传失败";
    if (errCode === "SignatureDoesNotMatch" || errMsg.includes("SignatureDoesNotMatch")) {
      message = "签名不匹配，请检查 Secret Access Key 是否正确";
    } else if (errCode === "InvalidAccessKeyId" || errMsg.includes("InvalidAccessKeyId")) {
      message = "Access Key ID 无效，请检查是否正确";
    } else if (errCode === "AccessDenied" || errMsg.includes("AccessDenied") || resp.status === 403) {
      message = "访问被拒绝，请检查密钥是否有写入权限";
    } else {
      message = `上传失败 [HTTP ${resp.status}${errCode ? ` / ${errCode}` : ""}]: ${errMsg || "未知错误"}`;
    }

    return { success: false, message };
  } catch (error: any) {
    console.error("[S3] 上传异常:", error);

    let message = "上传失败";
    if (error?.message?.includes("Network") || error?.message?.includes("fetch")) {
      message = "上传失败：网络错误或无法访问 Endpoint。请检查扩展权限或 S3 服务端 CORS 配置。";
    } else {
      message = `上传失败: ${error?.message || String(error)}`;
    }

    return { success: false, message };
  }
}

/**
 * 构建 S3 文件 URL
 */
function buildS3Url(config: S3Config, key: string): string {
  const endpoint = normalizeEndpoint(config.endpoint || "");

  if (config.forcePathStyle) {
    return `${endpoint}/${config.bucket}/${key}`;
  } else {
    if (endpoint.includes("amazonaws.com")) {
      return `${endpoint}/${key}`;
    }
    const endpointUrl = new URL(endpoint);
    return `${endpointUrl.protocol}//${config.bucket}.${endpointUrl.host}/${key}`;
  }
}

/**
 * 安全获取 browser.storage API
 */
function getStorage() {
  if (typeof browser === "undefined" || !browser.storage) {
    throw new Error("Browser storage API 不可用");
  }
  return browser.storage.local;
}

/**
 * 保存 S3 配置到 storage
 * 保存成功后通知 background 更新 declarativeNetRequest UA 规则
 * @param config S3 配置（不包含 secretAccessKey 时保留原有值）
 */
export async function saveS3Config(config: Partial<S3Config>): Promise<void> {
  const storage = getStorage();
  const existing = await getS3Config();

  const merged = {
    ...DEFAULT_S3_CONFIG,
    ...existing,
    ...config,
    secretAccessKey:
      config.secretAccessKey || existing?.secretAccessKey || "",
  } as S3Config;

  await storage.set({
    [STORAGE_KEY_S3_CONFIG]: merged,
  });

  if (merged.endpoint) {
    await updateUARuleInBackground(merged.endpoint);
  }

  console.log("[S3] 配置已保存");
}

/**
 * 从 storage 获取 S3 配置
 */
export async function getS3Config(): Promise<S3Config | null> {
  try {
    const storage = getStorage();
    const result = await storage.get(STORAGE_KEY_S3_CONFIG);
    const config = result[STORAGE_KEY_S3_CONFIG];

    if (!config) {
      return null;
    }

    return { ...DEFAULT_S3_CONFIG, ...config } as S3Config;
  } catch (error) {
    console.error("[S3] 获取配置失败:", error);
    return null;
  }
}

/**
 * 清除 S3 配置
 */
export async function clearS3Config(): Promise<void> {
  const storage = getStorage();
  await storage.remove(STORAGE_KEY_S3_CONFIG);
  console.log("[S3] 配置已清除");
}

/**
 * 检查是否已配置 S3
 */
export async function isS3Configured(): Promise<boolean> {
  const config = await getS3Config();
  return !!(
    config?.endpoint &&
    config?.bucket &&
    config?.accessKeyId &&
    config?.secretAccessKey
  );
}

/**
 * 导出数据到 S3 的完整流程
 * @param db SQLite 数据库实例（sql.js 的 Database 对象）
 * @param bookTitle 书籍标题（用于日志）
 */
export async function exportToS3(
  db: any,
  bookTitle: string
): Promise<{ success: boolean; message: string; url?: string }> {
  const isConfigured = await isS3Configured();
  console.log("[S3] 检查配置状态:", { isConfigured });

  if (!isConfigured) {
    return {
      success: false,
      message: "S3 未配置，请先配置 S3 参数\n\n配置路径: 扩展设置 > S3 配置",
    };
  }

  const config = await getS3Config();
  console.log("[S3] 获取配置:", {
    endpoint: config?.endpoint,
    bucket: config?.bucket,
    region: config?.region,
    accessKeyId: config?.accessKeyId ? "已设置" : "未设置",
    secretAccessKey: config?.secretAccessKey ? "已设置" : "未设置",
    forcePathStyle: config?.forcePathStyle,
  });

  if (!config) {
    return { success: false, message: "无法获取 S3 配置" };
  }

  try {
    const data: Uint8Array = db.export();
    console.log("[S3] 数据库导出大小:", data.byteLength, "字节");

    console.log("[S3] 开始上传...");
    const result = await uploadToS3(config, data);
    console.log("[S3] 上传结果:", result);

    if (result.success) {
      return {
        success: true,
        message: `《${bookTitle}》导出成功\n\n${result.message}`,
        url: result.url,
      };
    } else {
      return result;
    }
  } catch (error: any) {
    console.error("[S3] 导出失败:", error);

    let message = "导出到 S3 失败";
    if (error instanceof Error || error?.message) {
      message = `导出失败: ${error.name ? `[${error.name}] ` : ""}${error.message}`;
    }

    return { success: false, message };
  }
}
