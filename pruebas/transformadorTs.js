import { stripTypeScriptTypes } from "node:module";

/**
 * Transformador de Jest para los archivos .ts.
 *
 * Hace exactamente lo mismo que Node al ejecutar `node src/servidor.ts`:
 * borra los tipos y deja el resto intacto. Asi los tests corren el mismo
 * codigo que corre la aplicacion, sin Babel, ts-jest ni otro compilador.
 *
 * Los tipos se reemplazan por espacios, por lo que lineas y columnas no se
 * mueven y no hace falta generar source maps.
 */
export default {
  process(codigo) {
    return { code: stripTypeScriptTypes(codigo) };
  },
};
