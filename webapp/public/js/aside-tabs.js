// ---------- specs/live-viewport-grote-monitor-plan.md, fase 1e: Statuslijst/Detail-tabs voor de
// gedeelde Kalibreren/Live/Schema-aside ----------
// Alleen zichtbaar (CSS @media (orientation: portrait) in style.css) op een smal/hoog scherm — in
// landscape blijft #liveTabBar verborgen en heeft de .tab-detail-klasse geen enkel effect (de
// bijbehorende CSS-regels zitten allemaal binnen dezelfde media-query), dus deze module is
// landscape-neutraal. Eigen, dependency-loze module (geen import van render-list.js/render-
// detail.js) zodat render-detail.js 'm kan aanroepen (auto-wisselen naar Detail bij een selectie)
// zonder een circulaire import tussen render-list.js en render-detail.js te introduceren.
const asideEl = document.querySelector('aside');

export function toonLijstTab(){
  asideEl.classList.remove('tab-detail');
  document.getElementById('liveTabLijst').classList.add('on');
  document.getElementById('liveTabDetail').classList.remove('on');
}
export function toonDetailTab(){
  asideEl.classList.add('tab-detail');
  document.getElementById('liveTabDetail').classList.add('on');
  document.getElementById('liveTabLijst').classList.remove('on');
}

document.getElementById('liveTabLijst').onclick = toonLijstTab;
document.getElementById('liveTabDetail').onclick = toonDetailTab;
