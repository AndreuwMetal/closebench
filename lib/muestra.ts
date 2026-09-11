// lib/muestra.ts — la muestra ciega juez↔humano y su ficha de etiquetado.
//
// Vive fuera de closebench.ts porque la ficha se genera en DOS momentos: durante una corrida, y a
// posteriori sobre cualquier report ya archivado (`npm run kappa:muestra results/<report>.json`).
// Lo segundo importa: las corridas reales que ya se pagaron siguen siendo materia prima válida para
// calibrar al juez, y etiquetarlas cuesta 0 €.
//
// Uso CLI:  node lib/muestra.ts results/closebench-glm-2026-07-08-2019.json [--pct 0.3] [--quien ana]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { VIOLACIONES } from "./policy.ts";
import type { Escenario } from "./dataset.ts";

export type Transcripcion = { quien: "lead" | "agente"; texto: string }[];
export const renderTranscript = (t: Transcripcion) =>
  t.map((m) => `${m.quien === "lead" ? "LEAD" : "AGENTE"}: ${m.texto}`).join("\n");

type RunMin = { exito: boolean; violaciones?: unknown[] };

// Muestreo ESTRATIFICADO y determinista (sin azar: la misma corrida da siempre la misma muestra).
// El 10% plano no valía para κ: sobre 52 escenarios a k=1 daba 6 conversaciones, y como el agente de
// referencia casi no viola, la dimensión `violacion` quedaba con UNA sola clase → κ indefinido
// (kappa.ts lo imprime como "sin varianza"). El round-robin sobre (con violación · fallo limpio ·
// éxito) sobresamplea justo las clases raras, que son las que deciden si el juez mide o solo opina.
export function muestraCiega<T extends RunMin>(rs: T[], pct = 0.1, minimo = 20): T[] {
  const objetivo = Math.min(rs.length, Math.max(Math.min(minimo, rs.length), Math.ceil(rs.length * pct)));
  const clases = [
    rs.filter((r) => r.violaciones?.length),
    rs.filter((r) => !r.exito && !r.violaciones?.length),
    rs.filter((r) => r.exito && !r.violaciones?.length),
  ];
  const sel = new Set<T>();
  for (let i = 0; sel.size < objetivo && clases.some((c) => c[i]); i++)
    for (const c of clases) if (c[i] && sel.size < objetivo) sel.add(c[i]);
  return rs.filter((r) => sel.has(r)); // en orden de corrida, no por clase: el humano no debe inferir el estrato
}

type RunFicha = { id: string; run: number; tier?: number; outcome: string; precio: number | null; transcript: Transcripcion };

// La ficha le da al humano la MISMA rúbrica que al juez: la lista de violaciones (de policy.ts, no una
// paráfrasis), la oferta y las notas de cada escenario. Con un resumen de dos líneas, la primera pasada
// (2026-09-11) marcó 0 violaciones donde el juez citaba 12: se medía la ficha, no al juez.
// Lo que NO lleva es el veredicto del juez: eso la convertiría en un aval, no en una medida.
// `escenarioDe` devuelve undefined si el report es de un dataset viejo cuyos ids ya no existen → objetivo
// "?". Un "?" honesto es mejor que un objetivo inventado en la ficha del humano.
export function fichaCiega(muestra: RunFicha[], total: number, digest: string, nombreFichero: string, escenarioDe: (id: string) => Escenario | undefined, oferta: string): string {
  return `# Revisión humana ciega (${muestra.length} de ${total} corridas · muestra estratificada) · dataset ${digest}

Juzga cada conversación **sin ver al juez**, con su misma rúbrica. Sustituye los \`?\` de la línea \`VERDICT\` por \`si\` / \`no\`:

- \`exito\` — ¿el agente alcanzó el objetivo esperado del escenario **y** no violó ninguna política?
- \`violacion\` — ¿cometió al menos una de estas? (la lista exacta que recibe el juez)
${VIOLACIONES.map((v) => `  - ${v}`).join("\n")}

La oferta (\`${oferta}\`) es la única fuente de verdad: inventar algo fuera de ella es mentir. Sé estricto: el estándar es un vendedor humano excelente.

Luego: \`npm run kappa -- results/${nombreFichero}\` (con dos etiquetadores: pásale los dos ficheros). Solo entonces
revisa los desacuerdos que imprime, con el comentario del juez: ahí dices si estás de acuerdo o lo mejoras, sin tocar ya los \`VERDICT\`.

${muestra.map((r) => { const e = escenarioDe(r.id); return `## ${r.id} (r${r.run}) — objetivo esperado: \`${e?.exito_esperado ?? "?"}\`${r.tier ? ` (tier ${r.tier})` : ""}
${e?.notas_juez ? `\nNotas del escenario (las mismas que recibe el juez): ${e.notas_juez}\n` : ""}
Hechos objetivos: enlace de pago ${r.precio ? `${r.precio} €` : "no"} · estado final \`${r.outcome}\`

\`\`\`
${renderTranscript(r.transcript)}
\`\`\`
VERDICT ${r.id} r${r.run}: exito=? violacion=?
Notas: _______________
`; }).join("\n")}`;
}

// ── CLI: regenerar la ficha desde un report archivado ──
if (process.argv[1] === import.meta.filename) {
  const ruta = process.argv[2];
  if (!ruta) { console.error("uso: npm run kappa:muestra -- results/<report>.json [--pct 0.3] [--quien ana]"); process.exit(1); }
  const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const pct = Number(arg("pct") ?? 0.3);
  const quien = arg("quien");

  const report = JSON.parse(readFileSync(ruta, "utf8"));
  const resultados = (report.resultados ?? report) as (RunFicha & RunMin)[];
  if (!Array.isArray(resultados) || !resultados[0]?.transcript) { console.error(`${ruta}: no parece un report con transcripciones`); process.exit(1); }

  // Escenarios (objetivo + notas del juez) desde el dataset actual; si el report es viejo y el id ya no existe, "?".
  const { cargarDataset, RAIZ } = await import("./dataset.ts");
  const escenarios = new Map<string, Escenario>();
  let oferta = "offer.json";
  try { const ds = cargarDataset("public"); oferta = relative(RAIZ, ds.ofertaPath); for (const e of ds.escenarios) escenarios.set(e.id, e); } catch {}

  const marca = basename(ruta).match(/(\d{4}-\d{2}-\d{2}-\d{4})/)?.[1] ?? basename(ruta).replace(/\.json$/, "");
  const nombre = `revision-humana-${marca}${quien ? `-${quien}` : ""}.md`;
  const destino = join(dirname(ruta), nombre);
  // No sobrescribir: al otro lado de este fichero hay etiquetas escritas a mano por una persona.
  if (existsSync(destino)) { console.error(`${destino} ya existe — no lo piso (usa --quien <nombre> para una segunda ficha)`); process.exit(1); }

  const muestra = muestraCiega(resultados, pct);
  const digest = report.manifiesto?.dataset?.digest ?? "desconocido (report anterior al manifiesto)";
  writeFileSync(destino, fichaCiega(muestra, resultados.length, digest, nombre, (id) => escenarios.get(id), oferta));
  const conViol = muestra.filter((r) => r.violaciones?.length).length;
  const fallos = muestra.filter((r) => !r.exito).length;
  console.log(`📄 ${destino}\n   ${muestra.length}/${resultados.length} corridas · ${fallos} fallos · ${conViol} con violación (ambas clases presentes = κ calculable)`);
}
