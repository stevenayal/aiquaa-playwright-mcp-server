export interface PdfTextValidation {
  valid: boolean;
  reasons: string[];
  metrics: {
    length: number;
    alphanumericRatio: number;
    suspiciousCharacterRatio: number;
    brokenWordBreaks: number;
  };
}

export function validateExtractedPdfText(text: string): PdfTextValidation {
  const normalized = text.trim();
  const length = normalized.length;
  const alphanumeric = (normalized.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const suspicious = (normalized.match(/[�□■¤¦]{1}|[^\p{L}\p{N}\p{P}\p{Z}\r\n\t]/gu) ?? []).length;
  const brokenWordBreaks = (normalized.match(/[\p{L}]-?\n[\p{L}]/gu) ?? []).length;
  const alphanumericRatio = length === 0 ? 0 : alphanumeric / length;
  const suspiciousCharacterRatio = length === 0 ? 1 : suspicious / length;
  const reasons: string[] = [];

  if (length < 100) reasons.push("el texto tiene menos de 100 caracteres");
  if (alphanumericRatio < 0.55) reasons.push("hay muy pocos caracteres alfanuméricos");
  if (suspiciousCharacterRatio > 0.02) reasons.push("hay demasiados símbolos o caracteres de reemplazo");
  if (brokenWordBreaks > Math.max(4, Math.floor(length / 300))) {
    reasons.push("hay demasiados saltos de línea dentro de palabras");
  }
  const nonEmptyLines = normalized.split(/\r?\n/).filter((line) => line.trim()).length;
  if (nonEmptyLines > 10 && length / nonEmptyLines < 12) {
    reasons.push("las líneas son anormalmente cortas, posible extracción fragmentada");
  }

  return {
    valid: reasons.length === 0,
    reasons,
    metrics: { length, alphanumericRatio, suspiciousCharacterRatio, brokenWordBreaks },
  };
}
