import { randomUUID } from "node:crypto";
import { registradorDe } from "../../config/logger.ts";
import * as repositorio from "../../datos/activosRepositorio.ts";
import { publicador } from "../../eventos/publicadorServicio.ts";
import { crearPipelineIngesta } from "../../pipeline/ingesta/pipelineIngesta.ts";
import { auditoria } from "../auditoriaServicio.ts";
import { cacheActivos } from "../cacheActivosServicio.ts";
import { obtenerTasaAUsd } from "../tasasServicio.ts";
import { crearComandosActivos } from "./crearComandosActivos.ts";

// Validacion, normalizacion y conversion de moneda: todo lo que le pasa a un activo antes de
// guardarse. Aca se le conectan el logger y la API de tasas.
const pipelineIngesta = crearPipelineIngesta({ registradorDe, obtenerTasa: obtenerTasaAUsd });

/** Los comandos de la aplicacion (crear, actualizar, eliminar): la fabrica ya conectada a MySQL, Redis y MongoDB. */
export const comandosActivos = crearComandosActivos({
  repositorio,
  ingestar: (cuerpo) => pipelineIngesta.ejecutar(cuerpo),
  auditoria,
  cache: cacheActivos,
  publicador,
  generarId: randomUUID,
  ahora: () => new Date(),
});
