// meertalige UI (NL/EN): platte dot-key vertaalbestanden, zie webapp/i18n/nl.json en en.json
// (gedeeld met server.js, zie specs/rebuild-plan-v2.md §11.2). Taalkeuze wordt onthouden in
// localStorage, zelfde patroon als de bestaande zoom-/sidebar-state.
const STORAGE_KEY = 'stroomdash_taal_v1';

export let huidigeTaal = 'nl';
try { huidigeTaal = localStorage.getItem(STORAGE_KEY) || 'nl'; } catch(e) {}
document.documentElement.lang = huidigeTaal;

// en-GB i.p.v. en-US voor Date#toLocaleString/-TimeString: houdt de 24-uursklok aan die de NL-kant
// ook gebruikt, i.p.v. een AM/PM-notatie erbij te introduceren als "toevallig" neveneffect van taal
export function huidigeLocale(){ return huidigeTaal === 'nl' ? 'nl-NL' : 'en-GB'; }

let dict = {};
async function laadDict(taal){
  const res = await fetch('/api/i18n/' + taal);
  dict = await res.json();
}
// top-level await: elke module die (transitief) main.js/i18n.js importeert wacht hierop, zodat
// t() overal al de juiste vertalingen heeft vóór de eerste render draait — geen losse init-stap
// of race tussen "taal geladen" en "eerste renderList()/renderBeheer()/etc." nodig.
await laadDict(huidigeTaal);

// {naam}-achtige placeholders in de vertaalstring vervangen door vars.naam — simpele string-
// interpolatie, geen library nodig voor dit aantal/soort teksten
export function t(key, vars){
  const str = dict[key];
  if(str == null){ console.warn('i18n: ontbrekende vertaalsleutel', key); return key; }
  if(!vars) return str;
  let result = str;
  for(const k in vars) result = result.split('{'+k+'}').join(vars[k]);
  return result;
}

// past vertalingen toe op statische markup in index.html (dingen die niet door een render*()-
// functie worden opgebouwd): data-i18n → textContent, data-i18n-html → innerHTML (vertaalstrings
// komen uit onze eigen JSON, dus vertrouwd, geen user input), data-i18n-placeholder → placeholder,
// data-i18n-title → title.
export function applyStaticI18n(root){
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.dataset.i18n); });
  scope.querySelectorAll('[data-i18n-html]').forEach(el=>{ el.innerHTML = t(el.dataset.i18nHtml); });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{ el.placeholder = t(el.dataset.i18nPlaceholder); });
  scope.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.title = t(el.dataset.i18nTitle); });
}

// taalkeuze-toggle in de header, zelfde visuele familie als .modeswitch (zie css/style.css
// .langswitch en specs/mockups/i18n-beheer-poc.html) — bewust twee altijd-zichtbare knoppen,
// geen dropdown/popup (zie de S10-precedent in specs/rebuild-plan-v2.md).
document.querySelectorAll('.langswitch [data-lang]').forEach(btn=>{
  btn.classList.toggle('active', btn.dataset.lang === huidigeTaal);
  btn.onclick = () => {
    if(btn.dataset.lang === huidigeTaal) return;
    try{ localStorage.setItem(STORAGE_KEY, btn.dataset.lang); }catch(e){}
    // eenvoudigste robuuste aanpak zonder build-stap: elk render*()-pad opnieuw laten vertalen
    // zou overal los t()-herstel vereisen; een herlaad is hier goedkoper en net zo snel (lokale
    // server), en de bestaande localStorage-state (zoom/sidebar/taal) blijft gewoon staan.
    location.reload();
  };
});

applyStaticI18n();
