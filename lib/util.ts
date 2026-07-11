// eval/lib/util.ts — helpers compartidos de la eval. Sin dependencias.
import { createHmac } from "node:crypto";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// marca de tiempo para nombres de archivo: 2026-07-04-1832
export const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

// Ejecuta tareas con concurrencia limitada, conservando el orden de resultados.
export async function pool<T, R>(items: T[], limite: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length);
  let siguiente = 0;
  const workers = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      resultados[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return resultados;
}

// Extrae el primer objeto JSON de un texto (modelos que envuelven el JSON en prosa o ```).
export function extraerJSON(texto: string): any {
  try { return JSON.parse(texto); } catch {}
  const m = texto.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// Firma HMAC que el agente espera en x-webhook-signature (mismo esquema que Kapso).
export const firmarKapso = (body: string, secreto: string) =>
  createHmac("sha256", secreto).update(body).digest("hex");

export const eur = (n: number) => `${Math.round(n).toLocaleString("es-ES")} €`;
export const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((100 * n) / d)}%`);

// pass^k (τ-bench): un escenario "pasa" solo si TODAS sus k corridas tuvieron éxito. Es la métrica
// de cabecera del leaderboard; se define UNA vez para que bench, verificación y board no diverjan.
export function passPorEscenario<T extends { id: string; exito: boolean }>(resultados: T[]): Map<string, boolean> {
  const porId = new Map<string, boolean>();
  for (const r of resultados) porId.set(r.id, (porId.get(r.id) ?? true) && r.exito);
  return porId;
}
