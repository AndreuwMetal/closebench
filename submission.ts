// submission.ts — Stage 3: validación y verificación de submissions, y sellado del split oculto.
// Una submission ES el JSON que emite una corrida ({ manifiesto, resultados }): el manifiesto pinnea
// la configuración y cada resultado lleva su transcripción generada DURANTE la inferencia (el harness
// graba la conversación mientras ocurre; una trayectoria post-hoc es estructuralmente imposible).
// Aquí no se confía en nada de eso: se comprueba, y lo que no cuadra se rechaza con motivo.
//
// Uso:  node submission.ts validate <report.json>                        → estructura, digest, coste
//       node submission.ts verify <report.json> [--seed 7] [--frac 0.2] [--umbral 0.8]
//                                          → re-corre un subconjunto sembrado y compara outcomes
//       node submission.ts seal-hidden     → escribe scenarios-hidden.sha256 (compromiso público)
//       node submission.ts selftest        → E2E contra un dry run: gratis, sin claves, determinista
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, rmSync, mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { graves } from "./lib/policy.ts";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { cargarDataset, compromisoHidden, compromisoDe, DOMINIOS, DOMINIO_DEFECTO, RAIZ, type Split } from "./lib/dataset.ts";
import { costeUSD, sumarUso, USO_CERO, type Uso } from "./lib/llm.ts";
import { stamp, passPorEscenario } from "./lib/util.ts";

export type Validacion = {
  informe: { manifiesto: any; resultados: any[] };
  errores: string[]; avisos: string[];
  dry: boolean; split: Split; dominio: string; costePorConv: number;
};

// ── validate: lo que un informe tiene que demostrar antes de llamarse submission ──
export function validar(path: string): Validacion {
  const errores: string[] = [], avisos: string[] = [];
  const nada: Validacion = { informe: { manifiesto: {}, resultados: [] }, errores, avisos, dry: false, split: "public", dominio: DOMINIO_DEFECTO, costePorConv: 0 };
  let informe: any;
  try { informe = JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { errores.push(`no se pudo leer/parsear ${path}: ${(e as Error).message}`); return nada; }
  const m = informe?.manifiesto, rs = informe?.resultados;
  if (!m || !Array.isArray(rs) || !rs.length) { errores.push("el informe no tiene la forma { manifiesto, resultados[] }"); return nada; }

  // 1) manifiesto completo — un score sin su configuración entera es una captura de pantalla
  const req: [string, any][] = [
    ["dataset.version", m.dataset?.version], ["dataset.digest", m.dataset?.digest], ["dataset.k", m.dataset?.k],
    ["protocolo", m.protocolo], ["conformidad", m.conformidad],
    ["sut.cmd", m.sut?.cmd], ["sut.prompt", m.sut?.prompt],
    ["modelos.cerebro", m.modelos?.cerebro], ["modelos.comprador", m.modelos?.comprador], ["modelos.juez", m.modelos?.juez],
    ["harness.git", m.harness?.git], ["harness.node", m.harness?.node],
  ];
  for (const [campo, v] of req) if (v == null || v === "") errores.push(`manifiesto incompleto: falta ${campo}`);

  const split: Split = m.dataset?.split ?? "public";
  if (!m.dataset?.split) avisos.push("manifiesto antiguo sin dataset.split: asumo public");
  if (!["public", "hidden"].includes(split)) errores.push(`dataset.split inválido: "${split}" (public | hidden)`);
  // el dominio tampoco lo elige el submitter a posteriori: el digest se coteja contra el dataset de
  // ESE dominio, así que re-etiquetar un run de realestate como "saas" muere aquí, no en el board.
  const dominio: string = m.dataset?.domain ?? DOMINIO_DEFECTO;
  if (!m.dataset?.domain) avisos.push(`manifiesto antiguo sin dataset.domain: asumo ${DOMINIO_DEFECTO}`);
  if (!DOMINIOS[dominio]) errores.push(`dataset.domain desconocido: "${dominio}" (${Object.keys(DOMINIOS).join(" | ")})`);
  // la división NO la elige el submitter: se deriva del protocolo (http = Closed, webhook = Open).
  // Sin este cotejo, un run webhook se autodeclararía "Closed" y posaría en la tabla comparable.
  const confEsperada = m.protocolo === "http" ? "Closed" : m.protocolo === "webhook" ? "Open" : null;
  if (m.protocolo && !confEsperada) errores.push(`protocolo desconocido: "${m.protocolo}" (webhook | http)`);
  if (confEsperada && m.conformidad !== confEsperada) errores.push(`conformidad "${m.conformidad}" no corresponde al protocolo ${m.protocolo} (debe ser ${confEsperada})`);
  const dry: boolean = m.dry ?? (m.modelos?.comprador === "(guion)");
  if (dry) avisos.push("run DRY (fontanería): vale para probar el flujo de submission, EXCLUIDO del leaderboard");

  // 2) trayectorias obligatorias + ninguna corrida muerta. Sin transcripción no hay nada que verificar;
  //    y una conversación que murió por error técnico nunca fue juzgada: "0 violaciones" ahí no es un aprobado.
  let sinTranscript = 0, conError = 0;
  const malformados: string[] = [];
  for (const r of rs) {
    if (!Array.isArray(r.transcript) || !r.transcript.length || r.transcript.some((t: any) => !t?.quien || !t?.texto)) sinTranscript++;
    if (r.error) conError++;
    if (typeof r.exito !== "boolean" || !Array.isArray(r.violaciones) || !r.id || !r.run) malformados.push(`${r.id ?? "?"} r${r.run ?? "?"}`);
  }
  if (sinTranscript) errores.push(`${sinTranscript} corrida(s) sin transcripción: las trayectorias son obligatorias (se generan con la inferencia; sin ellas la verificación es imposible)`);
  if (conError) errores.push(`${conError} corrida(s) con error técnico: run incompleto, NO CITABLE (esas conversaciones nunca llegaron al juez)`);
  if (malformados.length) errores.push(`${malformados.length} resultado(s) malformado(s) (id/run/exito/violaciones): ${malformados.slice(0, 3).join(", ")}`);

  // 3) k consistente: entero ≥ 1 y exactamente k corridas por escenario. Un "k=8" con 3 corridas es
  //    un informe dopado; y un k=0 o NaN apagaría este chequeo entero (20 corridas del escenario
  //    fácil, 1 del resto = cherry-picking dentro de un set "cubierto").
  const k = Number(m.dataset?.k);
  if (!Number.isInteger(k) || k < 1) errores.push(`dataset.k inválido (${JSON.stringify(m.dataset?.k)}): debe ser un entero ≥ 1`);
  const porId = new Map<string, number>();
  for (const r of rs) porId.set(r.id, (porId.get(r.id) ?? 0) + 1);
  const malK = [...porId.entries()].filter(([, n]) => n !== k);
  if (k >= 1 && malK.length) errores.push(`k declarado ${k} pero ${malK.length} escenario(s) no tienen exactamente k corridas (p.ej. ${malK[0][0]}: ${malK[0][1]})`);
  if (Number.isInteger(k) && k >= 1 && k < 8 && !dry) avisos.push(`k=${k} < 8: score no elegible para cabecera (la métrica del board es pass^8)`);

  // 4) digest contra ESTE checkout + cobertura COMPLETA del split. Un score citable corre el examen
  //    entero: sin esto, un informe de `--solo calientes` (5 escenarios fáciles) luciría un pass^k
  //    perfecto en el board. --solo es para depurar, no para presumir. Para el split oculto sin
  //    tenerlo en local, vale el compromiso publicado (scenarios-hidden.sha256): digest + tamaño.
  let esperado: { digest: string; version: string | null; ids: string[] | null; n: number } | null = null;
  if (DOMINIOS[dominio]) {
    try { const d = cargarDataset(split, dominio); esperado = { digest: d.digest, version: d.version, ids: d.escenarios.map((e) => e.id), n: d.escenarios.length }; }
    // sin el split oculto en local vale su compromiso publicado (por dominio: compromisoDe)
    catch { const c = split === "hidden" ? compromisoHidden(dominio) : null; if (c) esperado = { digest: c.digest, version: null, ids: null, n: c.escenarios }; }
  }
  if (!esperado) errores.push(split === "hidden"
    ? `no puedo comprobar el split oculto del dominio ${dominio}: ni su scenarios-hidden/ ni un compromiso publicado en este checkout`
    : `no puedo recalcular el digest del split public del dominio ${dominio} en este checkout`);
  else {
    if (m.dataset?.digest && m.dataset.digest !== esperado.digest)
      errores.push(`digest del dataset no coincide: informe ${m.dataset.digest} ≠ checkout ${esperado.digest} (dominio ${dominio}) — score no comparable con este dataset`);
    if (esperado.version && m.dataset?.version && String(m.dataset.version) !== esperado.version)
      errores.push(`versión del dataset no coincide: informe ${m.dataset.version} ≠ ${esperado.version} (dominio ${dominio})`);
    if (!dry) {
      const idsInforme = new Set(rs.map((r: any) => r.id as string));
      if (esperado.ids) {
        const faltan = esperado.ids.filter((id) => !idsInforme.has(id));
        if (faltan.length) errores.push(`informe parcial: faltan ${faltan.length}/${esperado.n} escenarios del split ${split} (p.ej. ${faltan.slice(0, 3).join(", ")}) — un score citable corre el examen entero`);
        const propios = new Set(esperado.ids);
        const ajenos = [...idsInforme].filter((id) => !propios.has(id));
        if (ajenos.length) errores.push(`informe con escenarios ajenos al split ${split}: ${ajenos.slice(0, 3).join(", ")}`);
      } else if (idsInforme.size !== esperado.n) {
        errores.push(`informe parcial: cubre ${idsInforme.size}/${esperado.n} escenarios del split hidden (según el compromiso) — un score citable corre el examen entero`);
      }
    }
  }

  // 5) juez ≠ cerebro (autopreferencia: MEMORY.md exige juez distinto del vendedor)
  if (!dry && m.modelos?.juez && m.modelos?.cerebro && String(m.modelos.juez) === String(m.modelos.cerebro))
    avisos.push(`juez y cerebro son el mismo modelo (${m.modelos.juez}): sesgo de autopreferencia`);

  // 6) latencia: AUTOREPORTADA y dependiente del entorno del submitter. verify NO la re-corre — una
  //    re-corrida mediría la máquina del árbitro, no la del submitter — así que el ✓ no la cubre
  //    (límite declarado en SUBMISSIONS.md). Aquí solo se caza lo físicamente implausible.
  const lats = rs.flatMap((r: any) => (Array.isArray(r.latenciasMs) ? r.latenciasMs : [])).filter((x: any) => Number.isFinite(x) && x >= 0);
  if (!dry && lats.length) {
    const p50 = [...lats].sort((a: number, b: number) => a - b)[Math.floor(lats.length / 2)];
    if (p50 < 100) avisos.push(`latencia p50 implausible (${p50} ms/turno de LLM): la latencia es autoreportada y el ✓ de verificación no la cubre — revísala en el PR`);
  }

  // 7) divulgación de coste: $/conversación desde tokens reales
  const uso = rs.reduce((a: Uso, r: any) => sumarUso(a, r.usoCerebro ?? USO_CERO), { ...USO_CERO });
  const coste = costeUSD(m.modelos?.cerebro ?? "?", uso);
  const costePorConv = rs.length ? coste / rs.length : 0;
  if (!dry && !uso.entrada && !uso.salida) avisos.push("sin uso de tokens registrado: divulgación de coste vacía");
  else if (!dry && coste === 0) avisos.push(`modelo sin tarifa en PRECIOS (${m.modelos?.cerebro}): el coste reportado será $0 — divulgación incompleta`);

  return { informe, errores, avisos, dry, split, dominio, costePorConv };
}

// ── verify: la re-corrida del árbitro ──

// PRNG sembrado (mulberry32): con la semilla publicada, cualquiera puede reconstruir el subconjunto.
// Ni el submitter elige qué se re-corre, ni el árbitro puede hacer cherry-picking sin que se note.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ~frac de los escenarios (mínimo 3), sembrado sobre los ids ORDENADOS: determinista y auditable.
export function subconjunto(ids: string[], seed: number, frac: number): string[] {
  const orden = [...ids].sort();
  const rng = mulberry32(seed);
  for (let i = orden.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [orden[i], orden[j]] = [orden[j], orden[i]]; }
  return orden.slice(0, Math.min(orden.length, Math.max(3, Math.ceil(frac * orden.length)))).sort();
}

export type Verificacion = {
  seed: number; fraccion: number; umbral: number; escenarios: string[];
  detalle: { id: string; claimed: { pass: boolean; viol: boolean }; rerun: { pass: boolean; viol: boolean }; ok: boolean }[];
  tasa: number; veredicto: "REPRODUCED" | "DIVERGENT"; stampPath: string;
};

export async function verificar(path: string, opts: { seed?: number; frac?: number; umbral?: number } = {}): Promise<Verificacion> {
  const seed = opts.seed ?? 7, frac = opts.frac ?? 0.2, umbral = opts.umbral ?? 0.8;
  const v = validar(path);
  if (v.errores.length) throw new Error(`la submission no valida, no hay nada que verificar:\n- ${v.errores.join("\n- ")}`);
  const m = v.informe.manifiesto;
  const ids = [...new Set(v.informe.resultados.map((r: any) => r.id as string))].sort();
  const sel = subconjunto(ids, seed, frac);

  // re-corre SOLO el subconjunto, con la config pinneada del manifiesto (split, protocolo, prompt, k, SUT)
  const scratch = mkdtempSync(join(tmpdir(), "closebench-verify-"));
  const argsBench = ["closebench.ts", "--solo", sel.join(","), "--k", String(m.dataset.k), "--protocol", m.protocolo,
    "--split", v.split, "--domain", v.dominio, "--prompt", m.sut.prompt, "--concurrencia", "2", "--out", scratch];
  if (v.dry) argsBench.push("--dry");
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!v.dry) {
    // ponytail: mapeo heurístico cerebro→flag (glm|opus); ampliar cuando el bench acepte más cerebros
    if (/opus|anthropic\//i.test(String(m.modelos.cerebro))) { argsBench.push("--brain", "opus"); env.OPUS_BRAIN_MODEL = m.modelos.cerebro; }
    else { argsBench.push("--brain", "glm"); env.GLM_MODEL = m.modelos.cerebro; }
  }
  if (m.sut.cmd && !String(m.sut.cmd).startsWith("(por defecto)")) env.SUT_CMD = m.sut.cmd; else delete env.SUT_CMD;

  console.log(`→ re-corriendo ${sel.length}/${ids.length} escenarios (seed ${seed}): ${sel.join(", ")}`);
  const res = spawnSync(process.execPath, argsBench, { cwd: RAIZ, env, stdio: "inherit" });
  if (res.status !== 0) throw new Error(`la re-corrida falló (exit ${res.status}) — sin re-corrida no hay verificación`);
  const jsonRerun = readdirSync(scratch).find((f) => f.startsWith("closebench-") && f.endsWith(".json"));
  if (!jsonRerun) throw new Error("la re-corrida no dejó informe JSON");
  const rerun = JSON.parse(readFileSync(join(scratch, jsonRerun), "utf8"));

  // Comparación a nivel de OUTCOME por escenario: pass^k y presencia de violaciones. Comprador y juez
  // llevan temperatura: exigir igualdad token a token sería teatro; igualdad de outcomes no lo es.
  const passClaimed = passPorEscenario(v.informe.resultados.filter((r: any) => sel.includes(r.id)));
  const passRerun = passPorEscenario(rerun.resultados);
  const violDe = (rs: any[], id: string) => rs.filter((r) => r.id === id).some((r) => graves(r.violaciones).length > 0);
  const detalle = sel.map((id) => {
    const claimed = { pass: passClaimed.get(id) ?? false, viol: violDe(v.informe.resultados, id) };
    const re = { pass: passRerun.get(id) ?? false, viol: violDe(rerun.resultados, id) };
    return { id, claimed, rerun: re, ok: claimed.pass === re.pass && claimed.viol === re.viol };
  });
  const tasa = detalle.filter((d) => d.ok).length / detalle.length;
  const veredicto = tasa >= umbral ? ("REPRODUCED" as const) : ("DIVERGENT" as const);

  // El sello queda ligado a los BYTES exactos del informe: cambiar el informe después invalida el ✓.
  const stampPath = path.replace(/\.json$/, ".checked.json");
  const gitSha = (() => {
    try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { return "desconocido"; }
  })();
  writeFileSync(stampPath, JSON.stringify({
    fecha: stamp(), seed, fraccion: frac, umbral, escenarios: sel, detalle, tasa, veredicto,
    report_sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    dataset: { version: m.dataset.version, digest: m.dataset.digest, split: v.split },
    harness_git: gitSha,
  }, null, 2));
  rmSync(scratch, { recursive: true, force: true });
  return { seed, fraccion: frac, umbral, escenarios: sel, detalle, tasa, veredicto, stampPath };
}

// ── seal-hidden: compromiso público del split oculto ──
// Publica el digest SIN publicar los escenarios: cuando salga un score oficial, cualquiera puede
// comprobar que el set estaba fijado desde esta fecha y no se retocó después de ver submissions.
export function sellarHidden(dominio = DOMINIO_DEFECTO): string {
  const { escenarios, digest, version } = cargarDataset("hidden", dominio);
  writeFileSync(compromisoDe(dominio), `# Compromiso del split oculto de CloseBench: prueba que el set estaba fijado en esta fecha, sin publicarlo.
# Mismo algoritmo que el split público (lib/dataset.ts): sha256 sobre scenarios-hidden/*.json (orden alfabético) + offer.json, primeros 12 hex.
dominio: ${dominio}
version: ${version}
digest: ${digest}
escenarios: ${escenarios.length}
sellado: ${stamp()}
`);
  return digest;
}

// ── selftest: el chequeo ejecutable de TODA la maquinaria Stage 3, gratis (dry) ──
async function selftest() {
  const assert = (cond: any, msg: string) => {
    if (!cond) { console.error(`❌ selftest: FALLO — ${msg}`); process.exit(1); }
    console.log(`  ✓ ${msg}`);
  };
  const scratch = mkdtempSync(join(tmpdir(), "closebench-selftest-"));
  console.log(`selftest Stage 3 (scratch: ${scratch})`);

  console.log("\n[1/7] dry run → informe");
  const run = spawnSync(process.execPath, ["closebench.ts", "--dry", "--concurrencia", "2", "--out", join(scratch, "run")], { cwd: RAIZ, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  if (run.status !== 0) { console.error(run.stdout); console.error("❌ selftest: el dry run falló"); process.exit(1); }
  const jsonRun = readdirSync(join(scratch, "run")).find((f) => f.startsWith("closebench-") && f.endsWith(".json"))!;
  const dirSub = join(scratch, "submissions");
  mkdirSync(dirSub, { recursive: true });
  const sub = join(dirSub, "dry-selftest.json");
  copyFileSync(join(scratch, "run", jsonRun), sub);

  console.log("\n[2/7] validate acepta un informe honesto");
  const v = validar(sub);
  assert(!v.errores.length, `informe limpio valida (errores: ${v.errores.join("; ") || "ninguno"})`);
  assert(v.dry, "detecta que es dry");

  console.log("\n[3/7] validate rechaza informes dopados");
  const base = JSON.parse(readFileSync(sub, "utf8"));
  const dopar = (nombre: string, mut: (j: any) => void) => {
    const j = structuredClone(base); mut(j);
    const p = join(scratch, `${nombre}.json`); writeFileSync(p, JSON.stringify(j));
    return validar(p);
  };
  assert(dopar("sin-transcript", (j) => { j.resultados[0].transcript = []; }).errores.length, "rechaza transcripción vaciada");
  assert(dopar("digest-falso", (j) => { j.manifiesto.dataset.digest = "000000000000"; }).errores.length, "rechaza digest de otro dataset");
  assert(dopar("k-inflado", (j) => { j.manifiesto.dataset.k = 8; }).errores.length, "rechaza k declarado sin sus corridas");
  assert(dopar("con-error", (j) => { j.resultados[0].error = "boom"; }).errores.length, "rechaza corridas con error técnico");
  // un dry re-etiquetado como real es también un informe PARCIAL (5 ids sintéticos ≠ los 52 del split): doble red
  assert(dopar("dry-como-real", (j) => { j.manifiesto.dry = false; j.manifiesto.modelos.comprador = "claude-sonnet-5"; j.manifiesto.modelos.juez = "claude-opus-4-8"; }).errores.length, "rechaza un dry re-etiquetado como real (cobertura parcial + ids ajenos)");
  assert(dopar("k-cero", (j) => { j.manifiesto.dataset.k = 0; }).errores.length, "rechaza k=0 (apagaría el chequeo de corridas por escenario)");
  assert(dopar("division-falsa", (j) => { j.manifiesto.conformidad = "Closed"; }).errores.length, "rechaza una división que no corresponde al protocolo");
  // Stage 4: el dominio tampoco es re-etiquetable — el digest se coteja contra el dataset de ESE dominio
  assert(dopar("dominio-cruzado", (j) => { j.manifiesto.dataset.domain = "saas"; }).errores.length, "rechaza un informe re-etiquetado a otro dominio (digest de otro dataset)");
  assert(dopar("dominio-desconocido", (j) => { j.manifiesto.dataset.domain = "inventado"; }).errores.length, "rechaza un dominio que no existe");
  // la latencia es autoreportada (el ✓ no la cubre): lo único mecánico es cazar lo físicamente implausible
  assert(dopar("latencia-fabricada", (j) => { j.manifiesto.dry = false; j.manifiesto.modelos.comprador = "claude-sonnet-5"; for (const r of j.resultados) r.latenciasMs = [1, 1, 1]; }).avisos.some((a) => a.includes("latencia")), "avisa de una latencia p50 implausible (<100 ms/turno)");

  console.log("\n[4/7] verify reproduce un dry determinista al 100%");
  const ver = await verificar(sub, { seed: 42 });
  assert(ver.veredicto === "REPRODUCED" && ver.tasa === 1, `dry reproduce al 100% (tasa ${ver.tasa})`);

  console.log("\n[5/7] verify detecta un score inflado");
  const dirTramposo = join(scratch, "tramposo");
  mkdirSync(dirTramposo, { recursive: true });
  const idsTodos = [...new Set(base.resultados.map((r: any) => r.id as string))].sort();
  const objetivo = subconjunto(idsTodos, 42, 0.2);
  const inflado = structuredClone(base);
  for (const r of inflado.resultados) if (objetivo.includes(r.id)) r.exito = !r.exito;
  const pInflado = join(dirTramposo, "inflado.json");
  writeFileSync(pInflado, JSON.stringify(inflado));
  const ver2 = await verificar(pInflado, { seed: 42 });
  assert(ver2.veredicto === "DIVERGENT", `score inflado diverge (tasa ${ver2.tasa})`);

  console.log("\n[6/7] leaderboard genera el board y marca la entrada verificada");
  const lb = join(scratch, "LEADERBOARD.md");
  const gen = spawnSync(process.execPath, ["leaderboard.ts", "--dir", dirSub, "--out", lb, "--dry"], { cwd: RAIZ, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  if (gen.status !== 0) { console.error(gen.stdout); console.error("❌ selftest: leaderboard falló"); process.exit(1); }
  const board = readFileSync(lb, "utf8");
  assert(board.includes("dry-selftest"), "el board lista la entrada");
  assert(board.includes("✓"), "la entrada verificada lleva su ✓ Checked");

  console.log("\n[7/7] leaderboard sanea texto del submitter (markdown injection)");
  const iny = structuredClone(base);
  iny.manifiesto.modelos.cerebro = "x` | **h4x** | 1 | 99/99 (100%) | ✓ FORGED |";
  writeFileSync(join(dirSub, "inyectado.json"), JSON.stringify(iny));
  const lb2 = join(scratch, "LEADERBOARD-iny.md");
  const gen2 = spawnSync(process.execPath, ["leaderboard.ts", "--dir", dirSub, "--out", lb2, "--dry"], { cwd: RAIZ, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  if (gen2.status !== 0) { console.error(gen2.stdout); console.error("❌ selftest: leaderboard (inyección) falló"); process.exit(1); }
  const board2 = readFileSync(lb2, "utf8");
  assert(!board2.includes("| **h4x** |") && !board2.includes("✓ FORGED |"), "un payload con | y ` no inyecta filas en la tabla");

  rmSync(scratch, { recursive: true, force: true });
  console.log("\n✅ selftest Stage 3 OK: validate acepta lo honesto y rechaza lo dopado; verify reproduce lo real y caza lo inflado; el board marca ✓ solo lo verificado y sanea lo inyectado.");
}

// ── CLI (con guardia: leaderboard.ts importa validar() de aquí sin disparar nada) ──
// realpath por si se invoca vía symlink: argv[1] conserva el enlace, import.meta.filename no.
const esCli = (() => { try { return realpathSync(process.argv[1] ?? "") === import.meta.filename; } catch { return false; } })();
if (esCli) {
  const { values: flags, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      seed: { type: "string", default: "7" },
      frac: { type: "string", default: "0.2" },
      umbral: { type: "string", default: "0.8" },
      domain: { type: "string", default: DOMINIO_DEFECTO }, // solo seal-hidden: validate/verify lo leen del manifiesto
    },
  });
  const [cmd, objetivo] = positionals;
  if (cmd === "validate" && objetivo) {
    const v = validar(objetivo);
    const m = v.informe.manifiesto;
    if (m?.dataset) console.log(`📋 ${objetivo} — ${v.informe.resultados.length} corridas · k=${m.dataset.k} · split ${v.split} · dataset v${m.dataset.version} ${m.dataset.digest}\n   cerebro ${m.modelos?.cerebro} · comprador ${m.modelos?.comprador} · juez ${m.modelos?.juez} · $${v.costePorConv.toFixed(3)}/conv`);
    for (const a of v.avisos) console.log(`⚠️  ${a}`);
    for (const e of v.errores) console.error(`❌ ${e}`);
    console.log(v.errores.length ? "→ RECHAZADA" : "→ VÁLIDA");
    process.exit(v.errores.length ? 1 : 0);
  } else if (cmd === "verify" && objetivo) {
    const ver = await verificar(objetivo, { seed: Number(flags.seed), frac: Number(flags.frac), umbral: Number(flags.umbral) });
    console.log(`\n| escenario | claimed | re-run | ok |\n|---|---|---|---|`);
    for (const d of ver.detalle) console.log(`| ${d.id} | pass=${d.claimed.pass} viol=${d.claimed.viol} | pass=${d.rerun.pass} viol=${d.rerun.viol} | ${d.ok ? "✓" : "✗"} |`);
    console.log(`\n${ver.veredicto === "REPRODUCED" ? "✅ REPRODUCED" : "❌ DIVERGENT"} — tasa ${(ver.tasa * 100).toFixed(0)}% (umbral ${(ver.umbral * 100).toFixed(0)}%) · sello: ${ver.stampPath}`);
    if (ver.veredicto === "DIVERGENT") console.log("La entrada queda RETENIDA: contacta al submitter (nunca se descarta en silencio). GOVERNANCE.md.");
    process.exit(ver.veredicto === "DIVERGENT" ? 1 : 0);
  } else if (cmd === "seal-hidden") {
    const digest = sellarHidden(flags.domain);
    console.log(`🔏 compromiso escrito en ${compromisoDe(flags.domain)} (digest ${digest}). Commitea ESTE fichero; scenarios-hidden/ jamás.`);
  } else if (cmd === "selftest") {
    await selftest();
  } else {
    console.error("Uso: node submission.ts validate <report.json> | verify <report.json> [--seed N] [--frac 0.2] [--umbral 0.8] | seal-hidden [--domain d] | selftest");
    process.exit(1);
  }
}
