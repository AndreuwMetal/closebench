# Pendiente — lo que falta para el primer leaderboard real

Runbook del mantenedor. Estado a **2026-10-09**: el código está listo (PR #20: proveedor fijado en OpenRouter,
prompt caching del comprador y del juez, cierre del proxy del cerebro Claude); lo que falta cuesta dinero de API.
El primer intento (2026-10-09 12:51) se quedó sin crédito de Anthropic a mitad: **ningún baseline completo, nada citable.**

## 1. Antes de gastar

- [ ] Recargar crédito en console.anthropic.com → Billing. Paga el comprador y el juez de **todos** los runs y el cerebro de los baselines Claude.
- [ ] Comprobar que queda saldo en Z.ai (cerebro GLM del ancla y del suelo).
- [ ] Opcional: `OPENROUTER_API_KEY` en `.env` para Kimi / Qwen / GPT-5.6 Sol (diversidad de proveedor, ver §5).
- [ ] Borrar los runs a medias del 2026-10-09 en `results/` (ignorados por git, no sirven): `closebench-claude-opus-5-5-2026-10-09-1251.*`.

## 2. Coste (medido en las pruebas del 2026-10-09, 1 escenario por modelo, con caché)

Evaluación (comprador `claude-sonnet-5` + juez `claude-opus-4-8`): **~$0.03/conversación** para cualquier cerebro.
Un baseline = 52 escenarios × k=8 = **416 conversaciones**.

| Baseline | Cerebro $/conv | Total aprox. | Crédito |
|---|---|---|---|
| reference-GLM (ancla) | 0.016 | ~$19 | Anthropic ~$13 + Z.ai ~$7 |
| `bad.md` suelo | ~0.015 | ~$19 | Anthropic ~$13 + Z.ai ~$6 |
| Haiku 5.5 | 0.002 | ~$13 | Anthropic |
| Sonnet 5.5 | 0.032 | ~$26 | Anthropic |
| Opus 5.5 | 0.067 | ~$40 | Anthropic |
| **Los 5** | | **~$120** | **Anthropic ~$105 + Z.ai ~$13** |
| Fable 5.1 (opcional, techo) | 0.149 | ~$75 | Anthropic |
| Verificación ✓ (≈20 % re-run, por baseline) | | ~$3–8 | Anthropic |

El escenario de la prueba (`caliente-01`) es de los fáciles: los de red team son más largos. **Recarga con margen (~$150 para los 5).**

## 3. Lanzar los runs

Dos tandas en paralelo (Anthropic aguanta 8 conversaciones concurrentes sin 429 en la prueba). ~1–2 h por baseline.

```bash
cd closebench
run() { name=$1; shift; node closebench.ts --k 8 "$@" > results/$name.log 2>&1; echo "$name exit=$?"; }
( run glm-anchor --brain glm; run bad-floor --brain glm --prompt prompts/bad.md; run haiku-5-5 --brain claude-haiku-5-5 ) &
( run opus-5-5 --brain claude-opus-5-5; run sonnet-5-5 --brain claude-sonnet-5-5 ) &
wait
```

Si el saldo se acaba a mitad, el informe dice `RUN INCOMPLETO` y lista los `--solo` a repetir: **un run incompleto no es citable** — repetir solo las fallidas con el comando que imprime.

## 4. Después de los runs

- [ ] Cada informe sin `RUN INCOMPLETO` ni errores técnicos (`grep "errores técnicos: 0" results/closebench-*.md`).
- [ ] Copiar cada JSON a `submissions/<baseline>.json` y validar: `npm run submit:validate`.
- [ ] Verificar el primero con semilla publicada: `npm run verify:submission submissions/<name>.json -- --seed 7` → escribe `.checked.json` (✓).
- [ ] `npm run leaderboard` → regenera `LEADERBOARD.md`.
- [ ] Copiar a `results/published/` los informes que cite la documentación (solo split público) y actualizar `results/published/README.md`.
- [ ] `npm run hf:export` y subir al dataset de HF.
- [ ] Muestra κ de transcripciones de cerebros Claude (`npm run kappa:muestra`) para las dos etiquetadoras: es el sesgo de proveedor que más importa comprobar (GOVERNANCE → Revision 2026-10-09).
- [ ] ROADMAP: marcar ✅ "First verified entries". Rellenar la tabla de baselines del paper (`paper/`).
- [ ] Hacer merge de la PR #20.

## 5. Con más presupuesto, por orden

1. **Baselines de otros proveedores** (Kimi, Qwen, GPT-5.6 Sol vía OpenRouter, ya fijados a su proveedor oficial): hoy 3 de 5 cerebros son del mismo proveedor que el juez y el comprador. ~$25–45 cada uno.
2. **Fable 5.1** como fila techo (~$75).
3. **Ampliar el split oculto de realestate** de 10 a 20–30 escenarios (GOVERNANCE: 20 es el mínimo para un score oficial) y crear el de saas. Escribir escenarios es gratis; validar su verdad con juez en vivo y re-sellar (`npm run hidden:seal`) va con subida de versión y nota en ROADMAP.
4. **Juez por Batch API** (−50 % en el juez, ~2/3 del coste de evaluación → ahorra ~$25–30 en los 5 baselines): encolar las peticiones del juez al acabar las conversaciones, `POST /v1/messages/batches`, sondear hasta `ended`, casar por `custom_id`. Cambia el tiempo, no el resultado. Requiere crédito para probarlo de punta a punta.

## 6. Difusión (gratis o casi, en este orden)

- [ ] Paper en arXiv (borrador en `paper/`): necesita la tabla de baselines del §4. Subirlo también a HF Papers en los 14 días siguientes a su publicación en arXiv.
- [ ] DOI en Zenodo: activar el repo en zenodo.org (GitHub integration) y publicar un release (Zenodo toma los metadatos de `CITATION.cff`). Añadir el DOI a `CITATION.cff`.
- [ ] HF: convertir el dataset en benchmark oficial (`eval.yaml` + PR del framework a huggingface.js + petición de allow-list en el foro).
- [ ] Kaggle Community Benchmark con el split público (Kaggle pone los modelos).
- [ ] Con paper y leaderboard: email a benchmarks@epoch.ai y formulario de partnerships de Artificial Analysis.
