(() => {
  // ---------- THEME ----------
  const THEME_KEY = 'mixtrackr.theme';
  const themeSelect = document.getElementById('themeSelect');

  function applyTheme(name){
    const val = name || 'default';
    document.documentElement.setAttribute('data-theme', val);
    if (themeSelect) themeSelect.value = val;
  }
  applyTheme(localStorage.getItem(THEME_KEY) || 'default');

  themeSelect?.addEventListener('change', () => {
    const val = themeSelect.value;
    applyTheme(val);
    try { localStorage.setItem(THEME_KEY, val); } catch {}
  });

  // ---------- ORIGINAL APP ----------
  const folderInput     = document.getElementById('folder');
  const collectionInput = document.getElementById('collection');
  const colStatus       = document.getElementById('collectionStatus');
  const fileListEl      = document.getElementById('filelist');
  const searchEl        = document.getElementById('search');
  const detailsCard     = document.getElementById('details');
  const welcomeCard     = document.getElementById('welcome');
  const emptyBox        = document.getElementById('empty');
  const dateTitle       = document.getElementById('dateTitle');
  const dateMeta        = document.getElementById('dateMeta');
  const tracklistEl     = document.getElementById('tracklist');
  const copyBtn         = document.getElementById('copyList');
  const exportTxt       = document.getElementById('exportTxt');
  const exportCsv       = document.getElementById('exportCsv');
  const countEl         = document.getElementById('count');
  const dropzone        = document.getElementById('dz');

  // --- create pager containers if they don't exist ---
  const ensurePager = (id, parent, beforeEl=null) => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'pager';
      if (beforeEl) parent.insertBefore(el, beforeEl.nextSibling);
      else parent.appendChild(el);
    }
    return el;
  };
  const filePagerEl  = ensurePager('filePager', fileListEl.parentElement);        // below sidebar list
  const trackPagerEl = ensurePager('trackPager', tracklistEl.parentElement);      // below tracklist

  // ---- pagination state ----
  const PAGE_SIZE_FILES  = 8;
  const PAGE_SIZE_TRACKS = 8;
  let filePage  = 1;
  let trackPage = 1;

  let files = []; let filtered = []; let current = null; let currentTracks = [];

  // Collection lookups
  let collectionLoaded = false;
  const keyToMeta     = new Map();  // AUDIO_ID or other keys -> meta
  const volPathToMeta = new Map();  // "d:/:hard techno/:file.mp3"
  const dirFileToMeta = new Map();  // "/:hard techno/:file.mp3"

  const byDateDesc = (a,b) => b.lastModified - a.lastModified;
  const fmtDate = (ms) => { try { return new Date(ms).toLocaleString(); } catch { return '' } };
  const looksLikeHistory = (name) => /\.nml$/i.test(name);
  const humanFile = (name) => (name.match(/(\d{4}-\d{2}-\d{2})/)?.[1]) || name.replace(/\.nml$/i,'');
  const lc = s => (s||'').toLowerCase();

  function makePrimaryKeyLike(volume, dir, file){
    return lc(`${volume||''}${dir||''}${file||''}`.replace(/\\/g,'/'));
  }
  function makeDirFile(dir, file){
    return lc(`${dir||''}${file||''}`.replace(/\\/g,'/'));
  }

  // ---------- COLLECTION ----------
  async function loadCollection(file){
    const text = await file.text();
    parseCollection(text);
    collectionLoaded = (volPathToMeta.size>0 || keyToMeta.size>0);
    if (collectionLoaded){
      colStatus.textContent = `Collection loaded (${volPathToMeta.size} paths, ${keyToMeta.size} keys)`;
      colStatus.className = 'status ok';
    } else {
      colStatus.textContent = 'Could not parse collection';
      colStatus.className = 'status warn';
    }
  }

  function parseCollection(xmlText){
    keyToMeta.clear(); volPathToMeta.clear(); dirFileToMeta.clear();
    try{
      const doc = new DOMParser().parseFromString(xmlText,"application/xml");
      const entries = Array.from(doc.querySelectorAll('COLLECTION > ENTRY, ENTRY'));

      entries.forEach(e=>{
        const info = e.querySelector('INFO');

        const artist =
          (info?.getAttribute('ARTIST') || e.getAttribute('ARTIST') ||
           e.querySelector('ARTIST')?.getAttribute('VALUE') || '').trim();

        const title  =
          (info?.getAttribute('TITLE')  || e.getAttribute('TITLE')  ||
           e.querySelector('TITLE') ?.getAttribute('VALUE')  || '').trim();

        const loc = e.querySelector('LOCATION');
        const volume = loc?.getAttribute('VOLUME') || '';
        const dir    = loc?.getAttribute('DIR')    || '';
        const file   = loc?.getAttribute('FILE')   || '';

        const meta = { artist, title, location: `${volume}${dir}${file}` };

        if (volume || dir || file){
          volPathToMeta.set(makePrimaryKeyLike(volume,dir,file), meta);
          dirFileToMeta.set(makeDirFile(dir,file), meta);
        }

        const aid = e.getAttribute('AUDIO_ID') || e.querySelector('AUDIO_ID')?.getAttribute('VALUE');
        if (aid) keyToMeta.set(lc(aid), meta);

        const pkNode = e.querySelector('PRIMARYKEY');
        const pk = pkNode?.getAttribute('KEY') || pkNode?.getAttribute('VALUE') || e.getAttribute('KEY');
        if (pk) keyToMeta.set(lc(pk), meta);
      });
    }catch(err){ console.error('Collection parse error', err); }
  }

// ---------- HISTORY ----------
function parseHistory(xmlText){
  let out = [];
  try{
    const doc = new DOMParser().parseFromString(xmlText,"application/xml");

    const pkNodes = doc.querySelectorAll('PLAYLIST ENTRY > PRIMARYKEY');
    if (pkNodes.length){
      pkNodes.forEach(pk=>{
        const keyRaw = pk.getAttribute('KEY') || '';
        const key = lc(keyRaw);
        let meta = volPathToMeta.get(key) || keyToMeta.get(key);

        if (!meta){
          const noDrive = key.replace(/^[a-z]:/,'');
          meta = dirFileToMeta.get(noDrive);
        }

        if (meta){
          out.push({ artist: meta.artist || '', title: meta.title || '' });
        } else {
          // Fallback: couldn't resolve against collection -> derive from filename
          const rawLast = key.split('/').pop() || keyRaw;
          // strip leading ":" from Traktor "/:" pieces and remove common audio extensions
          const cleaned = rawLast
            .replace(/^:/, '')
            .replace(/\.(mp3|wav|aiff|flac|m4a)$/i, '')
            .trim();

          // Try to parse "Artist - Title" if present in the filename
          let artistFromName = '';
          let titleFromName  = cleaned;
          const parts = cleaned.split(/\s*-\s*/);
          if (parts.length >= 2) {
            artistFromName = parts.shift().trim();
            titleFromName  = parts.join(' - ').trim();
          }

          out.push({
            artist: artistFromName || '',
            title:  titleFromName  || cleaned
          });
        }
      });
    } else {
      // Fallback for inline INFO/ARTIST/TITLE in history
      doc.querySelectorAll('ENTRY > INFO').forEach(n=>{
        const artist=(n.getAttribute('ARTIST')||'').trim();
        const title =(n.getAttribute('TITLE') ||'').trim();
        if (artist||title) out.push({artist,title});
      });
      doc.querySelectorAll('ENTRY').forEach(e=>{
        const a=e.querySelector('ARTIST')?.getAttribute('VALUE')||'';
        const t=e.querySelector('TITLE') ?.getAttribute('VALUE')||'';
        if (a||t) out.push({artist:a.trim(),title:t.trim()});
      });
    }

    // De-dup while preserving order
    const seen = new Set();
    out = out.filter(t=>{
      const k = `${t.artist||''}|${t.title||''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  } catch(e){
    console.error('History parse error', e);
    out = [];
  }
  return out;
}

  // ---------- PAGER HELPER ----------
  function renderPager(container, totalItems, pageSize, currentPage, onChange){
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    container.innerHTML = '';
    if (totalPages <= 1) return;

    const mkBtn = (label, page, disabled=false, active=false) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (disabled) b.disabled = true;
      if (active) b.classList.add('active');
      b.addEventListener('click', () => onChange(page));
      return b;
    };

    container.appendChild(mkBtn(' Prev', Math.max(1, currentPage - 1), currentPage === 1));

    const windowSize = 5;
    const total = totalPages;
    let start = Math.max(1, currentPage - Math.floor(windowSize/2));
    let end   = Math.min(total, start + windowSize - 1);
    if (end - start + 1 < windowSize) start = Math.max(1, end - windowSize + 1);

    if (start > 1) container.appendChild(mkBtn('1', 1, false, currentPage===1));
    if (start > 2) { const dot = document.createElement('span'); dot.textContent=''; dot.style.padding='0 4px'; container.appendChild(dot); }

    for (let p=start; p<=end; p++){
      container.appendChild(mkBtn(String(p), p, false, p===currentPage));
    }

    if (end < total-1) { const dot2 = document.createElement('span'); dot2.textContent=''; dot2.style.padding='0 4px'; container.appendChild(dot2); }
    if (end < total) container.appendChild(mkBtn(String(total), total, false, currentPage===total));

    container.appendChild(mkBtn('Next ', Math.min(totalPages, currentPage + 1), currentPage === totalPages));
  }

  // ---------- UI (with pagination) ----------
  function renderList(){
    fileListEl.innerHTML='';
    if(!filtered.length){
      fileListEl.innerHTML='<div class="hint" style="padding:10px">No .nml files loaded yet.</div>';
      filePagerEl.innerHTML = '';
      return;
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE_FILES));
    filePage = Math.min(filePage, totalPages);
    const startIdx  = (filePage - 1) * PAGE_SIZE_FILES;
    const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE_FILES);

    pageItems.forEach(rec=>{
      const div=document.createElement('div');
      div.className='date-item'+(current&&current.name===rec.name?' active':'');
      div.dataset.name=rec.name;
      div.innerHTML=`
        <div><div class="name">${humanFile(rec.name)}</div><div class="meta">${rec.name}</div></div>
        <div class="meta">${fmtDate(rec.lastModified)}</div>`;
      div.addEventListener('click',()=>openFile(rec));
      fileListEl.appendChild(div);
    });

    renderPager(filePagerEl, total, PAGE_SIZE_FILES, filePage, (p)=>{ filePage = p; renderList(); });
  }

  function filterList(){
    const q=(searchEl.value||'').trim().toLowerCase();
    filtered = (!q) ? files.slice().sort(byDateDesc)
      : files.filter(f=>f.name.toLowerCase().includes(q)||humanFile(f.name).toLowerCase().includes(q)).sort(byDateDesc);
    filePage = 1; // reset page on filter
    renderList();
  }

  function renderTracks(){
    tracklistEl.innerHTML='';
    const total = currentTracks.length;
    if (!total){ trackPagerEl.innerHTML=''; return; }

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE_TRACKS));
    trackPage = Math.min(trackPage, totalPages);
    const startIdx  = (trackPage - 1) * PAGE_SIZE_TRACKS;
    const pageItems = currentTracks.slice(startIdx, startIdx + PAGE_SIZE_TRACKS);

    pageItems.forEach((t, i)=>{
      const li=document.createElement('li');
      const globalIdx = startIdx + i;
      li.innerHTML=`
        <div class="idx">${String(globalIdx+1).padStart(2,'0')}</div>
        <div>
          <div class="line-title">${t.title||'Unknown Title'}</div>
          <div class="line-artist">${t.artist||'Unknown Artist'}</div>
        </div>`;
      tracklistEl.appendChild(li);
    });

    renderPager(trackPagerEl, total, PAGE_SIZE_TRACKS, trackPage, (p)=>{ trackPage = p; renderTracks(); });
  }

// ---------- EXPORT FORMATS ----------
function asTextList(tracks) {
  return tracks
    .map((t, i) => 
      `${String(i + 1).padStart(2, "0")}  ${t.artist || "Unknown Artist"} - ${t.title || "Unknown Title"}`
    )
    .join("\n");
}

function asCSV(tracks) {
  const lines = [['#','Artist','Title']];
  tracks.forEach((t,i)=>lines.push([i+1,t.artist||'',t.title||'']));
  return lines.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
}

  async function openFile(rec){
    current=rec;
    [...document.querySelectorAll('.date-item')].forEach(el=>el.classList.toggle('active',el.dataset.name===rec.name));
    const text=await rec.file.text();
    const tracks=parseHistory(text);
    currentTracks=tracks;

    trackPage = 1;         // reset pager for new file
    renderTracks();        // draw paginated tracks

    welcomeCard.style.display='none';
    detailsCard.style.display='';
    emptyBox.style.display=tracks.length?'none':'';
    dateTitle.textContent=`History  ${humanFile(rec.name)}`;
    const colNote = collectionLoaded ? '' : '  (Tip: load collection.nml for full titles)';
    dateMeta.textContent=`${rec.name}  Modified ${fmtDate(rec.lastModified)}  ${tracks.length} tracks${colNote}`;

    exportTxt.disabled = exportCsv.disabled = (tracks.length===0);
    countEl.textContent = tracks.length ? `${tracks.length} tracks` : '';
  }

  function addFiles(fileList){
    const arr=Array.from(fileList).filter(f=>looksLikeHistory(f.name));
    if(!arr.length) return;
    const map=new Map(files.map(f=>[f.name,f]));
    arr.forEach(f=>map.set(f.name,{name:f.name,lastModified:f.lastModified,file:f}));
    files=Array.from(map.values());
    filePage = 1; // reset page when adding
    filterList();
    if(!current && files.length){ openFile(files.slice().sort(byDateDesc)[0]); }
  }

  function download(name,content,mime){
    const blob=new Blob([content],{type:mime});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
    document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},0);
  }

  exportTxt.addEventListener('click',()=>{ 
    if(!currentTracks.length) return;
    const base   = current ? humanFile(current.name) : 'tracklist';
    const header = current ? `MixTrackr  ${humanFile(current.name)} (${currentTracks.length} tracks)` : 'MixTrackr  Tracklist';
    const txt    = asTextList(currentTracks, { header, sep: "----------------------------------------" });
    download(`${base}.txt`, txt, 'text/plain;charset=utf-8');
  });

  exportCsv.addEventListener('click',()=>{ 
    if(!currentTracks.length) return;
    const base=current?humanFile(current.name):'tracklist';
    download(`${base}.csv`,asCSV(currentTracks),'text/csv;charset=utf-8');
  });

  copyBtn.addEventListener('click',async()=>{
    if(!currentTracks.length) return;
    try{
      const header = current ? `MixTrackr  ${humanFile(current.name)} (${currentTracks.length} tracks)` : '';
      await navigator.clipboard.writeText(asTextList(currentTracks, { header }));
      copyBtn.textContent='Copied';
      setTimeout(()=>copyBtn.textContent='Copy to Clipboard',1200);
    }catch{
      alert('Could not copy to clipboard. Export TXT instead.');
    }
  });

  folderInput.addEventListener('change',(e)=>addFiles(e.target.files));
  collectionInput.addEventListener('change',(e)=>{ if(e.target.files?.[0]) loadCollection(e.target.files[0]); });
  searchEl.addEventListener('input',filterList);

  // Drag & drop
  ;['dragenter','dragover'].forEach(evt=>dropzone.addEventListener(evt,e=>{
    e.preventDefault(); e.stopPropagation(); dropzone.classList.add('drag');
  }));
  ;['dragleave','drop'].forEach(evt=>dropzone.addEventListener(evt,e=>{
    e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('drag');
  }));
  dropzone.addEventListener('drop',e=>{
    const dt=e.dataTransfer;
    if(dt?.items){
      const arr=[]; for(const item of dt.items){
        if(item.kind==='file'){ const f=item.getAsFile(); if(f) arr.push(f); }
      } addFiles(arr);
    } else if(dt?.files){
      addFiles(dt.files);
    }
  });
})();
