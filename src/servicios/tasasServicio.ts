import { env } from "../config/env.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";

/**
 * Integracion con la API externa de tipo de cambio: open.er-api.com.
 *
 * Igual que CoinGecko, es gratuita y no requiere API key. Se consulta con la
 * moneda de origen como base y la respuesta trae cuanto vale cada moneda:
 *
 *   GET https://open.er-api.com/v6/latest/EUR
 *   -> { "result": "success", "base_code": "EUR", "rates": { "USD": 1.08, ... } }
 *
 * Por eso `rates.USD` es directamente el factor para pasar de EUR a USD.
 *
 * Detalle que obliga a mirar el cuerpo y no solo el status: para un codigo
 * inexistente responde HTTP 200 con { "result": "error", "error-type":
 * "unsupported-code" }.
 */

/** Signatura que los filtros reciben por parametro (y los tests reemplazan). */
export type ObtenerTasa = (monedaOrigen: string) => Promise<number>;

/**
 * Cuanto vale 1 unidad de `monedaOrigen` en USD.
 *
 *  - 400: la moneda no existe. El error es del cliente, que la envio mal.
 *  - 502: se llamo a la API y fallo (timeout, red, respuesta inesperada).
 */
export const obtenerTasaAUsd: ObtenerTasa = async (monedaOrigen) => {
  const url = `${env.API_TASAS_URL}/${encodeURIComponent(monedaOrigen)}`;

  let respuesta: Response;
  try {
    respuesta = await fetch(url, { signal: AbortSignal.timeout(env.TIMEOUT_MS) });
  } catch {
    throw new ErrorApi(502, "No se pudo contactar a la API de tipo de cambio (timeout o red)");
  }

  if (!respuesta.ok) {
    throw new ErrorApi(
      502,
      `La API de tipo de cambio respondió con el estado ${respuesta.status}`,
    );
  }

  // Tambien puede fallar al leer el cuerpo (no es JSON, o salta el timeout):
  // es una falla del tercero, asi que corresponde 502 y no un 500.
  let datos: unknown;
  try {
    datos = await respuesta.json();
  } catch {
    throw new ErrorApi(502, "La API de tipo de cambio devolvió una respuesta que no es JSON válido");
  }

  // El JSON llega como `unknown`: hay que comprobar su forma antes de usarlo.
  if (typeof datos !== "object" || datos === null) {
    throw new ErrorApi(502, "La API de tipo de cambio devolvió una respuesta inesperada");
  }

  const cuerpo = datos as Record<string, unknown>;
  if (cuerpo["result"] === "error" && cuerpo["error-type"] === "unsupported-code") {
    throw new ErrorApi(400, `La moneda ${monedaOrigen} no está soportada`);
  }

  const tasa = extraerTasaUsd(cuerpo);
  if (tasa === undefined) {
    throw new ErrorApi(502, "La API de tipo de cambio devolvió una respuesta inesperada");
  }
  return tasa;
};

/** Navega { "rates": { "USD": 1.08 } } sin recurrir a `any`. */
function extraerTasaUsd(cuerpo: Record<string, unknown>): number | undefined {
  const tasas = cuerpo["rates"];
  if (typeof tasas !== "object" || tasas === null) return undefined;

  const usd = (tasas as Record<string, unknown>)["USD"];
  return typeof usd === "number" && Number.isFinite(usd) && usd > 0 ? usd : undefined;
}
