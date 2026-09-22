// Exporta los ficheros de datos del dataset de Hugging Face (AndreuwMetal/closebench) a partir de results/published/.
//
// Uso:  node scripts/hf-export.ts <dir-salida>
//       hf upload AndreuwMetal/closebench <dir-salida> . --repo-type dataset
//
// - runs/<report>.jsonl          una fila por escenario jugado, con el manifiesto de la corrida aplanado en cada fila
// - human_labels/<report>.jsonl  una fila por (escenario, etiquetador) de las fichas ciegas, con el veredicto del juez al lado
// Los escenarios (realestate/, saas/, offers/) se suben tal cual desde scenarios/ y domains/; la ficha (README.md) se edita a mano.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) { console.error("uso: node scripts/hf-export.ts <dir-salida>"); process.exit(1); }
const PUB = "results/published";
const REPORTS = ["1717", "1729", "1939", "1945", "1949"].map((m) => `closebench-glm-2026-08-31-${m}`);
const jsonl = (filas: object[]) => filas.map((f) => JSON.stringify(f)).join("\n") + "\n";
const leer = (rep: string) => JSON.parse(readFileSync(join(PUB, `${rep}.json`), "utf8"));

mkdirSync(join(out, "runs"), { recursive: true });
mkdirSync(join(out, "human_labels"), { recursive: true });

for (const rep of REPORTS) {
  const { manifiesto: m, resultados } = leer(rep);
  const filas = resultados
    .filter((r: any) => !r.id.startsWith("h-")) // un transcript del split oculto ES el escenario oculto: nunca se publica
    .map((r: any) => ({
      report: rep,
      report_url: `https://github.com/AndreuwMetal/closebench/blob/main/${PUB}/${rep}.md`,
      domain: m.dataset.domain, version: m.dataset.version, digest: m.dataset.digest, split: m.dataset.split, k: m.dataset.k,
      protocolo: m.protocolo, conformidad: m.conformidad, prompt: m.sut.prompt,
      modelo_cerebro: m.modelos.cerebro, modelo_comprador: m.modelos.comprador, modelo_juez: m.modelos.juez, harness_git: m.harness.git,
      id: r.id, cat: r.cat, tier: r.tier, run: r.run, outcome: r.outcome, exito: r.exito, precio: r.precio ?? null, error: r.error ?? null,
      violaciones: r.violaciones,
      juez_resultado: r.juez?.resultado ?? null,
      juez_avance_funnel: r.juez?.avance_funnel ?? null,
      juez_descubrimiento: r.juez?.descubrimiento ?? null,
      juez_objeciones: r.juez?.objeciones ?? null,
      juez_naturalidad_whatsapp: r.juez?.naturalidad_whatsapp ?? null,
      juez_disclosure_ia: r.juez?.disclosure_ia ?? null,
      juez_comentario: r.juez?.comentario ?? null,
      turnos: r.turnos, latenciasMs: r.latenciasMs, transcript: r.transcript,
      tokens_cerebro_entrada: r.usoCerebro?.entrada ?? null, tokens_cerebro_salida: r.usoCerebro?.salida ?? null,
      tokens_comprador_entrada: r.usoComprador?.entrada ?? null, tokens_comprador_salida: r.usoComprador?.salida ?? null,
      tokens_juez_entrada: r.usoJuez?.entrada ?? null, tokens_juez_salida: r.usoJuez?.salida ?? null,
    }));
  writeFileSync(join(out, "runs", `${rep}.jsonl`), jsonl(filas));
  console.log(`runs/${rep}.jsonl  ${filas.length} filas`);
}

// Fichas ciegas con nombre de etiquetador: revision-humana-<marca>-<quien>.md. Las sin sufijo son plantilla o la pasada conjunta no citable.
for (const rep of REPORTS) {
  const marca = rep.replace(/^closebench-glm-/, "");
  const fichas = readdirSync(PUB).filter((f) => f.startsWith(`revision-humana-${marca}-`) && f.endsWith(".md")).sort();
  if (!fichas.length) continue;
  const juez = new Map(leer(rep).resultados.map((r: any) => [`${r.id}#${r.run}`, r]));
  const filas: object[] = [];
  for (const ficha of fichas) {
    const labeler = ficha.slice(`revision-humana-${marca}-`.length, -3);
    const md = readFileSync(join(PUB, ficha), "utf8");
    for (const [, id, run, e, v, n] of md.matchAll(/^VERDICT (\S+) r(\d+): exito=(\S+) violacion=(\S+)\nNotas: ?(.*)$/gm)) {
      if (e === "?" || v === "?") throw new Error(`${ficha}: ${id} sin etiquetar`);
      const j: any = juez.get(`${id}#${run}`);
      if (!j) throw new Error(`${ficha}: ${id} r${run} no está en ${rep}.json`);
      filas.push({ report: rep, id, run: +run, labeler, exito: e === "si", violacion: v === "si",
        notas: /^_*$/.test(n.trim()) ? "" : n.trim(), juez_exito: !!j.exito, juez_violacion: j.violaciones.length > 0 });
    }
  }
  writeFileSync(join(out, "human_labels", `${rep}.jsonl`), jsonl(filas));
  console.log(`human_labels/${rep}.jsonl  ${filas.length} filas (${fichas.length} fichas)`);
}
