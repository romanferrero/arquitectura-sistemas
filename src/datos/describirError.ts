/**
 * Texto util para loguear un error de base de datos.
 *
 * Los errores de conexion de Node/Sequelize suelen llegar con `message` vacio
 * (es un AggregateError); lo unico informativo es el nombre y el `code` del error
 * original, por ejemplo "SequelizeConnectionRefusedError: ECONNREFUSED".
 */
export function describirError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const codigo = (error as { parent?: { code?: unknown } }).parent?.code;
  const partes = [error.name, error.message, typeof codigo === "string" ? codigo : ""];
  return partes.filter((parte) => parte !== "").join(": ");
}
