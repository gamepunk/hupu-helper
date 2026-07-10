// ============================================================
//  IndexedDB 存储层 — 替代 chrome.storage.local
//  容量上限：硬盘剩余空间的 ~50%（远超 chrome.storage 的 10MB）
// ============================================================

// ---------- 类型定义 ----------

export interface SavedEmoji {
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
}

export interface EmojiImageData {
  meta: SavedEmoji;
  /** base64 编码的图片数据 (data:image/...) */
  dataUrl: string;
}

const DB_NAME = "hupu-helper";
const DB_VERSION = 3;
const STORE_NAME = "emojis";
const RECENT_STORE = "recent";

// ---------- 数据库初始化 ----------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // 清理旧版 store（v1→v2 时创建的错误结构）
      if (db.objectStoreNames.contains("emojis_v1")) {
        db.deleteObjectStore("emojis_v1");
      }

      // emojis store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("savedAt", "savedAt", { unique: false });
      }

      // recent store（最近使用）
      if (!db.objectStoreNames.contains(RECENT_STORE)) {
        db.createObjectStore(RECENT_STORE, { keyPath: "key" });
      }
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

interface StoredEmoji {
  id: string;
  sourceUrl: string;
  pageTitle: string;
  savedAt: number;
  name: string;
  dataUrl: string;
}

/** EmojiImageData → StoredEmoji（展平） */
function toStored(emoji: EmojiImageData): StoredEmoji {
  return {
    id: emoji.meta.id,
    sourceUrl: emoji.meta.sourceUrl,
    pageTitle: emoji.meta.pageTitle,
    savedAt: emoji.meta.savedAt,
    name: emoji.meta.name,
    dataUrl: emoji.dataUrl,
  };
}

/** StoredEmoji → EmojiImageData（还原嵌套） */
function fromStored(stored: StoredEmoji): EmojiImageData {
  return {
    meta: {
      id: stored.id,
      sourceUrl: stored.sourceUrl,
      pageTitle: stored.pageTitle,
      savedAt: stored.savedAt,
      name: stored.name,
    },
    dataUrl: stored.dataUrl,
  };
}

// ---------- CRUD 操作 ----------

/** 获取所有已保存的表情包（按保存时间倒序） */
export async function getAllEmojis(): Promise<EmojiImageData[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("savedAt");
    const request = index.openCursor(null, "prev");
    const results: EmojiImageData[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        results.push(fromStored(cursor.value as StoredEmoji));
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
export async function saveEmoji(
  sourceUrl: string,
  dataUrl: string,
  pageTitle?: string,
  name?: string,
): Promise<EmojiImageData> {
  const existing = await findBySourceUrl(sourceUrl);
  if (existing) return existing;

  const all = await getAllEmojis();

  const emoji: EmojiImageData = {
    meta: {
      id: generateId(),
      sourceUrl,
      pageTitle: pageTitle ?? document.title,
      savedAt: Date.now(),
      name: name ?? `表情 ${all.length + 1}`,
    },
    dataUrl,
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(toStored(emoji));

    request.onsuccess = () => resolve(emoji);
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
  });
}

/** 删除一个表情包 */
export async function deleteEmoji(id: string): Promise<void> {
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

/** 更新表情包名称 */
export async function updateEmojiName(id: string, name: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const data = request.result as StoredEmoji | undefined;
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
export async function saveRecentEmoji(id: string): Promise<void> {
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
export async function getRecentEmojiIds(): Promise<string[]> {
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
): Promise<EmojiImageData | null> {
  const all = await getAllEmojis();
  return all.find((e) => e.meta.sourceUrl === sourceUrl) ?? null;
}
