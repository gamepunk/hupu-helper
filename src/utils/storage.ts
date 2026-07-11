// ============================================================
//  IndexedDB 存储层 — 替代 chrome.storage.local
//  容量上限：硬盘剩余空间的 ~50%（远超 chrome.storage 的 10MB）
// ============================================================

// ---------- 工具函数 ----------

/** data URL → Blob */
function dataURLToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mimeType = meta.match(/:(.*?);/)?.[1] ?? "image/png";
  const byteStr = atob(b64);
  const bytes = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/** Blob → data URL（兼容 service worker 环境） */
function blobToDataURL(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    // Window 环境 — 使用 FileReader
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  // Service worker 环境 — 使用 Response + btoa
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:${blob.type};base64,${btoa(binary)}`;
  });
}

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

      const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("savedAt", "savedAt", { unique: false });
      store.createIndex("sourceUrl", "sourceUrl", { unique: false });
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
  dataBlob: Blob;
  pinned: boolean;
}

/** MemeImageData → StoredMeme（展平 + 转 Blob） */
function toStored(meme: MemeImageData): StoredMeme {
  return {
    id: meme.meta.id,
    sourceUrl: meme.meta.sourceUrl,
    pageTitle: meme.meta.pageTitle,
    savedAt: meme.meta.savedAt,
    name: meme.meta.name,
    dataBlob: dataURLToBlob(meme.dataUrl),
    pinned: meme.meta.pinned ?? false,
  };
}

/** StoredMeme → MemeImageData（Blob → data URL） */
async function fromStored(stored: StoredMeme): Promise<MemeImageData> {
  return {
    meta: {
      id: stored.id,
      sourceUrl: stored.sourceUrl,
      pageTitle: stored.pageTitle,
      savedAt: stored.savedAt,
      name: stored.name,
      pinned: stored.pinned ?? false,
    },
    dataUrl: await blobToDataURL(stored.dataBlob),
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
    const stored: StoredMeme[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        stored.push(cursor.value as StoredMeme);
        cursor.continue();
      } else {
        // 先收集所有记录（仅指针），再并行转换 Blob → dataUrl
        resolve(Promise.all(stored.map(fromStored)));
      }
    };
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
  });
}

/** 获取已保存的表情包总数（无需读取 Blob） */
async function getMemeCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
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

  const count = await getMemeCount();

  const meme: MemeImageData = {
    meta: {
      id: generateId(),
      sourceUrl,
      pageTitle: pageTitle ?? document.title,
      savedAt: Date.now(),
      pinned: false,
      name: name ?? `表情 ${count + 1}`,
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

/** 直接保存 Blob（跳过 dataUrl 转换，性能优化） */
export async function saveMemeFromBlob(
  sourceUrl: string,
  blob: Blob,
  pageTitle?: string,
  name?: string,
): Promise<MemeImageData> {
  const existing = await findBySourceUrl(sourceUrl);
  if (existing) return existing;

  const count = await getMemeCount();

  const id = generateId();
  const stored: StoredMeme = {
    id,
    sourceUrl,
    pageTitle: pageTitle ?? document.title,
    savedAt: Date.now(),
    name: name ?? `表情 ${count + 1}`,
    dataBlob: blob,
    pinned: false,
  };

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(stored);

    request.onsuccess = () => {
      fromStored(stored).then((meme) => resolve(meme));
    };
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
  const existingUrls = new Set<string>();
  // 从 IndexedDB 收集已存在的 sourceUrl（只读 key，不读 Blob）
  const readDb = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = readDb.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        existingUrls.add((cursor.value as StoredMeme).sourceUrl);
        cursor.continue();
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => {
      readDb.close();
      resolve();
    };
  });
  let imported = 0;

  const writeDb = await openDB();
  return new Promise((resolve, reject) => {
    const tx = writeDb.transaction(STORE_NAME, "readwrite");
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
      writeDb.close();
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

/** 根据 sourceUrl 查找是否已存在（使用索引，不读 Blob） */
async function findBySourceUrl(
  sourceUrl: string,
): Promise<MemeImageData | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("sourceUrl");
    const request = index.get(sourceUrl);
    request.onsuccess = () => {
      const stored = request.result as StoredMeme | undefined;
      if (stored) {
        fromStored(stored).then(resolve);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
