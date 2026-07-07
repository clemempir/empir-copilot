import { browser } from "wxt/browser";
import { detectSite, isListingPage, type Listing } from "@empir/core";
import type { EmpirRequest, TabState } from "@/lib/messages";
import { getSupabase } from "@/lib/supabase";

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
 * Pastille rouge sur l'icône Chrome = nombre de notifications non lues du
 * compte connecté. Rafraîchie par chrome.alarms (~5 min — un websocket
 * « temps réel » mourrait avec le service worker MV3), au démarrage, et à la
 * demande du sidepanel (message REFRESH_BADGE après lecture/broadcast).
 */
const BADGE_ALARM = "empir:badge";
const BADGE_PERIOD_MIN = 5;

async function refreshBadge(): Promise<void> {
  try {
    const supa = getSupabase();
    const { data } = await supa.auth.getSession();
    const userId = data.session?.user?.id;
    let unread = 0;
    if (userId) {
      const { count } = await supa
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("read", false);
      unread = count ?? 0;
    }
    await browser.action.setBadgeText({ text: unread > 0 ? String(Math.min(unread, 99)) : "" });
    if (unread > 0) await browser.action.setBadgeBackgroundColor({ color: "#ff5d73" });
  } catch {
    /* hors-ligne ou non configuré — on garde la pastille telle quelle */
  }
}

export default defineBackground(() => {
  if (browser.sidePanel) {
    // Panneau ouvrable PARTOUT (compte/notifications hors annonce) mais scoped
    // PAR ONGLET : un défaut global « enabled » ferait renaître le panneau
    // dans chaque nouvelle fenêtre (comportement Chrome). Donc désactivé
    // globalement, et activé+ouvert sur l'onglet courant au clic sur l'icône.
    (browser.sidePanel as { setOptions?: (o: { enabled: boolean }) => Promise<void> })
      .setOptions?.({ enabled: false })
      .catch(() => {});
    browser.action.onClicked.addListener((tab) => {
      if (tab.id == null) return;
      const sp = browser.sidePanel as {
        setOptions?: (o: { tabId: number; path: string; enabled: boolean }) => Promise<void>;
        open?: (o: { tabId: number }) => Promise<void>;
      };
      // Pas d'await entre les deux : open() doit rester dans le geste utilisateur.
      void sp.setOptions?.({ tabId: tab.id, path: "sidepanel.html", enabled: true }).catch(() => {});
      void sp.open?.({ tabId: tab.id }).catch(() => {});
    });
  }

  // Pastille de notifications : au réveil du service worker + toutes les 5 min.
  void browser.alarms.create(BADGE_ALARM, { periodInMinutes: BADGE_PERIOD_MIN });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BADGE_ALARM) void refreshBadge();
  });
  void refreshBadge();

  browser.runtime.onMessage.addListener((msg: EmpirRequest, sender, sendResponse) => {
    (async () => {
      await hydrateTabStates();
      const tabId = sender.tab?.id ?? (msg as { tabId?: number }).tabId;

      if (msg.type === "LISTING_DETECTED" && tabId !== undefined) {
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
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === "OPEN_SIDE_PANEL" && tabId !== undefined) {
        const sp = browser.sidePanel as {
          setOptions?: (o: { tabId: number; path: string; enabled: boolean }) => Promise<void>;
          open?: (opts: { tabId: number }) => Promise<void>;
        };
        void sp.setOptions?.({ tabId, path: "sidepanel.html", enabled: true }).catch(() => {});
        await sp.open?.({ tabId }).catch(() => {});
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === "REFRESH_BADGE") {
        await refreshBadge();
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ error: "unknown" });
    })();
    return true;
  });

  browser.tabs.onUpdated.addListener(async (tabId, change, tab) => {
    if (change.url && tab.url) {
      await hydrateTabStates();
      const url = tab.url;
      if (!isListingPage(url) || !detectSite(url)) {
        await setTabState(tabId, { status: "idle" });
      } else {
        // Annonce → AUTRE annonce dans le même onglet : purge l'état de la
        // précédente en attendant la re-détection — sinon, si l'extraction de
        // la nouvelle échoue, « Lancer l'analyse » relancerait l'ancienne.
        const cur = ensureTabState(tabId);
        if (cur.listing && cur.listing.url !== url) {
          await setTabState(tabId, { status: "idle" });
        }
      }
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    tabStates.delete(tabId);
  });

  // Reference Listing import so tree-shaker doesn't trip
  void (null as Listing | null);
});
