import { useState } from "react";
import {
  ArrowLeft,
  Bell,
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  LogOut,
  PencilLine,
  Settings,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { frenchAuthError } from "@/lib/hooks/use-auth";
import {
  EmpirButton,
  NotificationCard,
  SavedListingCard,
} from "@/components/empir";

export interface AccountViewProps {
  user: { name?: string | null; email: string; avatarUrl?: string | null };
  plan: { tier: "free" | "unlimited"; analysesUsed: number; analysesLimit: number };
  notifications: {
    id: string;
    title: string;
    body?: string;
    time?: string;
    read?: boolean;
  }[];
  savedListings: {
    id: string;
    title: string;
    meta?: string;
    price?: number;
    score?: number | null;
    photoUrl?: string;
    onClick?: () => void;
    /** Retire le bien de la liste (icône poubelle). */
    onRemove?: () => void;
  }[];
  onBack: () => void;
  /**
   * Enregistre nom et/ou e-mail. Retourne un message d'information à afficher
   * (ex. « confirmez la nouvelle adresse par e-mail »), ou null.
   */
  onUpdateProfile?: (fields: { name: string; email: string }) => Promise<string | null>;
  onLogout: () => void;
  /** Suppression définitive du compte (RGPD) — demande une confirmation. */
  onDeleteAccount?: () => Promise<void> | void;
  onMarkAllRead?: () => void;
  onNotificationClick?: (id: string) => void;
  onNavigate?: (target: "alerts" | "prefs" | "help") => void;
}

const initials = (s: string) =>
  s
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

export function AccountView({
  user,
  plan,
  notifications,
  savedListings,
  onBack,
  onUpdateProfile,
  onLogout,
  onDeleteAccount,
  onMarkAllRead,
  onNotificationClick,
  onNavigate,
}: AccountViewProps) {
  // Seules les notifications non lues sont affichées : la coche ✓✓ marque
  // comme lu, donc masque la carte. Une seule visible par défaut, le reste
  // derrière un dépliant pour ne pas charger l'écran.
  const unreadNotifs = notifications.filter((n) => !n.read);
  const unread = unreadNotifs.length;
  const [showAllNotifs, setShowAllNotifs] = useState(false);
  const visibleNotifs = showAllNotifs ? unreadNotifs : unreadNotifs.slice(0, 1);
  const hiddenNotifs = unread - 1;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  const startEditProfile = () => {
    setNameDraft(user.name ?? "");
    setEmailDraft(user.email);
    setProfileMsg(null);
    setProfileErr(null);
    setEditingProfile(true);
  };

  const saveProfile = () => {
    if (!onUpdateProfile) return;
    setSavingProfile(true);
    setProfileErr(null);
    onUpdateProfile({ name: nameDraft.trim(), email: emailDraft.trim() })
      .then((msg) => {
        setEditingProfile(false);
        setProfileMsg(msg);
      })
      .catch((e) => setProfileErr(frenchAuthError(e)))
      .finally(() => setSavingProfile(false));
  };
  return (
    <div className="flex h-full flex-col bg-empir-bg">
      <header className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[12px] text-empir-muted hover:text-empir-text"
        >
          <ArrowLeft className="size-4" />
          Retour à l'analyse
        </button>
      </header>

      <div className="empir-scroll flex-1 overflow-y-auto px-4 pb-6">
        {/* Profil */}
        <section className="mt-2 rounded-empir-card-lg border border-empir-line bg-empir-card p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-12 shrink-0 place-items-center rounded-empir-pill bg-gradient-to-br from-empir-primary to-empir-primary-dark text-[14px] font-semibold text-white">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="size-full rounded-empir-pill object-cover" />
              ) : (
                <span>{initials(user.name ?? user.email)}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-empir-text">
                {user.name ?? user.email.split("@")[0]}
              </div>
              <div className="truncate text-[11px] text-empir-muted">{user.email}</div>
            </div>
            {onUpdateProfile && !editingProfile && (
              <button
                type="button"
                onClick={startEditProfile}
                title="Modifier mon nom ou mon e-mail"
                className="grid size-6 shrink-0 place-items-center rounded-[7px] text-empir-muted-2 transition-colors hover:bg-white/5 hover:text-empir-text"
              >
                <PencilLine className="size-3" strokeWidth={1.8} />
              </button>
            )}
          </div>

          {editingProfile && (
            <div className="mt-4 flex flex-col gap-2">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Nom affiché"
                className="h-9 rounded-empir-btn border border-empir-line bg-white/5 px-3 text-[12.5px] text-empir-text placeholder:text-empir-muted-2 focus:border-empir-primary/60 focus:outline-none"
              />
              <input
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                placeholder="Adresse e-mail"
                className="h-9 rounded-empir-btn border border-empir-line bg-white/5 px-3 text-[12.5px] text-empir-text placeholder:text-empir-muted-2 focus:border-empir-primary/60 focus:outline-none"
              />
              <div className="mt-1 flex gap-2">
                <EmpirButton
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setEditingProfile(false)}
                  disabled={savingProfile}
                >
                  Annuler
                </EmpirButton>
                <EmpirButton
                  type="button"
                  className="flex-1"
                  onClick={saveProfile}
                  disabled={savingProfile || (!nameDraft.trim() && !emailDraft.trim())}
                >
                  {savingProfile ? "Enregistrement…" : "Enregistrer"}
                </EmpirButton>
              </div>
            </div>
          )}

          {profileErr && (
            <p className="mt-3 text-[11px] leading-relaxed text-empir-danger">{profileErr}</p>
          )}
          {profileMsg && (
            <p className="mt-3 text-[11px] leading-relaxed text-empir-accent">{profileMsg}</p>
          )}
        </section>

        {/* Plan */}
        <section className="mt-3 flex items-center justify-between gap-3 rounded-empir-card border border-empir-line bg-empir-card p-3.5">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-empir-muted-2">
              Formule
            </div>
            <div className="mt-1 text-[12.5px] text-empir-text">
              {plan.tier === "unlimited"
                ? "Analyses illimitées"
                : `${plan.analysesUsed} / ${plan.analysesLimit} analyses complètes ce mois-ci`}
            </div>
          </div>
        </section>

        {/* Notifications */}
        <section className="mt-5">
          <header className="mb-2 flex items-center justify-between">
            <h3 className="text-[10.5px] uppercase tracking-[0.18em] text-empir-muted-2">
              Notifications {unread > 0 && (
                <span className="ml-1 rounded-empir-pill bg-empir-danger/20 px-1.5 py-px text-[9px] font-semibold text-empir-danger">
                  {unread}
                </span>
              )}
            </h3>
            {unread > 0 && onMarkAllRead && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-[10.5px] text-empir-accent hover:underline"
              >
                Tout marquer lu
              </button>
            )}
          </header>
          <div className="space-y-2">
            {unread === 0 && (
              <p className="rounded-empir-card border border-dashed border-empir-line bg-empir-card/50 px-3 py-4 text-center text-[11px] text-empir-muted-2">
                Aucune notification.
              </p>
            )}
            {visibleNotifs.map((n) => (
              <NotificationCard
                key={n.id}
                title={n.title}
                body={n.body}
                time={n.time}
                onClick={() => onNotificationClick?.(n.id)}
              />
            ))}
            {unread > 1 && (
              <button
                type="button"
                onClick={() => setShowAllNotifs((v) => !v)}
                className="flex w-full items-center justify-center gap-1.5 rounded-empir-card border border-dashed border-empir-line bg-empir-card/50 px-3 py-2 text-[11px] text-empir-muted transition-colors hover:bg-white/[0.04] hover:text-empir-text"
              >
                <ChevronDown
                  className={cn("size-3.5 transition-transform", showAllNotifs && "rotate-180")}
                  strokeWidth={1.8}
                />
                {showAllNotifs
                  ? "Réduire"
                  : hiddenNotifs === 1
                    ? "Voir 1 autre notification"
                    : `Voir les ${hiddenNotifs} autres notifications`}
              </button>
            )}
          </div>
        </section>

        {/* Biens sauvegardés */}
        <section className="mt-5">
          <h3 className="mb-2 text-[10.5px] uppercase tracking-[0.18em] text-empir-muted-2">
            Biens sauvegardés
          </h3>
          <div className="space-y-2">
            {savedListings.length === 0 && (
              <p className="rounded-empir-card border border-dashed border-empir-line bg-empir-card/50 px-3 py-4 text-center text-[11px] text-empir-muted-2">
                Aucun bien sauvegardé pour le moment.
              </p>
            )}
            {savedListings.map((b) => (
              <SavedListingCard
                key={b.id}
                title={b.title}
                meta={b.meta}
                price={b.price}
                score={b.score}
                photoUrl={b.photoUrl}
                onClick={b.onClick}
                onRemove={b.onRemove}
              />
            ))}
          </div>
        </section>

        {/* Menu paramètres */}
        <section className="mt-5 rounded-empir-card border border-empir-line bg-empir-card">
          <MenuItem
            icon={Bell}
            label="Alertes & notifications"
            onClick={() => onNavigate?.("alerts")}
          />
          <MenuItem
            icon={Settings}
            label="Préférences"
            onClick={() => onNavigate?.("prefs")}
          />
          <MenuItem
            icon={HelpCircle}
            label="Aide & support"
            onClick={() => onNavigate?.("help")}
          />
          <MenuItem
            icon={LogOut}
            label="Se déconnecter"
            tone="danger"
            onClick={onLogout}
          />
          {onDeleteAccount && (
            <MenuItem
              icon={Trash2}
              label="Supprimer mon compte"
              tone="danger"
              onClick={() => setConfirmingDelete(true)}
            />
          )}
        </section>

        {/* Confirmation de suppression (RGPD) — action irréversible. */}
        {confirmingDelete && onDeleteAccount && (
          <section className="mt-3 rounded-empir-card border border-empir-danger/40 bg-empir-card p-3.5">
            <p className="text-[12px] font-semibold text-empir-danger">
              Supprimer définitivement votre compte ?
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-empir-muted">
              Vos biens sauvegardés, votre profil et vos notifications seront effacés.
              Cette action est irréversible.
            </p>
            <div className="mt-3 flex gap-2">
              <EmpirButton
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Annuler
              </EmpirButton>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  setDeleting(true);
                  void Promise.resolve(onDeleteAccount()).finally(() => setDeleting(false));
                }}
                className="flex-1 rounded-empir-btn bg-empir-danger/15 px-3 py-2 text-[12px] font-semibold text-empir-danger transition-colors hover:bg-empir-danger/25 disabled:opacity-50"
              >
                {deleting ? "Suppression…" : "Supprimer"}
              </button>
            </div>
          </section>
        )}

        <p className="mt-6 text-center text-[9.5px] text-empir-muted-2">
          <BookOpenCheck className="mr-1 inline size-3" />
          EMPIR Copilot · v0.1.0
        </p>
      </div>
    </div>
  );
}

interface MenuItemProps {
  icon: typeof Bell;
  label: string;
  tone?: "default" | "danger";
  onClick?: () => void;
}

function MenuItem({ icon: Icon, label, tone = "default", onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 border-b border-empir-line px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-white/[0.04]"
    >
      <span className="flex items-center gap-2.5">
        <Icon
          className={
            tone === "danger" ? "size-[15px] text-empir-danger" : "size-[15px] text-empir-muted"
          }
        />
        <span
          className={
            tone === "danger"
              ? "text-[12.5px] text-empir-danger"
              : "text-[12.5px] text-empir-text"
          }
        >
          {label}
        </span>
      </span>
      <ChevronRight className="size-4 text-empir-muted-2" />
    </button>
  );
}
