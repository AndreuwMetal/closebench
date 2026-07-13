// leaderboard.ts — Stage 3: regenera LEADERBOARD.md desde submissions/. Estático y determinista:
// el board es una VISTA sobre artefactos verificables (informes + sellos de verificación), no una
// base de datos que alguien edita. Quien no se fíe del board, lo regenera.
//
// Uso: node leaderboard.ts [--dir submissions] [--out LEADERBOARD.md] [--dry (incluye runs dry)]
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { validar } from "./submission.ts";
import { RAIZ } from "./lib/dataset.ts";
import { stamp, pct, passPorEscenario } from "./lib/util.ts";

const { values: flags } = parseArgs({
  options: {
    dir: { type: "string", default: join(RAIZ, "submissions") },
    out: { type: "string", default: join(RAIZ, "LEADERBOARD.md") },
    dry: { type: "boolean", default: false },
  },
});

type Entrada = {
  nombre: string; dry: boolean; split: string; dominio: string; version: string; digest: string; conformidad: string;
  cerebro: string; k: number; passK: number; nIds: number; ok: number; total: number;
  violaciones: number; costeConv: number; latP50: number | null; checked: string;
};

// El nombre de fichero y el id de modelo los controla el submitter y acaban en celdas de la tabla:
// sin sanear, un payload con | o ` inyecta filas/columnas falsas (markdown injection) — más barato
// que forjar un sello. Se quitan los metacaracteres de tabla y se capa la longitud.
const celda = (s: unknown, max = 48) => String(s).replace(/[|`\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const entradas: Entrada[] = [];
const rechazadas: { nombre: string; motivo: string }[] = [];
const omitidasDry: string[] = [];

const dir = flags.dir!;
const ficheros = existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".checked.json")).sort()
  : [];

for (const f of ficheros) {
  const path = join(dir, f);
  const nombre = basename(f, ".json");
  const v = validar(path);
  if (v.errores.length) { rechazadas.push({ nombre, motivo: v.errores[0] }); continue; }
  if (v.dry && !flags.dry) { omitidasDry.push(nombre); continue; }
  const m = v.informe.manifiesto, rs = v.informe.resultados;
  const pass = passPorEscenario(rs);

  // ✓ solo con sello REPRODUCED ligado por sha256 a ESTOS bytes: cambiar el informe invalida el ✓
  let checked = "—";
  const stampPath = path.replace(/\.json$/, ".checked.json");
  if (existsSync(stampPath)) {
    try {
      const s = JSON.parse(readFileSync(stampPath, "utf8"));
      const sha = createHash("sha256").update(readFileSync(path)).digest("hex");
      if (s.report_sha256 !== sha) checked = "⚠ stale stamp";
      else if (s.veredicto === "REPRODUCED") checked = `✓ (seed ${s.seed}, ${Math.round(s.tasa * 100)}%)`;
      else checked = "✗ DIVERGENT";
    } catch { checked = "⚠ stamp ilegible"; }
  }

  // latencia p50 sobre todos los turnos del run; informes anteriores a Stage 4 no la traen → "—"
  const lats = rs.flatMap((r: any) => (Array.isArray(r.latenciasMs) ? r.latenciasMs : [])).filter((x: any) => Number.isFinite(x)).sort((a: number, b: number) => a - b);
  entradas.push({
    nombre: celda(v.dry ? `${nombre} · DRY (plumbing)` : nombre),
    dry: v.dry, split: v.split, dominio: celda(v.dominio, 24), version: celda(m.dataset.version, 16), digest: m.dataset.digest,
    conformidad: m.conformidad, cerebro: celda(m.modelos.cerebro), k: Number(m.dataset.k),
    passK: [...pass.values()].filter(Boolean).length, nIds: pass.size,
    ok: rs.filter((r: any) => r.exito).length, total: rs.length,
    violaciones: rs.reduce((n: number, r: any) => n + (r.violaciones?.length ?? 0), 0),
    costeConv: v.costePorConv, latP50: lats.length ? lats[Math.floor(lats.length / 2)] : null, checked,
  });
}

// grupos (dominio, version, digest, split): scores de datasets distintos JAMÁS en la misma tabla —
// y un dominio no compite contra otro (no hay score compuesto: docs/DOMAINS.md).
// hidden primero: es el board oficial; public es iteración.
const clave = (e: Entrada) => `${e.split}|${e.dominio}|v${e.version}|${e.digest}`;
const grupos = new Map<string, Entrada[]>();
for (const e of entradas) grupos.set(clave(e), [...(grupos.get(clave(e)) ?? []), e]);
const ordenGrupos = [...grupos.keys()].sort((a, b) => (a.split("|")[0] === "hidden" ? 0 : 1) - (b.split("|")[0] === "hidden" ? 0 : 1) || a.localeCompare(b));

const tabla = (es: Entrada[]) => {
  const filas = [...es].sort((a, b) => b.passK / b.nIds - a.passK / a.nIds || b.ok / b.total - a.ok / a.total || a.costeConv - b.costeConv);
  return [
    "| # | Entrant | Brain | k | pass^k | Success | Violations | $/conv | p50 lat | Checked |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...filas.map((e, i) =>
      `| ${i + 1} | **${e.nombre}** | \`${e.cerebro}\` | ${e.k} | ${e.passK}/${e.nIds} (${pct(e.passK, e.nIds)}) | ${e.ok}/${e.total} (${pct(e.ok, e.total)}) | ${e.violaciones === 0 ? "0 ✅" : `${e.violaciones} ❌`} | $${e.costeConv.toFixed(3)} | ${e.latP50 == null ? "—" : `${(e.latP50 / 1000).toFixed(1)}s`} | ${e.checked} |`),
  ].join("\n");
};

const seccionGrupo = (k: string, es: Entrada[]) => {
  const [split, dominio, version, digest] = k.split("|");
  const titulo = split === "hidden"
    ? `## Official board — domain **${dominio}** · dataset ${version} · digest \`${digest}\` · hidden split`
    : `## Iteration results — domain **${dominio}** · dataset ${version} · digest \`${digest}\` · public split (not official: for development and debugging)`;
  // El board OFICIAL solo lista entradas con ✓ del árbitro: en un checkout sin scenarios-hidden/ la
  // validación de un run "hidden" solo pudo cotejar digest y tamaño contra el compromiso, así que sin
  // re-corrida del mantenedor una entrada oculta no rankea — se lista como pendiente, no se descarta.
  const rankeables = split === "hidden" ? es.filter((e) => e.checked.startsWith("✓")) : es;
  const pendientes = split === "hidden" ? es.filter((e) => !e.checked.startsWith("✓")) : [];
  const divisiones = ["Closed", "Open"].map((d) => {
    const dentro = rankeables.filter((e) => e.conformidad === d);
    if (!dentro.length) return null;
    const nota = d === "Closed"
      ? "fixed buyer, policy and toolset — the apples-to-apples number"
      : "bring your own scaffolding (webhook protocol) — the frontier, reported separately";
    return `### ${d} division (${nota})\n\n${tabla(dentro)}`;
  }).filter(Boolean).join("\n\n");
  const colaPendiente = pendientes.length
    ? `\n\n**Pending verification** (a hidden-split score only enters the official board after a maintainer's seeded re-run):\n${pendientes.map((e) => `- **${e.nombre}** — ${e.checked === "—" ? "awaiting re-run" : e.checked}`).join("\n")}`
    : "";
  return `${titulo}\n\n${divisiones || "_No verified entries yet._"}${colaPendiente}`;
};

const cuerpo = ordenGrupos.length
  ? ordenGrupos.map((k) => seccionGrupo(k, grupos.get(k)!)).join("\n\n")
  : "_No entries yet — be the first: [docs/SUBMISSIONS.md](docs/SUBMISSIONS.md)._";

const md = `# CloseBench Leaderboard

> Regenerated with \`npm run leaderboard\` from [\`submissions/\`](submissions/) — how to submit: [docs/SUBMISSIONS.md](docs/SUBMISSIONS.md).
> Headline metric is **pass^k** (reliability across k runs), never best-of-k. Violations are automatic scenario fails — the compliance gate is inside the number, not next to it.
> **✓ Checked** = a maintainer re-ran a seeded subset and the outcomes reproduced; the seed is published, the stamp is sha-bound to the report. Scores are only comparable within one domain + dataset version + digest + split: tables never mix them, and there is no cross-domain composite score ([docs/DOMAINS.md](docs/DOMAINS.md)). **p50 lat** = median agent response time per turn, when the report carries it.

_Last regenerated: ${stamp()}._

${cuerpo}
${!ordenGrupos.some((k) => k.startsWith("hidden")) && ordenGrupos.length ? "\n> No official (hidden-split) entries yet. Hidden-split runs are executed by maintainers; the split's commitment lives in [`scenarios-hidden.sha256`](scenarios-hidden.sha256)." : ""}
${omitidasDry.length ? `\n### Excluded dry runs\n\n${omitidasDry.map((n) => `- ${n} — plumbing run, measures the harness, not an agent`).join("\n")}` : ""}
${rechazadas.length ? `\n### Rejected submissions\n\n${rechazadas.map((r) => `- **${r.nombre}** — ${r.motivo}`).join("\n")}` : ""}
`;

writeFileSync(flags.out!, md);
console.log(md);
console.log(`📄 ${flags.out} · ${entradas.length} entrada(s), ${omitidasDry.length} dry omitida(s), ${rechazadas.length} rechazada(s)`);
