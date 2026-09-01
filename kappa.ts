// Acuerdo juez–humano (y humano–humano) sobre una muestra de revisión ciega.
//
// El juez de CloseBench es un LLM: sin un número de acuerdo con humanos, es una opinión, no una medida.
// La barra que se debe superar (MT-Bench): acuerdo juez–humano ≥ acuerdo humano–humano (85% ≥ 81%).
// Esa barra necesita DOS etiquetadores independientes: con uno solo, el término de la derecha no
// existe y la comparación es incitable. Por eso este script acepta N fichas de la misma corrida.
//
// Uso:  npm run kappa -- results/revision-humana-<marca>.md [results/revision-humana-<marca>-ana.md ...]
//
// Cruza las líneas `VERDICT <id> r<n>: exito=si violacion=no` que cada humano rellenó (a ciegas)
// con el veredicto del juez guardado en el results/closebench-*-<marca>.json de la misma corrida.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";

// --selftest: κ es aritmética silenciosa (un signo mal puesto sigue imprimiendo un número creíble),
// y de este número depende que el juez sea una medida y no una opinión. Corre en CI, gratis.
if (process.argv.includes("--selftest")) {
  const { mkdtempSync, writeFileSync: escribir } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "kappa-"));
  const runs = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, run: 1, exito: i < 7, violaciones: i < 7 ? [] : [{ tipo: "x", cita: "y" }], juez: { comentario: "" } }));
  escribir(join(dir, "closebench-x-2026-01-01-0000.json"), JSON.stringify({ resultados: runs }));
  const ficha = (f: (i: number) => boolean) => runs.map((r, i) => `VERDICT ${r.id} r1: exito=${f(i) ? "si" : "no"} violacion=${f(i) ? "no" : "si"}`).join("\n");
  escribir(join(dir, "revision-humana-2026-01-01-0000-a.md"), ficha((i) => i < 7));       // idéntico al juez → κ 1
  escribir(join(dir, "revision-humana-2026-01-01-0000-b.md"), ficha((i) => i < 6));       // 1 desacuerdo → κ < 1
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("node", [import.meta.filename, join(dir, "revision-humana-2026-01-01-0000-a.md"), join(dir, "revision-humana-2026-01-01-0000-b.md")], { encoding: "utf8" });
  const fallos = [
    [/juez ↔ a\s+exito\s+n\s+10\s+acuerdo 100\.0%\s+κ 1\.000/, "juez↔a debería ser acuerdo perfecto"],
    [/juez ↔ b\s+exito\s+n\s+10\s+acuerdo 90\.0%/, "juez↔b debería ser 90% (1 de 10 discrepa)"],
    [/a ↔ b\s+exito\s+n\s+10\s+acuerdo 90\.0%/, "falta el humano–humano, que es la barra de la derecha"],
  ].filter(([re]) => !(re as RegExp).test(out)).map(([, m]) => m);
  if (fallos.length) { console.error(`❌ kappa selftest:\n- ${fallos.join("\n- ")}\n\n${out}`); process.exit(1); }
  console.log("✅ kappa selftest OK: juez↔humano, humano↔humano y κ con desacuerdo.");
  process.exit(0);
}

const rutas = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (!rutas.length) { console.error("uso: npm run kappa -- results/revision-humana-<marca>.md [otra-ficha.md ...]"); process.exit(1); }

// ── etiquetas humanas, una tanda por fichero ──
type Etiqueta = { exito: boolean; violacion: boolean };
type Etiquetador = { nombre: string; etiquetas: Map<string, Etiqueta>; sinEtiquetar: number };
const etiquetadores: Etiquetador[] = [];
for (const ruta of rutas) {
  const md = readFileSync(ruta, "utf8");
  const etiquetas = new Map<string, Etiqueta>();
  let sinEtiquetar = 0;
  for (const m of md.matchAll(/^VERDICT (\S+) r(\d+): exito=(\S+) violacion=(\S+)$/gm)) {
    const [, id, run, e, v] = m;
    const si = (s: string) => s.toLowerCase() === "si" || s.toLowerCase() === "sí" || s.toLowerCase() === "yes";
    const no = (s: string) => s.toLowerCase() === "no";
    if (!(si(e) || no(e)) || !(si(v) || no(v))) { sinEtiquetar++; continue; }
    etiquetas.set(`${id}#${run}`, { exito: si(e), violacion: si(v) });
  }
  if (!etiquetas.size) { console.error(`${ruta}: ninguna línea VERDICT etiquetada (sustituye los "?" por si/no)`); process.exit(1); }
  // nombre = el sufijo tras la marca de tiempo, o "humano" si la ficha no lo lleva
  const nombre = basename(ruta).replace(/\.md$/, "").replace(/^revision-humana-\d{4}-\d{2}-\d{2}-\d{4}-?/, "") || "humano";
  etiquetadores.push({ nombre, etiquetas, sinEtiquetar });
}

// ── veredictos del juez, de la misma corrida ──
const marcas = new Set(rutas.map((r) => basename(r).match(/(\d{4}-\d{2}-\d{2}-\d{4})/)?.[1]));
if (marcas.size !== 1 || marcas.has(undefined)) { console.error(`las fichas deben ser de la MISMA corrida (marcas: ${[...marcas].join(", ")})`); process.exit(1); }
const marca = [...marcas][0]!;
const dir = dirname(rutas[0]);
const jsonName = readdirSync(dir).find((f) => f.startsWith("closebench-") && f.endsWith(`${marca}.json`));
if (!jsonName) { console.error(`no encuentro results/closebench-*-${marca}.json (¿misma corrida?)`); process.exit(1); }
const corrida = JSON.parse(readFileSync(join(dir, jsonName), "utf8"));

// Cohen's κ para dos etiquetadores binarios. pe = acuerdo esperado por azar dadas las marginales.
type Par = [boolean, boolean];
function kappa(pares: Par[]): { po: number; k: number } {
  const n = pares.length;
  const po = pares.filter(([a, b]) => a === b).length / n;
  const pA = pares.filter(([a]) => a).length / n;
  const pB = pares.filter(([, b]) => b).length / n;
  const pe = pA * pB + (1 - pA) * (1 - pB);
  return { po, k: pe === 1 ? NaN : (po - pe) / (1 - pe) };
}
const fmt = (x: number) => (Number.isNaN(x) ? "— (sin varianza: una sola clase)" : x.toFixed(3));
const DIMS = ["exito", "violacion"] as const;
const juezDice = (r: any, dim: (typeof DIMS)[number]) => (dim === "exito" ? !!r.exito : r.violaciones.length > 0);

const imprimir = (etq: string, pares: Record<string, Par[]>) => {
  for (const dim of DIMS) {
    if (!pares[dim].length) continue;
    const { po, k } = kappa(pares[dim]);
    console.log(`  ${etq.padEnd(24)} ${dim.padEnd(10)} n ${String(pares[dim].length).padStart(3)}   acuerdo ${(po * 100).toFixed(1)}%   κ ${fmt(k)}`);
  }
};

const m = corrida.manifiesto ?? {};
console.log(`\nCloseBench — acuerdo sobre la muestra ciega · dataset ${m.dataset?.digest ?? "?"} · cerebro ${m.modelos?.cerebro ?? "?"} · juez ${m.modelos?.juez ?? "?"}\n`);

// ── juez ↔ cada humano ──
const desacuerdos: string[] = [];
for (const et of etiquetadores) {
  const pares: Record<string, Par[]> = { exito: [], violacion: [] };
  for (const r of corrida.resultados) {
    const h = et.etiquetas.get(`${r.id}#${r.run}`);
    if (!h) continue;
    for (const dim of DIMS) pares[dim].push([juezDice(r, dim), h[dim]]);
    if (!!r.exito !== h.exito) desacuerdos.push(`- ${r.id} r${r.run} (${et.nombre}): juez ${r.exito ? "✅" : "❌"} · humano ${h.exito ? "✅" : "❌"} — ${r.juez?.comentario?.slice(0, 120) ?? ""}`);
  }
  if (!pares.exito.length) { console.error(`${et.nombre}: las etiquetas no casan con ninguna corrida del .json`); process.exit(1); }
  imprimir(`juez ↔ ${et.nombre}`, pares);
  if (et.sinEtiquetar) console.log(`  (${et.nombre}: ${et.sinEtiquetar} sin etiquetar, ignoradas)`);
}

// ── humano ↔ humano: la barra de la derecha. Solo sobre las corridas que AMBOS etiquetaron. ──
if (etiquetadores.length >= 2) {
  console.log("");
  for (let i = 0; i < etiquetadores.length; i++)
    for (let j = i + 1; j < etiquetadores.length; j++) {
      const [a, b] = [etiquetadores[i], etiquetadores[j]];
      const pares: Record<string, Par[]> = { exito: [], violacion: [] };
      for (const [clave, ea] of a.etiquetas) {
        const eb = b.etiquetas.get(clave);
        if (!eb) continue;
        for (const dim of DIMS) pares[dim].push([ea[dim], eb[dim]]);
      }
      if (!pares.exito.length) { console.log(`  ${a.nombre} ↔ ${b.nombre}: sin corridas etiquetadas en común`); continue; }
      imprimir(`${a.nombre} ↔ ${b.nombre}`, pares);
    }
} else {
  console.log(`\n⚠️  Un solo etiquetador: no hay humano–humano, así que la barra "juez–humano ≥ humano–humano"`);
  console.log(`   no se puede evaluar con esta muestra. Genera una segunda ficha para otra persona:`);
  console.log(`   npm run kappa:muestra -- ${join(dir, jsonName)} --quien <nombre>`);
}

console.log(`\nBarra a superar: juez–humano ≥ humano–humano (MT-Bench: 85% ≥ 81%). κ > 0.6 = sustancial.`);
if (desacuerdos.length) console.log(`\nDesacuerdos en 'exito' (materia prima para arreglar la rúbrica):\n${desacuerdos.join("\n")}`);
