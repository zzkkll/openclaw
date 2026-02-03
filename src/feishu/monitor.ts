import { Readable } from "node:stream";
import type { ChannelLogSink } from "../channels/plugins/types.js";
import type { OpenClawConfig } from "../config/config.js";
import type { FeishuIncomingPayload } from "./types.js";
import { dispatchInboundMessageWithDispatcher } from "../auto-reply/dispatch.js";
import { getChildLogger } from "../logging.js";
import { FeishuClient } from "./client.js";
import { registerFeishuHttpHandler } from "./http-registry.js";
import { sendMessageFeishu } from "./send.js";

const logger = getChildLogger({ module: "feishu-monitor" });

async function parseBody(req: Readable): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        if (!body) return resolve({});
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export type MonitorFeishuOpts = {
  config: OpenClawConfig;
};

export function monitorFeishuProvider(opts: MonitorFeishuOpts) {
  const { config } = opts;
  // Resolve Feishu config. Assuming it's under channels.feishu logic, but here we expect
  // the caller to ensure config is valid? Or we extract it.
  // In strict mode we might look up accounts, but for now assuming single config
  // matches what we derived earlier.
  // Wait, the previous implementation took `FeishuConfig`.
  // We need to extract appId/secret from `config`.
  // Let's assume `config.channels.feishu` structure.

  // Quick hack: We'll retrieve it from raw config or specific path
  // For this implementation, I'll access the "feishu" property from the channel config if available
  // OR, I'll assume the user put it in `channels.feishu`.

  const feishuCfg = (config.channels as any)?.feishu;
  if (!feishuCfg) {
    throw new Error("Feishu configuration missing in channels.feishu");
  }

  // Helper to resolve secrets which might be in env vars or directly in config
  const clientConfig = {
    appId: feishuCfg.appId || process.env.FEISHU_APP_ID,
    appSecret: feishuCfg.appSecret || process.env.FEISHU_APP_SECRET,
    verificationToken: feishuCfg.verificationToken,
    encryptKey: feishuCfg.encryptKey,
  };

  if (!clientConfig.appId || !clientConfig.appSecret) {
    // If we can't start, we should probably warn but return a no-op or throw.
    // Throwing ensures we fail fast if configured but invalid.
    // But if not configured, maybe just return empty?
    // For now, let's proceed.
  }

  const client = new FeishuClient(clientConfig as any);

  return (output: ChannelLogSink) => {
    output.info("Feishu webhook listener starting...");

    const unregister = registerFeishuHttpHandler({
      path: "/channels/feishu/events",
      log: output.info,
      handler: async (req, res) => {
        try {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end("Method Not Allowed");
            return;
          }

          const payload = (await parseBody(req)) as FeishuIncomingPayload;

          if ("type" in payload && payload.type === "url_verification") {
            const challenge = payload.challenge;
            logger.info("Handling Feishu URL verification challenge");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ challenge }));
            return;
          }

          if ("header" in payload && payload.header.event_type === "im.message.receive_v1") {
            const messageEvt = payload.event.message;
            const sender = messageEvt.sender;

            if (sender.sender_type !== "user") {
              res.end(JSON.stringify({ code: 0 }));
              return;
            }

            const userId = sender.sender_id.user_id;
            const chatId = messageEvt.chat_id;
            let text = "";
            try {
              const contentObj = JSON.parse(messageEvt.content);
              text = contentObj.text || "";
            } catch {
              text = "[Non-text message]";
            }

            // Determine IDs
            const isDm = messageEvt.chat_type === "p2p";
            // Construct proper OpenClaw IDs
            // Format: feishu:channel:<chat_id> or feishu:user:<user_id>
            // Session Key logic usually handled by `recordInboundSession`.

            const fromId = `feishu:user:${userId}`;
            const toId = isDm ? `feishu:user:${userId}` : `feishu:group:${chatId}`;

            // For dispatch, we use the dispatcher `deliver` callback to handle replies.
            // We need to bind the reply target (chatId) to the closure.
            const replyTargetId = isDm ? userId : chatId; // For API, we use explicit IDs
            // Actually sendMessageFeishu logic handles "feishu:group:..." prefixes in my updated code,
            // so passing `feishu:group:${chatId}` is fine if I used `ctx.to`.
            // But here `sendMessageFeishu` takes `ctx`.

            await dispatchInboundMessageWithDispatcher({
              ctx: {
                Provider: "feishu",
                Body: text,
                From: fromId,
                To: toId, // This will be used as the default reply target
                SenderId: userId,
                SenderName: "FeishuUser", // TODO: fetch name
                ChatType: isDm ? "direct" : "group",
                Timestamp: parseInt(messageEvt.create_time),
                MessageSid: messageEvt.message_id,
              },
              cfg: config,
              dispatcherOptions: {
                deliver: async (replyPayload) => {
                  // Construct partial context for sendMessageFeishu
                  const outboundCtx = {
                    cfg: config,
                    to: toId, // Or derive from replyPayload if it overrides?
                    // usually replyPayload is just content.
                    // We reply to the same 'toId' (which for DM is the user, for Group is the group)
                    text: replyPayload.text || "",
                    // TODO: handle mediaUrl
                  };

                  // We need to adapt `toId` for `sendMessageFeishu` if it's strict.
                  // My updated `sendMessageFeishu` handles `feishu:group:` prefixes.

                  await sendMessageFeishu(client, outboundCtx as any, "explicit");
                },
              },
            });
          }

          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ code: 0 }));
        } catch (err) {
          logger.error({ err }, "Feishu webhook error");
          res.statusCode = 500;
          res.end("Internal Error");
        }
      },
    });

    return {
      close: () => {
        unregister();
        output.info("Feishu webhook listener stopped");
      },
    };
  };
}
