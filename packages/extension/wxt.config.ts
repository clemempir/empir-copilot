import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { HOST_PERMISSIONS } from "./lib/host-permissions";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifestVersion: 3,
  // Fenêtre de test (pnpm dev) : profil Chrome PERSISTANT au lieu d'un profil
  // jetable — Chrome y mémorise la largeur du sidepanel (non réglable par
  // l'extension, c'est une limite de l'API), les réglages et les connexions
  // d'une session à l'autre. Le dossier est ignoré par git (.wxt/).
  webExt: {
    // DÉSACTIVÉ : l'utilisateur teste dans son vrai Chrome (extension non
    // empaquetée via Documents/EMPIR-extension-test). La fenêtre de test
    // automatique liait la vie du serveur dev à la sienne : la fermer tuait
    // le serveur → extension orpheline (écran blanc). Remettre disabled:false
    // pour retrouver la fenêtre de test auto.
    disabled: true,
    chromiumProfile: ".wxt/chrome-profile",
    keepProfileChanges: true,
    startUrls: ["https://www.seloger.com/"],
  },
  hooks: {
    "build:manifestGenerated": (wxt, manifest) => {
      if (wxt.config.browser !== "firefox") return;
      for (const entry of manifest.web_accessible_resources ?? []) {
        if (typeof entry === "object" && "use_dynamic_url" in entry) {
          delete entry.use_dynamic_url;
        }
      }
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => ({
    name: "EMPIR Copilot",
    description:
      "L'adresse réelle d'une annonce immobilière et les données officielles (DVF, DPE, Géorisques, PLU, taxe foncière) en quelques secondes.",
    action: {
      default_title: "EMPIR Copilot",
      default_icon: {
        16: "icon/16.png",
        32: "icon/32.png",
        48: "icon/48.png",
      },
    },
    permissions:
      browser === "firefox"
        ? ["storage", "tabs", "identity"]
        : ["storage", "sidePanel", "tabs", "identity"],
    host_permissions: HOST_PERMISSIONS,
    ...(browser === "firefox" && {
      browser_specific_settings: {
        gecko: {
          id: "empir-copilot@empir.app",
          strict_min_version: "121.0",
          data_collection_permissions: { required: ["none"] },
        },
      },
    }),
  }),
});
