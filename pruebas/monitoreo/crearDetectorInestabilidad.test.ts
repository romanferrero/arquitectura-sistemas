import { describe, expect, test } from "@jest/globals";
import { crearDetectorInestabilidad } from "../../src/monitoreo/crearDetectorInestabilidad.ts";

const MINUTO = 60_000;

function armar() {
  return crearDetectorInestabilidad({ maximo: 5, ventanaMs: MINUTO });
}

const api = (id: number, reinicios: number) => ({ nombre: "api", id, reinicios });

describe("crearDetectorInestabilidad", () => {
  test("la primera lectura solo fija el punto de partida: un proceso que ya llevaba muchos reinicios no alerta", () => {
    const detector = armar();

    expect(detector.observar([api(0, 40)], 0)).toEqual([]);
  });

  test("hasta 5 reinicios en un minuto NO alerta; el 6º sí", () => {
    const detector = armar();
    detector.observar([api(0, 0)], 0);

    expect(detector.observar([api(0, 5)], 10_000)).toEqual([]);
    expect(detector.observar([api(0, 6)], 15_000)).toEqual([{ nombre: "api", id: 0, reiniciosEnVentana: 6, ventanaMs: MINUTO }]);
  });

  test("cuenta cada reinicio aunque varios ocurran entre dos lecturas", () => {
    const detector = armar();
    detector.observar([api(0, 2)], 0);

    const alertas = detector.observar([api(0, 9)], 5_000); // +7 de golpe

    expect(alertas[0]?.reiniciosEnVentana).toBe(7);
  });

  test("los reinicios vencen: 5 hace más de un minuto más 1 ahora no son 6", () => {
    const detector = armar();
    detector.observar([api(0, 0)], 0);
    detector.observar([api(0, 5)], 1_000);

    expect(detector.observar([api(0, 6)], 1_000 + MINUTO + 1)).toEqual([]);
  });

  test("la ventana es deslizante: lo que cuenta es lo de los últimos 60 s, no el minuto del reloj", () => {
    const detector = armar();
    detector.observar([api(0, 0)], 0);
    detector.observar([api(0, 3)], 30_000);

    // 3 reinicios a los 30 s y 3 más a los 80 s: a los 80 s los primeros aun estan dentro (50 s atras).
    expect(detector.observar([api(0, 6)], 80_000)).toHaveLength(1);
    // Y a los 95 s, ya vencieron los de los 30 s (65 s atras): quedan 3.
    expect(detector.observar([api(0, 6)], 95_000)).toEqual([]);
  });

  test("cada instancia se cuenta por separado: 3 reinicios en cada una de dos instancias no alertan", () => {
    const detector = armar();
    detector.observar([api(0, 0), api(1, 0)], 0);

    expect(detector.observar([api(0, 3), api(1, 3)], 10_000)).toEqual([]);
  });

  test("distingue procesos con distinto nombre aunque tengan el mismo id", () => {
    const detector = armar();
    detector.observar([api(0, 0), { nombre: "worker", id: 0, reinicios: 0 }], 0);

    const alertas = detector.observar([api(0, 6), { nombre: "worker", id: 0, reinicios: 1 }], 10_000);

    expect(alertas.map((alerta) => alerta.nombre)).toEqual(["api"]);
  });

  test("un proceso que sigue inestable no se vuelve a avisar en cada lectura, sino una vez por ventana", () => {
    const detector = armar();
    detector.observar([api(0, 0)], 0);

    expect(detector.observar([api(0, 6)], 5_000)).toHaveLength(1);
    expect(detector.observar([api(0, 7)], 10_000)).toEqual([]); // sigue inestable, ya se aviso
    expect(detector.observar([api(0, 13)], 5_000 + MINUTO)).toHaveLength(1); // pasó una ventana y sigue con otros 6 reinicios
  });

  test("si se recupera y vuelve a inestabilizarse antes de que pase una ventana desde el último aviso, avisa de nuevo", () => {
    const detector = armar();
    detector.observar([api(0, 0)], 0);
    detector.observar([api(0, 3)], 1_000);
    expect(detector.observar([api(0, 6)], 30_000)).toHaveLength(1); // 6 en el último minuto: aviso
    // A los 61 s vencieron los 3 primeros: quedan 3 (se recuperó) y no hay aviso.
    expect(detector.observar([api(0, 6)], 61_000)).toHaveLength(0);
    // Otro episodio a los 70 s, a solo 40 s del aviso anterior: 3 + 4 = 7 en la ventana. Tiene que avisar.
    const alertas = detector.observar([api(0, 10)], 70_000);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.reiniciosEnVentana).toBe(7);
  });

  test("si no hay reinicios nuevos no alerta nunca, por alto que sea el contador acumulado", () => {
    const detector = armar();
    detector.observar([api(0, 100)], 0);

    expect(detector.observar([api(0, 100)], 10_000)).toEqual([]);
    expect(detector.observar([api(0, 100)], 20_000)).toEqual([]);
  });

  test("un proceso que desaparece y vuelve a aparecer parte de cero", () => {
    const detector = armar();
    detector.observar([api(0, 0)], 0);
    detector.observar([api(0, 5)], 1_000);
    detector.observar([], 2_000); // se borro de PM2

    expect(detector.observar([api(0, 5)], 3_000)).toEqual([]); // vuelve: punto de partida
    expect(detector.observar([api(0, 6)], 4_000)).toEqual([]); // 1 reinicio, no 6
  });

  test("el máximo y la ventana son configurables", () => {
    const detector = crearDetectorInestabilidad({ maximo: 1, ventanaMs: 1_000 });
    detector.observar([api(0, 0)], 0);

    expect(detector.observar([api(0, 2)], 500)).toHaveLength(1);
  });
});
