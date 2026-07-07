import { useCallback, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { getSupabase } from "@/lib/supabase";

/** Resynchronise la pastille de l'icône Chrome (gérée par le background). */
function pingBadge(): void {
  void browser.runtime.sendMessage({ type: "REFRESH_BADGE" }).catch(() => {});
}

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  read: boolean;
  created_at: string;
}

export interface UseNotifications {
  items: NotificationRow[];
  unreadCount: number;
  loading: boolean;
  refresh(): Promise<void>;
  markAllRead(): Promise<void>;
  markRead(id: string): Promise<void>;
}

export function useNotifications(userId: string | null): UseNotifications {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { data } = await getSupabase()
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    setItems((data as NotificationRow[] | null) ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    await getSupabase().from("notifications").update({ read: true }).eq("user_id", userId);
    await refresh();
    pingBadge();
  }, [userId, refresh]);

  const markRead = useCallback(
    async (id: string) => {
      await getSupabase().from("notifications").update({ read: true }).eq("id", id);
      await refresh();
      pingBadge();
    },
    [refresh],
  );

  return {
    items,
    unreadCount: items.filter((n) => !n.read).length,
    loading,
    refresh,
    markAllRead,
    markRead,
  };
}
