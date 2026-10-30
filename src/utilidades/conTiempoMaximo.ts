/**
 * Ejecuta una operacion asincrona con un tiempo maximo: si no termina a tiempo, rechaza con un
 * Error cuyo mensaje es `descripcion`. Lo usan la auditoria (MongoDB) y la cola de reportes
 * (Redis), que no pueden dejar la peticion esperando a una dependencia lenta.
 *
 * OJO: perder la carrera NO cancela la operacion. Sigue en curso y puede terminar despues
 * (por ejemplo, un registro que igual se guarda); quien llama tiene que tenerlo en cuenta.
 */
export async function conTiempoMaximo<T>(
  operacion: () => Promise<T>,
  tiempoMaximoMs: number,
  descripcion: string,
): Promise<T> {
  let temporizador: NodeJS.Timeout | undefined;
  try {
    // Dentro de una funcion async para que tambien un error sincronico sea un rechazo.
    const pendiente = (async () => await operacion())();
    // Si pierde la carrera contra el tiempo, evita un rechazo sin manejar mas tarde.
    pendiente.catch(() => undefined);

    const vencido = new Promise<never>((_resolver, rechazar) => {
      temporizador = setTimeout(() => rechazar(new Error(descripcion)), tiempoMaximoMs);
    });
    return await Promise.race([pendiente, vencido]);
  } finally {
    clearTimeout(temporizador);
  }
}
