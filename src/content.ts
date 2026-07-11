/// <reference types="chrome" />

// 从 storage 导入类型（避免重复定义）
import type { MemeImageData } from "./utils/storage";

// ============================================================
//  Hupu Helper - Content Script
//  功能：
//    1. 右键菜单保存表情包（由 background.js 处理）
//    2. 评论区注入表情选择器，点击已保存表情 → 上传至虎扑
// ============================================================

// ---------- 配置 ----------

const PICKER_CONTAINER_ID = "hupu-helper-picker";
const PICKER_BTN_CLASS = "hupu-helper-picker-btn";

// ---------- 通过 Background 读写数据 ----------

/** 向 background 请求所有已保存的表情包 */
function requestMemesFromBackground(): Promise<MemeImageData[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_SAVED_MEMES" }, (response) => {
      resolve((response?.data as MemeImageData[]) ?? []);
    });
  });
}

/** 通过 background 获取最近使用的表情 ID */
function getRecentIdsFromBackground(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_RECENT_IDS" }, (response) => {
      resolve((response?.data as string[]) ?? []);
    });
  });
}

/** 通过 background 记录最近使用 */
function saveRecentToBackground(id: string): void {
  chrome.runtime.sendMessage({ type: "SAVE_RECENT_MEME", id });
}

/** 保存图片到 storage */
async function handleSaveImage(imageUrl: string): Promise<void> {
  try {
    // 获取图片数据 — 先用 fetch，失败则回退到 XMLHttpRequest
    let blob: Blob;

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      blob = await response.blob();
    } catch {
      // fallback: XMLHttpRequest（某些图床限制 fetch 但允许 XHR）
      blob = await fetchViaXHR(imageUrl);
    }

    // 转 base64
    const dataUrl = await blobToDataURL(blob);

    // 发送到 background 保存
    chrome.runtime.sendMessage(
      {
        type: "SAVE_MEME_DATA",
        sourceUrl: imageUrl,
        dataUrl,
        pageTitle: document.title,
        name: `表情`,
      },
      (response) => {
        if (response?.success) {
          console.log("[Hupu Helper] 表情包已保存");
        } else {
          console.error("[Hupu Helper] 保存失败");
        }
      },
    );
  } catch (err) {
    console.error("[Hupu Helper] Save image error:", err);
  }
}

/** 通过 XMLHttpRequest 获取图片 Blob（fallback） */
function fetchViaXHR(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "blob";
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("XHR failed"));
    xhr.send();
  });
}

/** Blob → data URL */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ============================================================
//  功能 2: 评论区表情选择器 + 上传
// ============================================================

/** 注入表情选择器 — 在虎捕工具栏添加表情按钮 */
function initMemePicker(): void {
  injectUploadScript();
  watchFileInput();
  injectToolbarMemeButton();
}

/** 监视页面中动态创建的 file input */
let detectedFileInput: HTMLInputElement | null = null;

function watchFileInput(): void {
  detectedFileInput = findHupuFileInput();
  const observer = new MutationObserver(() => {
    const fi = findHupuFileInput();
    if (fi && fi !== detectedFileInput) {
      detectedFileInput = fi;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** 在虎捕评论区注入表情按钮 + 最近使用表情行 */
function injectToolbarMemeButton(): void {
  const tryAll = () => {
    tryInjectMemeButton();
    tryInjectRecentRow();
  };

  tryAll();

  const observer = new MutationObserver(() => tryAll());
  observer.observe(document.body, { childList: true, subtree: true });
}

function tryInjectMemeButton(): void {
  if (document.querySelector(`.${PICKER_BTN_CLASS}`)) return;
  const container = findToolbarContainer();
  if (container) appendMemeButton(container);
}

/** 在「还可以添加N张图片」前面插入最近使用表情行（同一行左对齐） */
let recentRowInjecting = false;
function tryInjectRecentRow(): void {
  if (document.querySelector(".hupu-recent-row") || recentRowInjecting) return;

  // 找底部操作栏
  const actionsBar = document.querySelector<HTMLElement>(
    "div.index_actions__uc_5L",
  );
  if (!actionsBar) return;

  recentRowInjecting = true;
  requestMemesFromBackground().then((all) => {
    if (all.length === 0 || document.querySelector(".hupu-recent-row")) {
      recentRowInjecting = false;
      return;
    }

    const row = document.createElement("span");
    row.className = "hupu-recent-row";
    row.style.cssText = `
      display:flex !important;
      align-items:center !important;
      align-self:center !important;
      gap:6px !important;
      flex:0 0 auto !important;
      margin:0 !important;
      margin-right:auto !important;
    `;

    // 置顶优先，最多取 10 个
    const sorted = [...all].sort((a, b) => {
      if (a.meta.pinned && !b.meta.pinned) return -1;
      if (!a.meta.pinned && b.meta.pinned) return 1;
      return 0;
    });
    sorted.slice(0, 10).forEach((meme) => {
      const item = document.createElement("span");
      item.style.cssText = `
        display:inline-flex !important;
        align-items:center !important;
        justify-content:center !important;
        width:36px !important;height:36px !important;
        border-radius:0 !important;
        background:#f5f5f5 !important;
        position:relative !important;
        border:1px solid ${meme.meta.pinned ? "#fadb14" : "#e8e8e8"} !important;
        cursor:pointer !important;
        overflow:hidden !important;
        transition:border-color 0.12s, transform 0.12s !important;
        flex-shrink:0 !important;
      `;
      item.title = meme.meta.pinned ? `📌 ${meme.meta.name}` : meme.meta.name;

      if (meme.meta.pinned) {
        const pin = document.createElement("span");
        pin.innerHTML =
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="#fadb14" stroke="#fadb14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
        pin.style.cssText =
          "position:absolute !important;top:1px !important;right:1px !important;z-index:2 !important;line-height:0 !important;pointer-events:none !important;";
        item.appendChild(pin);
      }

      const img = document.createElement("img");
      img.src = meme.dataUrl;
      img.style.cssText = `
        width:35px !important;height:35px !important;
        object-fit:cover !important;display:block !important;
        pointer-events:none !important;
      `;

      item.appendChild(img);

      item.addEventListener("mouseenter", () => {
        item.style.borderColor = "#667eea";
        item.style.transform = "scale(1.15)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.borderColor = meme.meta.pinned ? "#fadb14" : "#e8e8e8";
        item.style.transform = "scale(1)";
      });
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        saveRecentToBackground(meme.meta.id);
        uploadMemeToHupu(meme);
      });
      row.appendChild(item);
    });

    // 插入到底部操作栏最前面（和输入框左对齐）
    actionsBar.insertBefore(row, actionsBar.firstChild);
    recentRowInjecting = false;
  });
}

/** 查找虎捕评论工具栏容器 */
function findToolbarContainer(): HTMLElement | null {
  // 方法1: 找包含「还可以添加N张图片」文字的容器
  const walker = document.createTreeWalker(
    document.body,
    4 /* NodeFilter.SHOW_TEXT */,
  );
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent?.includes("还可以添加")) {
      let parent = node.parentElement;
      while (parent && parent !== document.body) {
        if (
          parent.querySelector('input[type="file"]') ||
          parent.querySelector('[class*="upload"]')
        ) {
          return parent;
        }
        parent = parent.parentElement;
      }
      return node.parentElement;
    }
  }

  // 方法2: 直接找 rc-upload 元素
  const rcUpload = document.querySelector<HTMLElement>(
    'span[role="button"], [class*="rc-upload"]',
  );
  if (rcUpload) {
    return rcUpload.parentElement || rcUpload;
  }

  // 方法3: 找包含 file input 且包含「图片」文字的容器
  const fileInputs = document.querySelectorAll('input[type="file"]');
  for (const fi of fileInputs) {
    let parent = fi.parentElement;
    while (parent && parent !== document.body) {
      if (parent.textContent?.includes("图片")) return parent;
      parent = parent.parentElement;
    }
  }

  return null;
}

/** 在工具栏容器中追加表情按钮 */
function appendMemeButton(container: HTMLElement): void {
  if (container.querySelector(`.${PICKER_BTN_CLASS}`)) return;

  // 匹配虎扑「图片」按钮的样式结构
  const btn = document.createElement("span");
  btn.className = PICKER_BTN_CLASS;
  btn.setAttribute("role", "button");
  btn.setAttribute("tabindex", "0");
  btn.title = "打开我的表情包";
  btn.style.cssText = `
    display: inline-flex !important;
    align-items: center !important;
    cursor: pointer !important;
    vertical-align: middle !important;
  `;

  const inner = document.createElement("div");
  inner.className = "index_btn__1h9VY";
  inner.style.cssText = `
    display: inline-flex !important;
    align-items: center !important;
    cursor: pointer !important;
  `;

  const icon = document.createElement("i");
  icon.className = "iconfont iconbiaoqing icon_3T0aG";
  icon.style.cssText = `
    font-size:16px !important;
    color:#666 !important;
  `;

  const text = document.createElement("span");
  text.textContent = "表情包";
  text.style.cssText = `
    font-size:13px !important;
    color:#666 !important;
    margin-left:4px !important;
  `;

  inner.appendChild(icon);
  inner.appendChild(text);
  btn.appendChild(inner);

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(0,0,0,0.06)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "transparent";
  });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePicker();
  });

  // 插入到「还可以添加N张图片」文字后面
  const textSpan = container.querySelector<HTMLElement>('[class*="text"]');
  if (textSpan && textSpan.parentElement === container) {
    textSpan.after(btn);
  } else {
    container.appendChild(btn);
  }
}

/** 开关表情选择器面板 */
async function togglePicker(): Promise<void> {
  const existing = document.getElementById(PICKER_CONTAINER_ID);
  if (existing) {
    existing.remove();
    return;
  }

  // 加载已保存的表情包 + 最近使用
  const [memes, recentIds] = await Promise.all([
    requestMemesFromBackground(),
    getRecentIdsFromBackground(),
  ]);
  renderPicker(memes, recentIds);
}

/** 渲染表情选择器面板 — 虎捕原生风格 */
function renderPicker(memes: MemeImageData[], recentIds: string[] = []): void {
  // 注入公共样式
  if (!document.getElementById("hupu-picker-style")) {
    const s = document.createElement("style");
    s.id = "hupu-picker-style";
    s.textContent = `
      @keyframes hupuPickerIn {
        from { opacity:0; transform:translateY(6px) scale(0.97); }
        to { opacity:1; transform:translateY(0) scale(1); }
      }
    `;
    document.head.appendChild(s);
  }

  const picker = document.createElement("div");
  picker.id = PICKER_CONTAINER_ID;

  const count = memes.length;
  const hasRecent = recentIds.length > 0;

  // 头部：标题 + 关闭
  const header = `
    <div style="
      display:flex;align-items:center;justify-content:space-between;
      padding:10px 14px;
    ">
      <span style="font-size:13px;font-weight:600;color:#333;">
        我的表情包
      </span>
      <span id="hupu-picker-close" style="
        cursor:pointer;font-size:16px;color:#bbb;line-height:1;padding:0 2px;
        transition:color 0.15s;
      ">✕</span>
    </div>
  `;

  // 空状态
  let body: string;
  if (count === 0) {
    body = `
      <div style="text-align:center;padding:32px 16px 28px;color:#bbb;font-size:13px;">
        <div style="font-size:36px;margin-bottom:8px;opacity:0.5;">📭</div>
        <div>还没有表情包</div>
        <div style="margin-top:4px;font-size:12px;color:#d0d0d0;">
          右键虎扑图片 → 保存为表情包
        </div>
      </div>
    `;
  } else {
    const recentLabel = hasRecent
      ? `<div style="font-size:11px;color:#bbb;padding:2px 12px 4px;">最近使用 ${recentIds.filter((rid) => memes.some((s) => s.meta.id === rid)).length}</div>
         <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:6px;padding:0 12px 8px;">
         ${(() => {
           const cols = 10;
           const validRecent = recentIds.filter((rid) =>
             memes.some((s) => s.meta.id === rid),
           );
           const items = validRecent.map((rid) => {
             const e = memes.find((s) => s.meta.id === rid);
             return e
               ? `<div class="hupu-picker-meme" data-id="${e.meta.id}"
                     style="width:36px;height:36px;border-radius:0;overflow:hidden;cursor:pointer;background:#f7f7f7;border:1px solid #e8e8e8;position:relative;transition:transform 0.12s;">
                     <img src="${e.dataUrl}" alt="" style="width:35px;height:35px;object-fit:cover;display:block;" loading="lazy" />
                   </div>`
               : "";
           });
           const empty = cols - (validRecent.length % cols || cols);
           for (let i = 0; i < empty; i++) {
             items.push(
               `<div style="width:36px;height:36px;border-radius:0;background:transparent;"></div>`,
             );
           }
           return items.join("");
         })()}
         </div>
         <div style="font-size:11px;color:#e0e0e0;border-top:1px solid #f0f0f0;padding:6px 12px 2px;">所有表情 ${memes.length}</div>`
      : "";

    body =
      recentLabel +
      `
      <div style="
        display:grid;grid-template-columns:repeat(10,1fr);gap:6px;
        padding:0 12px 12px;max-height:240px;overflow-y:auto;
      ">
        ${(() => {
          const cols = 10;
          // 置顶在前，其余在后
          const sorted = [...memes].sort((a, b) => {
            if (a.meta.pinned && !b.meta.pinned) return -1;
            if (!a.meta.pinned && b.meta.pinned) return 1;
            return 0;
          });
          const items = sorted.map(
            (e) => `
          <div class="hupu-picker-meme" data-id="${e.meta.id}"
            style="
              width:36px;height:36px;border-radius:0;overflow:hidden;
              cursor:pointer;background:#f7f7f7;
              border:1px solid ${e.meta.pinned ? "#fadb14" : "#e8e8e8"};
              position:relative;transition:transform 0.12s;
            "
            title="${e.meta.pinned ? "已置顶" : ""}"
          >
            ${e.meta.pinned ? '<svg style="position:absolute;top:1px;right:1px;z-index:1;" width="10" height="10" viewBox="0 0 24 24" fill="#fadb14" stroke="#fadb14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' : ""}
            <img src="${e.dataUrl}" alt="" style="
              width:35px;height:35px;object-fit:cover;display:block;
            " loading="lazy" />
          </div>
        `,
          );
          const empty = cols - (sorted.length % cols || cols);
          for (let i = 0; i < empty; i++) {
            items.push(
              `<div style="width:36px;height:36px;border-radius:0;background:transparent;"></div>`,
            );
          }
          return items.join("");
        })()}
      </div>
    `;
  }

  picker.innerHTML = header + body;

  // 面板样式 — 气泡弹出
  picker.style.cssText = `
    position:fixed !important;
    z-index:999999 !important;
    width:440px !important;
    background:#fff !important;
    border-radius:8px !important;
    box-shadow:0 4px 20px rgba(0,0,0,0.12) !important;
    border:1px solid #e0e0e0 !important;
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif !important;
    animation:hupuPickerIn 0.15s ease !important;
  `;

  // 定位：按钮正上方弹出
  const toolbarBtn = document.querySelector(`.${PICKER_BTN_CLASS}`);
  if (toolbarBtn) {
    const rect = toolbarBtn.getBoundingClientRect();
    const pickerW = 440;

    let left = Math.max(
      4,
      Math.min(
        rect.left + rect.width / 2 - pickerW / 2,
        window.innerWidth - pickerW - 4,
      ),
    );
    picker.style.left = `${left}px`;
    picker.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    picker.style.right = "12px";
    picker.style.bottom = "120px";
  }

  document.body.appendChild(picker);

  // 关闭
  const removePicker = () => {
    picker.remove();
  };

  picker
    .querySelector("#hupu-picker-close")
    ?.addEventListener("click", () => removePicker());
  picker
    .querySelector("#hupu-picker-close")
    ?.addEventListener("mouseenter", () => {
      (picker.querySelector("#hupu-picker-close") as HTMLElement).style.color =
        "#666";
    });
  picker
    .querySelector("#hupu-picker-close")
    ?.addEventListener("mouseleave", () => {
      (picker.querySelector("#hupu-picker-close") as HTMLElement).style.color =
        "#bbb";
    });

  // 外部点击或滚动关闭
  setTimeout(() => {
    const closeOnClick = (ev: MouseEvent) => {
      if (!picker.contains(ev.target as Node)) {
        removePicker();
        document.removeEventListener("mousedown", closeOnClick);
        window.removeEventListener("scroll", closeOnScroll);
      }
    };
    const closeOnScroll = () => {
      removePicker();
      document.removeEventListener("mousedown", closeOnClick);
      window.removeEventListener("scroll", closeOnScroll);
    };
    document.addEventListener("mousedown", closeOnClick);
    window.addEventListener("scroll", closeOnScroll, { passive: true });
  }, 0);

  // 表情交互
  picker.querySelectorAll(".hupu-picker-meme").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      (el as HTMLElement).style.transform = "scale(1.06)";
    });
    el.addEventListener("mouseleave", () => {
      (el as HTMLElement).style.transform = "scale(1)";
    });

    el.addEventListener("click", async () => {
      const id = (el as HTMLElement).dataset.id;
      const meme = memes.find((e) => e.meta.id === id);
      if (meme) {
        removePicker();
        saveRecentToBackground(meme.meta.id);
        await uploadMemeToHupu(meme);
      }
    });
  });
}

// ============================================================
//  上传逻辑 - 将表情上传到虎扑评论区
// ============================================================

/** 将保存的表情上传至虎扑 */
async function uploadMemeToHupu(meme: MemeImageData): Promise<void> {
  try {
    // 转换 data URL 为 File
    const file = dataURLToFile(meme.dataUrl, `meme_${meme.meta.id}.png`);

    // 使用 MutationObserver 缓存的 file input
    const fileInput = detectedFileInput || findHupuFileInput();

    if (!fileInput) {
      return;
    }

    // 使用 DataTransfer 设置文件
    const success = setFileOnInput(fileInput, file);
    if (!success) {
      // 如果直接设置失败，尝试注入脚本方式
      await injectFileViaScript(file);
    }
  } catch (err) {
    console.error("[Hupu Helper] Upload error:", err);
  }
}

/** 查找虎捕的图片上传 file input */
function findHupuFileInput(): HTMLInputElement | null {
  // 尝试各种选择器找到虎扑动态创建的 file input
  const selectors = [
    'input[type="file"]',
    'input[type="file"][accept*="image"]',
    'input[type="file"][accept*="png"]',
    'input[type="file"][accept*="jpg"]',
    'input[type="file"][multiple]',
  ];

  for (const sel of selectors) {
    const inputs = document.querySelectorAll<HTMLInputElement>(sel);
    if (inputs.length > 0) {
      // 选最后一个（虎扑通常动态创建，最新的在最后）
      return inputs[inputs.length - 1];
    }
  }

  return null;
}

/** 使用 DataTransfer 设置文件到 input */
function setFileOnInput(input: HTMLInputElement, file: File): boolean {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);

    // 使用 prototype 上的原生 setter（兼容 React 合成事件）
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "files",
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(input, dt.files);
    } else {
      // fallback
      Object.defineProperty(input, "files", {
        value: dt.files,
        writable: false,
      });
    }

    // React 监听 input + change 事件
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

/** 通过 CustomEvent 通知 page script 来设置文件 */
function injectFileViaScript(file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;

      // 监听上传结果
      const onResult = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        document.removeEventListener("hupu-helper:upload-result", onResult);
        if (detail.success) {
          resolve();
        } else {
          reject(new Error(detail.error));
        }
      };
      document.addEventListener("hupu-helper:upload-result", onResult);

      // 通过 CustomEvent 通知 page script（upload-helper.js）
      window.dispatchEvent(
        new CustomEvent("hupu-helper:upload-file", {
          detail: { dataUrl, fileName: file.name },
        }),
      );
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** dataURL → File */
function dataURLToFile(dataUrl: string, filename: string): File {
  const [meta, b64] = dataUrl.split(",");
  const mimeType = meta.match(/:(.*?);/)?.[1] ?? "image/png";
  const byteStr = atob(b64);
  const bytes = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) {
    bytes[i] = byteStr.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mimeType });
}

/** 注入上传处理脚本到页面上下文（通过扩展 URL 绕过 CSP） */
function injectUploadScript(): void {
  if (document.querySelector("script[data-hupu-helper]")) return;

  const script = document.createElement("script");
  script.setAttribute("data-hupu-helper", "uploader");
  script.src = chrome.runtime.getURL("meme-upload.js");
  document.documentElement.appendChild(script);
  script.onload = () => script.remove();
}

// ============================================================
//  消息监听（来自 background / popup）
// ============================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "SAVE_IMAGE_MEME": {
      const { imageUrl } = message as { type: string; imageUrl: string };
      handleSaveImage(imageUrl);
      sendResponse({ success: true });
      break;
    }
    case "UPLOAD_MEME_FILE": {
      const { dataUrl } = message as { type: string; dataUrl: string };
      window.dispatchEvent(
        new CustomEvent("hupu-helper:upload-file", {
          detail: { dataUrl, fileName: "emoji.png" },
        }),
      );
      sendResponse({ success: true });
      break;
    }
    case "MEME_DATA_CHANGED": {
      // 表情数据有变动，刷新底部栏
      refreshRecentRow();
      sendResponse({ success: true });
      break;
    }
  }
  return true;
});

/** 刷新底部栏 + 更新已打开的 modal（如有） */
function refreshRecentRow(): void {
  // 如果 modal 开着，刷新数据
  const picker = document.getElementById(PICKER_CONTAINER_ID);
  if (picker) {
    Promise.all([
      requestMemesFromBackground(),
      getRecentIdsFromBackground(),
    ]).then(([memes, recentIds]) => {
      picker.remove();
      renderPicker(memes, recentIds);
    });
  }

  // 刷新底部栏和按钮
  const old = document.querySelector(".hupu-recent-row");
  if (old) old.remove();
  const oldBtn = document.querySelector(`.${PICKER_BTN_CLASS}`);
  if (oldBtn) oldBtn.remove();
  recentRowInjecting = false;
  injectToolbarMemeButton();
}

// ============================================================
//  初始化
// ============================================================

function init(): void {
  console.log("[Hupu Helper] Content script loaded ✅");

  // 注入悬浮按钮 + 表情选择器
  initMemePicker();
}

// DOM 就绪后启动
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

export {};
