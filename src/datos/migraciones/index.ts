import { migracion001 } from "./001-crear-activos.ts";
import type { Migracion } from "./tipos.ts";

/**
 * Lista EXPLICITA y ordenada de las migraciones.
 *
 * No se descubren buscando archivos en la carpeta (un glob): asi la lista es
 * identica corriendo desde `src/` con Node o desde `dist/` ya compilado, y el
 * compilador avisa si una migracion se borra o se renombra.
 *
 * Para agregar una: crear el archivo `00N-...ts` y sumarla al final de este array.
 * Nunca se edita ni se reordena una migracion que ya se aplico en algun entorno.
 */
export const migraciones: Migracion[] = [migracion001];
