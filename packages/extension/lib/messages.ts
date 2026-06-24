import { browser } from "wxt/browser";
import type { Listing, QuickAnalysis, Report } from "@empir/core";

export type TabStatus = "idle" | "detected" | "analyzing" | "result" | "error";

export interface TabState {
  status: TabStatus;
  listing?: Listing;
  quick?: QuickAnalysis;
  report?: Report;
  error?: string;
}

export type EmpirRequest =
  | { type: "LISTING_DETECTED"; listing: Listing }
  | { type: "GET_TAB_STATE"; tabId?: number }
  | { type: "RUN_ANALYSIS"; tabId: number }
  | { type: "OPEN_SIDE_PANEL" };

export type EmpirEvent = { type: "TAB_STATE_CHANGED"; tabId: number; state: TabState };

export function sendRequest<T>(message: EmpirRequest): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}
