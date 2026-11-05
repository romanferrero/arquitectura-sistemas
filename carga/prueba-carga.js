import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

/**
 * PRUEBA DE CARGA (Parte 8): 100 usuarios virtuales a la vez contra la API, en dos escenarios paralelos.
 *
 *   lectura   (80 usuarios)  GET /api/activos/:id. Sale de Redis casi siempre (X-Cache: HIT): es el camino barato.
 *   escritura (20 usuarios)  POST /api/activos y DELETE /api/activos/:id, en USD. Cada ciclo pasa por el pipeline,
 *                            MySQL y la publicacion del evento: es el camino caro.
 *
 * Se corre con k6 desde Docker Compose (perfil `carga`), una vez con una instancia de la API y otra con el cluster:
 *
 *   PM2_INSTANCES=1 docker compose up -d --wait api          # o max, o 4
 *   ETIQUETA=1-instancia docker compose run --rm k6
 *
 * Variables (todas opcionales salvo las de autenticacion):
 *   URL_BASE            donde esta la API (en la red de compose: http://api:3000)
 *   USUARIOS_LECTURA    80            USUARIOS_ESCRITURA   20
 *   DURACION            30s           PAUSA_MS             0 (cuanto espera cada usuario entre pedidos)
 *   ACTIVOS_SEMILLA     20            (cuantos activos se crean antes de leer)
 *   TOKEN               un JWT con rol TRADER; si no esta, se pide al proveedor de identidad:
 *   CARGA_URL_IDP, CARGA_CLIENT_ID, CARGA_USUARIO, CARGA_CLAVE, CARGA_AUDIENCE   (grant password, como Postman)
 *
 * Los contadores `instancia_N` cuentan cuantas respuestas atendio cada instancia del cluster (header X-Instancia) y
 * `tasa_cache_hit` cuantas lecturas salieron de Redis.
 */
const URL_BASE = __ENV.URL_BASE || "http://api:3000";
const USUARIOS_LECTURA = Number(__ENV.USUARIOS_LECTURA || 80);
const USUARIOS_ESCRITURA = Number(__ENV.USUARIOS_ESCRITURA || 20);
const DURACION = __ENV.DURACION || "30s";
const PAUSA_S = Number(__ENV.PAUSA_MS || 0) / 1000;
const ACTIVOS_SEMILLA = Number(__ENV.ACTIVOS_SEMILLA || 20);
const NOMBRE_SEMILLA = "Semilla de carga";
const NOMBRE_ESCRITURA = "Prueba de carga";

const errores5xx = new Counter("errores_5xx");
const tasaCacheHit = new Rate("tasa_cache_hit");
const MAXIMO_INSTANCIAS = 32;
const porInstancia = [];
for (let i = 0; i < MAXIMO_INSTANCIAS; i += 1) porInstancia.push(new Counter(`instancia_${i}`));
const instanciaDesconocida = new Counter("instancia_desconocida");

export const options = {
  scenarios: {
    lectura: { executor: "constant-vus", vus: USUARIOS_LECTURA, duration: DURACION, exec: "leer" },
    escritura: { executor: "constant-vus", vus: USUARIOS_ESCRITURA, duration: DURACION, exec: "escribir" },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    "http_req_duration{scenario:lectura}": ["p(95)<500"],
    "http_req_duration{scenario:escritura}": ["p(95)<500"],
    errores_5xx: ["count==0"],
    checks: ["rate>0.99"],
  },
};

function encabezados(token) {
  return { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
}

function contarInstancia(respuesta) {
  const numero = Number(respuesta.headers["X-Instancia"]);
  if (Number.isInteger(numero) && numero >= 0 && numero < MAXIMO_INSTANCIAS) porInstancia[numero].add(1);
  else instanciaDesconocida.add(1);
  if (respuesta.status >= 500) errores5xx.add(1);
}

/** Deja en el log (de a pocas por usuario) los pedidos que no dieron lo esperado, para saber que paso. */
let avisos = 0;
function avisarSiFalla(respuesta, esperado, que) {
  if (respuesta.status === esperado || avisos >= 5) return;
  avisos += 1;
  console.warn(`${que}: respondio ${respuesta.status} (se esperaba ${esperado}) ${String(respuesta.body).slice(0, 120)}`);
}

function pedirToken() {
  if (__ENV.TOKEN) return __ENV.TOKEN;
  const respuesta = http.post(
    `${__ENV.CARGA_URL_IDP}/oauth/token`,
    {
      grant_type: "password",
      username: __ENV.CARGA_USUARIO,
      password: __ENV.CARGA_CLAVE,
      audience: __ENV.CARGA_AUDIENCE || "https://portafolio-cripto/api",
      client_id: __ENV.CARGA_CLIENT_ID,
      scope: "openid",
    },
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );
  if (respuesta.status !== 200) {
    throw new Error(`El proveedor de identidad respondio ${respuesta.status}: ${respuesta.body}`);
  }
  return respuesta.json("access_token");
}

/**
 * Solo se borra lo que dejo una corrida anterior de ESTA prueba: simbolo con el prefijo `ZZ` Y el nombre que ella les pone.
 * Un portafolio con activos reales (aunque el simbolo empiece igual) no se toca.
 */
function esDeLaPruebaDeCarga(activo) {
  return (
    String(activo.simbolo).startsWith("ZZ") &&
    (activo.nombre === NOMBRE_ESCRITURA || String(activo.nombre).startsWith(NOMBRE_SEMILLA))
  );
}

/** Antes de empezar: el token, un barrido de lo que haya quedado de otra corrida y los activos que se van a leer. */
export function setup() {
  const token = pedirToken();
  const opciones = encabezados(token);

  const existentes = http.get(`${URL_BASE}/api/activos`, opciones);
  if (existentes.status !== 200) throw new Error(`No se pudo listar los activos (${existentes.status})`);
  for (const activo of existentes.json()) {
    if (esDeLaPruebaDeCarga(activo)) http.del(`${URL_BASE}/api/activos/${activo.id}`, null, opciones);
  }

  const ids = [];
  for (let i = 0; i < ACTIVOS_SEMILLA; i += 1) {
    const cuerpo = { simbolo: `ZZS${String(i).padStart(2, "0")}`, nombre: `${NOMBRE_SEMILLA} ${i}`, cantidad: 1, precioCompra: 100 + i };
    const creado = http.post(`${URL_BASE}/api/activos`, JSON.stringify(cuerpo), opciones);
    if (creado.status !== 201) throw new Error(`No se pudo crear la semilla ${i} (${creado.status}): ${creado.body}`);
    ids.push(creado.json("id"));
  }
  return { token, ids };
}

/** Escenario de lectura: un activo al azar de los sembrados. */
export function leer(datos) {
  const id = datos.ids[Math.floor(Math.random() * datos.ids.length)];
  const respuesta = http.get(`${URL_BASE}/api/activos/${id}`, encabezados(datos.token));
  contarInstancia(respuesta);
  tasaCacheHit.add(respuesta.headers["X-Cache"] === "HIT");
  avisarSiFalla(respuesta, 200, "lectura");
  check(respuesta, { "lectura: 200": (r) => r.status === 200 });
  if (PAUSA_S > 0) sleep(PAUSA_S);
}

/** Escenario de escritura: crea un activo con un simbolo propio (ZZ<usuario>X<vuelta en base 36>, hasta 10 caracteres) y lo borra. */
export function escribir(datos) {
  const opciones = encabezados(datos.token);
  const cuerpo = { simbolo: `ZZ${__VU}X${__ITER.toString(36)}`, nombre: NOMBRE_ESCRITURA, cantidad: 2, precioCompra: 50, moneda: "USD" };

  const creado = http.post(`${URL_BASE}/api/activos`, JSON.stringify(cuerpo), opciones);
  contarInstancia(creado);
  avisarSiFalla(creado, 201, "POST");
  const sePudoCrear = check(creado, { "escritura: POST 201": (r) => r.status === 201 });
  if (!sePudoCrear) return;

  const borrado = http.del(`${URL_BASE}/api/activos/${creado.json("id")}`, null, opciones);
  contarInstancia(borrado);
  avisarSiFalla(borrado, 204, "DELETE");
  check(borrado, { "escritura: DELETE 204": (r) => r.status === 204 });
  if (PAUSA_S > 0) sleep(PAUSA_S);
}

/** Al terminar: se borran las semillas. */
export function teardown(datos) {
  const opciones = encabezados(datos.token);
  for (const id of datos.ids) http.del(`${URL_BASE}/api/activos/${id}`, null, opciones);
}
