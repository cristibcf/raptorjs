/**
 * Izolarea constructiei unei componente fata de computatia care o construieste.
 *
 * **Problema**, gasita la runda 3 de audit: o componenta care CITESTE un semnal
 * in timp ce isi construieste DOM-ul aboneaza computatia apelantului la acel
 * semnal. Daca apelantul e un binding reactiv - un `Show`, un `For`, orice
 * regiune dintr-o aplicatie reala - atunci prima interactiune cu componenta
 * re-ruleaza toata regiunea parinte:
 *
 * ```tsx
 * <Show when={loggedIn}>
 *   <DropdownMenu ... />   // deschiderea meniului reconstruia tot blocul
 * </Show>
 * ```
 *
 * Nu e doar risipa: regiunea reconstruita pierde identitatea nodurilor, deci
 * focusul, pozitia de scroll si ce era tastat intr-un input dispar.
 *
 * Masurat pe catalogul site-ului: 11 din 93 de componente interactive faceau
 * asta. Site-ul le impacheta el in `untracked(...)`, dar un ocol scris in
 * consumator inseamna ca oricine foloseste biblioteca da peste problema fara sa
 * stie de ce - deci locul reparatiei e aici.
 *
 * **Ce NU strica:** `untracked` goleste doar observatorul curent. Effect-urile
 * pornite inauntru isi fac propriile computatii, `onCleanup` ramane legat de
 * owner-ul corect, iar bindingurile din interiorul componentei raman fine-grained.
 * Se pierde exact lucrul nedorit: abonarea apelantului.
 */
import { untracked } from "@raptor/dom";

/** Construieste o componenta fara sa abonezi computatia apelantului. */
export function isolate<T>(build: () => T): T {
  return untracked(build);
}
