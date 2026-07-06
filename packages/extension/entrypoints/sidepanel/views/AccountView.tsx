import { useState } from "react";
import {
  ArrowLeft,
  Bell,
  BookOpenCheck,
  ChevronRight,
  CreditCard,
  HelpCircle,
  LogOut,
  Settings,
  Trash2,
} from "lucide-react";
import {
  EmpirButton,
  EmpirLogo,
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
  }[];
  onBack: () => void;
  onUpgradeClick: () => void;
  onLogout: () => void;
  /** Suppression définitive du compte (RGPD) — demande une confirmation. */
  onDeleteAccount?: () => Promise<void> | void;
  onMarkAllRead?: () => void;
  onNotificationClick?: (id: string) => void;
  onNavigate?: (target: "alerts" | "billing" | "prefs" | "help") => void;
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
  onUpgradeClick,
  onLogout,
  onDeleteAccount,
  onMarkAllRead,
  onNotificationClick,
  onNavigate,
}: AccountViewProps) {
  const unread = notifications.filter((n) => !n.read).length;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
        <EmpirLogo size="sm" withText={false} />
      </header>

      <div className="empir-scroll flex-1 overflow-y-auto px-4 pb-6">
        {/* Profil */}
        <section className="mt-2 flex items-center gap-3 rounded-empir-card-lg border border-empir-line bg-empir-card p-4">
          <div className="grid size-12 place-items-center rounded-empir-pill bg-gradient-to-br from-empir-primary to-empir-primary-dark text-[14px] font-semibold text-white">
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
        </section>

        {/* Plan */}
        <section className="mt-3 flex items-center justify-between gap-3 rounded-empir-card border border-empir-line bg-empir-card p-3.5">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.2em] text-empir-muted-2">
              Formule {plan.tier === "unlimited" ? "Illimitée" : "Gratuite"}
            </div>
            <div className="mt-1 text-[12.5px] text-empir-text">
              {plan.tier === "unlimited"
                ? "Analyses illimitées · merci 🙏"
                : `${plan.analysesUsed} / ${plan.analysesLimit} analyses complètes ce mois-ci`}
            </div>
          </div>
          {plan.tier === "free" && (
            <EmpirButton type="button" size="sm" onClick={onUpgradeClick}>
              Passer Pro
            </EmpirButton>
          )}
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
            {notifications.length === 0 && (
              <p className="rounded-empir-card border border-dashed border-empir-line bg-empir-card/50 px-3 py-4 text-center text-[11px] text-empir-muted-2">
                Aucune notification.
              </p>
            )}
            {notifications.map((n) => (
              <NotificationCard
                key={n.id}
                title={n.title}
                body={n.body}
                time={n.time}
                read={n.read}
                onClick={() => onNotificationClick?.(n.id)}
              />
            ))}
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
            icon={CreditCard}
            label="Abonnement & facturation"
            onClick={() => onNavigate?.("billing")}
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
