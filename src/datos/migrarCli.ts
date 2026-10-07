import { logger } from "../config/logger.ts";
import { sequelize } from "./conexiones.ts";
import { describirError } from "./describirError.ts";
import { deshacerUltima, estadoMigraciones, migrar } from "./migrar.ts";

/**
 * Comando de migraciones, para correr desde la terminal:
 *
 *   npm run migrar            -> aplica las pendientes
 *   npm run migrar:deshacer   -> deshace la ultima aplicada
 *   npm run migrar:estado     -> lista aplicadas y pendientes
 */
const comando = process.argv[2];

try {
  if (comando === "subir") {
    const aplicadas = await migrar();
    logger.info(aplicadas.length === 0 ? "No hay migraciones pendientes" : `Aplicadas: ${aplicadas.join(", ")}`);
  } else if (comando === "bajar") {
    const deshecha = await deshacerUltima();
    logger.info(deshecha === undefined ? "No hay migraciones para deshacer" : `Deshecha: ${deshecha}`);
  } else if (comando === "estado") {
    const { aplicadas, pendientes } = await estadoMigraciones();
    logger.info(`Aplicadas (${aplicadas.length}): ${aplicadas.join(", ") || "ninguna"}`);
    logger.info(`Pendientes (${pendientes.length}): ${pendientes.join(", ") || "ninguna"}`);
  } else {
    logger.error(`Comando desconocido "${String(comando)}". Usar: subir | bajar | estado`);
    process.exitCode = 1;
  }
} catch (error) {
  logger.error(`Falló la migración: ${describirError(error)}`);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
