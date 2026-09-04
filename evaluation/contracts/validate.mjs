/**
 * Contract validator — a sufficient subset of JSON Schema, zero dependencies.
 *
 * Nothing under `evaluation/` pulls npm packages (gate0 and provenance are both
 * dependency-free), and the validator is no exception. The supported keywords
 * cover exactly what the three contracts use:
 *   type (including the ["string","null"] form), const, enum, required,
 *   properties, additionalProperties:false, items, minItems, minLength,
 *   minimum, maximum, $ref (same-document #/definitions/… only)
 *
 * An unsupported keyword throws instead of being silently ignored. Silent
 * skipping would make a contract look enforced while it is not — the same class
 * of mistake as a checker that reports PASS for something it never examined.
 *
 * Usage:
 *   node evaluation/contracts/validate.mjs <schema.json> <data.json | data.jsonl>
 */

import { readFileSync } from "node:fs";

const SUPPORTED = new Set([
  "$schema", "$id", "title", "description", "definitions",
  "type", "const", "enum", "required", "properties", "additionalProperties",
  "items", "minItems", "minLength", "minimum", "maximum", "$ref",
]);

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(value, expected) {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  return actual === expected;
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`only same-document $ref is supported, got: ${ref}`);
  let node = root;
  for (const seg of ref.slice(2).split("/")) {
    node = node?.[seg];
    if (node === undefined) throw new Error(`cannot resolve $ref: ${ref}`);
  }
  return node;
}

/**
 * Validate one value. Returns a list of errors; empty means it passed.
 * Every error carries a path so it points at the offending field.
 */
export function validate(schema, value, root = schema, path = "$") {
  const errors = [];

  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) throw new Error(`unsupported schema keyword "${key}" at ${path}; refusing to ignore it silently`);
  }

  if (schema.$ref) {
    return validate(resolveRef(root, schema.$ref), value, root, path);
  }

  if ("const" in schema && value !== schema.const) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    return errors;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(value, t))) {
      errors.push(`${path}: type must be ${types.join("|")}, got ${typeOf(value)}`);
      return errors;
    }
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
    return errors;
  }

  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${path}: length must be >= ${schema.minLength}, got ${value.length}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}, got ${value}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}, got ${value}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: needs at least ${schema.minItems} item(s), got ${value.length}`);
    }
    if (schema.items) {
      value.forEach((item, i) => errors.push(...validate(schema.items, item, root, `${path}[${i}]`)));
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const req of schema.required ?? []) {
      if (!(req in value)) errors.push(`${path}: missing required field "${req}"`);
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) {
        errors.push(...validate(props[k], v, root, `${path}.${k}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: field "${k}" is not allowed`);
      }
    }
  }

  return errors;
}

export function loadSchema(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Validate a .json file (single object or array) or a .jsonl file (line by line). */
export function validateFile(schema, dataPath) {
  const text = readFileSync(dataPath, "utf8");
  const records = dataPath.endsWith(".jsonl")
    ? text.split("\n").filter((l) => l.trim()).map((l, i) => ({ i, value: JSON.parse(l) }))
    : (() => { const v = JSON.parse(text); return (Array.isArray(v) ? v : [v]).map((value, i) => ({ i, value })); })();

  const report = { total: records.length, failed: 0, errors: [] };
  for (const { i, value } of records) {
    const errs = validate(schema, value);
    if (errs.length) {
      report.failed += 1;
      report.errors.push(...errs.map((e) => `#${i} ${e}`));
    }
  }
  return report;
}

// ── CLI ──────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const [schemaPath, dataPath] = process.argv.slice(2);
  if (!schemaPath || !dataPath) {
    console.error("usage: node validate.mjs <schema.json> <data.json|data.jsonl>");
    process.exit(2);
  }
  const report = validateFile(loadSchema(schemaPath), dataPath);
  const shown = report.errors.slice(0, 20);
  if (report.failed === 0) {
    console.log(`ok  ${dataPath}: ${report.total} record(s) pass ${schemaPath}`);
    process.exit(0);
  }
  console.error(`FAIL  ${dataPath}: ${report.failed}/${report.total} record(s) fail ${schemaPath}`);
  for (const e of shown) console.error("  " + e);
  if (report.errors.length > shown.length) console.error(`  … ${report.errors.length - shown.length} more`);
  process.exit(1);
}
