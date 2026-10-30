/**
 * Texto util para loguear un error de base de datos.
 *
 * Los errores de conexion de Node/Sequelize suelen llegar con `message` vacio
 * (es un AggregateError); lo unico informativo es el nombre y el `code` del error
 * original, por ejemplo "SequelizeConnectionRefusedError: ECONNREFUSED".
 */
export function describirError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  // El codigo puede venir en `parent` (Sequelize), en el propio error o en el primero de
  // los errores agrupados (el AggregateError de Node/redis cuando no se llega al servidor).
  const conCodigo = error as {
    parent?: { code?: unknown };
    code?: unknown;
    errors?: { code?: unknown }[];
  };
  const codigo = conCodigo.parent?.code ?? conCodigo.code ?? conCodigo.errors?.[0]?.code;
  const partes = [error.name, error.message, typeof codigo === "string" ? codigo : ""];
  return partes.filter((parte) => parte !== "").join(": ");
}
