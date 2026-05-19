import axios from "axios";
import { api } from "./api";

const DB_NAME = "wms-offline-queue";
const STORE_NAME = "operations";
const DB_VERSION = 1;

type OperationType = "descent" | "error" | "montagem-sp";

type QueueStatus = "pending" | "sending";

type QueueFile = {
  blob: Blob;
  name: string;
  type: string;
};

type DescentPayload = {
  orderNumber: string;
  workDate: string;
  image: QueueFile;
};

type ErrorPayload = {
  orderNumber: string;
  problemType: string;
  finalized: string;
  dock: string;
  reportDate: string;
  fallbackDescendedUserName?: string;
  image: QueueFile;
};

type MontagemSpPayload = {
  workDate: string;
  loaderUserName: string;
  startTime: string;
  endTime: string;
  stopsCount: string;
  pauseMinutes: string;
  pauseEvents: string;
  hasHelper: string;
  helperName?: string;
  notes?: string;
  palletsCount?: string;
  loadValue?: string;
  volume?: string;
  weightKg?: string;
  isoporQty?: string;
  photo: QueueFile;
};

type QueuePayloadMap = {
  descent: DescentPayload;
  error: ErrorPayload;
  "montagem-sp": MontagemSpPayload;
};

export type QueueItem<T extends OperationType = OperationType> = {
  id: string;
  type: T;
  status: QueueStatus;
  attempts: number;
  createdAt: string;
  lastError?: string;
  payload: QueuePayloadMap[T];
};

let syncStarted = false;
let flushPromise: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  const db = await openDb();
  return new Promise<T | void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    tx.oncomplete = () => resolve((req as IDBRequest<T> | undefined)?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }).finally(() => db.close());
}

function queueFileFromFile(file: File): QueueFile {
  return {
    blob: file,
    name: file.name,
    type: file.type
  };
}

function fileFromQueueFile(file: QueueFile): File {
  return new File([file.blob], file.name, { type: file.type || "application/octet-stream" });
}

export function buildQueueFile(file: File): QueueFile {
  return queueFileFromFile(file);
}

export async function enqueueOperation<T extends OperationType>(type: T, payload: QueuePayloadMap[T]) {
  const item: QueueItem<T> = {
    id: crypto.randomUUID(),
    type,
    payload,
    attempts: 0,
    status: "pending",
    createdAt: new Date().toISOString()
  };
  await withStore("readwrite", (store) => store.put(item));
  return item;
}

async function getAllOperations() {
  const result = await withStore<QueueItem[]>("readonly", (store) => store.getAll());
  return (result as QueueItem[] | undefined) || [];
}

async function updateOperation(item: QueueItem) {
  await withStore("readwrite", (store) => store.put(item));
}

async function deleteOperation(id: string) {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function getPendingOperationCount() {
  const items = await getAllOperations();
  return items.length;
}

function appendIfPresent(form: FormData, key: string, value: string | undefined) {
  if (value !== undefined && value !== "") {
    form.append(key, value);
  }
}

async function sendOperation(item: QueueItem) {
  const form = new FormData();
  form.append("clientRequestId", item.id);

  if (item.type === "descent") {
    const payload = item.payload as DescentPayload;
    form.append("orderNumber", payload.orderNumber);
    form.append("workDate", payload.workDate);
    form.append("image", fileFromQueueFile(payload.image));
    await api.post("/descents", form, { headers: { "Content-Type": "multipart/form-data" } });
    return;
  }

  if (item.type === "error") {
    const payload = item.payload as ErrorPayload;
    form.append("orderNumber", payload.orderNumber);
    form.append("problemType", payload.problemType);
    form.append("finalized", payload.finalized);
    form.append("dock", payload.dock);
    form.append("reportDate", payload.reportDate);
    appendIfPresent(form, "fallbackDescendedUserName", payload.fallbackDescendedUserName);
    form.append("image", fileFromQueueFile(payload.image));
    await api.post("/errors", form, { headers: { "Content-Type": "multipart/form-data" } });
    return;
  }

  const payload = item.payload as MontagemSpPayload;
  form.append("workDate", payload.workDate);
  form.append("loaderUserName", payload.loaderUserName);
  form.append("startTime", payload.startTime);
  form.append("endTime", payload.endTime);
  form.append("stopsCount", payload.stopsCount);
  form.append("pauseMinutes", payload.pauseMinutes);
  form.append("pauseEvents", payload.pauseEvents);
  form.append("hasHelper", payload.hasHelper);
  appendIfPresent(form, "helperName", payload.helperName);
  appendIfPresent(form, "notes", payload.notes);
  appendIfPresent(form, "palletsCount", payload.palletsCount);
  appendIfPresent(form, "loadValue", payload.loadValue);
  appendIfPresent(form, "volume", payload.volume);
  appendIfPresent(form, "weightKg", payload.weightKg);
  appendIfPresent(form, "isoporQty", payload.isoporQty);
  form.append("photo", fileFromQueueFile(payload.photo));
  await api.post("/montagem-sp", form, { headers: { "Content-Type": "multipart/form-data" } });
}

function extractQueueError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = typeof error.response?.data?.message === "string" ? error.response.data.message : error.message;
    return {
      status: error.response?.status,
      message
    };
  }
  return {
    status: undefined,
    message: error instanceof Error ? error.message : "Falha ao sincronizar fila local."
  };
}

export async function submitQueuedOperation<T extends OperationType>(type: T, payload: QueuePayloadMap[T]) {
  const item = await enqueueOperation(type, payload);
  try {
    await sendOperation(item);
    await deleteOperation(item.id);
    return { status: "sent" as const, id: item.id };
  } catch (error) {
    const info = extractQueueError(error);
    item.status = "pending";
    item.attempts += 1;
    item.lastError = info.message;
    await updateOperation(item);
    return {
      status: "queued" as const,
      id: item.id,
      httpStatus: info.status,
      message: info.message
    };
  }
}

export async function flushOperationalQueue() {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    const items = (await getAllOperations()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const item of items) {
      try {
        item.status = "sending";
        await updateOperation(item);
        await sendOperation(item);
        await deleteOperation(item.id);
      } catch (error) {
        const info = extractQueueError(error);
        item.status = "pending";
        item.attempts += 1;
        item.lastError = info.message;
        await updateOperation(item);
        if (info.status === 401 || info.status === 403) {
          break;
        }
        if (!info.status || info.status >= 500) {
          break;
        }
      }
    }
  })();

  try {
    await flushPromise;
  } finally {
    flushPromise = null;
  }
}

export function startOperationalQueueSync() {
  if (syncStarted) return;
  syncStarted = true;

  const run = () => {
    void flushOperationalQueue();
  };

  window.addEventListener("online", run);
  window.setInterval(run, 30000);
}
