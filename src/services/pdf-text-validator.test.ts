import test from "node:test";
import assert from "node:assert/strict";
import { validateExtractedPdfText } from "./pdf-text-validator.js";

test("acepta texto extraído razonablemente bien formado", () => {
  const text = "El sistema debe permitir que un usuario autenticado recupere su contraseña. ".repeat(4);
  assert.equal(validateExtractedPdfText(text).valid, true);
});

test("rechaza texto OCR corto y con caracteres rotos", () => {
  const result = validateExtractedPdfText("A�\nb�\nc�\n□□□");
  assert.equal(result.valid, false);
  assert.ok(result.reasons.length >= 2);
});
