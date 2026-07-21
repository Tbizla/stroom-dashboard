// ---------- kast-databallon op de plattegrond (Live-modus), zie specs/kast-popup-mqtt-spec.md ----------
import { state, liveData, liveEnergyData, mapwrap, mapinner } from './state.js';
import { nodeById, genNaam, statusClass, maxFaseStroom } from './topology.js';
import { t } from './i18n.js';
import { faseSwatch } from './fasekleuren.js';

function fmtVeld(v, eenheid, decimals){
  if(v==null) return '—';
  const d = decimals==null ? 2 : decimals;
  return v.toFixed(d) + (eenheid ? ' '+eenheid : '');
}

export function renderKastPopup(){
  let el = document.getElementById('kastPopup');
  if(state.mode!=='live' || !state.openPopupKastId){
    if(el) el.remove();
    return;
  }
  const k = state.TOPO.kasten.find(x=>x.id===state.openPopupKastId);
  if(!k || !k.positie || k.positie.x_pct==null){
    state.openPopupKastId = null;
    if(el) el.remove();
    return;
  }

  if(!el){
    el = document.createElement('div');
    el.id = 'kastPopup';
    // buiten #mapinner (die het zoom-schaal-transform draagt) zodat de ballon zelf een constant
    // schermformaat houdt bij uit-/inzoomen — alleen het ankerpunt (de pin) volgt de kaart mee
    mapwrap.appendChild(el);
  }
  el.className = 'kastpopup';
  el.innerHTML = '';

  const arrow = document.createElement('div');
  arrow.className = 'kastpopup-arrow';
  el.appendChild(arrow);

  const closeBtn = document.createElement('div');
  closeBtn.className = 'kastpopup-close';
  closeBtn.textContent = '✕';
  closeBtn.onclick = ()=>{ state.openPopupKastId = null; renderKastPopup(); };
  el.appendChild(closeBtn);

  const head = document.createElement('div');
  head.className = 'kastpopup-head';
  const dot = document.createElement('span');
  dot.className = 'dot2 ' + statusClass(k);
  const naam = document.createElement('span');
  naam.className = 'naam';
  naam.textContent = (k.type==='batterij'?'🔋 ':'') + k.naam;
  head.appendChild(dot); head.appendChild(naam);
  el.appendChild(head);

  const gevoedVanaf = k.parent ? nodeById(k.parent).naam : genNaam(k.generator);
  const sub = document.createElement('div');
  sub.className = 'kastpopup-sub';
  sub.innerHTML = t('kastpopup.ratingSub', {rating: k.rating_a, bron: gevoedVanaf}) + '<br>' + k.mqtt_topic_prefix;
  el.appendChild(sub);

  const d = liveData[k.id];
  if(!d){
    const geen = document.createElement('div');
    geen.className = 'geendata';
    geen.textContent = t('kastpopup.geenDataBlok');
    el.appendChild(geen);
  } else {
    const tabel = document.createElement('table');
    tabel.innerHTML =
      '<tr><th></th><th>'+faseSwatch(0)+'A</th><th>'+faseSwatch(1)+'B</th><th>'+faseSwatch(2)+'C</th></tr>'+
      '<tr><td>'+t('kastpopup.stroom')+'</td><td>'+fmtVeld(d.a_current,'A')+'</td><td>'+fmtVeld(d.b_current,'A')+'</td><td>'+fmtVeld(d.c_current,'A')+'</td></tr>'+
      '<tr><td>'+t('kastpopup.spanning')+'</td><td>'+fmtVeld(d.a_voltage,'V',0)+'</td><td>'+fmtVeld(d.b_voltage,'V',0)+'</td><td>'+fmtVeld(d.c_voltage,'V',0)+'</td></tr>'+
      '<tr><td>'+t('kastpopup.actVermogen')+'</td><td>'+fmtVeld(d.a_act_power,'W',0)+'</td><td>'+fmtVeld(d.b_act_power,'W',0)+'</td><td>'+fmtVeld(d.c_act_power,'W',0)+'</td></tr>'+
      '<tr><td>'+t('kastpopup.schijnbVermogen')+'</td><td>'+fmtVeld(d.a_aprt_power,'VA',0)+'</td><td>'+fmtVeld(d.b_aprt_power,'VA',0)+'</td><td>'+fmtVeld(d.c_aprt_power,'VA',0)+'</td></tr>'+
      '<tr><td>'+t('kastpopup.cosPhi')+'</td><td>'+fmtVeld(d.a_pf,'',2)+'</td><td>'+fmtVeld(d.b_pf,'',2)+'</td><td>'+fmtVeld(d.c_pf,'',2)+'</td></tr>';
    el.appendChild(tabel);

    const totRow = document.createElement('div');
    totRow.className = 'kprow';
    totRow.innerHTML = '<span class="k">'+t('kastpopup.totaleStroom')+'</span><span>'+fmtVeld(d.total_current,'A')+'</span>';
    el.appendChild(totRow);
    const totRow2 = document.createElement('div');
    totRow2.className = 'kprow';
    totRow2.innerHTML = '<span class="k">'+t('kastpopup.totaalSchijnbVermogen')+'</span><span>'+fmtVeld(d.total_aprt_power,'VA',0)+'</span>';
    el.appendChild(totRow2);
  }

  const ed = liveEnergyData[k.id];
  const energieRow = document.createElement('div');
  energieRow.className = 'kprow';
  energieRow.innerHTML = '<span class="k">'+t('kastpopup.cumulatieveEnergie')+'</span><span>'+(ed && ed.total_act!=null ? (ed.total_act/1000).toFixed(2)+' kWh' : t('kastpopup.geenData'))+'</span>';
  el.appendChild(energieRow);

  // statusbalk: zelfde logica als de aside-detail (metingenHtml) — hoogste fase t.o.v. rating_a,
  // expliciet niet total_current tegen rating_a afzetten (zie README.md sectie 6)
  const maxFase = maxFaseStroom(d);
  const pct = maxFase!=null ? Math.min(100, (maxFase/k.rating_a)*100) : 0;
  const cls = pct>=90?'var(--red)':pct>=70?'var(--amber)':'var(--green)';
  const barwrap = document.createElement('div');
  barwrap.className = 'barwrap';
  barwrap.style.marginTop = '8px';
  barwrap.innerHTML = '<div class="bar" style="width:'+pct+'%;background:'+cls+'"></div>';
  el.appendChild(barwrap);

  const laatste = document.createElement('div');
  laatste.className = 'laatste';
  laatste.textContent = d ? t('kastpopup.laatsteUpdate', {n: Math.max(0, Math.round((Date.now()-d.ts)/1000))}) : t('kastpopup.laatsteGeen');
  el.appendChild(laatste);

  // positioneren t.o.v. de pin, boven met pijl naar beneden — of eronder/horizontaal verschoven
  // als de ballon anders buiten #mapwrap zou uitsteken, of over de zoom-knoppen (#zoomCtl, een
  // los overlay-element linksboven in #mainBody, geen onderdeel van mapwrap's scroll-inhoud) heen
  // zou vallen. Ankerpunt = de daadwerkelijke schermpositie van de pin (getBoundingClientRect, dus
  // altijd correct ongeacht zoom/pan), niet een herberekening uit x_pct — de ballon zelf staat
  // buiten #mapinner dus heeft geen eigen zoomschaal.
  const pinEl = mapinner.querySelector('.pin[data-id="'+CSS.escape(k.id)+'"]');
  if(!pinEl){ el.remove(); return; }
  const pinRect = pinEl.getBoundingClientRect();
  const wrapRect = mapwrap.getBoundingClientRect();
  const zoomCtlRect = document.getElementById('zoomCtl').getBoundingClientRect();
  const pinCenterX = pinRect.left + pinRect.width/2, pinCenterY = pinRect.top + pinRect.height/2;

  // in "inhoud-coördinaten" van mapwrap (schermpositie + huidige scroll) zetten, zodat de ballon
  // vanzelf meeschuift bij pannen tot de eerstvolgende herberekening (open/zoom/databericht)
  el.style.left = (pinCenterX - wrapRect.left + mapwrap.scrollLeft) + 'px';
  el.style.top = (pinCenterY - wrapRect.top + mapwrap.scrollTop) + 'px';
  el.style.transform = 'none';
  el.classList.remove('onder');
  const ownW = el.offsetWidth, ownH = el.offsetHeight;

  let dx = -ownW/2;
  let dy = -(ownH + 14);
  let onder = false;

  // effectieve bovengrens: normaal de rand van #mapwrap, maar lager (onder de zoom-knoppen) als
  // de ballon daar horizontaal overheen zou vallen
  const valtOverZoomCtl = !(pinCenterX+dx+ownW < zoomCtlRect.left || pinCenterX+dx > zoomCtlRect.right);
  const bovengrens = valtOverZoomCtl ? Math.max(wrapRect.top, zoomCtlRect.bottom) + 8 : wrapRect.top + 4;
  if(pinCenterY + dy < bovengrens){
    onder = true;
    el.classList.add('onder');
    dy = Math.max(14, bovengrens - pinCenterY);
  }

  if(pinCenterX + dx < wrapRect.left + 4){
    dx = wrapRect.left + 4 - pinCenterX;
  } else if(pinCenterX + dx + ownW > wrapRect.right - 4){
    dx = wrapRect.right - 4 - ownW - pinCenterX;
  }

  el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
  const arrowShift = dx - (-ownW/2);
  if(arrowShift) arrow.style.left = 'calc(50% - ' + arrowShift + 'px)';
}
