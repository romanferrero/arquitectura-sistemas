/**
 * Unico archivo de la aplicacion que lee process.env.
 *
 * Las variables se cargan con el flag NATIVO de Node (`node --env-file=.env`),
 * por eso no se usa la libreria `dotenv`.
 *
 * Si falta una variable obligatoria el proceso corta aca mismo (fail fast) con
 * un mensaje claro, en vez de fallar mas tarde con un `undefined` inesperado.
 */

function textoRequerido(nombre: string): string {
  const valor = process.env[nombre];
  if (valor === undefined || valor.trim() === "") {
    console.error(
      `[config] Falta la variable de entorno ${nombre}. ` +
        `Copiá .env.example a .env y ejecutá con --env-file=.env`,
    );
    process.exit(1);
  }
  return valor.trim();
}

function numeroRequerido(nombre: string): number {
  const valor = Number(textoRequerido(nombre));
  if (!Number.isFinite(valor) || valor <= 0) {
    console.error(`[config] La variable ${nombre} debe ser un número positivo.`);
    process.exit(1);
  }
  return valor;
}

/** Igual que numeroRequerido pero admite el 0 (ej: un umbral "cualquier valor por encima de 0"). */
function numeroNoNegativoRequerido(nombre: string): number {
  const valor = Number(textoRequerido(nombre));
  if (!Number.isFinite(valor) || valor < 0) {
    console.error(`[config] La variable ${nombre} debe ser un número mayor o igual a 0.`);
    process.exit(1);
  }
  return valor;
}

/**
 * URI de MongoDB. Es una FUNCION y no una propiedad de `env`: asi los comandos que solo
 * usan MySQL (migrar, por ejemplo) no exigen tener configurado MongoDB. El servidor la
 * llama al arrancar, antes de conectar nada, para fallar rapido si falta algo.
 * `authSource=admin` es necesario porque el usuario root del
 * contenedor se crea en la base `admin`, aunque los datos vivan en otra.
 * `directConnection=true` evita que el driver intente descubrir un replica set.
 * Usuario y password se codifican por si traen caracteres reservados (@, :, /).
 */
export function mongoUri(): string {
  const usuario = encodeURIComponent(textoRequerido("MONGO_INITDB_ROOT_USERNAME"));
  const password = encodeURIComponent(textoRequerido("MONGO_INITDB_ROOT_PASSWORD"));
  const host = textoRequerido("MONGO_HOST");
  const puerto = numeroRequerido("MONGO_PORT");
  const base = textoRequerido("MONGO_DATABASE");
  return `mongodb://${usuario}:${password}@${host}:${puerto}/${base}?authSource=admin&directConnection=true`;
}

/**
 * URL de Redis. Igual que mongoUri(), es una FUNCION: los comandos que no usan Redis
 * (migrar) no exigen tener configuradas sus variables. La password se codifica por si
 * trae caracteres reservados.
 */
export function redisUrl(): string {
  const { host, puerto, password } = redisConfig();
  return `redis://:${encodeURIComponent(password)}@${host}:${puerto}`;
}

/**
 * Host, puerto y password de Redis por separado. Los usa BullMQ, que abre sus propias
 * conexiones (con `ioredis`) a partir de estos datos y no de una URL.
 */
export function redisConfig(): { host: string; puerto: number; password: string } {
  return {
    host: textoRequerido("REDIS_HOST"),
    puerto: numeroRequerido("REDIS_PORT"),
    password: textoRequerido("REDIS_PASSWORD"),
  };
}

/** Una URL valida; si no lo es, corta el arranque nombrando la variable. */
function urlRequerida(nombre: string): string {
  const texto = textoRequerido(nombre);
  try {
    new URL(texto);
  } catch {
    console.error(`[config] La variable ${nombre} debe ser una URL válida.`);
    process.exit(1);
  }
  return texto;
}

/**
 * Configuracion del proveedor de identidad que emite los JWT (Auth0 u otro). La app no sabe
 * cual es: solo necesita quien emite, para quien, donde estan sus claves publicas y como se
 * llama el claim de los roles. Cambiar de proveedor es cambiar estas variables.
 */
export function authConfig(): { issuer: string; audience: string; jwksUrl: string; claimRoles: string } {
  return {
    issuer: textoRequerido("AUTH_ISSUER"),
    audience: textoRequerido("AUTH_AUDIENCE"),
    jwksUrl: urlRequerida("AUTH_JWKS_URL"),
    claimRoles: textoRequerido("AUTH_CLAIM_ROLES"),
  };
}

/** Cuanto demora (simulado) el worker en generar un reporte, en milisegundos. Admite 0. */
export function reporteDemoraMs(): number {
  return numeroNoNegativoRequerido("REPORTE_DEMORA_MS");
}

/** Cuanto dura un activo en la cache de Redis antes de volver a leerlo de MySQL. */
export function cacheTtlSegundos(): number {
  const valor = numeroRequerido("CACHE_TTL_SEGUNDOS");
  if (!Number.isInteger(valor)) {
    console.error("[config] La variable CACHE_TTL_SEGUNDOS debe ser un entero positivo.");
    process.exit(1);
  }
  return valor;
}

/**
 * Numero de la instancia dentro del cluster de PM2 (0, 1, 2...). PM2 lo pone en NODE_APP_INSTANCE; fuera de PM2
 * (`npm run dev`) no existe y la instancia es "0". Va en el header `X-Instancia` y en `/salud`.
 */
export function instancia(): string {
  return process.env["NODE_APP_INSTANCE"]?.trim() || "0";
}

/**
 * Si la API aplica las migraciones pendientes al arrancar. Por defecto SI (comodo con `npm run dev`). Con varias
 * instancias arrancando a la vez no conviene que todas migren: en Docker lo hace un paso aparte (el servicio
 * `migraciones`) y la API corre con `MIGRAR_AL_ARRANCAR=false`.
 */
export function migrarAlArrancar(): boolean {
  const valor = process.env["MIGRAR_AL_ARRANCAR"]?.trim().toLowerCase();
  if (valor === undefined || valor === "") return true;
  if (valor === "true") return true;
  if (valor === "false") return false;
  console.error("[config] La variable MIGRAR_AL_ARRANCAR debe ser true o false.");
  process.exit(1);
}

/**
 * Cuanto espera la API, al recibir la senal de apagado, a que terminen los pedidos en curso antes de forzar la
 * salida (en milisegundos). Tiene que ser MENOR que el `kill_timeout` de PM2, que es quien manda el SIGKILL.
 */
export function cierreTimeoutMs(): number {
  const valor = process.env["SHUTDOWN_TIMEOUT_MS"]?.trim();
  if (valor === undefined || valor === "") return 10_000;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1_000 || numero > 60_000) {
    console.error("[config] La variable SHUTDOWN_TIMEOUT_MS debe ser un entero entre 1000 y 60000.");
    process.exit(1);
  }
  return numero;
}

export const env = Object.freeze({
  PORT: numeroRequerido("PORT"),
  NODE_ENV: textoRequerido("NODE_ENV"),
  API_PRECIOS_URL: textoRequerido("API_PRECIOS_URL"),
  API_TASAS_URL: textoRequerido("API_TASAS_URL"),
  MONEDA: textoRequerido("MONEDA").toLowerCase(),
  TIMEOUT_MS: numeroRequerido("TIMEOUT_MS"),
  UMBRAL_MONTO_USD: numeroNoNegativoRequerido("UMBRAL_MONTO_USD"),
  UMBRAL_VOLATILIDAD: numeroNoNegativoRequerido("UMBRAL_VOLATILIDAD"),
  MYSQL_HOST: textoRequerido("MYSQL_HOST"),
  MYSQL_PORT: numeroRequerido("MYSQL_PORT"),
  MYSQL_DATABASE: textoRequerido("MYSQL_DATABASE"),
  MYSQL_USER: textoRequerido("MYSQL_USER"),
  MYSQL_PASSWORD: textoRequerido("MYSQL_PASSWORD"),
});
