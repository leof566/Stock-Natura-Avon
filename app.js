/* Mi Stock Natura – Lógica principal (v3: venta rápida, historial, filtros por fecha) */
// Registro del Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
}

// IndexedDB util simple
const DB_NAME = 'mi-stock-natura';
const STORE = 'items';
let db;

function openDB(){
  return new Promise((res,rej)=>{
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('by_code','barcode',{unique:false});
    };
    req.onsuccess = ()=>{ db = req.result; res(db); };
    req.onerror = ()=>rej(req.error);
  });
}
function tx(mode){ return db.transaction(STORE, mode).objectStore(STORE); }
function addItem(obj){ return new Promise((res,rej)=>{ tx('readwrite').add(obj).onsuccess = e=>res(e.target.result); }); }
function updateItem(obj){ return new Promise((res,rej)=>{ tx('readwrite').put(obj).onsuccess=()=>res(); }); }
function deleteItem(id){ return new Promise((res,rej)=>{ tx('readwrite').delete(id).onsuccess=()=>res(); }); }
function getAll(){ return new Promise((res,rej)=>{ const r = tx('readonly').getAll(); r.onsuccess=()=>res(r.result||[]); }); }

// UI refs
const $ = s=>document.querySelector(s);
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

// F/M exclusividad básica
isFemaleEl.addEventListener('change',()=>{ if(isFemaleEl.checked) isMaleEl.checked=false; });
isMaleEl.addEventListener('change',()=>{ if(isMaleEl.checked) isFemaleEl.checked=false; });

// Estado global
let list = [];
let reader; // ZXing
let scanning = false;
let scanMode = 'ADD'; // 'ADD' | 'SALE'
let lastHit = '';
let lastHitAt = 0;

function toast(msg){
  toastEl.textContent = msg; toastEl.style.display='block';
  clearTimeout(toastEl._t); toastEl._t = setTimeout(()=>toastEl.style.display='none', 1600);
}

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
        <button class="btn-ghost" onclick="showHistory(${it.id})">Historial</button>
        <button class="btn-ghost" onclick="removeItem(${it.id})">Eliminar</button>
      </td>
    </tr>`
  }).join('');
  tbody.innerHTML = rows || `<tr><td colspan="7" style="color:#aaa">Sin productos aún.</td></tr>`;
  // backup auto
  localStorage.setItem('msn:autoBackup', JSON.stringify({when:Date.now(), data:list}));
  autoStamp.textContent = new Date().toLocaleString();
}

function addHistory(it, action, extra={}){
  it.history = Array.isArray(it.history) ? it.history : [];
  it.history.unshift({ ts: Date.now(), action, ...extra });
  if(it.history.length>200) it.history.length = 200;
}

window.showHistory = function(id){
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

// Exportar Excel (respeta filtros activos)
exportExcelBtn.addEventListener('click', ()=>{
  const data = getFiltered().map(it=>({
    Nombre: it.name,
    Codigo: it.barcode,
    Precio: it.price,
    F: it.female? 'F' : '',
    M: it.male? 'M' : '',
    Estado: it.status,
    Creado: new Date(it.createdAt||0).toLocaleString(),
    Vendido: it.soldAt ? new Date(it.soldAt).toLocaleString() : ''
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock');
  XLSX.writeFile(wb, 'mi-stock-natura.xlsx');
});

// Exportar PDF (respeta filtros activos)
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

// Backup/Restore JSON
backupBtn.addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(list,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'backup-mi-stock-natura.json';
  a.click();
});
restoreFile.addEventListener('change', async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  const text = await file.text();
  const arr = JSON.parse(text);
  for(const it of arr){
    const obj = {
      name: it.name||'Sin nombre',
      barcode: it.barcode||'',
      price: it.price||'0',
      female: !!it.female,
      male: !!it.male,
      status: it.status||'DISPONIBLE',
      createdAt: it.createdAt || Date.now(),
      soldAt: it.soldAt || null,
      history: Array.isArray(it.history)? it.history : []
    };
    addHistory(obj,'CREADO');
    await addItem(obj);
  }
  load();
});

// Instalación PWA (instrucción básica)
installHint.addEventListener('click', ()=>{
  alert('Para instalar: en Android/Chrome tocá ⋮ > "Agregar a pantalla principal". En iOS/Safari: Compartir > "Agregar a pantalla de inicio".');
});

// Escáner
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
          // BarcodeDetector detecta sobre un ImageBitmap o ImageData
          const bitmap = await createImageBitmap(grabCanvas);
          const barcodes = await detector.detect(bitmap);
          if(barcodes.length){
            const code = barcodes[0].rawValue;
            if(scanMode==='ADD'){
              barcodeEl.value = code; beep.currentTime=0; beep.play(); stopScan();
            } else {
              handleQuickSale(code);
            }
          }
        }catch(e){ /* silencio */ }
        requestAnimationFrame(loop);
      };
      loop();
    } else {
      // Fallback ZXing
      reader = new ZXingBrowser.BrowserMultiFormatReader();
      const devices = await ZXingBrowser.BrowserCodeReader.listVideoInputDevices();
      const deviceId = (devices.find(d=>/back|environment/i.test(d.label))||devices[0]||{}).deviceId;
      await reader.decodeFromVideoDevice(deviceId, video, (result,err)=>{
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
  if(code===lastHit && (now-lastHitAt)<1500) return; // anti-duplicado rápido
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
  if(reader){ try{ reader.reset(); }catch(_){} }
}
scanBtn.addEventListener('click', ()=>toggleScan('ADD'));
quickSaleBtn.addEventListener('click', ()=>toggleScan('SALE'));

// Init
(async()=>{ await openDB(); await load(); })();
