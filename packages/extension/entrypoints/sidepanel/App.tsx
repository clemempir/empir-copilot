import { useEffect, useMemo, useState } from "react";
import { browser } from "wxt/browser";
import type { Listing, QuickAnalysis } from "@empir/core";
import type { TabState } from "@/lib/messages";
import { useAuth } from "@/lib/hooks/use-auth";
import { useAnalyze } from "@/lib/hooks/use-analyze";
import { useSavedListings } from "@/lib/hooks/use-saved-listings";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useProfile } from "@/lib/hooks/use-profile";
import { IdleView } from "./views/IdleView";
import { AnalyzingView } from "./views/AnalyzingView";
import { ResultView } from "./views/ResultView";
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

  // Subscribe to background tab state updates (LISTING_DETECTED)
  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: "GET_TAB_STATE" })
      .then((r) => {
        const res = r as { state?: TabState };
        if (res?.state) setTabState(res.state);
      })
      .catch(() => {});
    const listener = (msg: { type?: string; state?: TabState }) => {
      if (msg?.type === "TAB_STATE_CHANGED" && msg.state) setTabState(msg.state);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  // Auto-run analysis when a new listing is detected
  useEffect(() => {
    if (
      tabState.status === "detected" &&
      tabState.listing &&
      !analyze.loading &&
      !analyze.result
    ) {
      void analyze.run(tabState.listing);
    }
  }, [tabState, analyze]);

  // Open upgrade modal when quota is hit
  useEffect(() => {
    if (analyze.result?.status === "quota_exceeded") setShowUpgrade(true);
  }, [analyze.result]);

  const mainStatus: MainStatus = useMemo(() => {
    if (analyze.loading) return "analyzing";
    if (analyze.result?.status === "ok") return "result";
    return "idle";
  }, [analyze.loading, analyze.result]);

  // Synthetic QuickAnalysis: V1 le score prix viendra plus tard depuis Edge
  // Function / core ; pour l'instant on affiche un score neutre 0-100 dérivé
  // de l'écart de prix annonce vs estimation simple (placeholder).
  const quick: QuickAnalysis = useMemo(
    () => ({
      listingPricePerM2:
        tabState.listing?.surface && tabState.listing.surface > 0
          ? Math.round(tabState.listing.price / tabState.listing.surface)
          : null,
      marketGapPct: null,
      market: null,
      score: null,
      scoreLabel: "Calcul à venir",
    }),
    [tabState.listing],
  );

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
          risks={analyze.result?.enrichments?.risks ? mapRisks(analyze.result.enrichments.risks) : []}
          urbanisme={analyze.result?.enrichments?.plu ? mapUrbanisme(analyze.result.enrichments.plu) : []}
          salesHistory={[]} // V1 : alimenté ultérieurement par enrichments.dvf
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
function mapRisks(raw: unknown): { label: string; level: "low" | "medium" | "high" | "info" }[] {
  const arr = (raw as { risquesNaturels?: { libelle: string }[] } | null)?.risquesNaturels;
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 6).map((r) => ({ label: r.libelle, level: "info" as const }));
}

function mapUrbanisme(
  raw: unknown,
): { zone: string; subtitle?: string; description?: string; tone?: "default" | "warn" | "info" }[] {
  const features = (raw as { features?: { properties?: { typezone?: string; libelle?: string } }[] }).features;
  if (!Array.isArray(features)) return [];
  return features.slice(0, 3).map((f) => ({
    zone: f.properties?.libelle ?? "Zone PLU",
    subtitle: f.properties?.typezone,
    tone: "default" as const,
  }));
}
