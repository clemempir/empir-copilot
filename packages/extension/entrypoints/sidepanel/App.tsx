import { useEffect, useMemo, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { buildQuickAnalysis, explainPluZone, type Listing, type QuickAnalysis } from "@empir/core";
import type { TabState } from "@/lib/messages";
import { useAuth } from "@/lib/hooks/use-auth";
import { useAnalyze } from "@/lib/hooks/use-analyze";
import { useMarket } from "@/lib/hooks/use-market";
import { useRisks } from "@/lib/hooks/use-risks";
import { useSavedListings } from "@/lib/hooks/use-saved-listings";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useProfile } from "@/lib/hooks/use-profile";
import { IdleView } from "./views/IdleView";
import { AnalyzingView } from "./views/AnalyzingView";
import { ResultView } from "./views/ResultView";
import { DiagnosticPanel } from "./views/DiagnosticPanel";
import { SignupView } from "./views/SignupView";
import { AccountView } from "./views/AccountView";
import { UpgradeModal } from "./views/UpgradeModal";

type Screen = "main" | "signup" | "account";
type MainStatus = "idle" | "analyzing" | "result";

const PLAN_LIMIT = 15;

export default function App() {
  const auth = useAuth();
  const analyze = useAnalyze();
  const profile = useProfile(auth.user?.id ?? null);
  const saved = useSavedListings(auth.user?.id ?? null);
  const notifs = useNotifications(auth.user?.id ?? null);

  const [screen, setScreen] = useState<Screen>("main");
  const [tabState, setTabState] = useState<TabState>({ status: "idle" });
  const [showUpgrade, setShowUpgrade] = useState(false);

  // S'attache à l'onglet actif et reste synchronisé avec le background.
  // Le sidepanel n'a pas de `sender.tab.id` côté background : on doit envoyer
  // explicitement le tabId pour récupérer l'état au démarrage.
  const activeTabIdRef = useRef<number | null>(null);
  useEffect(() => {
    let alive = true;

    async function bindActiveTab() {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      const tabId = tabs[0]?.id ?? null;
      if (!alive || tabId == null) return;
      activeTabIdRef.current = tabId;
      const r = await browser.runtime
        .sendMessage({ type: "GET_TAB_STATE", tabId })
        .catch(() => null);
      const res = r as { state?: TabState } | null;
      if (alive && res?.state) setTabState(res.state);
    }

    void bindActiveTab();

    const onMsg = (msg: { type?: string; tabId?: number; state?: TabState }) => {
      if (msg?.type !== "TAB_STATE_CHANGED" || !msg.state) return;
      if (msg.tabId == null || msg.tabId === activeTabIdRef.current) {
        setTabState(msg.state);
      } else {
        // Le broadcast concerne un autre onglet que celui auquel on se croit lié :
        // l'onglet actif a peut-être changé (nouvel onglet). On se re-synchronise
        // au lieu de perdre l'événement de détection.
        void bindActiveTab();
      }
    };
    browser.runtime.onMessage.addListener(onMsg);

    const onActivated = () => void bindActiveTab();
    browser.tabs.onActivated.addListener(onActivated);

    // Re-bind quand l'onglet actif finit de charger ou change d'URL (nouvel
    // onglet d'annonce, navigation), pour ne pas rester collé à l'ancien état.
    const onUpdated = (
      tabId: number,
      change: { status?: string; url?: string },
    ) => {
      if (tabId === activeTabIdRef.current && (change.status === "complete" || change.url)) {
        void bindActiveTab();
      }
    };
    browser.tabs.onUpdated.addListener(onUpdated);

    return () => {
      alive = false;
      browser.runtime.onMessage.removeListener(onMsg);
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  // Auto-run analysis on each new listing URL (déclenche aussi en SPA), une
  // seule fois par URL — y compris en cas d'échec, pour éviter une boucle de
  // retry.
  const lastRunUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const url = tabState.listing?.url ?? null;
    if (
      tabState.status !== "detected" ||
      !tabState.listing ||
      !url ||
      lastRunUrlRef.current === url
    ) {
      return;
    }
    lastRunUrlRef.current = url;
    analyze.reset();
    void analyze.run(tabState.listing);
  }, [tabState.status, tabState.listing, analyze]);

  // Open upgrade modal when quota is hit
  useEffect(() => {
    if (analyze.result?.status === "quota_exceeded") setShowUpgrade(true);
  }, [analyze.result]);

  const mainStatus: MainStatus = useMemo(() => {
    if (analyze.loading) return "analyzing";
    if (analyze.result?.status === "ok") return "result";
    return "idle";
  }, [analyze.loading, analyze.result]);

  // Prix du marché du quartier (ventes DVF réelles autour de l'adresse résolue),
  // puis score prix = position de l'annonce vs médiane comparable.
  const market = useMarket(tabState.listing, analyze.result?.resolvedAddress);
  // Risques Géorisques (naturels + technologiques, avec gravité), côté client.
  // La donnée est communale : le marqueur de l'annonce (stable pour toute
  // l'analyse) suffit — évite un re-fetch quand la résolution d'adresse aboutit.
  const risksState = useRisks(
    tabState.listing?.geo?.lat ?? analyze.result?.resolvedAddress?.lat,
    tabState.listing?.geo?.lon ?? analyze.result?.resolvedAddress?.lon,
  );
  const quick: QuickAnalysis = useMemo(() => {
    if (!tabState.listing) {
      return { listingPricePerM2: null, marketGapPct: null, market: null, score: null, scoreLabel: "—" };
    }
    if (market.loading) {
      return { ...buildQuickAnalysis(tabState.listing, null), scoreLabel: "Calcul…" };
    }
    return buildQuickAnalysis(tabState.listing, market.market);
  }, [tabState.listing, market.market, market.loading]);

  const usage = analyze.result?.usage ?? {
    used: profile.profile?.plan === "unlimited" ? 0 : 0,
    limit: PLAN_LIMIT,
    allowed: true,
    plan: profile.profile?.plan ?? "free",
  };

  // ─── Screens ─────────────────────────────────────────────────────────────

  if (screen === "signup") {
    return (
      <SignupView
        onBack={() => setScreen("main")}
        onGoogleSignIn={async () => {
          await auth.signInWithGoogle();
          setScreen("main");
        }}
        onEmailSignIn={async (email, password) => {
          await auth.signUpWithEmail(email, password);
          setScreen("main");
        }}
        onSwitchToLogin={async () => {
          // Bascule signup → login : reset le screen pour repasser sur le flux
          // login (à terme une vue dédiée ; pour V1 on garde signup avec
          // l'option « se connecter » qui appellera signInWithPassword via
          // l'API auth).
        }}
      />
    );
  }

  if (screen === "account") {
    if (!auth.user || !profile.profile) {
      return (
        <SignupView
          onBack={() => setScreen("main")}
          contextLabel="Mon compte"
          onGoogleSignIn={() => auth.signInWithGoogle()}
          onEmailSignIn={(e, p) => auth.signUpWithEmail(e, p)}
          onSwitchToLogin={() => undefined}
        />
      );
    }
    return (
      <AccountView
        user={{
          email: auth.user.email ?? "",
          name: (auth.user.user_metadata?.full_name as string | undefined) ?? null,
          avatarUrl: (auth.user.user_metadata?.avatar_url as string | undefined) ?? null,
        }}
        plan={{
          tier: profile.profile.plan,
          analysesUsed: usage.used,
          analysesLimit: PLAN_LIMIT,
        }}
        notifications={notifs.items.map((n) => ({
          id: String(n.id),
          title: n.title,
          body: n.body ?? undefined,
          time: timeAgo(n.created_at),
          read: n.read,
        }))}
        savedListings={saved.items.map((s) => ({
          id: String(s.id),
          title: s.title ?? "Bien sauvegardé",
          meta: s.address ?? undefined,
          price: s.price ?? undefined,
          score: s.score,
          photoUrl: s.photo_url ?? undefined,
          onClick: () => window.open(s.listing_url, "_blank"),
        }))}
        onBack={() => setScreen("main")}
        onUpgradeClick={() => setShowUpgrade(true)}
        onLogout={async () => {
          await auth.signOut();
          setScreen("main");
        }}
        onMarkAllRead={() => notifs.markAllRead()}
        onNotificationClick={(id) => notifs.markRead(id)}
      />
    );
  }

  // ─── Main screen ─────────────────────────────────────────────────────────

  return (
    <div className="relative flex h-screen flex-col bg-empir-bg text-empir-text">
      {mainStatus === "idle" && <IdleView />}
      {mainStatus === "analyzing" && <AnalyzingView />}
      {mainStatus === "result" && tabState.listing && (
        <ResultView
          listing={tabState.listing}
          quick={quick}
          resolvedAddress={analyze.result?.resolvedAddress}
          usage={{ used: usage.used, limit: usage.limit }}
          saved={saved.isSaved(tabState.listing.url)}
          onSaveClick={() => {
            if (!auth.user) return setScreen("signup");
            if (!tabState.listing) return;
            void saved.save(tabState.listing, {
              score: quick.score ?? undefined,
              address: analyze.result?.resolvedAddress?.address,
            });
          }}
          onAccountClick={() => setScreen("account")}
          hasUnread={notifs.items.some((n) => !n.read)}
          risks={risksState.risks}
          urbanisme={analyze.result?.enrichments?.plu ? mapUrbanisme(analyze.result.enrichments.plu) : []}
          salesHistory={market.timeline?.nodes ?? []}
          salesSummary={market.timeline?.summary ?? null}
        />
      )}

      {/* Tiroir de diagnostic — uniquement en dev (pnpm dev). */}
      {import.meta.env.DEV && mainStatus === "result" && tabState.listing && (
        <DiagnosticPanel
          listing={tabState.listing}
          resolvedAddress={analyze.result?.resolvedAddress}
          candidates={analyze.result?.candidates}
          debug={analyze.result?.debug}
        />
      )}

      {showUpgrade && (
        <UpgradeModal
          usage={{ used: usage.used, limit: usage.limit }}
          onClose={() => setShowUpgrade(false)}
          onSubmit={async (c) => {
            if (!auth.user) {
              setScreen("signup");
              setShowUpgrade(false);
              return;
            }
            await profile.updateContact(c);
            setShowUpgrade(false);
            if (tabState.listing) void analyze.run(tabState.listing);
          }}
        />
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} j`;
}

// V1 : adapters minimaux. La forme exacte des payloads Géorisques / PLU varie ;
// ces fonctions seront durcies au branchement réel des Edge Functions.
function mapUrbanisme(
  raw: unknown,
): { zone: string; subtitle?: string; description?: string; tone?: "default" | "warn" | "info" }[] {
  const features = (raw as {
    features?: { properties?: { typezone?: string; libelle?: string; libelong?: string } }[];
  }).features;
  if (!Array.isArray(features)) return [];
  return features.slice(0, 3).map((f) => {
    const p = f.properties ?? {};
    const ex = explainPluZone(p.typezone);
    return {
      zone: p.libelle ? `Zone ${p.libelle}` : ex.category,
      subtitle: p.libelong || ex.category,
      description: ex.meaning || undefined,
      tone: ex.tone,
    };
  });
}
