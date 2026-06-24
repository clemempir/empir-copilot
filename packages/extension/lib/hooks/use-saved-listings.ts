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

  const save = useCallback(
    async (listing: Listing, extra?: { score?: number; address?: string }) => {
      if (!userId) throw new Error("Utilisateur non connecté");
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
      if (error) throw error;
      await refresh();
    },
    [userId, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await getSupabase().from("saved_listings").delete().eq("id", id);
      if (error) throw error;
      await refresh();
    },
    [refresh],
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
