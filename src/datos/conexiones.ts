import mongoose from "mongoose";
import { Sequelize } from "sequelize";
import { env } from "../config/env.ts";

/**
 * Conexiones a las dos bases. Este es el unico archivo que sabe como se llega
 * a MySQL y a MongoDB; el resto de la capa de datos importa `sequelize` o usa
 * mongoose ya conectados.
 *
 * Crear el objeto Sequelize no abre ninguna conexion: se conecta al primer uso
 * o al llamar conectarMysql().
 */
export const sequelize = new Sequelize(env.MYSQL_DATABASE, env.MYSQL_USER, env.MYSQL_PASSWORD, {
  dialect: "mysql",
  host: env.MYSQL_HOST,
  port: env.MYSQL_PORT,
  logging: false, // el SQL generado no se loguea; cambiar a console.log para depurar
});

/** Abre y comprueba la conexion con MySQL. Lanza si no puede autenticarse. */
export async function conectarMysql(): Promise<void> {
  await sequelize.authenticate();
}

/** Abre la conexion con MongoDB. Falla en 5 s si no encuentra el servidor. */
export async function conectarMongo(): Promise<void> {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5_000 });
}

/** Cierra ambas conexiones, aunque una de las dos falle al cerrarse. */
export async function cerrarConexiones(): Promise<void> {
  await Promise.allSettled([sequelize.close(), mongoose.disconnect()]);
}
