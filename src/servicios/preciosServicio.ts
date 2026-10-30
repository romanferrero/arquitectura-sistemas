import { env } from "../config/env.ts";
import { ErrorApi } from "../errores/ErrorApi.ts";

/**
 * Integracion con la API externa de precios: CoinGecko.
 *
 * Se eligio CoinGecko porque es gratuita y NO requiere API key ni registro,
 * asi el ejercicio es reproducible por cualquiera sin credenciales.
 *
 * Su unica friccion es que identifica las monedas por un id interno
 * ("bitcoin") y no por el simbolo ("BTC"), por eso hace falta este mapa.
 * La alternativa era pedir /coins/list, que descarga ~15.000 monedas cada vez
 * solo para traducir un identificador.
 */
const IDS_COINGECKO: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  MATIC: "matic-network",
  LTC: "litecoin",
  AVAX: "avalanche-2",
};

/** Simbolos que la API sabe cotizar (se expone en el mensaje de error). */
export const SIMBOLOS_SOPORTADOS = Object.keys(IDS_COINGECKO);

/**
 * Devuelve la cotizacion actual del simbolo en la moneda configurada.
 *
 * Dos codigos de error bien distintos:
 *  - 404: el simbolo no esta en el mapa, la cotizacion no existe para nosotros.
 *         Ni siquiera se llega a llamar a CoinGecko.
 *  - 502: se llamo a CoinGecko y fallo. El error no es de nuestra aplicacion
 *         sino de un servicio de terceros, por eso no corresponde un 500.
 */
export async function obtenerPrecio(simbolo: string): Promise<number> {
  const idMoneda = IDS_COINGECKO[simbolo];
  if (idMoneda === undefined) {
    throw new ErrorApi(
      404,
      `No hay cotización disponible para ${simbolo}. ` +
        `Símbolos soportados: ${SIMBOLOS_SOPORTADOS.join(", ")}`,
    );
  }

  const datos = await consultarCoinGecko([idMoneda]);

  // El JSON llega como `unknown`: hay que comprobar su forma antes de usarlo.
  const precio = extraerPrecio(datos, idMoneda, env.MONEDA);
  if (precio === undefined) {
    throw new ErrorApi(502, "La API de precios devolvió una respuesta inesperada");
  }

  return precio;
}

/**
 * Cotizaciones de varios simbolos en UNA sola llamada a CoinGecko (la usa el reporte de
 * valoracion, que no puede pedir una cotizacion por activo). Devuelve solo los simbolos que
 * se pudieron cotizar: los que no estan en el mapa o que CoinGecko no devolvio quedan fuera
 * y quien llama decide que hacer con ellos. Si CoinGecko falla, lanza 502.
 */
export async function obtenerPrecios(simbolos: string[]): Promise<Map<string, number>> {
  const soportados = [...new Set(simbolos)].filter((simbolo) => IDS_COINGECKO[simbolo] !== undefined);
  const precios = new Map<string, number>();
  if (soportados.length === 0) return precios; // nada que cotizar: no se llama a CoinGecko

  const datos = await consultarCoinGecko(soportados.map((simbolo) => IDS_COINGECKO[simbolo] as string));
  for (const simbolo of soportados) {
    const precio = extraerPrecio(datos, IDS_COINGECKO[simbolo] as string, env.MONEDA);
    if (precio !== undefined) precios.set(simbolo, precio);
  }
  return precios;
}

/** Hace la llamada a CoinGecko y devuelve el JSON. Todo lo que falle ahi es un 502. */
async function consultarCoinGecko(ids: string[]): Promise<unknown> {
  const url = `${env.API_PRECIOS_URL}?ids=${ids.join(",")}&vs_currencies=${env.MONEDA}`;

  let respuesta: Response;
  try {
    // fetch es nativo en Node (no hace falta axios).
    // AbortSignal.timeout evita que una caida de CoinGecko cuelgue la request.
    respuesta = await fetch(url, { signal: AbortSignal.timeout(env.TIMEOUT_MS) });
  } catch {
    throw new ErrorApi(502, "No se pudo contactar a la API de precios (timeout o red)");
  }

  if (!respuesta.ok) {
    throw new ErrorApi(
      502,
      `La API de precios respondió con el estado ${respuesta.status}`,
    );
  }

  // Tambien puede fallar al leer el cuerpo (no es JSON, o salta el timeout):
  // es una falla del tercero, asi que corresponde 502 y no un 500.
  try {
    return await respuesta.json();
  } catch {
    throw new ErrorApi(502, "La API de precios devolvió una respuesta que no es JSON válido");
  }
}

/** Navega { "bitcoin": { "usd": 63500.12 } } sin recurrir a `any`. */
function extraerPrecio(datos: unknown, idMoneda: string, moneda: string): number | undefined {
  if (typeof datos !== "object" || datos === null) return undefined;

  const porMoneda = (datos as Record<string, unknown>)[idMoneda];
  if (typeof porMoneda !== "object" || porMoneda === null) return undefined;

  const precio = (porMoneda as Record<string, unknown>)[moneda];
  return typeof precio === "number" && Number.isFinite(precio) ? precio : undefined;
}
