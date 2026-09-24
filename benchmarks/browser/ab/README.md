# A/B intercalat pentru o singura schimbare

Masuratorile facute in navigari separate **nu sunt comparabile**. In sesiunea in
care s-a construit unealta asta, acelasi cod a dat `create 10k` = 40 ms si, zece
minute mai tarziu, 106 ms — s-a schimbat incarcarea masinii, nu codul. O
comparatie A/B facuta asa a raportat un castig de 29% acolo unde masuratoarea
corecta arata 0%.

Aici ambele variante sunt bundle-uri separate incarcate in **aceeasi pagina** si
masurate alternat, cu rotatie intre runde. Zgomotul cade pe amandoua deodata, iar
estimatorul este **minimul** (zgomotul doar adauga timp, nu scade niciodata).

## Folosire

Variantele trebuie sa stea **langa** fisierul pe care il inlocuiesc, ca importurile
lor relative sa se rezolve:

```bash
cp <varianta-veche> packages/dom/src/__ab-a.ts
cp <varianta-noua>  packages/dom/src/__ab-b.ts
cd benchmarks
node browser/ab/build.ts ../packages/dom/src/__ab-a.ts ../packages/dom/src/__ab-b.ts
node browser/serve.ts        # apoi deschide /ab/index.html si apasa "Ruleaza"
rm ../packages/dom/src/__ab-a.ts ../packages/dom/src/__ab-b.ts
```

Build-ul schimba doar `packages/dom/src/control.ts` (unde sta `For`), printr-un
plugin de rezolvare; restul grafului ramane identic, deci diferenta dintre
bundle-uri este exact schimbarea testata.

## Cum se citeste

Ruleaza de **cel putin trei ori**. Un castig este real doar daca apare cu acelasi
semn in toate rularile. Diferentele sub rezolutia masuratorii (aici ~0.1 ms) nu
inseamna nimic: la o operatie de 1.4 ms, asta e deja 7%.
