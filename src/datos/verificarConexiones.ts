import mongoose from "mongoose";
import { logger } from "../config/logger.ts";
import { cerrarConexiones, conectarMongo, conectarMysql, sequelize } from "./conexiones.ts";
import { describirError } from "./describirError.ts";

/**
 * Comprueba que las dos bases respondan con la configuracion del .env:
 *
 *   npm run db:verificar
 *
 * Sirve para distinguir "no llega a la base" de "la app tiene un bug".
 */
let fallo = false;

try {
  await conectarMysql();
  const [filas] = await sequelize.query("SELECT VERSION() AS version");
  logger.info(`MySQL OK (version ${String((filas as { version: string }[])[0]?.version)})`);
} catch (error) {
  fallo = true;
  logger.error(`MySQL no responde: ${describirError(error)}`);
}

try {
  await conectarMongo();
  await mongoose.connection.db?.admin().ping();
  logger.info(`MongoDB OK (base ${mongoose.connection.name})`);
} catch (error) {
  fallo = true;
  logger.error(`MongoDB no responde: ${describirError(error)}`);
}

await cerrarConexiones();
if (fallo) process.exitCode = 1;
