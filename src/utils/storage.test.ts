import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import "fake-indexeddb/auto";
import {
  saveMeme,
  deleteMeme,
  getAllMemes,
  togglePinMeme,
  updateMemeName,
  importMemes,
  saveRecentMeme,
  getRecentMemeIds,
} from "./storage";

const img1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const img2 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QHwADBQGAKx5gWQAAAABJRU5ErkJggg==";

describe("Storage CRUD", () => {
  beforeAll(() => {
    // 用 fake-indexeddb 覆盖全局 indexedDB
    // fake-indexeddb 已通过 import "fake-indexeddb/auto" 自动注入
  });

  afterAll(() => {
    // 清理
  });

  // ---------- saveMeme ----------

  test("saveMeme 保存一个新表情", async () => {
    const saved = await saveMeme("https://a.com/1.png", img1, "页面A", "表情1");
    expect(saved.meta.id).toBeTruthy();
    expect(saved.meta.sourceUrl).toBe("https://a.com/1.png");
    expect(saved.meta.pageTitle).toBe("页面A");
    expect(saved.meta.name).toBe("表情1");
    expect(saved.meta.pinned).toBe(false);
    expect(saved.dataUrl).toBe(img1);
  });

  test("saveMeme 相同 sourceUrl 跳过重复", async () => {
    const saved = await saveMeme("https://a.com/1.png", img1, "页面A", "表情1");
    // 会返回已有的记录
    expect(saved.meta.sourceUrl).toBe("https://a.com/1.png");
  });

  test("saveMeme 不同 sourceUrl 正常保存", async () => {
    const saved = await saveMeme("https://a.com/2.png", img2, "页面B", "表情2");
    expect(saved.meta.sourceUrl).toBe("https://a.com/2.png");
    expect(saved.meta.name).toBe("表情2");
  });

  // ---------- getAllMemes ----------

  test("getAllMemes 获取所有保存的表情（按时间倒序）", async () => {
    const all = await getAllMemes();
    expect(all.length).toBe(2);
    // 最新的在前
    expect(all[0].meta.sourceUrl).toBe("https://a.com/2.png");
    expect(all[1].meta.sourceUrl).toBe("https://a.com/1.png");
  });

  // ---------- togglePinMeme ----------

  test("togglePinMeme 切换置顶状态", async () => {
    const all = await getAllMemes();
    const id = all[0].meta.id;

    const pinned1 = await togglePinMeme(id);
    expect(pinned1).toBe(true);

    const pinned2 = await togglePinMeme(id);
    expect(pinned2).toBe(false);

    const pinned3 = await togglePinMeme(id);
    expect(pinned3).toBe(true);
  });

  // ---------- updateMemeName ----------

  test("updateMemeName 更新名称", async () => {
    const all = await getAllMemes();
    const id = all[0].meta.id;

    await updateMemeName(id, "新名字");
    const updated = await getAllMemes();
    const found = updated.find((m) => m.meta.id === id);
    expect(found?.meta.name).toBe("新名字");
  });

  // ---------- deleteMeme ----------

  test("deleteMeme 删除表情", async () => {
    const before = await getAllMemes();
    const id = before[0].meta.id;

    await deleteMeme(id);

    const after = await getAllMemes();
    expect(after.length).toBe(before.length - 1);
    expect(after.find((m) => m.meta.id === id)).toBeUndefined();
  });

  // ---------- importMemes ----------

  test("importMemes 批量导入（含置顶状态）", async () => {
    const items = [
      {
        sourceUrl: "https://b.com/1.jpg",
        dataUrl: img1,
        pageTitle: "导入页",
        name: "导入表情",
        pinned: true,
        savedAt: 1000,
      },
      {
        sourceUrl: "https://b.com/2.jpg",
        dataUrl: img2,
        pageTitle: "导入页2",
        name: "导入表情2",
        pinned: false,
        savedAt: 2000,
      },
    ];

    const count = await importMemes(items);
    expect(count).toBe(2);

    const all = await getAllMemes();
    // 2 个旧的（删除 1 个后剩 1 个）+ 2 个新的 = 3
    expect(all.length).toBe(3);
  });

  test("importMemes 跳过重复 sourceUrl", async () => {
    const items = [
      {
        sourceUrl: "https://b.com/1.jpg",
        dataUrl: img1,
      },
    ];
    const count = await importMemes(items);
    expect(count).toBe(0); // 已存在，跳过
  });

  test("importMemes 保留原始时间戳和置顶状态", async () => {
    const all = await getAllMemes();
    const imported = all.find(
      (m) => m.meta.sourceUrl === "https://b.com/1.jpg",
    );
    expect(imported).toBeTruthy();
    expect(imported?.meta.savedAt).toBe(1000);
    expect(imported?.meta.pinned).toBe(true);
  });
});

describe("Recent memes", () => {
  test("saveRecentMeme / getRecentMemeIds", async () => {
    await saveRecentMeme("id-1");
    await saveRecentMeme("id-2");
    await saveRecentMeme("id-1"); // id-1 移到最前

    const ids = await getRecentMemeIds();
    expect(ids).toEqual(["id-1", "id-2"]);
  });

  test("getRecentMemeIds 最多返回 9 个", async () => {
    for (let i = 0; i < 12; i++) {
      await saveRecentMeme(`id-${i}`);
    }
    const ids = await getRecentMemeIds();
    expect(ids.length).toBe(9);
    // 最新的在最前
    expect(ids[0]).toBe("id-11");
    expect(ids[8]).toBe("id-3");
  });
});
