/* Mi Stock Natura – v4: deudores + calculadora + mejoras */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
}

const DB_NAME = 'mi-stock-natura';
const STORE = 'items';
const DEB_STORE = 'debtors';
let db;

function openDB(){
  return new Promise((res,rej)=>{
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)){
        const s = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('by_code','barcode',{unique:false});
      }
      if(!db.objectStoreNames.contains(DEB_STORE)){
        const d = db.createObjectStore(DEB_STORE, { keyPath: 'id', autoIncrement: true });
        d.createIndex('by_name','name',{unique:false});
      }
    };
    req.onsuccess = ()=>{ db = req.result; res(db); };
    req.onerror = ()=>rej(req.error);
  });
}
function tx(name, mode){ return db.transaction(name, mode).objectStore(name); }
// Items
function addItem(obj){ return new Promise((res)=>{ tx(STORE,'readwrite').add(obj).onsuccess=e=>res(e.target.result); }); }
function updateItem(obj){ return new Promise((res)=>{ tx(STORE,'readwrite').put(obj).onsuccess=()=>res(); }); }
function deleteItem(id){ return new Promise((res)=>{ tx(STORE,'readwrite').delete(id).onsuccess=()=>res(); }); }
function getAll(){ return new Promise((res)=>{ const r = tx(STORE,'readonly').getAll(); r.onsuccess=()=>res(r.result||[]); }); }
// Debtors
function dAdd(obj){ return new Promise((res)=>{ tx(DEB_STORE,'readwrite').add(obj).onsuccess=e=>res(e.target.result); }); }
function dUpdate(obj){ return new Promise((res)=>{ tx(DEB_STORE,'readwrite').put(obj).onsuccess=()=>res(); }); }
function dDelete(id){ return new Promise((res)=>{ tx(DEB_STORE,'readwrite').delete(id).onsuccess=()=>res(); }); }
function dAll(){ return new Promise((res)=>{ const r = tx(DEB_STORE,'readonly').getAll(); r.onsuccess=()=>res(r.result||[]); }); }

// Helpers
const $ = s=>document.querySelector(s);
const money = n => Number(n||0).toLocaleString('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0});
function amt(v){ if(v===undefined||v===null) return 0; const n = parseFloat(String(v).replace(/[^\d.,-]/g,'').replace(',','.')); return isNaN(n)?0:n; }

// Items UI refs
const nameEl = $('#name');
const barcodeEl = $('#barcode');
const priceEl = $('#price');
const isFemaleEl = $('#isFemale');
const isMaleEl = $('#isMale');
const statusEl = $('#status');
const addBtn = $('#addBtn');
const tbody = $('#tbody');
const searchEl = $('#search');
const filterStateEl = $('#filterState');
const exportExcelBtn = $('#exportExcel');
const exportPDFBtn = $('#exportPDF');
const backupBtn = $('#backupBtn');
const restoreFile = $('#restoreFile');
const autoStamp = $('#autoStamp');
const scanBtn = $('#scanBtn');
const quickSaleBtn = $('#quickSaleBtn');
const scanBox = $('#scanBox');
const video = $('#video');
const beep = $('#beep');
const installHint = $('#installHint');
const dateFromEl = $('#dateFrom');
const dateToEl = $('#dateTo');
const dateModeEl = $('#dateMode');
const toastEl = $('#toast');
const historyModal = $('#historyModal');
const historyContent = $('#historyContent');
const closeHistBtn = $('#closeHist');
const grabCanvas = document.getElementById('grabCanvas');

// Debtors UI refs
const debNameEl = $('#debName');
const debAmountEl = $('#debAmount');
const debAddBtn = $('#debAddBtn');
const debSearchEl = $('#debSearch');
const debExportExcelBtn = $('#debExportExcel');
const debTbody = $('#debTbody');

// Calculator refs
const calcDisplay = $('#calcDisplay');

// F/M exclusividad
isFemaleEl?.addEventListener('change',()=>{ if(isFemaleEl.checked) isMaleEl.checked=false; });
isMaleEl?.addEventListener('change',()=>{ if(isMaleEl.checked) isFemaleEl.checked=false; });

// Estado
let list = [];
let debtors = [];
let reader; // ZXing
let scanning = false;
let scanMode = 'ADD';
let lastHit = ''; let lastHitAt = 0;

function toast(msg){
  toastEl.textContent = msg; toastEl.style.display='block';
  clearTimeout(toastEl._t); toastEl._t = setTimeout(()=>toastEl.style.display='none', 1600);
}

// ---------- Inventario ----------
function getFiltered(){
  const q = (searchEl.value||'').toLowerCase();
  const f = filterStateEl.value;
  const mode = (dateModeEl.value||'CREACION');
  const df = dateFromEl.value ? new Date(dateFromEl.value + 'T00:00:00').getTime() : null;
  const dt = dateToEl.value ? new Date(dateToEl.value + 'T23:59:59').getTime() : null;

  return list.filter(it=>{
    const okText = it.name.toLowerCase().includes(q) || String(it.barcode||'').includes(q);
    const okState = (f==='ALL') || (it.status===f);
    let okDate = true;
    if(df || dt){
      const key = mode==='VENTA' ? (it.soldAt||null) : (it.createdAt||null);
      if(key==null) okDate = false; else {
        if(df && key < df) okDate = false;
        if(dt && key > dt) okDate = false;
      }
    }
    return okText && okState && okDate;
  });
}

function render(){
  const rows = getFiltered().map(it=>{
    return `<tr>
      <td contenteditable onblur="edit(${it.id},'name',this.innerText)">${it.name}</td>
      <td contenteditable onblur="edit(${it.id},'barcode',this.innerText)">${it.barcode||''}</td>
      <td contenteditable onblur="edit(${it.id},'price',this.innerText)">${it.price}</td>
      <td style="text-align:center"><input type="checkbox" ${it.female?'checked':''} onchange="toggleFM(${it.id},'F')"></td>
      <td style="text-align:center"><input type="checkbox" ${it.male?'checked':''} onchange="toggleFM(${it.id},'M')"></td>
      <td class="state ${it.status==='VENDIDO'?'vend':'dispo'}">${it.status}</td>
      <td>
        <button class="btn-ghost" onclick="toggleState(${it.id})">Cambiar estado</button>
        <button class="btn-ghost" onclick="showHistory('item',${it.id})">Historial</button>
        <button class="btn-ghost" onclick="removeItem(${it.id})">Eliminar</button>
      </td>
    </tr>`
  }).join('');
  tbody.innerHTML = rows || `<tr><td colspan="7" style="color:#aaa">Sin productos aún.</td></tr>`;
  localStorage.setItem('msn:autoBackup', JSON.stringify({when:Date.now(), items:list, debtors}));
  autoStamp.textContent = new Date().toLocaleString();
}

function addHistory(it, action, extra={}){
  it.history = Array.isArray(it.history) ? it.history : [];
  it.history.unshift({ ts: Date.now(), action, ...extra });
  if(it.history.length>300) it.history.length = 300;
}

window.showHistory = function(kind, id){
  if(kind==='item'){
    const it = list.find(x=>x.id===id); if(!it){ alert('No encontrado'); return; }
    const rows = (it.history||[]).map(h=>{
      const when = new Date(h.ts).toLocaleString();
      let label = h.action;
      if(h.action==='CREADO') label = 'Creado';
      if(h.action==='VENTA') label = 'Vendido';
      if(h.action==='STATUS') label = `Estado: ${h.status}`;
      if(h.action==='EDIT') label = `Editado: ${h.field}`;
      return `<div class="chip" style="width:100%;justify-content:space-between"><span>${when}</span><span>${label}</span></div>`
    }).join('') || '<div class="tiny">Sin movimientos.</div>';
    historyContent.innerHTML = rows;
  } else {
    const it = debtors.find(x=>x.id===id); if(!it){ alert('No encontrado'); return; }
    const rows = (it.history||[]).map(h=>{
      const when = new Date(h.ts).toLocaleString();
      let label = h.action;
      if(h.action==='NEW') label = `Alta de deuda ${money(h.amount)}`;
      if(h.action==='CHARGE') label = `Ajuste deuda ${money(h.amount)}`;
      if(h.action==='PAYMENT') label = `Pago recibido ${money(h.amount)}`;
      return `<div class="chip" style="width:100%;justify-content:space-between"><span>${when}</span><span>${label}</span></div>`
    }).join('') || '<div class="tiny">Sin movimientos.</div>';
    historyContent.innerHTML = rows;
  }
  historyModal.style.display='flex';
}
closeHistBtn.addEventListener('click',()=> historyModal.style.display='none');
historyModal.addEventListener('click', (e)=>{ if(e.target===historyModal) historyModal.style.display='none'; });

window.toggleState = async function(id){
  const it = list.find(x=>x.id===id); if(!it) return;
  it.status = it.status === 'VENDIDO' ? 'DISPONIBLE' : 'VENDIDO';
  if(it.status==='VENDIDO'){ it.soldAt = Date.now(); addHistory(it,'STATUS',{status:'VENDIDO'}); }
  else { it.soldAt = null; addHistory(it,'STATUS',{status:'DISPONIBLE'}); }
  await updateItem(it); load();
}
window.removeItem = async function(id){ await deleteItem(id); load(); }
window.edit = async function(id,field,val){
  const it = list.find(x=>x.id===id); if(!it) return;
  if(field==='price'){ val = val.replace(/[^0-9.,]/g,''); }
  const old = it[field];
  it[field] = val;
  addHistory(it,'EDIT',{field, from:old, to:val});
  await updateItem(it); load();
}
window.toggleFM = async function(id,which){
  const it = list.find(x=>x.id===id); if(!it) return;
  if(which==='F'){ it.female = !it.female; if(it.female) it.male=false; }
  if(which==='M'){ it.male = !it.male; if(it.male) it.female=false; }
  addHistory(it,'EDIT',{field:which==='F'?'female':'male'});
  await updateItem(it); load();
}

async function load(){ list = await getAll(); render(); }

addBtn.addEventListener('click', async ()=>{
  const obj = {
    name: (nameEl.value||'').trim() || 'Sin nombre',
    barcode: (barcodeEl.value||'').trim(),
    price: (priceEl.value||'0').trim(),
    female: !!isFemaleEl.checked,
    male: !!isMaleEl.checked,
    status: statusEl.value,
    createdAt: Date.now(),
    soldAt: null,
    history: []
  };
  addHistory(obj,'CREADO');
  await addItem(obj);
  nameEl.value = barcodeEl.value = priceEl.value = '';
  isFemaleEl.checked = isMaleEl.checked = false;
  statusEl.value = 'DISPONIBLE';
  load();
});

searchEl.addEventListener('input', render);
filterStateEl.addEventListener('change', render);
dateFromEl.addEventListener('change', render);
dateToEl.addEventListener('change', render);
dateModeEl.addEventListener('change', render);

// Exportar Excel (Inventario)
exportExcelBtn.addEventListener('click', ()=>{
  const data = getFiltered().map(it=>({
    Nombre: it.name, Codigo: it.barcode, Precio: it.price,
    F: it.female? 'F' : '', M: it.male? 'M' : '', Estado: it.status,
    Creado: new Date(it.createdAt||0).toLocaleString(),
    Vendido: it.soldAt ? new Date(it.soldAt).toLocaleString() : ''
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock');
  XLSX.writeFile(wb, 'mi-stock-natura.xlsx');
});

// Exportar PDF (Inventario)
exportPDFBtn.addEventListener('click', ()=>{
  const rows = getFiltered();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'p', unit:'pt', format:'a4'});
  doc.setFont('helvetica','bold');
  doc.setFontSize(16); doc.text('Mi Stock Natura', 40, 40);
  doc.setFontSize(10);
  let y = 70;
  const headers = ['Nombre','Código','Precio','F','M','Estado'];
  doc.text(headers.join('  |  '), 40, y);
  y += 12; doc.line(40,y,555,y); y+=16;
  rows.forEach(it=>{
    const row = [it.name, String(it.barcode||''), String(it.price||''), it.female?'F':'', it.male?'M':'', it.status].join('  |  ');
    doc.text(row.substring(0,120), 40, y); y+=14;
    if(y>780){ doc.addPage(); y=40; }
  });
  doc.save('mi-stock-natura.pdf');
});

// Backup/Restore JSON (items + debtors)
backupBtn.addEventListener('click', async ()=>{
  const payload = { items: list, debtors };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'backup-mi-stock-natura.json';
  a.click();
});
restoreFile.addEventListener('change', async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  const itemsArr = Array.isArray(data) ? data : (data.items || []);
  const debtArr = Array.isArray(data) ? [] : (data.debtors || []);
  for(const it of itemsArr){
    const obj = {
      name: it.name||'Sin nombre',
      barcode: it.barcode||'',
      price: it.price||'0',
      female: !!it.female, male: !!it.male,
      status: it.status||'DISPONIBLE',
      createdAt: it.createdAt || Date.now(),
      soldAt: it.soldAt || null,
      history: Array.isArray(it.history)? it.history : []
    };
    addHistory(obj,'CREADO');
    await addItem(obj);
  }
  for(const d of debtArr){
    const ob = {
      name: d.name||'Sin nombre',
      totalDebt: Number(d.totalDebt||0),
      totalPaid: Number(d.totalPaid||0),
      createdAt: d.createdAt || Date.now(),
      history: Array.isArray(d.history)? d.history : []
    };
    await dAdd(ob);
  }
  await load(); await dLoad();
});

// Instalación PWA
installHint?.addEventListener('click', ()=>{
  alert('Para instalar: en Android/Chrome tocá ⋮ > "Agregar a pantalla principal". En iOS/Safari: Compartir > "Agregar a pantalla de inicio".');
});

// Escáner + venta rápida
let readerZX;
async function toggleScan(mode='ADD'){
  if(scanning){ stopScan(); return; }
  scanMode = mode;
  scanBox.style.display='block';
  scanning = true; lastHit=''; lastHitAt=0;
  try {
    if(window.BarcodeDetector){
      const detector = new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e','code_128','code_39','codabar','qr_code']});
      const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
      video.srcObject = stream; await video.play();
      const track = stream.getVideoTracks()[0];
      const cap = new ImageCapture(track);
      const ctx = grabCanvas.getContext('2d');
      const loop = async()=>{
        if(!scanning) return;
        try{
          const frame = await cap.grabFrame();
          grabCanvas.width = frame.width; grabCanvas.height = frame.height;
          ctx.drawImage(frame,0,0);
          const bitmap = await createImageBitmap(grabCanvas);
          const barcodes = await detector.detect(bitmap);
          if(barcodes.length){
            const code = barcodes[0].rawValue;
            if(scanMode==='ADD'){ barcodeEl.value = code; beep.currentTime=0; beep.play(); stopScan(); }
            else { handleQuickSale(code); }
          }
        }catch(e){}
        requestAnimationFrame(loop);
      };
      loop();
    } else {
      readerZX = new ZXingBrowser.BrowserMultiFormatReader();
      const devices = await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
      const deviceId = (devices.find(d=>/back|environment/i.test(d.label))||devices[0]||{}).deviceId;
      await readerZX.decodeFromVideoDevice(deviceId, video, (result,err)=>{
        if(result){
          const code = result.getText();
          if(scanMode==='ADD'){ barcodeEl.value = code; beep.currentTime=0; beep.play(); stopScan(); }
          else { handleQuickSale(code); }
        }
      });
    }
  } catch(err){
    alert('No se pudo acceder a la cámara. Permití el uso de cámara o usá carga manual.');
    stopScan();
  }
}
async function handleQuickSale(code){
  const now = Date.now();
  if(code===lastHit && (now-lastHitAt)<1500) return;
  lastHit = code; lastHitAt = now;
  const candidate = list.find(it=>it.barcode==code && it.status==='DISPONIBLE');
  if(!candidate){
    const exists = list.some(it=>it.barcode==code);
    toast(exists? 'No hay disponibles (ya vendidos)' : 'Código no encontrado');
    return;
  }
  candidate.status='VENDIDO'; candidate.soldAt=Date.now(); addHistory(candidate,'VENTA',{barcode:code});
  await updateItem(candidate); await load();
  beep.currentTime=0; beep.play();
  toast(`Vendido: ${candidate.name}`);
}
function stopScan(){
  scanning=false; scanBox.style.display='none';
  if(video.srcObject){ video.srcObject.getTracks().forEach(t=>t.stop()); video.srcObject=null; }
  if(readerZX){ try{ readerZX.reset(); }catch(_){} }
}
scanBtn?.addEventListener('click', ()=>toggleScan('ADD'));
quickSaleBtn?.addEventListener('click', ()=>toggleScan('SALE'));

// ---------- Deudores ----------
function dRender(){
  const q = (debSearchEl.value||'').toLowerCase();
  const rows = debtors
    .filter(d => d.name.toLowerCase().includes(q))
    .map(d=>{
      const saldo = Number(d.totalDebt||0) - Number(d.totalPaid||0);
      return `<tr>
        <td contenteditable onblur="debEdit(${d.id},'name',this.innerText)">${d.name}</td>
        <td contenteditable onblur="debEdit(${d.id},'totalDebt',this.innerText)">${Number(d.totalDebt||0)}</td>
        <td>${Number(d.totalPaid||0)}</td>
        <td class="${saldo>0?'vend':'dispo'}">${saldo}</td>
        <td>
          <button class="btn-ghost" onclick="debCharge(${d.id})">Ajustar deuda</button>
          <button class="btn-ghost" onclick="debPay(${d.id})">Pago</button>
          <button class="btn-ghost" onclick="showHistory('deb',${d.id})">Historial</button>
          <button class="btn-ghost" onclick="debRemove(${d.id})">Eliminar</button>
        </td>
      </tr>`
    }).join('');
  debTbody.innerHTML = rows || '<tr><td colspan="5" style="color:#aaa">Sin deudores aún.</td></tr>';
}

async function dLoad(){ debtors = await dAll(); dRender(); }

debAddBtn?.addEventListener('click', async ()=>{
  const name = (debNameEl.value||'').trim();
  const amount = amt(debAmountEl.value);
  if(!name){ alert('Ingresá un nombre'); return; }
  const obj = { name, totalDebt: amount, totalPaid: 0, createdAt: Date.now(), history: [] };
  obj.history.unshift({ts:Date.now(), action:'NEW', amount});
  await dAdd(obj);
  debNameEl.value = ''; debAmountEl.value = '';
  dLoad();
});

debSearchEl?.addEventListener('input', dRender);

window.debEdit = async function(id, field, val){
  const it = debtors.find(x=>x.id===id); if(!it) return;
  if(field==='totalDebt'){
    const before = Number(it.totalDebt||0);
    const newVal = amt(val);
    const diff = newVal - before;
    it.totalDebt = newVal;
    if(diff!==0) it.history.unshift({ts:Date.now(), action:'CHARGE', amount: diff});
  } else if(field==='name'){
    it.name = String(val).trim() || it.name;
  }
  await dUpdate(it); dLoad();
}
window.debCharge = async function(id){
  const it = debtors.find(x=>x.id===id); if(!it) return;
  const val = prompt('Ajuste de deuda (+ aumenta, - reduce)', '0');
  const amount = amt(val);
  if(!amount) return;
  it.totalDebt = Number(it.totalDebt||0) + amount;
  it.history.unshift({ts:Date.now(), action:'CHARGE', amount});
  await dUpdate(it); dLoad();
}
window.debPay = async function(id){
  const it = debtors.find(x=>x.id===id); if(!it) return;
  const val = prompt('Monto del pago recibido', '0');
  const amount = amt(val);
  if(!amount) return;
  it.totalPaid = Number(it.totalPaid||0) + amount;
  it.history.unshift({ts:Date.now(), action:'PAYMENT', amount});
  await dUpdate(it); dLoad();
}
window.debRemove = async function(id){ await dDelete(id); dLoad(); }

debExportExcelBtn?.addEventListener('click', ()=>{
  const data = debtors.map(d=>({
    Nombre: d.name,
    Deuda_Total: Number(d.totalDebt||0),
    Pagado: Number(d.totalPaid||0),
    Saldo: Number(d.totalDebt||0) - Number(d.totalPaid||0)
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Deudores');
  XLSX.writeFile(wb, 'deudores-mi-stock-natura.xlsx');
});

// ---------- Calculadora ----------
document.addEventListener('click', (e)=>{
  const b = e.target.closest('[data-c]'); if(!b) return;
  const c = b.getAttribute('data-c');
  let expr = calcDisplay.textContent.trim();
  if(expr==='0' && '0123456789.('.includes(c)) expr='';
  if(c==='C'){ expr='0'; }
  else if(c==='⌫'){ expr = expr.length>1 ? expr.slice(0,-1) : '0'; }
  else if(c==='='){
    const safe = expr.replace(/×/g,'*').replace(/÷/g,'/');
    if(/^[0-9+\-*/().%\s]+$/.test(safe)){
      try{ expr = String(Function('return ('+safe+')')()); }
      catch{ expr = 'Error'; }
    } else { expr='Error'; }
  } else {
    expr += c;
  }
  calcDisplay.textContent = expr;
});

(async()=>{ await openDB(); await load(); await dLoad(); })();
