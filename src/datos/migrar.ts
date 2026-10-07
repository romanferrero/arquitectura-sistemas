import type { QueryInterface } from "sequelize";
import { SequelizeStorage, Umzug } from "umzug";
import { logger } from "../config/logger.ts";
import { sequelize } from "./conexiones.ts";
import { migraciones } from "./migraciones/index.ts";

/**
 * Ejecutor de migraciones (Umzug). Lleva el registro de cuales ya se aplicaron
 * en la tabla `migraciones` de la propia base, asi `migrar()` solo corre las que
 * faltan y se puede llamar las veces que haga falta.
 */
const umzug = new Umzug<QueryInterface>({
  migrations: migraciones.map((migracion) => ({
    name: migracion.nombre,
    up: async ({ context }) => migracion.up(context),
    down: async ({ context }) => migracion.down(context),
  })),
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize, tableName: "migraciones" }),
  logger: {
    info: (evento) => logger.info(describirEvento(evento)),
    warn: (evento) => logger.warn(describirEvento(evento)),
    error: (evento) => logger.error(describirEvento(evento)),
    debug: () => undefined,
  },
});

/** Los eventos de Umzug traen `event` y `name`; si falta alguno se muestra el evento entero. */
function describirEvento(evento: Record<string, unknown>): string {
  return typeof evento["event"] === "string" && typeof evento["name"] === "string"
    ? `Migración ${evento["event"]}: ${evento["name"]}`
    : `Migración: ${JSON.stringify(evento)}`;
}

/** Aplica todas las migraciones pendientes. Devuelve los nombres de las aplicadas. */
export async function migrar(): Promise<string[]> {
  const aplicadas = await umzug.up();
  return aplicadas.map((migracion) => migracion.name);
}

/** Deshace la ultima migracion aplicada. Devuelve su nombre, o undefined si no habia ninguna. */
export async function deshacerUltima(): Promise<string | undefined> {
  const [deshecha] = await umzug.down();
  return deshecha?.name;
}

/** Cuales se aplicaron y cuales faltan. */
export async function estadoMigraciones(): Promise<{ aplicadas: string[]; pendientes: string[] }> {
  const [aplicadas, pendientes] = await Promise.all([umzug.executed(), umzug.pending()]);
  return {
    aplicadas: aplicadas.map((migracion) => migracion.name),
    pendientes: pendientes.map((migracion) => migracion.name),
  };
}
