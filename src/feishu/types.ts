export interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
  // If true, we assume the gateway is behind a proxy or tunnel that might strip headers
  skipSignatureCheck?: boolean;
}

export interface FeishuEventPayload<T = unknown> {
  schema: string;
  header: {
    event_id: string;
    token: string;
    create_time: string;
    event_type: string;
    tenant_key: string;
    app_id: string;
  };
  event: T;
}

export interface FeishuMessageEvent {
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time: string;
    chat_id: string;
    chat_type: "p2p" | "group";
    message_type:
      | "text"
      | "post"
      | "image"
      | "file"
      | "audio"
      | "media"
      | "sticker"
      | "interactive";
    content: string; // JSON string
    sender: {
      sender_id: {
        union_id: string;
        user_id: string; // We prefer this
        open_id: string;
      };
      sender_type: "user";
      tenant_key: string;
    };
    mentions?: Array<{
      key: string;
      id: {
        union_id: string;
        user_id: string;
        open_id: string;
      };
      name: string;
      tenant_key: string;
    }>;
  };
}

export interface FeishuChallengePayload {
  type: "url_verification";
  challenge: string;
  token: string;
}

export type FeishuIncomingPayload = FeishuChallengePayload | FeishuEventPayload<FeishuMessageEvent>;

// API Response Wrappers
export interface FeishuApiResponse<T> {
  code: number;
  msg: string;
  data: T;
}

export interface FeishuAccessToken {
  tenant_access_token: string;
  expire: number; // seconds
}

export interface FeishuUserInfo {
  name: string;
  avatar_url: string;
  email?: string;
}
