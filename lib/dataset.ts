// lib/dataset.ts — carga, linter y sellado del dataset. ÚNICA fuente de verdad del digest:
// bench, validación de submissions y verificación lo importan de aquí. Si cada uno lo calculara
// por su cuenta podrían divergir en silencio, y un digest que puede divergir no sella nada.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const DATASET_VERSION = "1.0"; // versión del dominio por defecto (realestate)
export const RAIZ = join(import.meta.dirname, "..");

// Dominios de venta (Stage 4). Cada dominio es un dataset con SU versión y SU digest: los boards
// jamás mezclan dominios. realestate vive en la raíz (scenarios/ + offer.json) para no tocar el
// digest congelado de v1.0; los demás en domains/<nombre>/. "preview" = linted + dry, aún sin
// validar contra un juez real ni split oculto (docs/DOMAINS.md).
export const DOMINIOS: Record<string, { version: string; estado: "official" | "preview" }> = {
  realestate: { version: DATASET_VERSION, estado: "official" },
  saas: { version: "0.1", estado: "preview" },
};
export const DOMINIO_DEFECTO = "realestate";

export type Split = "public" | "hidden";
export const SPLITS: Split[] = ["public", "hidden"];
// public = iteración y debug (repo). hidden = score oficial (fuera del repo; solo se publica su
// compromiso sha256 en scenarios-hidden.sha256 para probar que el set no se retocó a posteriori).
export const dirSplit = (split: Split, dominio = DOMINIO_DEFECTO) => {
  const base = dominio === DOMINIO_DEFECTO ? RAIZ : join(RAIZ, "domains", dominio);
  return join(base, split === "hidden" ? "scenarios-hidden" : "scenarios");
};
export const ofertaDe = (dominio = DOMINIO_DEFECTO) =>
  join(dominio === DOMINIO_DEFECTO ? RAIZ : join(RAIZ, "domains", dominio), "offer.json");
// Compromiso público del split oculto, POR dominio: el de realestate vive en la raíz (histórico);
// el de un dominio nuevo, junto a su dataset (domains/<d>/scenarios-hidden.sha256).
export const compromisoDe = (dominio = DOMINIO_DEFECTO) =>
  join(dominio === DOMINIO_DEFECTO ? RAIZ : join(RAIZ, "domains", dominio), "scenarios-hidden.sha256");
export const COMPROMISO_HIDDEN = compromisoDe(); // realestate, el único sellado hoy

// tier: 1 = señal de compra, un paso al objetivo · 2 = descubrimiento/objeciones/negociación en política
//       3 = adversario, ambiguo o filo de política: un paso en falso es VIOLACIÓN, no solo venta perdida
export type Escenario = {
  id: string; cat: string; lang: string; tier: 1 | 2 | 3; nombre: string; persona: string; contexto: string;
  actitud: string; apertura: string; presupuesto_max?: number; criterios: string;
  max_turnos: number; exito_esperado: "pago" | "demo" | "handoff" | "aviso" | "descalificar" | "no_venta_etica";
  estado_esperado?: string; notas_juez?: string; guion?: string[];
};

export function cargarDataset(split: Split = "public", dominio = DOMINIO_DEFECTO): { escenarios: Escenario[]; digest: string; version: string; ofertaPath: string } {
  if (!DOMINIOS[dominio]) throw new Error(`dominio desconocido: "${dominio}" (conocidos: ${Object.keys(DOMINIOS).join(", ")})`);
  const dir = dirSplit(split, dominio);
  if (!existsSync(dir))
    throw new Error(split === "hidden"
      ? dominio === DOMINIO_DEFECTO
        ? "no hay split oculto en este checkout (scenarios-hidden/ no existe): el score oficial lo corren los mantenedores"
        : `el dominio "${dominio}" aún no tiene split oculto (estado: ${DOMINIOS[dominio].estado}) — ver docs/DOMAINS.md`
      : `falta el directorio de escenarios: ${dir}`);
  const todos: Escenario[] = [];
  const hash = createHash("sha256");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const crudo = readFileSync(join(dir, f), "utf8");
    hash.update(crudo);
    const arr = JSON.parse(crudo);
    if (!Array.isArray(arr)) throw new Error(`${f}: se esperaba un array de escenarios`);
    todos.push(...arr);
  }
  if (!todos.length) throw new Error(`split ${split}: 0 escenarios en ${dir}`);
  const ofertaPath = ofertaDe(dominio);
  hash.update(readFileSync(ofertaPath));
  // linter mínimo: el bench no arranca con escenarios rotos
  const ids = new Set<string>();
  const EXITOS = ["pago", "demo", "handoff", "aviso", "descalificar", "no_venta_etica"];
  for (const e of todos) {
    for (const campo of ["id", "cat", "lang", "persona", "apertura", "criterios"] as const)
      if (!e[campo] || typeof e[campo] !== "string") throw new Error(`escenario ${e.id ?? "?"}: falta el campo "${campo}"`);
    if (ids.has(e.id)) throw new Error(`escenario duplicado: ${e.id}`);
    ids.add(e.id);
    if (![1, 2, 3].includes(e.tier)) throw new Error(`${e.id}: tier inválido (${e.tier}) — debe ser 1, 2 o 3`);
    if (!Number.isInteger(e.max_turnos) || e.max_turnos < 1) throw new Error(`${e.id}: max_turnos inválido`);
    if (!EXITOS.includes(e.exito_esperado)) throw new Error(`${e.id}: exito_esperado inválido (${e.exito_esperado})`);
  }
  return { escenarios: todos, digest: hash.digest("hex").slice(0, 12), version: DOMINIOS[dominio].version, ofertaPath };
}

// Digest y tamaño del split oculto sin tenerlo: el compromiso publicado en el repo.
export function compromisoHidden(dominio = DOMINIO_DEFECTO): { digest: string; escenarios: number } | null {
  const path = compromisoDe(dominio);
  if (!existsSync(path)) return null;
  const texto = readFileSync(path, "utf8");
  const digest = texto.match(/digest:\s*([0-9a-f]{12})/)?.[1];
  const n = texto.match(/escenarios:\s*(\d+)/)?.[1];
  return digest ? { digest, escenarios: Number(n ?? 0) } : null;
}
