import type {
  ChannelOutboundContext,
  ChannelOutboundTargetMode,
} from "../channels/plugins/types.js";
import type { FeishuClient } from "./client.js";
import { getChildLogger } from "../logging.js";

const logger = getChildLogger({ module: "feishu-send" });

export async function sendMessageFeishu(
  client: FeishuClient,
  ctx: ChannelOutboundContext,
  mode: ChannelOutboundTargetMode,
): Promise<string | null> {
  // TODO: Add support for images/files. For now, text only.
  const text = ctx.text || "[Empty message]";

  // The 'target' in mode is the Feishu receive_id (e.g. chat_id or user_id)
  let receiveId = "";
  let receiveIdType: "chat_id" | "user_id" | "open_id" | "union_id" = "chat_id";

  // mode is a string union: "explicit" | "implicit" | "heartbeat"
  // We rely on the formatted ctx.to string to determine target type if needed,
  // or just assume default behavior based on convention.

  if (ctx.to.startsWith("feishu:group:")) {
    receiveId = ctx.to.replace("feishu:group:", "");
    receiveIdType = "chat_id";
  } else if (ctx.to.startsWith("feishu:dm:")) {
    receiveId = ctx.to.replace("feishu:dm:", "");
    receiveIdType = "user_id";
  } else {
    // Fallback: assume the raw ID is passed
    receiveId = ctx.to;
    // If it looks like a UUID (chat_id) vs optimized ID (user_id/open_id) checking is hard.
    // Defaulting to chat_id is safer for channels, but user_id is safer for DMs.
    // Let's guess based on typical length or just default to open_id if it's not clearly a group.
    // However, standard openclaw convention for other channels usually relies on normalized IDs.
    receiveIdType = "chat_id";
  }

  // Feishu Text Format: JSON {"text": "string"}
  // Or we can use "interactive" cards for richer Markdown.
  // For simplicity, we use raw text.

  try {
    const msgId = await client.sendMessage(receiveId, receiveIdType, "text", {
      text: text,
    });
    return msgId;
  } catch (err) {
    logger.error({ err, receiveId }, "Failed to send Feishu message");
    return null;
  }
}
