import { useCallback, useEffect, useState } from "react";
import type { Listing } from "@empir/core";
import { getSupabase } from "@/lib/supabase";

export interface SavedListing {
  id: string;
  listing_url: string;
  title: string | null;
  address: string | null;
  price: number | null;
  score: number | null;
  photo_url: string | null;
  payload: unknown;
  created_at: string;
}

export interface UseSavedListings {
  items: SavedListing[];
  loading: boolean;
  refresh(): Promise<void>;
  save(listing: Listing, extra?: { score?: number; address?: string }): Promise<void>;
  remove(id: string): Promise<void>;
  isSaved(listingUrl: string): boolean;
}

export function useSavedListings(userId: string | null): UseSavedListings {
  const [items, setItems] = useState<SavedListing[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      return;
    }
    setLoading(true);
    const { data } = await getSupabase()
      .from("saved_listings")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setItems((data as SavedListing[] | null) ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // save/remove sont OPTIMISTES : l'état local change immédiatement (le cœur
  // s'allume/s'éteint au clic, sans attendre le réseau), puis le serveur se
  // synchronise ; en cas d'échec, on revient en arrière.
  const save = useCallback(
    async (listing: Listing, extra?: { score?: number; address?: string }) => {
      if (!userId) throw new Error("Utilisateur non connecté");
      const optimistic: SavedListing = {
        id: `optimistic:${listing.url}`,
        listing_url: listing.url,
        title: listing.title ?? null,
        address: extra?.address ?? listing.location.rawAddress ?? null,
        price: listing.price ?? null,
        score: extra?.score ?? null,
        photo_url: listing.photos[0] ?? null,
        payload: listing,
        created_at: new Date().toISOString(),
      };
      setItems((cur) => [optimistic, ...cur.filter((i) => i.listing_url !== listing.url)]);
      const { error } = await getSupabase()
        .from("saved_listings")
        .upsert(
          {
            user_id: userId,
            listing_url: listing.url,
            title: listing.title,
            address: extra?.address ?? listing.location.rawAddress,
            price: listing.price,
            score: extra?.score ?? null,
            photo_url: listing.photos[0] ?? null,
            payload: listing,
          },
          { onConflict: "user_id,listing_url" },
        );
      if (error) {
        setItems((cur) => cur.filter((i) => i.id !== optimistic.id));
        throw error;
      }
      await refresh(); // remplace l'entrée optimiste par la ligne réelle (vrai id)
    },
    [userId, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      let removed: SavedListing | undefined;
      setItems((cur) => {
        removed = cur.find((i) => i.id === id);
        return cur.filter((i) => i.id !== id);
      });
      // Suppression par (user, url) : couvre aussi l'entrée optimiste dont
      // l'id local n'existe pas en base (double-clic rapide sur le cœur).
      const q = getSupabase().from("saved_listings").delete();
      const { error } = removed
        ? await q.eq("user_id", userId ?? "").eq("listing_url", removed.listing_url)
        : await q.eq("id", id);
      if (error) {
        if (removed) {
          const back = removed;
          setItems((cur) => [back, ...cur.filter((i) => i.id !== back.id)]);
        }
        throw error;
      }
    },
    [userId],
  );

  return {
    items,
    loading,
    refresh,
    save,
    remove,
    isSaved: (url) => items.some((i) => i.listing_url === url),
  };
}
