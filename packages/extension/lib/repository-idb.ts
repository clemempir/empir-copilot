import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CacheEntry, Listing, Report, Repository } from "@empir/core";

interface EmpirDB extends DBSchema {
  listings: { key: string; value: Listing };
  reports: { key: string; value: Report; indexes: { "by-url": string } };
  cache: { key: string; value: CacheEntry<unknown> };
}

let dbPromise: Promise<IDBPDatabase<EmpirDB>> | null = null;

function getDb(): Promise<IDBPDatabase<EmpirDB>> {
  dbPromise ??= openDB<EmpirDB>("empir", 1, {
    upgrade(db) {
      db.createObjectStore("listings", { keyPath: "url" });
      const reports = db.createObjectStore("reports", { keyPath: "id" });
      reports.createIndex("by-url", "listingUrl");
      db.createObjectStore("cache");
    },
  });
  return dbPromise;
}

export async function clearCache(): Promise<void> {
  await (await getDb()).clear("cache");
}

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["listings", "reports", "cache"], "readwrite");
  await Promise.all([
    tx.objectStore("listings").clear(),
    tx.objectStore("reports").clear(),
    tx.objectStore("cache").clear(),
    tx.done,
  ]);
}

export const idbRepository: Repository = {
  async saveListing(listing) {
    await (await getDb()).put("listings", listing);
  },
  async getListingByUrl(url) {
    return (await getDb()).get("listings", url);
  },
  async saveReport(report) {
    await (await getDb()).put("reports", report);
  },
  async getReport(id) {
    return (await getDb()).get("reports", id);
  },
  async deleteReport(id) {
    await (await getDb()).delete("reports", id);
  },
  async listReports() {
    return (await getDb()).getAll("reports");
  },
  async getLatestReportByUrl(listingUrl) {
    const reports = await (await getDb()).getAllFromIndex("reports", "by-url", listingUrl);
    if (reports.length === 0) return undefined;
    return reports.reduce((latest, r) => (r.createdAt > latest.createdAt ? r : latest));
  },
  async getCache<T>(key: string): Promise<T | undefined> {
    const entry = (await (await getDb()).get("cache", key)) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      await (await getDb()).delete("cache", key);
      return undefined;
    }
    return entry.value;
  },
  async setCache<T>(key: string, value: T, ttlMs: number) {
    await (await getDb()).put("cache", { value, expiresAt: Date.now() + ttlMs }, key);
  },
};
