import type { RegistroAuditoria } from "../modelos/auditoria.ts";
import type { DocumentoAuditoria } from "./modelos/registroAuditoriaModelo.ts";

/** Un documento leido de MongoDB (con `.lean()`): trae el `_id` y la fecha como Date. */
export type DocumentoLeido = DocumentoAuditoria & { _id: { toString(): string } };

/**
 * Del documento de MongoDB al registro que ve el resto de la aplicacion: `_id`
 * pasa a `id` (texto), la fecha a texto ISO, y los campos opcionales ausentes
 * simplemente no aparecen.
 */
export function documentoARegistro(documento: DocumentoLeido): RegistroAuditoria {
  const registro: RegistroAuditoria = {
    id: documento._id.toString(),
    operacion: documento.operacion,
    entidad: documento.entidad,
    entidadId: documento.entidadId,
    ocurridoEn: documento.ocurridoEn.toISOString(),
  };
  if (documento.antes !== undefined) registro.antes = documento.antes;
  if (documento.despues !== undefined) registro.despues = documento.despues;
  if (documento.camposModificados !== undefined && documento.camposModificados.length > 0) {
    registro.camposModificados = documento.camposModificados;
  }
  if (documento.metadatos !== undefined) registro.metadatos = documento.metadatos;
  return registro;
}
