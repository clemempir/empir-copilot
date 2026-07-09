import { useEffect, useMemo, useRef, useState } from "react";
import { browser } from "wxt/browser";
import {
  buildQuickAnalysis,
  correctedLocation,
  explainPluZone,
  getZonePatrimoine,
  type GeoPoint,
  type Listing,
  type QuickAnalysis,
} from "@empir/core";
import type { TabState } from "@/lib/messages";
import { invokeEdge } from "@/lib/supabase";
import { useAuth } from "@/lib/hooks/use-auth";
import { useAnalyze } from "@/lib/hooks/use-analyze";
import { useMarket } from "@/lib/hooks/use-market";
import { useRisks } from "@/lib/hooks/use-risks";
import { useSavedListings } from "@/lib/hooks/use-saved-listings";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useProfile } from "@/lib/hooks/use-profile";
import { X } from "lucide-react";
import { NotificationCard } from "@/components/empir";
import { IdleView } from "./views/IdleView";
import { AnalyzingView } from "./views/AnalyzingView";
import { ResultView } from "./views/ResultView";
import { DiagnosticPanel } from "./views/DiagnosticPanel";
import { SignupView } from "./views/SignupView";
import { AccountView } from "./views/AccountView";

type Screen = "main" | "signup" | "account";
type MainStatus = "idle" | "analyzing" | "result";

/** Essais gratuits sans compte (à vie par appareil) — cf. track-usage. */
const FREE_TRIALS = 3;

export default function App() {
  const auth = useAuth();
  const analyze = useAnalyze();
  const profile = useProfile(auth.user?.id ?? null);
  const saved = useSavedListings(auth.user?.id ?? null);
  const notifs = useNotifications(auth.user?.id ?? null);

  const [screen, setScreen] = useState<Screen>("main");
  const [tabState, setTabState] = useState<TabState>({ status: "idle" });
  const [signupContext, setSignupContext] = useState("Compte EMPIR");
  // Annonce avec adresse corrigée à la main : remplace l'annonce détectée
  // pour TOUT le pipeline (marché, risques, affichage) — sinon le prix médian
  // resterait centré sur l'ancien marqueur quand la résolution échoue.
  const [correctedListing, setCorrectedListing] = useState<Listing | null>(null);

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

    // Filet de sécurité : le background persiste chaque état d'onglet en
    // session storage. S'y abonner garantit la bascule (« annonce détectée »)
    // même si le message TAB_STATE_CHANGED se perd pendant une navigation.
    const onStorage = (changes: Record<string, unknown>, area: string) => {
      if (area === "session" && "tabStates" in changes) void bindActiveTab();
    };
    browser.storage.onChanged.addListener(onStorage);

    return () => {
      alive = false;
      browser.runtime.onMessage.removeListener(onMsg);
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.storage.onChanged.removeListener(onStorage);
    };
  }, []);

  // L'analyse ne se lance PLUS automatiquement : l'utilisateur clique
  // « Lancer l'analyse » (il peut ainsi consulter son compte sans consommer
  // une analyse). L'état n'est remis à zéro que pour une NOUVELLE annonce —
  // pas quand l'onglet actif devient une page sans annonce (Google Maps…),
  // sinon un simple aller-retour effaçait le résultat affiché.
  const lastUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const url = tabState.listing?.url ?? null;
    if (!url || lastUrlRef.current === url) return;
    lastUrlRef.current = url;
    setCorrectedListing(null); // nouvelle annonce → oublier la correction manuelle
    analyze.reset();
  }, [tabState.listing, analyze]);

  // Retour sur une annonce déjà analysée (le panneau a été déchargé entre
  // temps — il est scoped par onglet) : restaure le résultat mémorisé au lieu
  // de redemander un clic (et une analyse) à l'utilisateur.
  useEffect(() => {
    const url = tabState.listing?.url;
    if (!url || analyze.result || analyze.loading) return;
    void analyze.restore(url);
  }, [tabState.listing, analyze]);

  // L'annonce « effective » : corrigée à la main si l'utilisateur a saisi une
  // adresse, sinon celle détectée sur la page.
  const activeListing = correctedListing ?? tabState.listing;

  // 3 essais gratuits épuisés → mur « créez un compte vérifié » (extension
  // gratuite et illimitée avec un compte ; pas de plan payant).
  useEffect(() => {
    if (analyze.result?.status === "quota_exceeded" && !auth.user) {
      setSignupContext("3 analyses gratuites utilisées");
      setScreen("signup");
    }
  }, [analyze.result, auth.user]);

  const mainStatus: MainStatus = useMemo(() => {
    if (analyze.loading) return "analyzing";
    if (analyze.result?.status === "ok") return "result";
    return "idle";
  }, [analyze.loading, analyze.result]);

  // Prix du marché du quartier (ventes DVF réelles autour de l'adresse résolue),
  // puis score prix = position de l'annonce vs médiane comparable.
  const market = useMarket(activeListing, analyze.result?.resolvedAddress);
  // Risques Géorisques (naturels + technologiques, avec gravité), côté client.
  // La donnée est communale : le marqueur de l'annonce (stable pour toute
  // l'analyse) suffit — évite un re-fetch quand la résolution d'adresse aboutit.
  const risksState = useRisks(
    activeListing?.geo?.lat ?? analyze.result?.resolvedAddress?.lat,
    activeListing?.geo?.lon ?? analyze.result?.resolvedAddress?.lon,
  );
  const quick: QuickAnalysis = useMemo(() => {
    if (!activeListing) {
      return { listingPricePerM2: null, marketGapPct: null, market: null, score: null, scoreLabel: "—" };
    }
    if (market.loading) {
      return { ...buildQuickAnalysis(activeListing, null), scoreLabel: "Calcul…" };
    }
    return buildQuickAnalysis(activeListing, market.market);
  }, [activeListing, market.market, market.loading]);

  // Encart de notification : la dernière non-lue apparaît au-dessus de la
  // carte adresse, 2 s APRÈS l'affichage du résultat (l'utilisateur regarde
  // déjà l'écran → l'animation d'entrée capte son attention). « Plus tard »
  // (X) la masque pour CETTE analyse seulement — elle revient à la suivante,
  // jusqu'au « marquer comme lu ».
  const [notifToastClosed, setNotifToastClosed] = useState(false);
  const [notifToastReady, setNotifToastReady] = useState(false);
  useEffect(() => {
    setNotifToastClosed(false);
    setNotifToastReady(false);
    if (analyze.result?.status !== "ok") return;
    const t = setTimeout(() => setNotifToastReady(true), 1000);
    return () => clearTimeout(t);
  }, [analyze.result]);
  const latestUnread = notifs.items.find((n) => !n.read);

  const usage = analyze.result?.usage ?? {
    used: 0,
    limit: auth.user ? null : FREE_TRIALS,
    allowed: true,
    plan: auth.user ? "verified" : "free",
  };

  // ─── Screens ─────────────────────────────────────────────────────────────

  // Adresse affirmée par l'utilisateur (saisie manuelle OU rapprochement
  // validé) : localisation écrasée + marqueur précis sur le point → le
  // résolveur cherche les DPE de CETTE adresse (gate serré ~30 m), et
  // l'annonce corrigée remplace l'annonce détectée pour tout le pipeline.
  const applyCorrectedAddress = (point: GeoPoint) => {
    const l = activeListing;
    if (!l) return;
    // rawAddress = label BAN canonique (pas la frappe partielle) pour
    // l'affichage et la comparaison avec l'adresse résolue.
    const corrected: Listing = {
      ...l,
      location: correctedLocation(point.label, point),
      geo: { lat: point.lat, lon: point.lon, precise: true },
    };
    setCorrectedListing(corrected);
    void analyze.run(corrected);
  };

  // Session ouverte (compte créé+vérifié, connexion, ou reset du mot de
  // passe) : retour à l'analyse, et si le mur des 3 essais avait bloqué,
  // l'analyse est relancée — le compte vérifié est illimité.
  const handleAuthenticated = () => {
    setScreen("main");
    if (analyze.result?.status === "quota_exceeded" && activeListing) {
      void analyze.run(activeListing);
    }
  };

  const authHandlers = {
    onGoogleSignIn: () => auth.signInWithGoogle(),
    onSignup: (e: string, p: string) => auth.signUpWithEmail(e, p),
    onLogin: (e: string, p: string) => auth.signInWithEmail(e, p),
    onVerifySignup: (e: string, c: string) => auth.verifySignupCode(e, c),
    onResendCode: (e: string) => auth.resendSignupCode(e),
    onForgot: (e: string) => auth.requestPasswordReset(e),
    onResetPassword: (e: string, c: string, p: string) => auth.resetPasswordWithCode(e, c, p),
    onAuthenticated: handleAuthenticated,
  };

  if (screen === "signup") {
    return (
      <SignupView onBack={() => setScreen("main")} contextLabel={signupContext} {...authHandlers} />
    );
  }

  if (screen === "account") {
    if (!auth.user || !profile.profile) {
      return (
        <SignupView onBack={() => setScreen("main")} contextLabel="Mon compte" {...authHandlers} />
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
          // Compte connecté = vérifié = illimité (l'extension est gratuite ;
          // la monétisation passe par l'application SaaS séparée).
          tier: "unlimited",
          analysesUsed: usage.used,
          analysesLimit: usage.limit ?? FREE_TRIALS,
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
          onRemove: () => void saved.remove(String(s.id)),
        }))}
        onBack={() => setScreen("main")}
        onUpdateProfile={async ({ name, email }) => {
          const currentName =
            (auth.user?.user_metadata?.full_name as string | undefined) ?? "";
          if (name && name !== currentName) await auth.updateName(name);
          if (email && email !== auth.user?.email) {
            await auth.updateEmail(email);
            return `Un e-mail de confirmation a été envoyé à ${email} — la nouvelle adresse prendra effet après validation.`;
          }
          return null;
        }}
        onLogout={async () => {
          await auth.signOut();
          setScreen("main");
        }}
        onDeleteAccount={async () => {
          // RGPD : suppression côté serveur (admin), puis session locale close.
          await invokeEdge("delete-account", {});
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
      {mainStatus === "idle" && (
        <IdleView
          listing={tabState.status === "detected" ? tabState.listing : null}
          onAnalyze={() => {
            if (tabState.listing) void analyze.run(tabState.listing);
          }}
          onAccountClick={() => setScreen("account")}
          hasUnread={notifs.items.some((n) => !n.read)}
        />
      )}
      {mainStatus === "analyzing" && <AnalyzingView listing={activeListing} />}
      {mainStatus === "result" && activeListing && (
        <ResultView
          listing={activeListing}
          quick={quick}
          notice={
            latestUnread && !notifToastClosed && notifToastReady ? (
              <div key={latestUnread.id} className="empir-notice-in relative">
                {/* Contour dégradé discret (violet → violet pâle) : enveloppe
                    de 1px peinte en dégradé, carte opaque sans bordure dessus. */}
                <div
                  className="rounded-empir-card p-px"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(124,108,255,0.65), rgba(124,108,255,0.12) 50%, rgba(183,172,255,0.4))",
                    boxShadow: "0 0 16px rgba(124,108,255,0.10)",
                  }}
                >
                  <NotificationCard
                    title={latestUnread.title}
                    body={latestUnread.body ?? undefined}
                    time={timeAgo(latestUnread.created_at)}
                    onClick={() => void notifs.markRead(latestUnread.id)}
                    className="border-0 bg-[#10151f]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setNotifToastClosed(true)}
                  title="Plus tard"
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-empir-line text-empir-muted transition-colors hover:text-empir-text"
                  style={{ background: "#0d121d" }}
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              </div>
            ) : undefined
          }
          resolvedAddress={analyze.result?.resolvedAddress}
          saved={saved.isSaved(activeListing.url)}
          onSaveClick={() => {
            if (!auth.user) return setScreen("signup");
            if (!activeListing) return;
            // Bascule : re-cliquer sur le cœur retire l'annonce des favoris.
            const existing = saved.items.find((i) => i.listing_url === activeListing.url);
            if (existing) {
              void saved.remove(existing.id);
            } else {
              void saved.save(activeListing, {
                score: quick.score ?? undefined,
                address: analyze.result?.resolvedAddress?.address,
              });
            }
          }}
          onAccountClick={() => setScreen("account")}
          onReanalyze={() => void analyze.run(activeListing)}
          onAddressSubmit={applyCorrectedAddress}
          candidates={analyze.result?.candidates ?? []}
          onCandidateValidate={(c) =>
            applyCorrectedAddress({
              lat: c.lat,
              lon: c.lon,
              label: c.address,
              citycode: "",
              score: c.confidence / 100,
              precision: "housenumber",
            })
          }
          hasUnread={notifs.items.some((n) => !n.read)}
          risks={risksState.risks}
          urbanisme={[
            ...(analyze.result?.enrichments?.plu ? mapUrbanisme(analyze.result.enrichments.plu) : []),
            // Encart patrimoine ABF, juste à côté de l'encart Zone. Présent dès
            // qu'une analyse a abouti (les 3 états concerné/non/inconnu sont gérés).
            ...(analyze.result ? [patrimoineCard(analyze.result.enrichments?.patrimoine)] : []),
          ]}
          salesHistory={market.timeline?.nodes ?? []}
          salesSummary={market.timeline?.summary ?? null}
        />
      )}

      {/* Tiroir de diagnostic — uniquement en dev (pnpm dev). */}
      {import.meta.env.DEV && mainStatus === "result" && activeListing && (
        <DiagnosticPanel
          listing={activeListing}
          resolvedAddress={analyze.result?.resolvedAddress}
          candidates={analyze.result?.candidates}
          debug={analyze.result?.debug}
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

// Encart « Zone patrimoine remarquable » (ABF) à partir du FeatureCollection
// `assiette-sup-s` brut renvoyé par le serveur (null si IGN injoignable).
function patrimoineCard(raw: unknown): {
  zone: string;
  subtitle?: string;
  description?: string;
  tone: "default" | "warn" | "info";
  statut: "concerne" | "non-concerne" | "inconnu";
} {
  const zp = getZonePatrimoine(raw);
  const zone = "Zone patrimoine remarquable";
  // Service IGN indisponible.
  if (zp == null) {
    return {
      zone,
      subtitle: "Information indisponible",
      description:
        "Le service de l'IGN est momentanément injoignable ; la présence d'une protection patrimoniale n'a pas pu être vérifiée.",
      tone: "info",
      statut: "inconnu",
    };
  }
  // Non concerné.
  if (!zp.concerne) {
    return {
      zone,
      subtitle: "Non concerné",
      description:
        "Le bien n'est pas en zone patrimoniale protégée ; aucun avis de l'Architecte des Bâtiments de France n'est requis à ce titre.",
      tone: "default",
      statut: "non-concerne",
    };
  }
  // Concerné : on cumule les libellés et les implications des catégories AC1/AC4.
  const subtitle = zp.categories.map((c) => c.label).join(" · ");
  const description = zp.categories
    .map((c) => (c.nom ? `${c.nom} — ${c.implication}` : c.implication))
    .join(" ");
  return { zone, subtitle, description, tone: "warn", statut: "concerne" };
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
