/**
 * Asignare sigura de proprietati pentru date DECODATE de pe fir (netagaduite).
 *
 * `obj["__proto__"] = x` invoca setter-ul de prototip in loc sa creeze o
 * proprietate proprie, ceea ce poate corupe valoarea sau injecta un prototip
 * otravit (CWE-1321 prototype pollution). `Object.defineProperty` scrie mereu o
 * proprietate PROPRIE, neutralizand setter-ul, si pastreaza round-trip-ul corect
 * chiar si pentru chei rezervate precum `__proto__`/`constructor`.
 */
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
