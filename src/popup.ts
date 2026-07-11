import { getAllMemes, deleteMeme, importMemes } from "./utils/storage";

const savedGrid = document.getElementById("savedGrid") as HTMLDivElement;
const countBadge = document.getElementById("countBadge") as HTMLSpanElement;
const importBtn = document.getElementById("importBtn") as HTMLButtonElement;
const exportBtn = document.getElementById("exportBtn") as HTMLButtonElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;

function togglePin(id: string): void {
  chrome.runtime.sendMessage({ type: "TOGGLE_PIN_MEME", id }, () => {
    render();
  });
}

// ---------- 导出 ----------

async function handleExport(): Promise<void> {
  const list = await getAllMemes();
  if (list.length === 0) return;

  const data = list.map((item) => ({
    sourceUrl: item.meta.sourceUrl,
    pageTitle: item.meta.pageTitle,
    savedAt: item.meta.savedAt,
    name: item.meta.name,
    pinned: item.meta.pinned,
    dataUrl: item.dataUrl,
  }));

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hupu-memes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- 导入 ----------

function handleImport(file: File): void {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result as string);
      if (!Array.isArray(data)) throw new Error("无效格式");
      await importMemes(data);
      render();
    } catch (err) {
      console.error("[Hupu Helper] Import failed:", err);
    }
  };
  reader.readAsText(file);
}

async function render(): Promise<void> {
  const list = await getAllMemes();
  countBadge.textContent = String(list.length);

  if (list.length === 0) {
    savedGrid.innerHTML = `
      <div class="empty-state">
        <div class="big">📭</div>
        <div>还没有表情包</div>
        <div class="hint">在任意图片上右键 → 保存为表情包</div>
      </div>
    `;
    return;
  }

  // 置顶优先
  const sorted = [...list].sort((a, b) => {
    if (a.meta.pinned && !b.meta.pinned) return -1;
    if (!a.meta.pinned && b.meta.pinned) return 1;
    return 0;
  });

  savedGrid.innerHTML = sorted
    .map(
      (item) => `
    <div class="saved-item">
      <img src="${item.dataUrl}" alt="" loading="lazy" data-url="${item.meta.sourceUrl}" />
      <div class="pin-btn" data-id="${item.meta.id}" data-pinned="${item.meta.pinned}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="${item.meta.pinned ? "#fadb14" : "none"}" stroke="${item.meta.pinned ? "#fadb14" : "#999"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      </div>
      <div class="del-btn" data-id="${item.meta.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></div>
    </div>
  `,
    )
    .join("");

  savedGrid.querySelectorAll(".saved-item img").forEach((img) => {
    img.addEventListener("click", () => {
      const url = (img as HTMLImageElement).dataset.url;
      if (url) chrome.tabs.create({ url });
    });
  });

  savedGrid.querySelectorAll(".pin-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      if (id) togglePin(id);
    });
  });

  savedGrid.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      if (!id) return;
      await deleteMeme(id);
      chrome.tabs.query({ url: "*://bbs.hupu.com/*" }, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id)
            chrome.tabs
              .sendMessage(tab.id, { type: "MEME_DATA_CHANGED" })
              .catch(() => {});
        });
      });
      render();
    });
  });
}

render();

// ---------- 按钮事件 ----------

exportBtn.addEventListener("click", handleExport);

importBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  if (fileInput.files?.[0]) {
    handleImport(fileInput.files[0]);
    fileInput.value = "";
  }
});

export {};
