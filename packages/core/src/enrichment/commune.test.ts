import { describe, it, expect, vi } from "vitest";
import { citycodeFromLatLon, fetchCommuneInfo } from "./commune.ts";

// ─── Fixture recorded from real API response (2026-06-11) ─────────────────────

/** GET https://geo.api.gouv.fr/communes/97411?fields=nom,population,surface */
const SAINT_DENIS_RESPONSE = {
  nom: "Saint-Denis",
  population: 155634,
  surface: 14233.04, // hectares
  code: "97411",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fetchCommuneInfo", () => {
  it("appelle le bon endpoint avec le code INSEE et les fields attendus", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => SAINT_DENIS_RESPONSE,
    });

    await fetchCommuneInfo("97411", { fetchFn: mockFetch as unknown as typeof fetch });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://geo.api.gouv.fr/communes/97411?fields=nom,population,surface");
  });

  it("Saint-Denis 97411 — nom, population et densité arrondie (surface en hectares)", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => SAINT_DENIS_RESPONSE,
    });

    const info = await fetchCommuneInfo("97411", { fetchFn: mockFetch as unknown as typeof fetch });

    expect(info.nom).toBe("Saint-Denis");
    expect(info.population).toBe(155634);
    // 155634 / (14233.04 / 100) = 1093.47 → 1093 hab/km²
    expect(info.densityPerKm2).toBe(1093);
  });

  it("erreur HTTP → throw avec le status", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(
      fetchCommuneInfo("97411", { fetchFn: mockFetch as unknown as typeof fetch }),
    ).rejects.toThrow("commune geo.api.gouv.fr: HTTP 503");
  });

  it("erreur réseau → throw (le pipeline gère via allSettled)", async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"));

    await expect(
      fetchCommuneInfo("97411", { fetchFn: mockFetch as unknown as typeof fetch }),
    ).rejects.toThrow("ECONNRESET");
  });

  it("réponse incomplète (population manquante) → throw explicite", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nom: "Saint-Denis", surface: 14233.04, code: "97411" }),
    });

    await expect(
      fetchCommuneInfo("97411", { fetchFn: mockFetch as unknown as typeof fetch }),
    ).rejects.toThrow("réponse incomplète pour 97411");
  });
});

describe("citycodeFromLatLon", () => {
  it("renvoie le code INSEE de la commune au point donné", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ code: "46042" }], // Cahors
    });
    const code = await citycodeFromLatLon(44.4485, 1.4405, {
      fetchFn: mockFetch as unknown as typeof fetch,
    });
    expect(code).toBe("46042");
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("lat=44.4485&lon=1.4405"));
  });

  it("aucune commune trouvée → null", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [] });
    const code = await citycodeFromLatLon(0, 0, { fetchFn: mockFetch as unknown as typeof fetch });
    expect(code).toBeNull();
  });
});
