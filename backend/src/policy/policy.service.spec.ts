import { readFileSync } from 'node:fs';
import { canonicalJson } from '../common/canonical-json.js';
import { parsePolicy } from './policy-schema.js';
import { checkRegistration, hashPolicy, PolicyRegistrationError, toRegisteredPolicy } from './policy.service.js';

describe('canonicalJson', () => {
  it('ignores key order at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ y: 1, x: 2 }] } })).toBe(canonicalJson({ a: { c: [{ x: 2, y: 1 }], d: 2 }, b: 1 }));
  });
  it('keeps array order (rule order matters)', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

const yaml = readFileSync(new URL('../../../policy/refund-policy.yaml', import.meta.url), 'utf8');

describe('hashPolicy', () => {
  const base = hashPolicy(parsePolicy(yaml));

  it('is a SHA-256 hex digest', () => {
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores comments and formatting', () => {
    const reformatted = yaml
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .map((line) => line.replace(/\s+#.*$/, ''))
      .join('\n\n');
    expect(hashPolicy(parsePolicy(reformatted))).toBe(base);
  });

  it('ignores the version label (it names the rules, it is not one of them)', () => {
    expect(hashPolicy({ ...parsePolicy(yaml), version: 'renamed' })).toBe(base);
  });

  it('changes when any rule changes', () => {
    expect(hashPolicy(parsePolicy(yaml.replace('value: 50000', 'value: 30000')))).not.toBe(base);
  });
});

describe('checkRegistration', () => {
  const document = parsePolicy(yaml);
  const hash = hashPolicy(document);
  const row = (overrides: object) => ({ id: 'v1', version: document.version, contentHash: hash, content: document, effectiveFrom: new Date(document.effectiveFrom), createdAt: new Date(), ...overrides });

  it('creates a first version', () => {
    expect(checkRegistration(document, hash, {})).toBeNull();
  });

  it('reuses the same file under the same label', () => {
    const existing = row({});
    expect(checkRegistration(document, hash, { sameVersion: existing, sameContent: existing, latest: existing })).toBe(existing);
  });

  it('refuses a label reused for different rules', () => {
    expect(() => checkRegistration(document, hash, { sameVersion: row({ contentHash: 'other' }) })).toThrow(/already registered with different rules/);
  });

  it('refuses identical rules under a second label', () => {
    expect(() => checkRegistration(document, hash, { sameContent: row({ version: 'old' }) })).toThrow(/already registered as version "old"/);
  });

  it('refuses a version that does not take effect after the latest', () => {
    const latest = row({ version: 'old', contentHash: 'other', effectiveFrom: new Date(document.effectiveFrom) });
    expect(() => checkRegistration(document, hash, { latest })).toThrow(PolicyRegistrationError);
    expect(checkRegistration(document, hash, { latest: { ...latest, effectiveFrom: new Date(0) } })).toBeNull();
  });
});

describe('toRegisteredPolicy', () => {
  const document = parsePolicy(yaml);
  const row = { id: 'v1', version: document.version, contentHash: hashPolicy(document), content: document, effectiveFrom: new Date(document.effectiveFrom), createdAt: new Date() };

  it('returns a validated policy', () => {
    expect(toRegisteredPolicy(row)).toMatchObject({ id: 'v1', version: document.version, document });
  });

  it('rejects a row edited after registration', () => {
    const content = { ...structuredClone(document), reviewEtaBusinessDays: 99 };
    expect(() => toRegisteredPolicy({ ...row, content })).toThrow(/integrity check/);
  });
});
