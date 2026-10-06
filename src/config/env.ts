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

export const env = Object.freeze({
  PORT: numeroRequerido("PORT"),
  NODE_ENV: textoRequerido("NODE_ENV"),
  API_PRECIOS_URL: textoRequerido("API_PRECIOS_URL"),
  MONEDA: textoRequerido("MONEDA").toLowerCase(),
  TIMEOUT_MS: numeroRequerido("TIMEOUT_MS"),
});
