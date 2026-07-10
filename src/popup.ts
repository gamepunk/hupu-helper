import { getAllEmojis, deleteEmoji } from "./utils/storage";

const savedGrid = document.getElementById("savedGrid") as HTMLDivElement;
const countBadge = document.getElementById("countBadge") as HTMLSpanElement;

async function render(): Promise<void> {
  const list = await getAllEmojis();
  countBadge.textContent = String(list.length);

  if (list.length === 0) {
    savedGrid.innerHTML = `
      <div class="empty-state">
        <div class="big">📭</div>
        <div>还没有表情包</div>
        <div class="hint">在虎扑图片上右键 → 保存为表情包</div>
      </div>
    `;
    return;
  }

  savedGrid.innerHTML = list
    .map(
      (item) => `
    <div class="saved-item" data-id="${item.meta.id}">
      <img src="${item.dataUrl}" alt="" loading="lazy" />
      <button class="del-btn" data-id="${item.meta.id}">✕</button>
    </div>
  `,
    )
    .join("");

  savedGrid.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = (btn as HTMLButtonElement).dataset.id;
      if (!id) return;
      await deleteEmoji(id);
      // 通知虎扑页面刷新
      chrome.tabs.query({ url: "*://*.hupu.com/*" }, (tabs) => {
        tabs.forEach((tab) => {
          if (tab.id)
            chrome.tabs
              .sendMessage(tab.id, { type: "EMOJI_DATA_CHANGED" })
              .catch(() => {});
        });
      });
      render();
    });
  });
}

render();

export {};
