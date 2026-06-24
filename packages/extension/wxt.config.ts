import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { HOST_PERMISSIONS } from "./lib/host-permissions";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifestVersion: 3,
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
      browser === "firefox" ? ["storage", "tabs"] : ["storage", "sidePanel", "tabs"],
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
