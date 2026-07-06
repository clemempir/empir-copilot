import { browser } from "wxt/browser";
import { detectSite, isListingPage, type Listing } from "@empir/core";
import type { EmpirRequest, TabState } from "@/lib/messages";

const tabStates = new Map<number, TabState>();
const TAB_STATES_STORAGE_KEY = "tabStates";

function ensureTabState(tabId: number): TabState {
  let state = tabStates.get(tabId);
  if (!state) {
    state = { status: "idle" };
    tabStates.set(tabId, state);
  }
  return state;
}

async function setTabState(tabId: number, state: TabState): Promise<void> {
  tabStates.set(tabId, state);
  await browser.storage.session
    .set({ [TAB_STATES_STORAGE_KEY]: Object.fromEntries(tabStates) })
    .catch(() => {});
  browser.runtime
    .sendMessage({ type: "TAB_STATE_CHANGED", tabId, state })
    .catch(() => {});
}

let hydration: Promise<void> | null = null;
function hydrateTabStates(): Promise<void> {
  hydration ??= (async () => {
    const stored = await browser.storage.session
      .get(TAB_STATES_STORAGE_KEY)
      .catch(() => ({}) as Record<string, unknown>);
    const raw = (stored as Record<string, unknown>)[TAB_STATES_STORAGE_KEY] as
      | Record<string, TabState>
      | undefined;
    if (raw) for (const [k, v] of Object.entries(raw)) tabStates.set(Number(k), v);
  })();
  return hydration;
}

/**
 * Active/désactive le sidepanel PAR ONGLET. Sans cela, un panneau ouvert suit
 * l'utilisateur sur tous les onglets/fenêtres (nouvel onglet, lien Google
 * Maps…) en restant vide. Ici : panneau disponible uniquement là où une
 * annonce est détectée — Chrome le ferme automatiquement ailleurs.
 */
function setPanelEnabled(tabId: number, enabled: boolean): void {
  const sp = browser.sidePanel as
    | { setOptions?: (o: { tabId: number; path?: string; enabled: boolean }) => Promise<void> }
    | undefined;
  void sp?.setOptions?.({ tabId, ...(enabled ? { path: "sidepanel.html" } : {}), enabled })
    .catch(() => {});
}

export default defineBackground(() => {
  if (browser.sidePanel && "setPanelBehavior" in browser.sidePanel) {
    // Ouverture gérée MANUELLEMENT (action.onClicked) : openPanelOnActionClick
    // ne sait pas ouvrir un panneau désactivé par défaut.
    browser.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch(() => {});
    // Désactivé par défaut (nouveaux onglets/fenêtres) — réactivé onglet par
    // onglet à la détection d'une annonce ou au clic sur l'icône.
    (browser.sidePanel as { setOptions?: (o: { enabled: boolean }) => Promise<void> })
      .setOptions?.({ enabled: false })
      .catch(() => {});
  }

  // Clic sur l'icône = demande explicite : on active et ouvre le panneau sur
  // CET onglet uniquement (il ne suivra pas dans les autres onglets).
  browser.action?.onClicked?.addListener((tab) => {
    const tabId = tab.id;
    if (tabId == null) return;
    const sp = browser.sidePanel as
      | {
          setOptions?: (o: { tabId: number; path: string; enabled: boolean }) => Promise<void>;
          open?: (o: { tabId: number }) => Promise<void>;
        }
      | undefined;
    void sp
      ?.setOptions?.({ tabId, path: "sidepanel.html", enabled: true })
      .then(() => sp.open?.({ tabId }))
      .catch(() => {});
  });

  browser.runtime.onMessage.addListener((msg: EmpirRequest, sender, sendResponse) => {
    (async () => {
      await hydrateTabStates();
      const tabId = sender.tab?.id ?? (msg as { tabId?: number }).tabId;

      if (msg.type === "LISTING_DETECTED" && tabId !== undefined) {
        setPanelEnabled(tabId, true);
        await setTabState(tabId, { status: "detected", listing: msg.listing });
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === "GET_TAB_STATE") {
        const id = msg.tabId ?? tabId;
        sendResponse({ tabId: id, state: id ? ensureTabState(id) : { status: "idle" } });
        return;
      }
      if (msg.type === "RUN_ANALYSIS") {
        const state = ensureTabState(msg.tabId);
        if (!state.listing) {
          sendResponse({ error: "no_listing" });
          return;
        }
        await setTabState(msg.tabId, { ...state, status: "analyzing" });
        // TODO (task 7): POST to Supabase Edge Function `analyze` with listing payload
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === "OPEN_SIDE_PANEL" && tabId !== undefined) {
        const sp = browser.sidePanel as { open?: (opts: { tabId: number }) => Promise<void> };
        await sp.open?.({ tabId }).catch(() => {});
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ error: "unknown" });
    })();
    return true;
  });

  browser.tabs.onUpdated.addListener(async (tabId, change, tab) => {
    if (change.url && tab.url) {
      const url = tab.url;
      if (!isListingPage(url) || !detectSite(url)) {
        setPanelEnabled(tabId, false);
        await setTabState(tabId, { status: "idle" });
      }
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    tabStates.delete(tabId);
  });

  // Reference Listing import so tree-shaker doesn't trip
  void (null as Listing | null);
});
