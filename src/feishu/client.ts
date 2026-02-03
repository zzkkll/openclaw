import { fetch } from "undici";
import type {
  FeishuConfig,
  FeishuApiResponse,
  FeishuAccessToken,
  FeishuUserInfo,
} from "./types.js";
import { getChildLogger } from "../logging.js";

const logger = getChildLogger({ module: "feishu-client" });

const BASE_URL = "https://open.feishu.cn/open-apis";

export class FeishuClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private config: FeishuConfig) {}

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - 60000) {
      return this.token;
    }

    logger.debug("Refresing Feishu access token");
    try {
      const resp = await fetch(`${BASE_URL}/auth/v3/tenant_access_token/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      });

      const data = (await resp.json()) as FeishuApiResponse<FeishuAccessToken>;
      if (data.code !== 0) {
        throw new Error(`Feishu auth failed: ${data.msg} (${data.code})`);
      }

      this.token = data.data.tenant_access_token;
      this.tokenExpiresAt = now + data.data.expire * 1000;
      return this.token;
    } catch (error) {
      logger.error({ err: error }, "Failed to get Feishu access token");
      throw error;
    }
  }

  async sendMessage(
    receiveId: string,
    receiveIdType: "open_id" | "user_id" | "union_id" | "chat_id",
    msgType: "text" | "interactive",
    content: unknown,
  ): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${BASE_URL}/im/v1/messages?receive_id_type=${receiveIdType}`;

    // Content must be a JSON string
    const stringifiedContent = typeof content === "string" ? content : JSON.stringify(content);

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: msgType,
        content: stringifiedContent,
      }),
    });

    const data = (await resp.json()) as FeishuApiResponse<{ message_id: string }>;
    if (data.code !== 0) {
      logger.error({ data }, "Feishu sendMessage failed");
      throw new Error(`Feishu sendMessage failed: ${data.msg} (${data.code})`);
    }

    return data.data.message_id;
  }

  async getUserInfo(
    userId: string,
    userIdType: "open_id" | "user_id" | "union_id" = "user_id",
  ): Promise<FeishuUserInfo | null> {
    try {
      const token = await this.getAccessToken();
      const url = `${BASE_URL}/contact/v3/users/${userId}?user_id_type=${userIdType}`;

      const resp = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await resp.json()) as FeishuApiResponse<{
        user: { name: string; avatar: { avatar_72: string }; email?: string };
      }>;
      if (data.code !== 0) {
        logger.warn({ data, userId }, "Feishu getUserInfo failed");
        return null;
      }

      return {
        name: data.data.user.name,
        avatar_url: data.data.user.avatar.avatar_72,
        email: data.data.user.email,
      };
    } catch (e) {
      logger.error({ err: e }, "Failed to fetch user info");
      return null;
    }
  }
}
