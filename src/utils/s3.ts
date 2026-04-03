/**
 * S3 上传模块
 * 使用 @aws-sdk/client-s3 v3 实现，兼容 S3Drive / MinIO / AWS S3 等
 *
 * 关键要求：必须设置 User-Agent: S3Drive/1.0
 */

import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

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
 * 创建 S3 客户端
 * 针对 S3Drive 等第三方 S3 兼容服务进行优化
 */
export function createS3Client(config: S3Config): S3Client {
  const mergedConfig = { ...DEFAULT_S3_CONFIG, ...config };

  // 确保 endpoint 规范（有协议头、无末尾斜杠）
  const endpoint = normalizeEndpoint(mergedConfig.endpoint || "");

  console.log("[S3] 创建客户端配置:", {
    endpoint,
    region: mergedConfig.region,
    forcePathStyle: mergedConfig.forcePathStyle,
  });

  const client = new S3Client({
    endpoint,
    region: mergedConfig.region,
    credentials: {
      accessKeyId: mergedConfig.accessKeyId,
      secretAccessKey: mergedConfig.secretAccessKey,
    },
    forcePathStyle: mergedConfig.forcePathStyle,
    // 关键：模拟 S3Drive 客户端
    customUserAgent: [["S3Drive", "1.0"]],
    // 禁用校验和计算（某些 S3 兼容服务不支持）
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  // 使用中间件强制设置 User-Agent（确保覆盖默认的 AWS SDK User-Agent）
  // @ts-ignore - middleware 类型较复杂
  client.middlewareStack.add(
    (next: any, context: any) => async (args: any) => {
      const { request } = args;
      if (request) {
        // 强制设置 User-Agent 为 S3Drive/1.0
        request.headers["user-agent"] = "S3Drive/1.0";
        // 移除 AWS SDK 默认的 x-amz-user-agent
        delete request.headers["x-amz-user-agent"];

        console.log("[S3] 发送请求:", {
          method: request.method,
          path: request.path,
          host: request.hostname,
          headers: {
            ...Object.fromEntries(
              Object.entries(request.headers).map(([k, v]) => [
                k,
                k === "authorization" ? "已设置(长度:" + String(v).length + ")" : v,
              ])
            ),
          },
        });
      }
      return next(args);
    },
    { step: "finalizeRequest", name: "s3driveUserAgent" }
  );

  return client;
}

/**
 * 测试 S3 连接
 * @returns 测试结果和错误信息
 */
export async function testS3Connection(
  config: S3Config
): Promise<{ success: boolean; message: string }> {
  try {
    const s3 = createS3Client(config);

    // 尝试列出桶中的对象（限制为1个）来验证连接
    await s3.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        MaxKeys: 1,
      })
    );

    return { success: true, message: "连接成功" };
  } catch (error: any) {
    // 增强错误日志
    console.error("[S3] 连接测试失败，完整错误:", error);
    console.error("[S3] 错误详情:", {
      name: error?.name,
      message: error?.message,
      code: error?.$metadata?.httpStatusCode,
      stack: error?.stack,
    });

    let message = "连接失败";
    const errName = error?.name || "";
    const errMsg = error?.message || "";

    if (errName === "UnknownError" || errMsg.includes("UnknownError")) {
      message = `连接测试失败: 服务端返回未知错误 (UnknownError)\n\n可能原因：\n1. S3Drive 需要特定的 User-Agent（已设置 S3Drive/1.0）\n2. Access Key 或 Secret Key 不正确\n3. 签名版本不匹配（当前使用 AWS Signature V4）\n\n建议检查 S3Drive 的密钥配置。`;
    } else if (
      errMsg.includes("Forbidden") ||
      errMsg.includes("403") ||
      errName === "Forbidden"
    ) {
      message = "访问被拒绝，请检查 Access Key 和 Secret Key";
    } else if (
      errMsg.includes("NoSuchBucket") ||
      errMsg.includes("404") ||
      errName === "NoSuchBucket"
    ) {
      message = "Bucket 不存在";
    } else if (
      errMsg.includes("SignatureDoesNotMatch") ||
      errName === "SignatureDoesNotMatch"
    ) {
      message = "签名不匹配，请检查 Secret Access Key 是否正确";
    } else if (
      errMsg.includes("Network") ||
      errMsg.includes("ENOTFOUND") ||
      errMsg.includes("fetch") ||
      errName === "TypeError"
    ) {
      message = `网络错误或无法访问 Endpoint。\n可能原因：\n1. Endpoint 地址不正确（已自动补全为 ${normalizeEndpoint(config.endpoint || "")}）\n2. S3 服务端未开启 CORS\n3. 浏览器扩展权限不足，请确保已在扩展详情中授予"允许访问所有网站"权限`;
    } else {
      message = `错误${errName ? ` [${errName}]` : ""}: ${errMsg}`;
    }

    return { success: false, message };
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
    const s3 = createS3Client(config);
    const key = config.key || DEFAULT_S3_CONFIG.key!;

    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: data,
        ContentType: "application/x-sqlite3",
        CacheControl: "no-cache",
      })
    );

    // 构建文件 URL
    const fileUrl = buildS3Url(config, key);

    return {
      success: true,
      message: `成功上传到 ${config.bucket}/${key}`,
      url: fileUrl,
    };
  } catch (error: any) {
    // 增强错误日志，打印完整的错误对象以便诊断
    console.error("[S3] 上传失败，完整错误:", error);
    console.error("[S3] 错误详情:", {
      name: error?.name,
      message: error?.message,
      code: error?.$metadata?.httpStatusCode,
      requestId: error?.$metadata?.requestId,
      cfId: error?.$metadata?.cfId,
      extendedRequestId: error?.$metadata?.extendedRequestId,
      stack: error?.stack,
    });

    let message = "上传失败";
    if (error instanceof Error || error?.message) {
      const errName = error.name || "";
      const errMsg = error.message || "";

      if (errName === "UnknownError" || errMsg.includes("UnknownError")) {
        message = `上传失败: 服务端返回未知错误 (UnknownError)\n\n可能原因：\n1. S3Drive 服务端需要特定的 User-Agent（已设置 S3Drive/1.0）\n2. Access Key 或 Secret Key 不正确\n3. 签名版本不匹配（当前使用 AWS Signature V4）\n4. 服务端返回了非标准的 HTTP 响应\n\n建议：\n- 确认 S3Drive 的 Access Key 和 Secret Key 正确\n- 检查 S3Drive 的日志查看具体拒绝原因\n- 尝试在 S3Drive 管理界面检查是否有访问限制`;
      } else if (errMsg.includes("fetch") || errMsg.includes("Network") || errName === "TypeError") {
        message = `上传失败：网络错误或无法访问 Endpoint。\n请检查扩展是否拥有对应域名的访问权限，或 S3 服务端是否开启 CORS。`;
      } else if (errName === "SignatureDoesNotMatch" || errMsg.includes("SignatureDoesNotMatch")) {
        message = `上传失败: 签名不匹配 (SignatureDoesNotMatch)\n请检查 Secret Access Key 是否正确。`;
      } else if (errName === "InvalidAccessKeyId" || errMsg.includes("InvalidAccessKeyId")) {
        message = `上传失败: Access Key ID 无效\n请检查 Access Key ID 是否正确。`;
      } else if (errName === "Forbidden" || errMsg.includes("Forbidden") || errMsg.includes("403")) {
        message = `上传失败: 访问被拒绝 (Forbidden)\n请检查密钥是否有写入权限。`;
      } else {
        message = `上传失败: ${errName ? `[${errName}] ` : ""}${errMsg}`;
      }
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
    // 路径样式: https://s3.example.com/bucket-name/key
    return `${endpoint}/${config.bucket}/${key}`;
  } else {
    // 虚拟主机样式: https://bucket-name.s3.example.com/key
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
 * @param config S3 配置（不包含 secretAccessKey 时保留原有值）
 */
export async function saveS3Config(config: Partial<S3Config>): Promise<void> {
  const storage = getStorage();

  // 获取现有配置（如果有）
  const existing = await getS3Config();

  // 合并配置
  const merged = {
    ...DEFAULT_S3_CONFIG,
    ...existing,
    ...config,
    // 如果没有提供新的 secretAccessKey，保留现有的
    secretAccessKey:
      config.secretAccessKey || existing?.secretAccessKey || "",
  } as S3Config;

  await storage.set({
    [STORAGE_KEY_S3_CONFIG]: merged,
  });

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
  // 检查是否已配置 S3
  const isConfigured = await isS3Configured();
  console.log("[S3] 检查配置状态:", { isConfigured });

  if (!isConfigured) {
    return {
      success: false,
      message:
        "S3 未配置，请先配置 S3 参数\n\n配置路径: 扩展设置 > S3 配置",
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
    // 导出数据库数据
    const data: Uint8Array = db.export();
    console.log("[S3] 数据库导出大小:", data.byteLength, "字节");

    // 上传到 S3
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
