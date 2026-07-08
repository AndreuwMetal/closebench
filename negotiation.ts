// Fase 3 — bench públicos: negociación bilateral con valores privados (protocolo de PACT,
// escenario comprador-vendedor 1:1 de AgenticPay). GLM-5.2 vs rival (Opus por API nativa Anthropic),
// jugando ambos roles. Métricas: acuerdos en ZOPA, reparto del excedente, retiradas correctas
// sin ZOPA, acuerdos ruinosos, movimientos inválidos, coste.
//
// Uso:  npm run bench:publicos            (necesita ZAI_API_KEY y ANTHROPIC_API_KEY)
//       npm run bench:publicos:dry        (sin claves ni tokens: jugadores guionizados)
//       node eval/bench-publicos.ts --rondas 12 --solo 3
import { parseArgs } from "node:util";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chatOpenAI, chatClaude, costeUSD, sumarUso, USO_CERO, type Uso } from "./lib/llm.ts";
import { pool, extraerJSON, stamp, eur, pct } from "./lib/util.ts";

const ENV_PATH = join(import.meta.dirname, ".env"); if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
const { values: args } = parseArgs({
  options: {
    dry: { type: "boolean", default: false },
    rondas: { type: "string", default: "20" },
    solo: { type: "string" },
    concurrencia: { type: "string", default: "4" },
  },
});
const RONDAS_MAX = Number(args.rondas);

// 10 configuraciones {coste del vendedor, valor del comprador}. ZOPA = valor > coste.
const CONFIGS = [
  { coste: 3000, valor: 6000 }, // ZOPA ancha
  { coste: 2000, valor: 8000 }, // ZOPA ancha
  { coste: 4500, valor: 5000 }, // ZOPA estrecha
  { coste: 4900, valor: 5100 }, // ZOPA mínima
  { coste: 3500, valor: 4200 },
  { coste: 2500, valor: 5500 },
  { coste: 5200, valor: 4800 }, // sin ZOPA → lo correcto es retirarse
  { coste: 5500, valor: 5000 }, // sin ZOPA
  { coste: 6000, valor: 5500 }, // sin ZOPA
  { coste: 7000, valor: 4000 }, // sin ZOPA clara
];

type Rol = "vendedor" | "comprador";
type Movimiento = { quien: Rol; accion: "oferta" | "aceptar" | "retirarse"; precio: number | null; mensaje: string };
type Jugador = (rol: Rol, privado: number, movimientos: Movimiento[], notaError?: string) => Promise<{ mov: any; uso: Uso }>;

const sistema = (rol: Rol, privado: number) =>
  rol === "vendedor"
    ? `Eres el VENDEDOR en una negociación por chat del precio de un servicio digital para pymes.
Tu coste mínimo aceptable es ${privado} € — información PRIVADA, no la reveles jamás.
Objetivo: cerrar al precio más ALTO posible, siempre por encima de ${privado} €. Cerrar por debajo es una pérdida: no lo aceptes nunca.
Si tras varias rondas ves imposible cerrar por encima de tu mínimo, retírate.
Responde SOLO con un JSON: {"accion":"oferta"|"aceptar"|"retirarse","precio":<número o null>,"mensaje":"<1-2 frases naturales de chat>"}
- "oferta": propones un precio (precio obligatorio). - "aceptar": cierras al ÚLTIMO precio que propuso el comprador. - "retirarse": fin sin acuerdo.`
    : `Eres el COMPRADOR en una negociación por chat del precio de un servicio digital para tu pyme.
El valor máximo que ese servicio tiene para ti es ${privado} € — información PRIVADA, no la reveles jamás.
Objetivo: cerrar al precio más BAJO posible, nunca por encima de ${privado} €. Pagar más de eso es tirar dinero: no lo aceptes nunca.
Si tras varias rondas ves imposible cerrar por debajo de tu máximo, retírate.
Responde SOLO con un JSON: {"accion":"oferta"|"aceptar"|"retirarse","precio":<número o null>,"mensaje":"<1-2 frases naturales de chat>"}
- "oferta": propones un precio (precio obligatorio). - "aceptar": cierras al ÚLTIMO precio que propuso el vendedor. - "retirarse": fin sin acuerdo.`;

const transcripcion = (movs: Movimiento[]) =>
  movs.map((m) => `${m.quien.toUpperCase()}: ${m.accion}${m.precio != null ? ` ${m.precio} €` : ""} — "${m.mensaje}"`).join("\n") ||
  "(aún no hay mensajes; tú abres la negociación)";

function jugadorLLM(baseUrl: string, apiKey: string, modelo: string): Jugador {
  const nativo = /^claude-/.test(modelo); // id nativo de Anthropic → API propia (chatClaude), sin OpenRouter
  let jsonMode = true; // si el proveedor OpenAI no soporta response_format, se degrada a extraerJSON
  return async (rol, privado, movimientos, notaError) => {
    const system = sistema(rol, privado);
    const user = `Negociación hasta ahora:\n${transcripcion(movimientos)}\n\n${notaError ? `⚠️ Tu respuesta anterior no era válida (${notaError}). ` : ""}Es tu turno. Responde solo el JSON.`;
    let r: { texto: string; uso: Uso };
    if (nativo) {
      r = await chatClaude({ modelo, system, mensajes: [{ role: "user", content: user }], maxTokens: 250 });
    } else {
      const mensajes = [{ role: "system" as const, content: system }, { role: "user" as const, content: user }];
      try {
        r = await chatOpenAI({ baseUrl, apiKey, modelo, json: jsonMode, maxTokens: 250, mensajes });
      } catch (e: any) {
        if (jsonMode && /format/i.test(e.message ?? "")) {
          jsonMode = false; // reintento sin json mode; extraerJSON se encarga
          r = await chatOpenAI({ baseUrl, apiKey, modelo, json: false, maxTokens: 250, mensajes });
        } else throw e;
      }
    }
    return { mov: extraerJSON(r.texto), uso: r.uso };
  };
}

// Jugador guionizado para --dry: valida protocolo, métricas y reporte sin gastar tokens.
function jugadorGuion(): Jugador {
  return async (rol, privado, movimientos) => {
    const propias = movimientos.filter((m) => m.quien === rol && m.precio != null).map((m) => m.precio!) ;
    const ajenas = movimientos.filter((m) => m.quien !== rol && m.precio != null).map((m) => m.precio!);
    const ultimaAjena = ajenas.at(-1);
    let mov: any;
    if (rol === "vendedor") {
      if (ultimaAjena != null && ultimaAjena >= privado * 1.05) mov = { accion: "aceptar", precio: null, mensaje: "Trato hecho." };
      else if (movimientos.length >= 8 && (ultimaAjena == null || ultimaAjena < privado)) mov = { accion: "retirarse", precio: null, mensaje: "Así no me salen los números, lo dejamos." };
      else mov = { accion: "oferta", precio: Math.round(Math.max(privado * 1.05, (propias.at(-1) ?? privado * 1.6) * 0.93)), mensaje: "Te lo puedo dejar en este precio." };
    } else {
      if (ultimaAjena != null && ultimaAjena <= privado * 0.95) mov = { accion: "aceptar", precio: null, mensaje: "Vale, me cuadra." };
      else if (movimientos.length >= 8 && (ultimaAjena == null || ultimaAjena > privado)) mov = { accion: "retirarse", precio: null, mensaje: "Se me va de presupuesto, lo dejamos." };
      else mov = { accion: "oferta", precio: Math.round(Math.min(privado * 0.95, (propias.at(-1) ?? privado * 0.6) * 1.08)), mensaje: "Mi presupuesto va por aquí." };
    }
    return { mov, uso: USO_CERO };
  };
}

type Resultado = {
  config: { coste: number; valor: number }; zopa: boolean;
  vendedor: string; comprador: string;
  movimientos: Movimiento[];
  precio: number | null;                 // precio de cierre (null = sin acuerdo)
  retiradoPor: Rol | null; invalidoDe: string | null;
  uso: Record<string, Uso>;
  error?: string;                        // la negociación reventó (no cuenta en métricas)
};

async function negociar(cfg: { coste: number; valor: number }, jugadores: Record<Rol, Jugador>, nombres: Record<Rol, string>): Promise<Resultado> {
  const movimientos: Movimiento[] = [];
  const uso: Record<string, Uso> = { [nombres.vendedor]: { ...USO_CERO }, [nombres.comprador]: { ...USO_CERO } };
  const res: Resultado = {
    config: cfg, zopa: cfg.valor > cfg.coste, vendedor: nombres.vendedor, comprador: nombres.comprador,
    movimientos, precio: null, retiradoPor: null, invalidoDe: null, uso,
  };
  let turno: Rol = "vendedor";
  for (let i = 0; i < RONDAS_MAX; i++) {
    const privado = turno === "vendedor" ? cfg.coste : cfg.valor;
    let nota: string | undefined;
    let mov: Movimiento | null = null;
    for (let intento = 0; intento < 2 && !mov; intento++) {
      const r = await jugadores[turno](turno, privado, movimientos, nota);
      uso[nombres[turno]] = sumarUso(uso[nombres[turno]], r.uso);
      const m = r.mov;
      const ultimaAjena = movimientos.filter((x) => x.quien !== turno && x.precio != null).at(-1);
      if (!m || !["oferta", "aceptar", "retirarse"].includes(m.accion)) nota = "JSON o accion no reconocidos";
      else if (m.accion === "oferta" && !(Number.isFinite(Number(m.precio)) && Number(m.precio) > 0)) nota = "una oferta necesita un precio positivo";
      else if (m.accion === "aceptar" && !ultimaAjena) nota = "no puedes aceptar: la otra parte aún no ha ofertado";
      else mov = { quien: turno, accion: m.accion, precio: m.accion === "oferta" ? Math.round(Number(m.precio)) : null, mensaje: String(m.mensaje ?? "").slice(0, 200) };
    }
    if (!mov) { res.invalidoDe = nombres[turno]; return res; } // dos respuestas inválidas seguidas: pierde
    movimientos.push(mov);
    if (mov.accion === "aceptar") {
      res.precio = movimientos.filter((x) => x.quien !== turno && x.precio != null).at(-1)!.precio;
      return res;
    }
    if (mov.accion === "retirarse") { res.retiradoPor = turno; return res; }
    turno = turno === "vendedor" ? "comprador" : "vendedor";
  }
  return res; // rondas agotadas sin acuerdo
}

// ── main ──
const GLM_MODEL = process.env.GLM_MODEL || "glm-5.2";
// Rival Opus por la API NATIVA de Anthropic (misma ANTHROPIC_API_KEY que el juez, sin OpenRouter).
// Para forzar OpenRouter: RIVAL_MODEL=anthropic/claude-opus-4.8 + OPENROUTER_API_KEY.
const RIVAL_MODEL = process.env.RIVAL_MODEL || "claude-opus-4-8";

async function main() {
  let jugadorDe: (modelo: string) => Jugador;
  if (args.dry) {
    jugadorDe = () => jugadorGuion();
  } else {
    const zai = process.env.ZAI_API_KEY;
    if (!zai) { console.error("Falta ZAI_API_KEY en .env"); process.exit(1); }
    const rivalNativo = /^claude-/.test(RIVAL_MODEL);
    if (rivalNativo && !process.env.ANTHROPIC_API_KEY) { console.error("Falta ANTHROPIC_API_KEY en .env (rival Opus por API nativa). Alternativa: --dry"); process.exit(1); }
    if (!rivalNativo && !process.env.OPENROUTER_API_KEY) { console.error("Falta OPENROUTER_API_KEY en .env (rival vía OpenRouter). Alternativa: RIVAL_MODEL nativo (claude-opus-4-8) + ANTHROPIC_API_KEY, o --dry"); process.exit(1); }
    const glmBase = process.env.GLM_BASE_URL || "https://api.z.ai/api/paas/v4";
    jugadorDe = (modelo) => modelo === GLM_MODEL
      ? jugadorLLM(glmBase, zai, GLM_MODEL)
      : rivalNativo
        ? jugadorLLM("", "", RIVAL_MODEL) // chatClaude usa ANTHROPIC_API_KEY por dentro
        : jugadorLLM("https://openrouter.ai/api/v1", process.env.OPENROUTER_API_KEY!, RIVAL_MODEL);
  }
  const A = GLM_MODEL, B = args.dry ? "rival-guion" : RIVAL_MODEL;

  let configs = CONFIGS.map((c, i) => ({ ...c, i }));
  if (args.solo != null) configs = configs.filter((c) => c.i === Number(args.solo));

  // cada config se juega 2 veces: A vende / B compra, y al revés
  const tareas = configs.flatMap((c) => [
    { cfg: c, nombres: { vendedor: A, comprador: B } },
    { cfg: c, nombres: { vendedor: B, comprador: A } },
  ]);
  console.log(`Bench públicos: ${tareas.length} negociaciones (${A} vs ${B})${args.dry ? " [DRY]" : ""}`);

  // una negociación reventada (red, refusal, 429 agotados) no tira la corrida: se apunta y se sigue
  const resultados = await pool(tareas, Number(args.concurrencia), async (t, i) => {
    let r: Resultado;
    try {
      r = await negociar(t.cfg, { vendedor: jugadorDe(t.nombres.vendedor), comprador: jugadorDe(t.nombres.comprador) }, t.nombres);
    } catch (e: any) {
      r = { config: t.cfg, zopa: t.cfg.valor > t.cfg.coste, vendedor: t.nombres.vendedor, comprador: t.nombres.comprador,
            movimientos: [], precio: null, retiradoPor: null, invalidoDe: null, uso: {}, error: e.message };
    }
    const fin = r.error ? `ERROR: ${r.error.slice(0, 80)}` : r.precio != null ? `acuerdo a ${eur(r.precio)}` : r.retiradoPor ? `retirada de ${r.retiradoPor}` : r.invalidoDe ? `inválido de ${r.invalidoDe}` : "sin acuerdo";
    console.log(`  [${i + 1}/${tareas.length}] coste ${eur(t.cfg.coste)} / valor ${eur(t.cfg.valor)} · vende ${t.nombres.vendedor} → ${fin} (${r.movimientos.length} movs)`);
    return r;
  });
  const errores = resultados.filter((r) => r.error);

  // ── métricas por modelo ──
  type Stats = { zopaJugadas: number; zopaAcuerdos: number; surplusV: number[]; surplusC: number[]; nozopaJugadas: number; retiradasOK: number; ruinosos: number; invalidos: number; uso: Uso };
  const stats: Record<string, Stats> = {};
  const S = (m: string) => (stats[m] ??= { zopaJugadas: 0, zopaAcuerdos: 0, surplusV: [], surplusC: [], nozopaJugadas: 0, retiradasOK: 0, ruinosos: 0, invalidos: 0, uso: { ...USO_CERO } });
  for (const r of resultados) {
    if (r.error) continue; // no cuenta en métricas; se lista aparte
    for (const rol of ["vendedor", "comprador"] as Rol[]) {
      const m = r[rol]; const s = S(m);
      s.uso = sumarUso(s.uso, r.uso[m] ?? USO_CERO);
      if (r.zopa) { s.zopaJugadas++; if (r.precio != null) s.zopaAcuerdos++; }
      else { s.nozopaJugadas++; if (r.retiradoPor === rol) s.retiradasOK++; }
      if (r.invalidoDe === m) s.invalidos++;
      if (r.precio != null) {
        if (rol === "vendedor" && r.precio < r.config.coste) s.ruinosos++;
        if (rol === "comprador" && r.precio > r.config.valor) s.ruinosos++;
        if (r.zopa) {
          const share = (r.precio - r.config.coste) / (r.config.valor - r.config.coste); // parte del excedente que captura el vendedor
          (rol === "vendedor" ? s.surplusV : s.surplusC).push(rol === "vendedor" ? share : 1 - share);
        }
      }
    }
  }
  const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const fila = (m: string) => {
    const s = S(m);
    const f = (x: number | null) => (x == null ? "—" : `${Math.round(100 * x)}%`);
    return `| ${m} | ${s.zopaAcuerdos}/${s.zopaJugadas} | ${f(media(s.surplusV))} | ${f(media(s.surplusC))} | ${s.retiradasOK}/${s.nozopaJugadas} | ${s.ruinosos} | ${s.invalidos} | $${costeUSD(m, s.uso).toFixed(2)} |`;
  };

  const dir = join(import.meta.dirname, "results");
  mkdirSync(dir, { recursive: true });
  const marca = stamp();
  const md = `# Bench públicos — negociación bilateral (protocolo PACT / AgenticPay 1:1) · ${marca}${args.dry ? " · DRY RUN" : ""}

${args.dry ? "> ⚠️ DRY RUN con jugadores guionizados: valida protocolo y métricas, NO mide a los modelos.\n" : ""}
Modelos: **${A}** vs **${B}** · ${tareas.length} negociaciones · máx ${RONDAS_MAX} movimientos · valores privados ocultos (adaptación ES).

| Modelo | Acuerdos en ZOPA | Excedente medio como vendedor | como comprador | Retirada correcta sin ZOPA | Acuerdos ruinosos | Inválidos | Coste |
|---|---|---|---|---|---|---|---|
${fila(A)}
${fila(B)}

Lectura: excedente = parte del margen disponible que captura ese rol (50% = reparto neutro; más alto = negocia mejor). "Ruinoso" = aceptó un precio que viola su valor privado. "Retirada correcta" = cortó una negociación imposible (sin ZOPA) en vez de agotar rondas.

## Detalle

| # | Coste | Valor | Vende | Resultado | Movs |
|---|---|---|---|---|---|
${resultados.map((r, i) => `| ${i + 1} | ${eur(r.config.coste)} | ${eur(r.config.valor)} | ${r.vendedor} | ${r.error ? `⚠️ error: ${r.error.slice(0, 60)}` : r.precio != null ? `acuerdo a ${eur(r.precio)}` : r.retiradoPor ? `retirada (${r.retiradoPor})` : r.invalidoDe ? `inválido (${r.invalidoDe})` : "sin acuerdo"} | ${r.movimientos.length} |`).join("\n")}
${errores.length ? `\n⚠️ ${errores.length} negociaciones con error técnico (excluidas de las métricas).\n` : ""}`;
  writeFileSync(join(dir, `publicos-${marca}.md`), md);
  writeFileSync(join(dir, `publicos-${marca}.json`), JSON.stringify(resultados, null, 2));

  // vuelca el resumen dentro del informe v1 (sección AUTO)
  const informePath = join(dir, "informe-v1.md");
  if (existsSync(informePath)) {
    const informe = readFileSync(informePath, "utf8");
    const bloque = `<!-- AUTO:PUBLICOS -->\n_Última corrida: ${marca}${args.dry ? " (dry run, no cuenta)" : ""} — detalle en \`publicos-${marca}.md\`._\n\n| Modelo | Acuerdos en ZOPA | Excedente vendedor | comprador | Retirada correcta | Ruinosos | Inválidos | Coste |\n|---|---|---|---|---|---|---|---|\n${fila(A)}\n${fila(B)}\n<!-- /AUTO:PUBLICOS -->`;
    writeFileSync(informePath, informe.replace(/<!-- AUTO:PUBLICOS -->[\s\S]*?<!-- \/AUTO:PUBLICOS -->/, bloque));
  }

  console.log(`\n✅ resultados en results/publicos-${marca}.{md,json}`);
  if (args.dry) {
    // el dry debe demostrar que el protocolo discrimina: hay acuerdos y hay retiradas
    const acuerdos = resultados.filter((r) => r.precio != null).length;
    const retiradas = resultados.filter((r) => r.retiradoPor).length;
    if (acuerdos < 1 || retiradas < 1) { console.error(`❌ dry run sin variedad (acuerdos=${acuerdos}, retiradas=${retiradas})`); process.exit(1); }
    console.log(`✅ dry OK: ${acuerdos} acuerdos, ${retiradas} retiradas — protocolo y métricas funcionan`);
  }
}

main().catch((e) => { console.error("bench-publicos:", e.message); process.exit(1); });
