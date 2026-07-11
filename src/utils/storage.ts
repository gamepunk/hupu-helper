// ============================================================
//  IndexedDB 存储层 — 替代 chrome.storage.local
//  容量上限：硬盘剩余空间的 ~50%（远超 chrome.storage 的 10MB）
// ============================================================

// ---------- 类型定义 ----------

export interface SavedMeme {
  /** 唯一标识 */
  id: string;
  /** 原始图片 URL（来源页面） */
  sourceUrl: string;
  /** 保存时的页面标题 */
  pageTitle: string;
  /** 保存时间戳 */
  savedAt: number;
  /** 可选的自定义名称 */
  name: string;
  /** 是否置顶 */
  pinned: boolean;
}

export interface MemeImageData {
  meta: SavedMeme;
  /** base64 编码的图片数据 (data:image/...) */
  dataUrl: string;
}

const DB_NAME = "hupu-helper";
const DB_VERSION = 1;
const STORE_NAME = "memes";
const RECENT_STORE = "recent";

// ---------- 数据库初始化 ----------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // 清理所有旧 store
      for (const name of db.objectStoreNames) {
        db.deleteObjectStore(name);
      }

      // memes store
      const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("savedAt", "savedAt", { unique: false });

      // recent store（最近使用）
      db.createObjectStore(RECENT_STORE, { keyPath: "key" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------- 工具 —— 生成 ID ----------

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- 扁平存储类型（IndexedDB 要求 keyPath 在顶层） ----------

interface StoredMeme {
  id: string;
  sourceUrl: string;
  pageTitle: string;
  savedAt: number;
  name: string;
  dataUrl: string;
  pinned: boolean;
}

/** EmojiImageData → StoredEmoji（展平） */
function toStored(meme: MemeImageData): StoredMeme {
  return {
    id: meme.meta.id,
    sourceUrl: meme.meta.sourceUrl,
    pageTitle: meme.meta.pageTitle,
    savedAt: meme.meta.savedAt,
    name: meme.meta.name,
    dataUrl: meme.dataUrl,
    pinned: meme.meta.pinned ?? false,
  };
}

/** StoredEmoji → EmojiImageData（还原嵌套） */
function fromStored(stored: StoredMeme): MemeImageData {
  return {
    meta: {
      id: stored.id,
      sourceUrl: stored.sourceUrl,
      pageTitle: stored.pageTitle,
      savedAt: stored.savedAt,
      name: stored.name,
      pinned: stored.pinned ?? false,
    },
    dataUrl: stored.dataUrl,
  };
}

// ---------- CRUD 操作 ----------

/** 获取所有已保存的表情包（按保存时间倒序） */
export async function getAllMemes(): Promise<MemeImageData[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("savedAt");
    const request = index.openCursor(null, "prev");
    const results: MemeImageData[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        results.push(fromStored(cursor.value as StoredMeme));
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
  });
}

/** 保存一个新表情包（已存在相同 sourceUrl 则跳过） */
export async function saveMeme(
  sourceUrl: string,
  dataUrl: string,
  pageTitle?: string,
  name?: string,
): Promise<MemeImageData> {
  const existing = await findBySourceUrl(sourceUrl);
  if (existing) return existing;

  const all = await getAllMemes();

  const meme: MemeImageData = {
    meta: {
      id: generateId(),
      sourceUrl,
      pageTitle: pageTitle ?? document.title,
      savedAt: Date.now(),
      pinned: false,
      name: name ?? `表情 ${all.length + 1}`,
    },
    dataUrl,
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(toStored(meme));

    request.onsuccess = () => resolve(meme);
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
  });
}

/** 批量导入表情包（保留原始时间戳） */
export async function importMemes(
  items: Array<{
    sourceUrl: string;
    dataUrl: string;
    pageTitle?: string;
    name?: string;
    savedAt?: number;
    pinned?: boolean;
  }>,
): Promise<number> {
  const existing = await getAllMemes();
  const existingUrls = new Set(existing.map((e) => e.meta.sourceUrl));
  let imported = 0;

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    for (const item of items) {
      if (!item.dataUrl || !item.sourceUrl || existingUrls.has(item.sourceUrl))
        continue;

      const meme: MemeImageData = {
        meta: {
          id: generateId(),
          sourceUrl: item.sourceUrl,
          pageTitle: item.pageTitle ?? "",
          savedAt: item.savedAt ?? Date.now(),
          name: item.name ?? "表情",
          pinned: item.pinned ?? false,
        },
        dataUrl: item.dataUrl,
      };

      store.put(toStored(meme));
      existingUrls.add(item.sourceUrl);
      imported++;
    }

    tx.oncomplete = () => {
      db.close();
      resolve(imported);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/** 删除一个表情包 */
export async function deleteMeme(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
  });
}

/** 切换置顶状态 */
export async function togglePinMeme(id: string): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const data = request.result as StoredMeme | undefined;
      if (data) {
        data.pinned = !data.pinned;
        store.put(data);
        resolve(data.pinned);
      } else {
        resolve(false);
      }
    };
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
  });
}

/** 更新表情包名称 */
export async function updateMemeName(id: string, name: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const data = request.result as StoredMeme | undefined;
      if (data) {
        data.name = name;
        store.put(data);
      }
      resolve();
    };
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
  });
}

// ---------- 最近使用 ----------

const RECENT_KEY = "recent_ids";
const MAX_RECENT = 9;

/** 记录一个表情包为最近使用 */
export async function saveRecentMeme(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(RECENT_STORE, "readwrite");
  const store = tx.objectStore(RECENT_STORE);

  // 读取当前列表
  const getReq = store.get(RECENT_KEY);

  getReq.onsuccess = () => {
    let ids: string[] =
      (getReq.result as { key: string; ids: string[] } | undefined)?.ids ?? [];

    // 去重 + 移到最前
    ids = [id, ...ids.filter((i) => i !== id)];
    // 截断
    if (ids.length > MAX_RECENT) ids = ids.slice(0, MAX_RECENT);

    store.put({ key: RECENT_KEY, ids });
  };

  return new Promise((resolve) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

/** 获取最近使用的表情包 ID 列表（按最近优先） */
export async function getRecentMemeIds(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(RECENT_STORE, "readonly");
    const store = tx.objectStore(RECENT_STORE);
    const req = store.get(RECENT_KEY);

    req.onsuccess = () => {
      resolve(
        (req.result as { key: string; ids: string[] } | undefined)?.ids ?? [],
      );
    };
    req.onerror = () => resolve([]);

    tx.oncomplete = () => db.close();
  });
}

// ---------- 内部工具 ----------

/** 根据 sourceUrl 查找是否已存在 */
async function findBySourceUrl(
  sourceUrl: string,
): Promise<MemeImageData | null> {
  const all = await getAllMemes();
  return all.find((e) => e.meta.sourceUrl === sourceUrl) ?? null;
}
