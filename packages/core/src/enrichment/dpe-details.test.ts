import { describe, expect, it, vi } from "vitest";
import { fetchDpeDetails } from "./dpe-details.ts";

function ok(results: unknown[]) {
  return { ok: true, json: async () => ({ results }) } as unknown as Response;
}

describe("fetchDpeDetails", () => {
  it("extrait chauffage, isolation et fenêtres", async () => {
    const fetchFn = vi.fn(async (_url: string) =>
      ok([
        {
          type_generateur_chauffage_principal: "Chaudière gaz à condensation après 2015",
          type_energie_principale_chauffage: "Gaz naturel",
          qualite_isolation_enveloppe: "insuffisante",
          qualite_isolation_menuiseries: "bonne",
        },
      ]),
    );
    const res = await fetchDpeDetails("2640E0046210B", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toEqual({
      chauffage: "Chaudière gaz à condensation après 2015",
      energieChauffage: "Gaz naturel",
      isolation: "insuffisante",
      fenetres: "bonne",
    });
    expect((fetchFn.mock.calls[0]![0] as string)).toContain("numero_dpe_eq=2640E0046210B");
  });

  it("chauffage : repli sur description puis énergie si le type est vide", async () => {
    const fetchFn = vi.fn(async () =>
      ok([
        {
          type_generateur_chauffage_principal: null,
          description_generateur_chauffage_n1_installation_n1: "Chaudière condensation",
          type_energie_principale_chauffage: "Gaz naturel",
          qualite_isolation_enveloppe: "moyenne",
        },
      ]),
    );
    const res = await fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res?.chauffage).toBe("Chaudière condensation");
    expect(res?.isolation).toBe("moyenne");
  });

  it("normalise les libellés de qualité (accents/casse)", async () => {
    const fetchFn = vi.fn(async () =>
      ok([{ qualite_isolation_enveloppe: "Très bonne", qualite_isolation_menuiseries: "TRES BONNE" }]),
    );
    const res = await fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res?.isolation).toBe("très bonne");
    expect(res?.fenetres).toBe("très bonne");
  });

  it("ignore les valeurs « non affecté »", async () => {
    const fetchFn = vi.fn(async () =>
      ok([{ type_generateur_chauffage_principal: "Non affecté", qualite_isolation_enveloppe: "bonne" }]),
    );
    const res = await fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toEqual({ isolation: "bonne" });
  });

  it("certificat introuvable → null", async () => {
    const fetchFn = vi.fn(async () => ok([]));
    const res = await fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toBeNull();
  });

  it("aucun des 3 champs → null", async () => {
    const fetchFn = vi.fn(async () => ok([{ numero_dpe: "X" }]));
    const res = await fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toBeNull();
  });

  it("certId vide → null sans requête", async () => {
    const fetchFn = vi.fn(async () => ok([]));
    const res = await fetchDpeDetails("", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("bascule sur le dataset historique si le jeu enrichi répond en erreur", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502 } as unknown as Response)
      .mockResolvedValueOnce(ok([{ qualite_isolation_enveloppe: "bonne" }]));
    const res = await fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toEqual({ isolation: "bonne" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((fetchFn.mock.calls[1]![0] as string)).toContain("dpe03existant");
  });

  it("propage une erreur HTTP si tous les datasets échouent", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    await expect(
      fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("fetchDpeDetails — isolation par poste + point faible", () => {
  it("détaille murs / toiture / plancher bas", async () => {
    const fetchFn = vi.fn(async () =>
      ok([
        {
          qualite_isolation_murs: "insuffisante",
          qualite_isolation_plancher_haut_comble_perdu: "très bonne",
          qualite_isolation_plancher_bas: "très bonne",
          deperditions_murs: 232,
        },
      ]),
    );
    const res = await fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res).toMatchObject({
      isolationMurs: "insuffisante",
      isolationToiture: "très bonne",
      isolationPlancherBas: "très bonne",
      pointFaible: "murs",
    });
  });

  it("coalesce la toiture : combles aménagés si perdus absents", async () => {
    const fetchFn = vi.fn(async () =>
      ok([{ qualite_isolation_plancher_haut_comble_amenage: "moyenne" }]),
    );
    const res = await fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res?.isolationToiture).toBe("moyenne");
  });

  it("point faible = plus grosse déperdition parmi les postes mal notés", async () => {
    const fetchFn = vi.fn(async () =>
      ok([
        {
          qualite_isolation_murs: "moyenne",
          qualite_isolation_menuiseries: "insuffisante",
          deperditions_murs: 40,
          deperditions_baies_vitrees: 120,
        },
      ]),
    );
    const res = await fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch });
    // fenêtres perdent le plus (120 > 40), donc point faible = fenetres
    expect(res?.pointFaible).toBe("fenetres");
  });

  it("aucun point faible quand tout est bien isolé", async () => {
    const fetchFn = vi.fn(async () =>
      ok([
        {
          qualite_isolation_murs: "bonne",
          qualite_isolation_plancher_bas: "très bonne",
          qualite_isolation_menuiseries: "bonne",
          deperditions_murs: 200,
        },
      ]),
    );
    const res = await fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res?.pointFaible).toBeUndefined();
    expect(res?.isolationMurs).toBe("bonne");
  });

  it("point faible sans chiffre de déperdition → pire note", async () => {
    const fetchFn = vi.fn(async () =>
      ok([
        { qualite_isolation_murs: "moyenne", qualite_isolation_plancher_bas: "insuffisante" },
      ]),
    );
    const res = await fetchDpeDetails("X", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(res?.pointFaible).toBe("plancherBas");
  });
});
