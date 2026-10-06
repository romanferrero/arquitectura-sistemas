import { describe, expect, test } from "@jest/globals";
import { crearFiltroAnalisisRiesgo } from "../../../src/pipeline/analisis/filtroAnalisisRiesgo.ts";
import type { ActivoAnalizable, LoteDepurado } from "../../../src/pipeline/analisis/tipos.ts";
import { crearRegistroEnMemoria, registradorSilencioso } from "../../ayudas/registro.ts";

const umbrales = { montoUsd: 1000, volatilidad: 50 };

function activo(cambio: Partial<ActivoAnalizable> = {}): ActivoAnalizable {
  return {
    simbolo: "BTC",
    nombre: undefined,
    cantidad: 1,
    precioCompra: 100,
    volatilidad: undefined,
    ...cambio,
  };
}

function lote(...activos: ActivoAnalizable[]): LoteDepurado {
  return { recibidos: activos.length, activos };
}

async function evaluar(...activos: ActivoAnalizable[]) {
  const filtro = crearFiltroAnalisisRiesgo(umbrales);
  return await filtro.ejecutar(lote(...activos), registradorSilencioso);
}

describe("FiltroAnalisisRiesgo", () => {
  test("calcula el monto como cantidad por precio de compra", async () => {
    const { activos } = await evaluar(activo({ cantidad: 2.5, precioCompra: 100 }));

    expect(activos[0]?.monto).toBe(250);
  });

  test("un activo chico y sin volatilidad es normal, sin motivos", async () => {
    const { activos } = await evaluar(activo());

    expect(activos[0]).toMatchObject({ riesgo: "normal", motivosRiesgo: [] });
  });

  test("Whale Alert: un monto que supera el umbral es high_risk", async () => {
    const { activos } = await evaluar(activo({ cantidad: 11, precioCompra: 100 })); // 1100 > 1000

    expect(activos[0]).toMatchObject({ riesgo: "high_risk", motivosRiesgo: ["whale_alert"] });
  });

  test("un monto igual al umbral NO dispara la alerta: tiene que superarlo", async () => {
    const { activos } = await evaluar(activo({ cantidad: 10, precioCompra: 100 })); // 1000

    expect(activos[0]).toMatchObject({ riesgo: "normal", motivosRiesgo: [] });
  });

  test("una volatilidad que supera el umbral es high_risk", async () => {
    const { activos } = await evaluar(activo({ volatilidad: 50.01 }));

    expect(activos[0]).toMatchObject({ riesgo: "high_risk", motivosRiesgo: ["alta_volatilidad"] });
  });

  test("una volatilidad igual al umbral no alcanza", async () => {
    const { activos } = await evaluar(activo({ volatilidad: 50 }));

    expect(activos[0]).toMatchObject({ riesgo: "normal" });
  });

  test("si se cumplen los dos motivos los informa a ambos", async () => {
    const { activos } = await evaluar(activo({ cantidad: 11, precioCompra: 100, volatilidad: 90 }));

    expect(activos[0]).toMatchObject({
      riesgo: "high_risk",
      motivosRiesgo: ["whale_alert", "alta_volatilidad"],
    });
  });

  test("evalúa cada activo por separado y conserva el orden", async () => {
    const { activos } = await evaluar(
      activo({ simbolo: "BTC", cantidad: 11 }),
      activo({ simbolo: "ETH" }),
      activo({ simbolo: "SOL", volatilidad: 99 }),
    );

    expect(activos.map((a) => [a.simbolo, a.riesgo])).toEqual([
      ["BTC", "high_risk"],
      ["ETH", "normal"],
      ["SOL", "high_risk"],
    ]);
  });

  test("conserva el total de recibidos del lote", async () => {
    const filtro = crearFiltroAnalisisRiesgo(umbrales);

    const resultado = await filtro.ejecutar({ recibidos: 7, activos: [activo()] }, registradorSilencioso);

    expect(resultado.recibidos).toBe(7);
  });

  test("registra cada activo marcado y el total", async () => {
    const { lineas, registradorDe } = crearRegistroEnMemoria();
    const filtro = crearFiltroAnalisisRiesgo(umbrales);

    await filtro.ejecutar(
      lote(activo({ simbolo: "BTC", cantidad: 11, volatilidad: 90 }), activo({ simbolo: "ETH" })),
      registradorDe(filtro.nombre),
    );

    expect(lineas).toEqual([
      "[INFO] FiltroAnalisisRiesgo: BTC marcado como high_risk (whale_alert, alta_volatilidad)",
      "[INFO] FiltroAnalisisRiesgo: 1 de 2 activos marcados como high_risk",
    ]);
  });
});
