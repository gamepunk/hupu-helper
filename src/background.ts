/// <reference types="chrome" />

import {
  saveEmoji,
  deleteEmoji,
  getAllEmojis,
  updateEmojiName,
  saveRecentEmoji,
  getRecentEmojiIds,
} from "./utils/storage";

// ---------- 右键菜单 ----------

const CONTEXT_MENU_ID = "hupu-save-emoji";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "保存为表情包",
    contexts: ["image"],
    documentUrlPatterns: ["*://*.hupu.com/*"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.srcUrl || !tab?.id) return;

  try {
    // 从 background 中无法直接 fetch blob（需要 host_permissions）
    // 改为发送消息给 content script，由 content script 完成抓取和保存
    await chrome.tabs.sendMessage(tab.id, {
      type: "SAVE_IMAGE_EMOJI",
      imageUrl: info.srcUrl,
    });
  } catch (err) {
    console.error("[Hupu Helper] Failed to send save message:", err);
  }
});

// ---------- 通知所有虎扑标签页刷新 ----------

async function notifyEmojiChanged(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: "*://*.hupu.com/*" });
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs
        .sendMessage(tab.id, { type: "EMOJI_DATA_CHANGED" })
        .catch(() => {});
    }
  }
}

// ---------- 消息处理 ----------

type MessageResponse = { success: boolean; data?: unknown; error?: string };

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; [key: string]: unknown },
    _sender,
    sendResponse: (response: MessageResponse) => void,
  ) => {
    (async () => {
      switch (message.type) {
        case "GET_SAVED_EMOJIS": {
          const emojis = await getAllEmojis();
          sendResponse({ success: true, data: emojis });
          break;
        }
        case "SAVE_EMOJI_DATA": {
          const { sourceUrl, dataUrl, pageTitle, name } = message as {
            type: string;
            sourceUrl: string;
            dataUrl: string;
            pageTitle?: string;
            name?: string;
          };
          const saved = await saveEmoji(sourceUrl, dataUrl, pageTitle, name);
          notifyEmojiChanged();
          sendResponse({ success: true, data: saved });
          break;
        }
        case "DELETE_EMOJI": {
          const { id } = message as { type: string; id: string };
          await deleteEmoji(id);
          notifyEmojiChanged();
          sendResponse({ success: true });
          break;
        }
        case "UPDATE_EMOJI_NAME": {
          const { id, name } = message as {
            type: string;
            id: string;
            name: string;
          };
          await updateEmojiName(id, name);
          sendResponse({ success: true });
          break;
        }
        case "SAVE_RECENT_EMOJI": {
          const { id } = message as { type: string; id: string };
          await saveRecentEmoji(id);
          sendResponse({ success: true });
          break;
        }
        case "GET_RECENT_IDS": {
          const ids = await getRecentEmojiIds();
          sendResponse({ success: true, data: ids });
          break;
        }
        case "UPLOAD_EMOJI_TO_HUPU": {
          // content script 请求上传表情到虎扑
          const { dataUrl } = message as {
            type: string;
            dataUrl: string;
          };
          // 转发给当前活跃 tab 的 content script
          const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (tab?.id) {
            await chrome.tabs.sendMessage(tab.id, {
              type: "UPLOAD_EMOJI_FILE",
              dataUrl,
            });
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: "No active hupu tab found" });
          }
          break;
        }
        default:
          sendResponse({ success: false, error: "Unknown message type" });
      }
    })();

    return true; // keep channel open for async response
  },
);
