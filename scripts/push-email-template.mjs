// push-email-template — pousse le template de l'e-mail de confirmation (et la
// configuration de redirection) vers le projet Supabase HÉBERGÉ, via l'API de
// management. Ne touche à rien d'autre (contrairement à `supabase config push`
// qui synchronise toute la section auth, y compris les secrets OAuth).
//
// Usage :  node scripts/push-email-template.mjs
// Token : lu dans ~/.supabase/access-token (créé par `supabase login`).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PROJECT_REF = "coqvobufxwurgrsphhnq";
const CONFIRMED_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/confirmed`;
const TEMPLATE = path.join(import.meta.dirname, "../supabase/templates/confirmation.html");

function readToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const file = path.join(os.homedir(), ".supabase/access-token");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  // `supabase login` range le jeton dans le trousseau macOS.
  return execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-w"], {
    encoding: "utf8",
  }).trim();
}
const token = readToken();

const api = async (method, body) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API management ${res.status}: ${await res.text()}`);
  return res.json();
};

// Liste blanche de redirection existante → on AJOUTE la page, sans rien perdre.
const current = await api("GET");
const allow = new Set(
  (current.uri_allow_list ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);
allow.add(CONFIRMED_URL);

await api("PATCH", {
  site_url: CONFIRMED_URL,
  uri_allow_list: [...allow].join(","),
  mailer_subjects_confirmation: "Confirmez votre compte EMPIR Copilot",
  mailer_templates_confirmation_content: fs.readFileSync(TEMPLATE, "utf8"),
  // Code à 6 chiffres — DOIT correspondre au champ de saisie de l'extension
  // (maxLength=6) et aux textes « code à 6 chiffres ».
  mailer_otp_length: 6,
});

console.log("✅ Template de confirmation + redirections poussés vers", PROJECT_REF);
console.log("   Redirections autorisées :", [...allow].join(" · "));
