/**
 * Safe property assignment for data DECODED off the wire (untrusted).
 *
 * `obj["__proto__"] = x` invokes the prototype setter instead of creating an
 * own property, which can corrupt the value or inject a poisoned prototype
 * (CWE-1321 prototype pollution). `Object.defineProperty` always writes an OWN
 * property, neutralizing the setter, and preserves a correct round-trip even
 * for reserved keys such as `__proto__`/`constructor`.
 */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
