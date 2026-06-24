import { loadEnvOverrides } from "../config.js";
import { ChannelError } from "../errors.js";
import { WechatApiClient } from "../wechat/api.js";
import { decodeQrMatrix, pollQrLogin, requestQrCode } from "../wechat/login.js";
import { createQRLoginHandle } from "./login.js";
import type { QRLoginHandle } from "./types.js";

export interface LoginQROpts {
  /** ilink 网关地址。默认 env(WECHAT_CHANNEL_BASE_URL) 或 https://ilinkai.weixin.qq.com */
  baseUrl?: string;
  /** CDN 地址。默认 env(WECHAT_CHANNEL_CDN_BASE_URL) 或 https://novac2c.cdn.weixin.qq.com/c2c */
  cdnBaseUrl?: string;
  /** base_info.channel_version。默认 "wechat-channel/0.1.0"（与 create.ts:57 一致） */
  channelVersion?: string;
  /** base_info.bot_agent。默认等于 channelVersion */
  botAgent?: string;
  /** 登录 bot 类型。默认 "3"（见 create.ts:115） */
  botType?: string;
  /** waitForLogin 默认超时。默认 120_000ms（与 create.ts:123 一致） */
  timeoutMs?: number;
  /** 取消 waitForLogin 轮询 */
  signal?: AbortSignal;
}

/**
 * 申请扫码登录二维码，无需任何已有凭证。
 *
 * 登录端点不走鉴权（get_bot_qrcode 用 useAuth:false；get_qrcode_status 是
 * 不带 token 的 GET），所以这里自建一个无 botToken 的 WechatApiClient。
 *
 * 返回的 QRLoginHandle 提供 toTerminal/toPng/toSvg/toDataURL 渲染二维码，
 * 以及 waitForLogin() —— 用户扫码确认后 resolve 出 { botToken, accountId, baseUrl }，
 * 把这三个值交给 createChannel 即可开始收发消息。
 *
 * @throws {@link ChannelError} "AUTH_REQUIRED" 当登录超时/失败/未拿到 token 时
 */
export async function loginQR(opts: LoginQROpts = {}): Promise<QRLoginHandle> {
  const env = loadEnvOverrides("WECHAT_CHANNEL_");
  const baseUrl = opts.baseUrl ?? env.baseUrl ?? "https://ilinkai.weixin.qq.com";
  const cdnBaseUrl = opts.cdnBaseUrl ?? env.cdnBaseUrl ?? "https://novac2c.cdn.weixin.qq.com/c2c";
  const channelVersion = opts.channelVersion ?? "wechat-channel/0.1.0";
  const botAgent = opts.botAgent ?? channelVersion;

  // 关键：不传 botToken —— 登录阶段本就没有凭证，端点也不需要鉴权。
  const api = new WechatApiClient({ baseUrl, cdnBaseUrl, channelVersion, botAgent });

  const { qrcode, qrcodeImgContent } = await requestQrCode(api, { botType: opts.botType ?? "3" });
  const matrix = await decodeQrMatrix(qrcodeImgContent);

  return createQRLoginHandle({
    matrix,
    waitForLogin: async (waitOpts) => {
      const result = await pollQrLogin(api, {
        qrcode,
        timeoutMs: waitOpts?.timeoutMs ?? opts.timeoutMs ?? 120_000,
        signal: waitOpts?.signal ?? opts.signal,
      });
      // 修复 create.ts:126 的 botToken! 非空断言：登录失败时显式抛错，
      // 不再把 undefined 当 string 返回给调用方。
      if (!result.connected || !result.botToken || !result.accountId) {
        throw new ChannelError("AUTH_REQUIRED", result.message);
      }
      return {
        botToken: result.botToken,
        accountId: result.accountId,
        baseUrl: result.baseUrl ?? baseUrl,
      };
    },
  });
}
