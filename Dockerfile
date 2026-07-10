# Corrida hermética de CloseBench. Node 24 (TS nativo, node:sqlite) + python3 para el adaptador Python.
#
#   docker build -t closebench .
#   docker run --rm closebench                      # las 3 suites dry: 0 claves, 0 coste
#   docker run --rm --env-file .env closebench npm run bench      # el examen real
#
# Sin `npm install`: CloseBench no tiene dependencias en tiempo de ejecución, a propósito.
FROM node:24-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /bench
COPY . .

# .dockerignore excluye .git, así que el manifiesto del informe dirá "git: desconocido" en lugar de
# inventarse un commit. Si necesitas trazabilidad del harness, monta el repo: -v "$PWD:/bench".
CMD ["npm", "run", "bench:dry:all"]
