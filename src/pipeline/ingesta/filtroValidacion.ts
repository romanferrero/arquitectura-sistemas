import { z } from "zod";
import { ErrorApi } from "../../errores/ErrorApi.ts";
import { CANTIDAD_MINIMA, PRECIO_MINIMO, VALOR_MAXIMO } from "../../modelos/limites.ts";
import { validarSimbolo } from "../../validaciones/activoValidacion.ts";
import type { Filtro } from "../pipeline.ts";
import type { ActivoEntrada } from "./tipos.ts";

/**
 * Primer filtro: comprueba la ESTRUCTURA del body con Zod. Solo valida, no
 * transforma: " btc " pasa tal cual y es el filtro siguiente quien lo limpia.
 *
 * Por eso las reglas de texto se evaluan sobre el valor ya recortado (con
 * refine) pero el valor que sale es el original. Los campos desconocidos se
 * descartan, como antes.
 *
 * Los mensajes se escriben a mano para mantener los del contrato anterior; el
 * cliente recibe TODOS los errores juntos, no solo el primero.
 */
const esquemaActivo = z.object(
  {
    simbolo: z
      .string({ error: "simbolo es obligatorio y debe ser un texto" })
      .refine(
        (valor) => validarSimbolo(valor) !== undefined,
        "simbolo debe tener entre 1 y 10 caracteres alfanuméricos (ej: BTC)",
      ),
    nombre: z
      .string({ error: "nombre es obligatorio y debe ser un texto" })
      .refine((valor) => valor.trim().length > 0, "nombre no puede estar vacío")
      .refine((valor) => valor.trim().length <= 50, "nombre no puede superar los 50 caracteres"),
    // Los refine de "minimo" dejan pasar los valores <= 0 para que un cero o un
    // negativo informe un solo error (el de positive) y no dos.
    cantidad: z
      .number({ error: "cantidad es obligatorio y debe ser un número" })
      .positive("cantidad debe ser mayor a 0")
      .refine(
        (valor) => valor <= 0 || valor >= CANTIDAD_MINIMA,
        `cantidad no puede ser menor a ${CANTIDAD_MINIMA.toFixed(8)} (admite 8 decimales)`,
      )
      .max(VALOR_MAXIMO, `cantidad no puede superar ${VALOR_MAXIMO}`),
    precioCompra: z
      .number({ error: "precioCompra es obligatorio y debe ser un número" })
      .positive("precioCompra debe ser mayor a 0")
      .refine(
        (valor) => valor <= 0 || valor >= PRECIO_MINIMO,
        `precioCompra no puede ser menor a ${PRECIO_MINIMO} (admite 2 decimales)`,
      )
      .max(VALOR_MAXIMO, `precioCompra no puede superar ${VALOR_MAXIMO}`),
    moneda: z
      .string({ error: "moneda debe ser un texto (ej: USD, EUR)" })
      .refine(
        (valor) => /^[A-Za-z]{3}$/.test(valor.trim()),
        "moneda debe ser un código de 3 letras (ej: USD, EUR)",
      )
      .optional(),
  },
  { error: "El cuerpo debe ser un objeto JSON" },
);

export const filtroValidacion: Filtro<unknown, ActivoEntrada> = {
  nombre: "FiltroValidacion",
  ejecutar(entrada, registrador) {
    const resultado = esquemaActivo.safeParse(entrada);
    if (!resultado.success) {
      throw new ErrorApi(
        400,
        "Datos del activo inválidos",
        resultado.error.issues.map((problema) => problema.message),
      );
    }

    registrador.info("Estructura del activo válida");
    return resultado.data;
  },
};
