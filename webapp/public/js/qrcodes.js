// ---------- QR-code per kast: overlay met QR + downloaden/printen, en bulk-printvel voor alle
// kasten tegelijk (zie specs/qr-code-plan.md). QRCode is de globale klasse van de lokaal
// gebundelde qrcodejs-library (webapp/public/js/vendor/qrcode.min.js, zie index.html); rendert
// synchroon een <canvas> in het opgegeven containerelement.
import { state } from './state.js';
import { t } from './i18n.js';

// basispad afleiden van location.pathname i.p.v. een hardgecodeerde root ('/') — anders wijst een
// geprinte QR-sticker naar de verkeerde plek zodra de instance ooit achter een reverse-proxy op
// een subpad draait (zie specs/vervolgticket-commit-37d57ff.md §1c). origin blijft nodig: een
// QR-code moet een volwaardige, scanbare absolute URL bevatten, geen documentrelatieve link.
function basisPad(){
  let pad = location.pathname;
  if(pad.endsWith('index.html')) pad = pad.slice(0, -'index.html'.length);
  if(!pad.endsWith('/')) pad += '/';
  return pad;
}
function deepLink(kastId){
  return location.origin + basisPad() + '?mode=live&kast=' + encodeURIComponent(kastId);
}

function overlayEl(){ return document.getElementById('qrOverlay'); }

// rendert (onzichtbaar) een eigen QR-instantie en geeft meteen de canvas-dataURL terug — los van
// de zichtbare overlay-box, zodat de bulk-print meerdere kasten kan genereren zonder de overlay
// zelf te hoeven tonen
function genereerDataUrl(kastId){
  const tmp = document.createElement('div');
  tmp.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(tmp);
  new QRCode(tmp, { text: deepLink(kastId), width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  const dataUrl = tmp.querySelector('canvas').toDataURL('image/png');
  document.body.removeChild(tmp);
  return dataUrl;
}

export function openQrOverlay(k){
  const el = overlayEl();
  const box = document.getElementById('qrOverlayBox');
  box.innerHTML = '';
  const url = deepLink(k.id);
  new QRCode(box, { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  document.getElementById('qrOverlayNaam').textContent = k.naam;
  document.getElementById('qrOverlayAfk').textContent = (k.afkorting ? k.afkorting+' · ' : '') + url;
  document.getElementById('qrOverlayDownload').onclick = ()=>{
    const canvas = box.querySelector('canvas');
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'qr-' + (k.afkorting || k.id) + '.png';
    a.click();
  };
  document.getElementById('qrOverlayPrint').onclick = ()=> printEnkeleSticker(k);
  el.style.display = 'flex';
}

function printKasten(kasten){
  const items = kasten.map(k => ({ naam: k.naam, afk: k.afkorting || '', dataUrl: genereerDataUrl(k.id) }));
  const win = window.open('', '_blank');
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + t('beheer.qrPrintvelTitel') + '</title><style>' +
    'body{font-family:sans-serif;margin:20px;background:#fff;color:#111}' +
    '.sheet{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}' +
    '.sticker{border:1px dashed #ccc;border-radius:6px;padding:10px;text-align:center;break-inside:avoid}' +
    '.sticker img{width:100%;max-width:140px}' +
    '.sticker .t{font-size:12px;font-weight:700;margin-top:4px}' +
    '.sticker .a{font-size:10px;color:#555}' +
    '</style></head><body><div class="sheet">' +
    items.map(it => '<div class="sticker"><img src="'+it.dataUrl+'" alt=""><div class="t">'+it.naam+'</div><div class="a">'+it.afk+'</div></div>').join('') +
    '</div><script>window.onload=()=>window.print()<\/script></body></html>');
  win.document.close();
}

// vervolgticket-ui-schaal-en-qr-sticker.md §2: losse, single-sticker-printlayout i.p.v. de
// 4-koloms-bulk-sheet met daarin maar 1 item (bijna leeg vel, klein sticker'tje in de hoek — niet
// bruikbaar om direct op stickerpapier/labelvellen te printen). Eén groot, gecentreerd blok, geen
// grid — bruikbaar om uit te knippen of op een standaard labelvel te plakken.
function printEnkeleSticker(k){
  const dataUrl = genereerDataUrl(k.id);
  const win = window.open('', '_blank');
  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + t('beheer.qrPrintvelTitel') + '</title><style>' +
    'body{font-family:sans-serif;margin:0;background:#fff;color:#111;display:flex;align-items:center;justify-content:center;min-height:100vh}' +
    '.sticker{border:1px dashed #ccc;border-radius:10px;padding:24px;text-align:center}' +
    '.sticker img{width:350px;max-width:80vw}' +
    '.sticker .t{font-size:22px;font-weight:700;margin-top:12px}' +
    '.sticker .a{font-size:14px;color:#555;margin-top:2px}' +
    '</style></head><body><div class="sticker"><img src="'+dataUrl+'" alt=""><div class="t">'+k.naam+'</div><div class="a">'+(k.afkorting||'')+'</div></div>' +
    '<script>window.onload=()=>window.print()<\/script></body></html>');
  win.document.close();
}

export function initQrCodes(){
  document.getElementById('qrOverlayClose').onclick = ()=>{ overlayEl().style.display = 'none'; };
  overlayEl().addEventListener('click', (e)=>{ if(e.target === overlayEl()) overlayEl().style.display = 'none'; });
  document.getElementById('qrAllBtn').onclick = ()=>{
    // geen QR-codes voor batterijen (net als generators) — zie specs/qr-code-plan.md
    const kasten = state.TOPO.kasten.filter(k => k.type !== 'batterij');
    if(!kasten.length) return alert(t('beheer.qrGeenKasten'));
    printKasten(kasten);
  };
}
