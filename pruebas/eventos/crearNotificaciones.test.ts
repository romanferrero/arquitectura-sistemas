import { describe, expect, test } from "@jest/globals";
import { crearNotificaciones } from "../../src/eventos/crearNotificaciones.ts";
import { crearRegistroEnMemoria } from "../ayudas/registro.ts";
import { activoDePrueba, eventoActualizado, eventoCreado, eventoEliminado } from "../ayudas/eventosDePrueba.ts";

const UMBRAL_GENERAL = 100_000;

/** El activo de prueba vale 0,5 BTC x 30.000 = 15.000 USD. */
function armar(preferencias: Record<string, number | "falla"> = {}) {
  const registro = crearRegistroEnMemoria();
  const consultadas: string[] = [];
  const notificaciones = crearNotificaciones({
    obtenerPreferencias: async (usuario) => {
      consultadas.push(usuario);
      const limite = preferencias[usuario];
      if (limite === "falla") throw new Error("Redis no responde");
      return { limiteAlertaUsd: limite ?? UMBRAL_GENERAL };
    },
    umbralPorDefectoUsd: UMBRAL_GENERAL,
    registrador: registro.registradorDe("Notificaciones"),
  });
  return { notificaciones, consultadas, lineas: registro.lineas };
}

const notificadas = (lineas: string[]): string[] => lineas.filter((linea) => linea.includes("Notificación enviada al usuario"));

describe("notificaciones · Whale Alert", () => {
  test("un activo creado que supera el límite del usuario dispara la notificación a ESE usuario", async () => {
    const { notificaciones, lineas } = armar({ "auth0|ana": 10_000 });

    await notificaciones.notificar(eventoCreado);

    expect(notificadas(lineas)).toHaveLength(1);
    expect(lineas[0]).toContain("[INFO] Notificaciones: Notificación enviada al usuario auth0|ana");
    expect(lineas[0]).toContain("BTC vale 15000 USD y supera su límite de 10000 USD");
  });

  test("si no supera el límite del usuario no notifica", async () => {
    const { notificaciones, lineas } = armar({ "auth0|ana": 20_000 });

    await notificaciones.notificar(eventoCreado);

    expect(notificadas(lineas)).toEqual([]);
  });

  test("igualar el límite no alcanza: tiene que superarlo (misma regla que el análisis de riesgo)", async () => {
    const { notificaciones, lineas } = armar({ "auth0|ana": 15_000 });

    await notificaciones.notificar(eventoCreado);

    expect(notificadas(lineas)).toEqual([]);
  });

  test("el límite es el de cada usuario: el mismo monto alerta a uno y a otro no", async () => {
    const { notificaciones, lineas } = armar({ "auth0|ana": 10_000, "auth0|beto": 50_000 });

    await notificaciones.notificar(eventoCreado);
    await notificaciones.notificar({ ...eventoCreado, metadatos: { origen: "API", usuario: "auth0|beto" } });

    expect(notificadas(lineas)).toHaveLength(1);
    expect(notificadas(lineas)[0]).toContain("auth0|ana");
  });

  test("sin límite configurado rige el umbral general", async () => {
    const { notificaciones, lineas } = armar();
    const grande = { ...activoDePrueba, cantidad: 10 }; // 300.000 USD

    await notificaciones.notificar({ ...eventoCreado, despues: grande });
    await notificaciones.notificar(eventoCreado); // 15.000 USD

    expect(notificadas(lineas)).toHaveLength(1);
    expect(lineas[0]).toContain("supera su límite de 100000 USD");
  });

  test("si no se pueden leer las preferencias rige el umbral general, con un aviso, y no rechaza", async () => {
    const { notificaciones, lineas } = armar({ "auth0|ana": "falla" });
    const grande = { ...activoDePrueba, cantidad: 10 };

    await expect(notificaciones.notificar({ ...eventoCreado, despues: grande })).resolves.toBeUndefined();

    expect(lineas.some((linea) => linea.includes("[WARN]") && linea.includes("se usa el umbral general"))).toBe(true);
    expect(notificadas(lineas)).toHaveLength(1);
  });

  test("un evento sin usuario usa el umbral general y no consulta preferencias", async () => {
    const { notificaciones, consultadas, lineas } = armar();
    const grande = { ...activoDePrueba, cantidad: 10 };

    await notificaciones.notificar({ ...eventoCreado, despues: grande, metadatos: { origen: "API" } });

    expect(consultadas).toEqual([]);
    expect(notificadas(lineas)[0]).toContain("usuario desconocido");
  });
});

describe("notificaciones · qué eventos alertan", () => {
  test("una actualización que CAMBIA el monto y lo deja por encima del límite alerta", async () => {
    const { notificaciones, lineas } = armar({ "auth0|ana": 20_000 });
    // antes 15.000, después 2 x 30.000 = 60.000

    await notificaciones.notificar(eventoActualizado);

    expect(notificadas(lineas)).toHaveLength(1);
  });

  test("una actualización que no cambia el monto (solo el nombre) no vuelve a alertar", async () => {
    const { notificaciones, lineas } = armar({ "auth0|ana": 10_000 });

    await notificaciones.notificar({ ...eventoActualizado, despues: { ...activoDePrueba, nombre: "Bitcoin (largo plazo)" }, camposModificados: ["nombre"] });

    expect(notificadas(lineas)).toEqual([]);
  });

  test("una actualización que baja el monto por debajo del límite no alerta", async () => {
    const { notificaciones, lineas } = armar({ "auth0|ana": 100_000 });

    await notificaciones.notificar({ ...eventoActualizado, antes: { ...activoDePrueba, cantidad: 10 } });

    expect(notificadas(lineas)).toEqual([]);
  });

  test("eliminar un activo nunca alerta, por grande que fuera", async () => {
    const { notificaciones, consultadas, lineas } = armar({ "auth0|ana": 1 });

    await notificaciones.notificar(eventoEliminado);

    expect(notificadas(lineas)).toEqual([]);
    expect(consultadas).toEqual([]);
  });
});
