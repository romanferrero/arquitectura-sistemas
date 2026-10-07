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
