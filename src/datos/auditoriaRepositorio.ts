import type { FiltroAuditoria, NuevoRegistroAuditoria, RegistroAuditoria } from "../modelos/auditoria.ts";
import { documentoARegistro } from "./mapeoAuditoria.ts";
import type { DocumentoLeido } from "./mapeoAuditoria.ts";
import { RegistroAuditoriaModelo } from "./modelos/registroAuditoriaModelo.ts";

/**
 * Repositorio del historial de auditoria sobre MongoDB (Mongoose).
 *
 * Es el gemelo de `activosRepositorio` pero para el otro motor: la capa de
 * servicios lo usa sin saber que detras hay documentos y no filas.
 *
 * Es solo de ALTA y CONSULTA: un registro de auditoria no se modifica ni se borra.
 */

export async function registrar(registro: NuevoRegistroAuditoria): Promise<void> {
  await RegistroAuditoriaModelo.create({ ...registro, entidad: "Activo", ocurridoEn: new Date() });
}

/** El historial de un activo, del evento mas reciente al mas viejo. */
export async function historialDe(entidadId: string): Promise<RegistroAuditoria[]> {
  const documentos = await RegistroAuditoriaModelo.find({ entidadId })
    .sort({ ocurridoEn: -1, _id: -1 })
    .lean<DocumentoLeido[]>();
  return documentos.map(documentoARegistro);
}

/** El historial general, del mas reciente al mas viejo, con tope y filtro opcional por operacion. */
export async function listar(filtro: FiltroAuditoria): Promise<RegistroAuditoria[]> {
  const documentos = await RegistroAuditoriaModelo.find(
    filtro.operacion === undefined ? {} : { operacion: filtro.operacion },
  )
    .sort({ ocurridoEn: -1, _id: -1 })
    .limit(filtro.limite)
    .lean<DocumentoLeido[]>();
  return documentos.map(documentoARegistro);
}
