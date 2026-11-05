/**
 * Configuracion de PM2 (es .cjs y no .js porque el proyecto es "type": "module" y PM2 lee este archivo con require).
 *
 * Que procesos define y por que se escalan distinto:
 *
 *  - `api`: se ejecuta en MODO CLUSTER, una instancia por nucleo (`instances: "max"`). Es la unica que se multiplica:
 *    las peticiones HTTP se reparten entre las instancias y el token JWT no guarda sesion, asi que da igual cual
 *    atienda cada una. El modo pánico y la caché viven en Redis, que ven todas.
 *  - `worker-reportes`, `suscriptor-proyecciones` y `suscriptor-notificaciones`: UNA instancia cada uno, en modo fork.
 *    Si se multiplicaran junto con la API, cada suscriptor de Pub/Sub recibiria TODOS los eventos en cada copia y
 *    el trabajo se duplicaria (los reportes si podrian repartirse: la cola entrega cada trabajo a un solo worker).
 *  - `monitor-reinicios`: avisa con un log critico si alguna instancia reinicia mas de 5 veces en un minuto.
 *
 * Uso:
 *   pm2-runtime ecosystem.config.cjs --only api,monitor-reinicios     # la API en cluster (lo que corre en Docker)
 *   pm2-runtime ecosystem.config.cjs --only worker-reportes           # el worker
 *   PM2_INSTANCES=1 pm2-runtime ecosystem.config.cjs --only api       # una sola instancia (para comparar)
 *
 * Variables que lee (todas opcionales):
 *   PM2_INSTANCES       cuantas instancias de la API: un numero o "max" (por defecto "max")
 *   PM2_MAX_MEMORY      limite de memoria por instancia antes de reiniciarla (por defecto 512M)
 *   SHUTDOWN_TIMEOUT_MS cuanto espera la API a los pedidos en curso al apagarse (por defecto 10000)
 */

// Este archivo lo evalua el CLI de PM2 (pm2 / pm2-runtime), que NO carga el .env: los hijos si (por node_args), pero
// PM2_INSTANCES, PM2_MAX_MEMORY y SHUTDOWN_TIMEOUT_MS se leen ACA. Sin esto, un valor puesto solo en el .env se ignoraba
// en `npm run cluster` (y SHUTDOWN_TIMEOUT_MS quedaba distinto en PM2 y en la API). En Docker no hay .env y las variables
// ya vienen del entorno; loadEnvFile no pisa las que ya existen.
try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

function leerInstancias(valor) {
  if (valor === undefined || valor === "" || valor === "max" || valor === "0") return "max";
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1) {
    throw new Error(`PM2_INSTANCES invalido: "${valor}" (un entero >= 1 o "max")`);
  }
  return numero;
}

// Mismas reglas que `cierreTimeoutMs()` de src/config/env.ts (vacio = por defecto; entero entre 1000 y 60000).
function leerCierreMs(valor) {
  if (valor === undefined || valor.trim() === "") return 10_000;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1_000 || numero > 60_000) {
    throw new Error(`SHUTDOWN_TIMEOUT_MS invalido: "${valor}" (un entero entre 1000 y 60000)`);
  }
  return numero;
}

const cierreMs = leerCierreMs(process.env.SHUTDOWN_TIMEOUT_MS);

// Lo que comparten todos los procesos.
const comun = {
  autorestart: true, // si una instancia se cae, PM2 la levanta de nuevo
  restart_delay: 1_000, // espera entre un reinicio y el siguiente
  min_uptime: "10s", // vivir menos que esto cuenta como arranque fallido
  // Hasta 20 arranques fallidos seguidos antes de que PM2 se rinda y deje el proceso en `errored`. Es mas alto que el
  // umbral del monitor (5 por minuto) A PROPOSITO: con un limite de 5, PM2 pararia el crash loop antes de que el
  // monitor llegara a verlo y avisar.
  max_restarts: 20,
  max_memory_restart: process.env.PM2_MAX_MEMORY?.trim() || "512M", // tope contra fugas (una instancia con todo el trafico se estabiliza en ~330 MB)
  // Carga el .env si existe (en local); en Docker no hay .env y las variables ya vienen del entorno.
  node_args: "--env-file-if-exists=.env",
  merge_logs: true,
  // A proposito siempre "production" bajo PM2: lo unico que cambia es el formato del log (JSON, el que se recoge de stdout).
  env: { NODE_ENV: "production" },
};

module.exports = {
  apps: [
    {
      ...comun,
      name: "api",
      script: "dist/servidor.js",
      exec_mode: "cluster",
      instances: leerInstancias(process.env.PM2_INSTANCES),
      // La instancia esta lista cuando llama a process.send("ready") (despues de conectar las tres bases y escuchar).
      // Con "max" arrancan todas a la vez y compiten por la CPU: se da margen.
      wait_ready: true,
      listen_timeout: 30_000,
      // PM2 manda SIGINT y, si pasado este tiempo la instancia sigue viva, SIGKILL. Tiene que ser MAYOR que lo que la
      // API espera a los pedidos en curso (SHUTDOWN_TIMEOUT_MS), para que el cierre ordenado alcance a terminar.
      kill_timeout: cierreMs + 2_000,
    },
    {
      ...comun,
      name: "worker-reportes",
      script: "dist/procesos/workerReportes.js",
      exec_mode: "fork",
      instances: 1,
      kill_timeout: 35_000, // el worker espera al reporte en curso hasta 30 s
    },
    {
      ...comun,
      name: "suscriptor-proyecciones",
      script: "dist/procesos/suscriptorProyecciones.js",
      exec_mode: "fork",
      instances: 1,
      kill_timeout: 12_000, // se cierra solo a los 10 s como maximo
    },
    {
      ...comun,
      name: "suscriptor-notificaciones",
      script: "dist/procesos/suscriptorNotificaciones.js",
      exec_mode: "fork",
      instances: 1,
      kill_timeout: 12_000,
    },
    {
      ...comun,
      name: "monitor-reinicios",
      script: "dist/procesos/monitorReinicios.js",
      exec_mode: "fork",
      instances: 1,
      kill_timeout: 3_000,
    },
  ],
};
