import { parse as parseYaml } from 'yaml';
import { collectRuleIssues } from './collect-rule-issues.js';
import { policyDocumentSchema, type PolicyDocument } from './policy.schema.js';
import { PolicyValidationError } from './policy-validation.error.js';

/**
 * Parses and fully validates policy YAML. Any problem is reported at load time
 * (application startup), never while a customer's request is being decided.
 */
export function parsePolicy(yamlText: string): PolicyDocument {
  let raw: unknown;
  try {
    // uniqueKeys: a duplicated key would otherwise silently override the first one.
    raw = parseYaml(yamlText, { uniqueKeys: true, prettyErrors: true });
  } catch (error) {
    throw new PolicyValidationError([`YAML syntax: ${(error as Error).message}`]);
  }

  const result = policyDocumentSchema.safeParse(raw);
  if (!result.success) {
    const format = (path: PropertyKey[], message: string) => `${path.map(String).join('.') || '(root)'}: ${message}`;
    const problems = result.error.issues.map((issue) => format(issue.path, issue.message));
    // The schema skips rule checks when the structure is broken; run them anyway
    // so the author sees every problem in one pass.
    for (const issue of collectRuleIssues(raw)) {
      const line = format(issue.path, issue.message);
      if (!problems.includes(line)) problems.push(line);
    }
    throw new PolicyValidationError(problems);
  }
  return result.data;
}
