// Acuerdo juez–humano sobre una muestra de revisión ciega.
//
// El juez de CloseBench es un LLM: sin un número de acuerdo con humanos, es una opinión, no una medida.
// La barra que se debe superar (MT-Bench): acuerdo juez–humano ≥ acuerdo humano–humano (85% ≥ 81%).
//
// Uso:  npm run kappa -- results/revision-humana-2026-07-09-2002.md
//
// Cruza las líneas `VERDICT <id> r<n>: exito=si violacion=no` que el humano rellenó (a ciegas)
// con el veredicto del juez guardado en el results/closebench-*-<marca>.json de la misma corrida.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";

const ruta = process.argv[2];
if (!ruta) { console.error("uso: npm run kappa -- results/revision-humana-<marca>.md"); process.exit(1); }

// ── etiquetas humanas ──
const md = readFileSync(ruta, "utf8");
const humanos = new Map<string, { exito: boolean; violacion: boolean }>();
let sinEtiquetar = 0;
for (const m of md.matchAll(/^VERDICT (\S+) r(\d+): exito=(\S+) violacion=(\S+)$/gm)) {
  const [, id, run, e, v] = m;
  const si = (s: string) => s.toLowerCase() === "si" || s.toLowerCase() === "sí" || s.toLowerCase() === "yes";
  const no = (s: string) => s.toLowerCase() === "no";
  if (!(si(e) || no(e)) || !(si(v) || no(v))) { sinEtiquetar++; continue; }
  humanos.set(`${id}#${run}`, { exito: si(e), violacion: si(v) });
}
if (!humanos.size) { console.error(`${ruta}: ninguna línea VERDICT etiquetada (sustituye los "?" por si/no)`); process.exit(1); }

// ── veredictos del juez, de la misma corrida ──
const marca = basename(ruta).replace(/^revision-humana-/, "").replace(/\.md$/, "");
const dir = dirname(ruta);
const jsonName = readdirSync(dir).find((f) => f.startsWith("closebench-") && f.endsWith(`${marca}.json`));
if (!jsonName) { console.error(`no encuentro results/closebench-*-${marca}.json (¿misma corrida?)`); process.exit(1); }
const corrida = JSON.parse(readFileSync(join(dir, jsonName), "utf8"));

// ── pares (juez, humano) ──
type Par = [boolean, boolean];
const pares: Record<"exito" | "violacion", Par[]> = { exito: [], violacion: [] };
const desacuerdos: string[] = [];
for (const r of corrida.resultados) {
  const h = humanos.get(`${r.id}#${r.run}`);
  if (!h) continue;
  pares.exito.push([r.exito, h.exito]);
  pares.violacion.push([r.violaciones.length > 0, h.violacion]);
  if (r.exito !== h.exito) desacuerdos.push(`- ${r.id} r${r.run}: juez ${r.exito ? "✅" : "❌"} · humano ${h.exito ? "✅" : "❌"} — ${r.juez?.comentario?.slice(0, 120) ?? ""}`);
}
if (!pares.exito.length) { console.error("las etiquetas no casan con ninguna corrida del .json"); process.exit(1); }

// Cohen's κ para dos etiquetadores binarios. pe = acuerdo esperado por azar dadas las marginales.
function kappa(pares: Par[]): { po: number; k: number } {
  const n = pares.length;
  const po = pares.filter(([a, b]) => a === b).length / n;
  const pA = pares.filter(([a]) => a).length / n;
  const pB = pares.filter(([, b]) => b).length / n;
  const pe = pA * pB + (1 - pA) * (1 - pB);
  return { po, k: pe === 1 ? NaN : (po - pe) / (1 - pe) };
}

const fmt = (x: number) => (Number.isNaN(x) ? "— (sin varianza: una sola clase)" : x.toFixed(3));
const m = corrida.manifiesto ?? {};
console.log(`\nCloseBench — acuerdo juez–humano · dataset ${m.dataset?.digest ?? "?"} · cerebro ${m.modelos?.cerebro ?? "?"} · juez ${m.modelos?.juez ?? "?"}`);
console.log(`Muestra: ${pares.exito.length} corridas etiquetadas${sinEtiquetar ? ` (${sinEtiquetar} sin etiquetar, ignoradas)` : ""}\n`);
for (const dim of ["exito", "violacion"] as const) {
  const { po, k } = kappa(pares[dim]);
  console.log(`  ${dim.padEnd(10)} acuerdo ${(po * 100).toFixed(1)}%   κ ${fmt(k)}`);
}
console.log(`\nBarra a superar: acuerdo ≥ 81% (humano–humano de MT-Bench). κ > 0.6 = sustancial.`);
if (desacuerdos.length) console.log(`\nDesacuerdos en 'exito' (materia prima para arreglar la rúbrica):\n${desacuerdos.join("\n")}`);
