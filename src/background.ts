/// <reference types="chrome" />

import {
  saveMeme,
  saveMemeFromBlob,
  deleteMeme,
  getAllMemes,
  togglePinMeme,
  saveRecentMeme,
  getRecentMemeIds,
} from "./utils/storage";

// ---------- 右键菜单 ----------

const CONTEXT_MENU_ID = "hupu-save-meme";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: "保存为表情包",
      contexts: ["image"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.srcUrl || !tab?.id) return;

  const imageUrl = info.srcUrl;

  // 优先发送给 content script（可读取页面标题等信息）
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "SAVE_IMAGE_MEME",
      imageUrl,
    });
    return;
  } catch {
    // content script 未加载，直接后台保存
    console.log(
      "[Hupu Helper] Content script not available, saving from background",
    );
  }

  try {
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();

    const pageTitle = tab.title ?? "虎扑";
    await saveMemeFromBlob(imageUrl, blob, pageTitle, "表情");
    notifyMemeChanged();
  } catch (err) {
    console.error("[Hupu Helper] Failed to save image:", err);
  }
});

// ---------- 通知所有虎扑标签页刷新 ----------

async function notifyMemeChanged(): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: ["*://bbs.hupu.com/*", "*://*.bbsactivity.hupu.com/*"],
  });
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs
        .sendMessage(tab.id, { type: "MEME_DATA_CHANGED" })
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
        case "GET_SAVED_MEMES": {
          const memes = await getAllMemes();
          sendResponse({ success: true, data: memes });
          break;
        }
        case "SAVE_MEME_DATA":
        case "SAVE_MEME_BLOB": {
          const { sourceUrl, pageTitle, name } = message as {
            type: string;
            sourceUrl: string;
            dataUrl?: string;
            blob?: Blob;
            pageTitle?: string;
            name?: string;
          };
          let saved: import("./utils/storage").MemeImageData;
          if (message.type === "SAVE_MEME_BLOB") {
            const { blob } = message as {
              type: string;
              blob: Blob;
              sourceUrl: string;
              pageTitle?: string;
              name?: string;
            };
            saved = await saveMemeFromBlob(sourceUrl, blob, pageTitle, name);
          } else {
            const { dataUrl } = message as {
              type: string;
              dataUrl: string;
              sourceUrl: string;
              pageTitle?: string;
              name?: string;
            };
            saved = await saveMeme(sourceUrl, dataUrl, pageTitle, name);
          }
          notifyMemeChanged();
          sendResponse({ success: true, data: saved });
          break;
        }
        case "DELETE_MEME": {
          const { id } = message as { type: string; id: string };
          await deleteMeme(id);
          notifyMemeChanged();
          sendResponse({ success: true });
          break;
        }
        case "TOGGLE_PIN_MEME": {
          const { id } = message as { type: string; id: string };
          const pinned = await togglePinMeme(id);
          notifyMemeChanged();
          sendResponse({ success: true, data: pinned });
          break;
        }
        case "SAVE_RECENT_MEME": {
          const { id } = message as { type: string; id: string };
          await saveRecentMeme(id);
          sendResponse({ success: true });
          break;
        }
        case "GET_RECENT_IDS": {
          const ids = await getRecentMemeIds();
          sendResponse({ success: true, data: ids });
          break;
        }
        case "UPLOAD_MEME_TO_HUPU": {
          const { dataUrl } = message as {
            type: string;
            dataUrl: string;
          };
          try {
            const [tab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });
            if (tab?.id) {
              await chrome.tabs.sendMessage(tab.id, {
                type: "UPLOAD_MEME_FILE",
                dataUrl,
              });
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: "No active tab found" });
            }
          } catch {
            sendResponse({
              success: false,
              error: "No content script available on this page",
            });
          }
          break;
        }
        default:
          sendResponse({ success: false, error: "Unknown message type" });
      }
    })();

    return true; // keep channel for async response
  },
);
