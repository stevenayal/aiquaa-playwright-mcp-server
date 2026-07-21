import test from "node:test";
import assert from "node:assert/strict";
import { mapScenariosToRules } from "./scenario-mapper.js";

const feature = `Feature: Login

  Scenario: Login válido
    Given un usuario registrado
    When ingresa credenciales válidas
    Then accede al inicio

  Scenario: Login inválido
    Given un usuario registrado
    When ingresa una contraseña incorrecta
    Then ve un error
`;

test("aplica tags de reglas y reporta las no cubiertas", () => {
  const result = mapScenariosToRules(
    [feature],
    ["RN-001", "RN-002", "RN-003"],
    [{ scenario: "Login válido", rule_ids: ["RN-001"] }],
  );
  assert.match(result.features[0] ?? "", /@rule:RN-001/);
  assert.match(result.features[0] ?? "", /@rule:RN-002/);
  assert.deepEqual(result.uncoveredRuleIds, ["RN-003"]);
});
