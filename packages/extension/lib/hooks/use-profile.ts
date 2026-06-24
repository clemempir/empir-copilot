import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export interface UserProfile {
  id: string;
  email: string | null;
  phone: string | null;
  phone_verified: boolean;
  plan: "free" | "unlimited";
}

export interface UseProfile {
  profile: UserProfile | null;
  loading: boolean;
  refresh(): Promise<void>;
  updateContact(input: { email?: string; phone?: string }): Promise<void>;
}

export function useProfile(userId: string | null): UseProfile {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    const { data } = await getSupabase()
      .from("users_profile")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    setProfile((data as UserProfile | null) ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateContact = useCallback(
    async (input: { email?: string; phone?: string }) => {
      if (!userId) return;
      await getSupabase()
        .from("users_profile")
        .update({ email: input.email, phone: input.phone, plan: "unlimited" })
        .eq("id", userId);
      await refresh();
    },
    [userId, refresh],
  );

  return { profile, loading, refresh, updateContact };
}
