/* Local design prototype. No requests, account access, recordings or patient data. */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const icons = window.VUGA_ICONS || {};
  const symbols = window.VUGA_SYMBOLS || [];
  const categories = window.VUGA_CATEGORIES || [];
  const byId = Object.fromEntries(symbols.map(s => [s.id, s]));
  const coreOrder = ['I','WANT','HELP','WATER','EAT','PLAY','YES','NO','MORE','HURT','TOILET','FINISH'];
  const categoryOrders = {
    core: coreOrder,
    food: ['WATER','FOOD','EAT','DRINK','MORE','FINISH','HELP','NO'],
    actions: ['EAT','DRINK','PLAY','STOP','FINISH','HELP','WANT','MORE'],
    feelings: ['HAPPY','SAD','HURT','HELP','YES','NO'],
    people: ['I','MUM','DAD','TEACHER','FRIEND','THANK_YOU'],
    places: ['HOME','SCHOOL','TOILET','HELP']
  };
  const colours = { core:'#F9E5A4', food:'#F5D5B8', actions:'#DDEDE2', feelings:'#E7DFF4', people:'#F9E5A4', places:'#DDEBF4' };
  const state = { view:'board', category:'core', message:[], modal:null, activeProfile:'P-01', profiles:['P-01','P-02'], enabled:new Set(symbols.map(s=>s.id)), predictive:true, motion:!matchMedia('(prefers-reduced-motion: reduce)').matches, larger:false, vocabularyCategory:'all', search:'', fresh:false, screen:'board' };
  let returnFocus = null;
  const profileSettings = new Map();
  function rememberProfile() { profileSettings.set(state.activeProfile,{enabled:[...state.enabled],predictive:state.predictive,motion:state.motion,larger:state.larger}); }
  function selectProfile(code) {
    rememberProfile();state.activeProfile=code;
    const settings=profileSettings.get(code);
    state.enabled=new Set(settings?.enabled||symbols.map(s=>s.id));
    state.predictive=settings?.predictive??true;state.motion=settings?.motion??!matchMedia('(prefers-reduced-motion: reduce)').matches;state.larger=settings?.larger??false;
  }
  const safe = value => String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  function glyph(name, extra='') { return `<span class="icon ${extra}" aria-hidden="true">${icons[name] || icons.leaf || ''}</span>`; }
  function rawGlyph(svg, extra='') { return `<span class="icon ${extra}" aria-hidden="true">${svg || ''}</span>`; }
  function action(name, value='') { return `data-action="${name}"${value ? ` data-value="${safe(value)}"` : ''}`; }
  function brand() { return '<a class="brand" href="#board" aria-label="Vuga child board"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="wordmark">vuga</span></a>'; }
  function header(adult=false) {
    return `<header class="app-header">${brand()}<div class="app-title"><b>${adult ? 'Umurezi' : 'Amagambo yanjye'}</b><small>${adult ? 'A little care makes a big difference.' : 'A little space for every voice.'}</small></div><div class="header-actions"><span class="local-status"><i></i>${adult ? 'This device' : state.activeProfile}</span>${adult ? `<button class="button-outline" ${action('board')}>${glyph('back')}Back to board</button>` : `<button class="button-soft" ${action('adult')} aria-label="Umurezi · Caregiver settings">${glyph('settings')}Umurezi</button>`}</div></header>`;
  }
  function messageChip(symbol, index) { return `<div class="message-chip${state.fresh && index===state.message.length-1 ? ' fresh' : ''}" style="--chip:${colours[symbol.category]}">${rawGlyph(symbol.svg)}<span>${safe(symbol.label.toLowerCase())}</span></div>`; }
  function messagePanel() {
    const hasMessage = state.message.length>0;
    return `<section class="message-panel" aria-label="My message"><div class="message-panel-top"><h1>Ubutumwa bwanjye<small>My message</small></h1><div class="edit-actions"><button class="edit-button" ${action('delete')} ${hasMessage?'':'disabled'} aria-label="Delete last symbol">${glyph('back')}Siba</button><button class="edit-button" ${action('clear')} ${hasMessage?'':'disabled'} aria-label="Clear all symbols">${glyph('no')}Byose</button></div></div><div class="message-compose"><div class="message-tray ${hasMessage?'has-message':''}" aria-live="polite" aria-label="Message symbols">${hasMessage ? state.message.map((id,i)=>messageChip(byId[id],i)).join('') : `<div class="empty-message">${glyph('more')}<div><b>Kanda ku ishusho</b><small>Tap a picture to begin.</small></div></div>`}</div><div class="speak-actions"><button class="speak-button" ${action('speak')} ${hasMessage?'':'disabled'} aria-label="Vuga · Speak message">${glyph('speaker')}Vuga</button><button class="show-button" ${action('show')} ${hasMessage?'':'disabled'} aria-label="Erekana · Show message">${glyph('eye')}Erekana</button></div></div></section>`;
  }
  function suggestedIds() {
    let order = !state.message.length ? ['I','WANT','HELP'] : state.message.at(-1)==='I' ? ['WANT','HELP','PLAY'] : state.message.at(-1)==='WANT' ? ['WATER','FOOD','PLAY'] : ['MORE','YES','THANK_YOU'];
    return [...order,...coreOrder].filter((id,i,all)=>state.enabled.has(id)&&all.indexOf(id)===i).slice(0,3);
  }
  function suggestions() {
    return `<section class="suggestion-block" aria-label="Word suggestions"><div class="suggestion-header"><span class="suggestion-label">${glyph('leaf')}${state.predictive?'Birashoboka…':'Amagambo yawe'}</span><span class="suggestion-caption">${state.predictive?'Maybe you mean':'Your words, in familiar places'}</span></div>${state.predictive ? `<div class="suggestion-row">${suggestedIds().map(id=>{const s=byId[id];return `<button class="suggestion-tile" ${action('select',id)} data-focus="suggestion-${id}" aria-label="Suggestion: ${safe(s.label)}">${rawGlyph(s.svg)}<span>${safe(s.label.toLowerCase())}</span><span class="suggestion-plus" aria-hidden="true">+</span></button>`;}).join('')}</div>` : '<div class="static-hint">Choose any picture below. Your board stays in the same order.</div>'}</section>`;
  }
  function symbolTile(symbol) {
    return `<button class="symbol-tile ${state.message.includes(symbol.id)?'selected':''}" style="--tile-accent:${colours[symbol.category]}" ${action('select',symbol.id)} data-focus="symbol-${symbol.id}" aria-label="${safe(symbol.label)} · ${safe(symbol.en)}">${rawGlyph(symbol.svg)}<b>${safe(symbol.label.toLowerCase())}</b><small>${safe(symbol.en)}</small></button>`;
  }
  function childBoard() {
    const category = categories.find(c=>c.id===state.category) || categories[0];
    const visible = (categoryOrders[state.category]||coreOrder).filter(id=>state.enabled.has(id)&&byId[id]);
    return `${header()}<div class="board-layout"><nav class="category-sidebar" aria-label="Picture categories"><p class="sidebar-label">AMASHUSHO</p>${categories.map(c=>`<button class="category-button ${state.category===c.id?'active':''}" ${action('category',c.id)} data-focus="category-${c.id}" aria-pressed="${state.category===c.id}">${rawGlyph(c.svg)}<span class="category-copy"><b>${safe(c.label)}</b><small>${safe(c.en)}</small></span></button>`).join('')}<div class="sidebar-note">${glyph('leaf')}<b>Amagambo yawe.</b>Your words matter.</div></nav><div class="board-main"><div class="message-area">${messagePanel()}${suggestions()}</div><section class="symbol-area" aria-label="${safe(category.label)}"><div class="grid-heading"><h2>${safe(category.label)}<small>${safe(category.en)}</small></h2><span>${visible.length} pictures</span></div><div class="symbol-grid">${visible.length?visible.map(id=>symbolTile(byId[id])).join(''):`<div class="board-empty">${glyph('leaf')}<h3>Amashusho yawe</h3><p>Your pictures will be here. An adult can help you choose the words you need.</p><button class="button-outline" ${action('adult')}>${glyph('settings')}Umurezi</button></div>`}</div><div class="board-bottom"><span>${glyph('offline')}Ready on this device</span><div class="gentle-dots" aria-hidden="true"><i></i><i></i><i></i></div><span>Kinyarwanda first</span></div></section></div></div>`;
  }
  const adultTabs = [['profiles','people','Profiles'],['vocabulary','more','Vocabulary'],['preferences','settings','Board preferences'],['summary','leaf','Local summary']];
  function adultShell() {
    return `${header(true)}<div class="caregiver-layout"><nav class="adult-sidebar" aria-label="Caregiver navigation"><p class="sidebar-label">CAREGIVER SPACE</p>${adultTabs.map(([id,icon,label])=>`<button class="adult-nav-button ${state.view===id?'active':''}" ${action('adult-tab',id)} aria-current="${state.view===id?'page':'false'}">${glyph(icon)}${label}</button>`).join('')}<div class="adult-sidebar-bottom"><div class="device-card">${glyph('offline')}<strong>A familiar board, anywhere.</strong>Profiles and vocabulary stay on this device.</div></div></nav><section class="adult-main">${state.view==='profiles'?profilesScreen():state.view==='vocabulary'?vocabularyScreen():state.view==='preferences'?preferencesScreen():summaryScreen()}</section></div>`;
  }
  function heading(eyebrow,title,copy,art=false) { return `<div class="adult-heading"><div><div class="section-eyebrow">${eyebrow}</div><h1>${title}</h1><p>${copy}</p></div>${art?glyph('leaf'):''}</div>`; }
  function profilesScreen() {
    return `${heading('A BOARD THAT FEELS LIKE THEIRS','Every voice is different.','Choose a profile and make a little space for the words that matter.',true)}<div class="mini-stats"><div class="mini-stat">${glyph('people')}<div><b>${state.profiles.length} profiles</b><small>On this device</small></div></div><div class="mini-stat" style="--stat:#F7E7B5">${glyph('more')}<div><b>${state.enabled.size} pictures</b><small>In the current board</small></div></div><div class="mini-stat" style="--stat:#E7E0F2">${glyph('offline')}<div><b>Offline ready</b><small>No account needed</small></div></div></div><div class="adult-section-title"><h2>Choose a profile</h2><span>Participant codes only</span></div><div class="profile-grid">${state.profiles.map((code,i)=>`<button class="profile-card ${state.activeProfile===code?'current':''}" ${action('profile',code)} aria-pressed="${state.activeProfile===code}">${state.activeProfile===code?'<span class="current-badge">CURRENT</span>':''}<div class="profile-avatar" style="--avatar:${i%2?'#F4E4B5':'#E4E8D7'}">${glyph(i%2?'happy':'leaf')}</div><h3>${safe(code)}</h3><p>Personal communication board</p><small>Saved on this device</small></button>`).join('')}<button class="new-profile-card" ${action('new-profile')}><span class="add-circle" aria-hidden="true">+</span><b>Add a profile</b><small>A new space for their words</small></button></div><div class="caregiver-bottom-grid"><div class="setup-card"><h2>Start with familiar words.</h2><p>Choose meaningful pictures together. You can keep the board small and add more when needed.</p><div class="mini-board">${['I','WATER','HELP','YES'].map(id=>`<span class="mini-symbol" style="--chip:${colours[byId[id].category]}">${rawGlyph(byId[id].svg)}</span>`).join('')}</div><button class="text-button" ${action('adult-tab','vocabulary')}>Choose vocabulary <span aria-hidden="true">→</span></button></div><div class="setup-card warm-card">${glyph('speaker')}<h2>A voice that feels familiar.</h2><p>Kinyarwanda recordings need to be added and reviewed. The visual message is always there to share.</p><button class="text-button" ${action('adult-tab','preferences')}>Review board settings <span aria-hidden="true">→</span></button></div></div>`;
  }
  function vocabularyScreen() {
    const search=state.search.toLowerCase().trim();
    const list=symbols.filter(s=>(state.vocabularyCategory==='all'||s.category===state.vocabularyCategory)&&(!search||s.label.toLowerCase().includes(search)||s.en.toLowerCase().includes(search)));
    return `${heading(`VOCABULARY · ${safe(state.activeProfile)}`,'The right words for their day.','Select the pictures that belong on this board. Keep room for choices, refusal, help and everyday conversation.')}<div class="vocabulary-toolbar"><label class="search-field">${glyph('eye')}<input id="vocabulary-search" data-focus="vocabulary-search" type="search" placeholder="Find a picture…" aria-label="Find a picture" value="${safe(state.search)}"></label><div><button class="toolbar-action" ${action('enable-all')}>Select all</button><button class="toolbar-action" ${action('enable-none')}>Clear selection</button></div></div><div class="category-filters" aria-label="Filter vocabulary"><button class="filter-pill ${state.vocabularyCategory==='all'?'active':''}" ${action('filter','all')} aria-pressed="${state.vocabularyCategory==='all'}">All pictures</button>${categories.map(c=>`<button class="filter-pill ${state.vocabularyCategory===c.id?'active':''}" ${action('filter',c.id)} aria-pressed="${state.vocabularyCategory===c.id}">${safe(c.en)}</button>`).join('')}</div><div class="adult-section-title"><h2>${state.enabled.size} pictures selected</h2><span>${symbols.length} available</span></div><div class="vocab-grid">${list.map(s=>`<label class="vocab-tile ${state.enabled.has(s.id)?'enabled':''}"><input type="checkbox" data-symbol="${s.id}" data-focus="check-${s.id}" ${state.enabled.has(s.id)?'checked':''} aria-label="Enable ${safe(s.label)}">${rawGlyph(s.svg)}<b>${safe(s.label.toLowerCase())}</b><small>${safe(s.en)}</small></label>`).join('')||'<p>No matching pictures. Try another word.</p>'}</div><p class="save-note">${glyph('yes')}Changes update the board in this preview. No information is sent anywhere.</p>`;
  }
  function setting(icon,title,description,id,checked) {
    return `<div class="setting-row">${glyph(icon)}<div class="setting-copy"><b id="${id}-label">${title}</b><p id="${id}-description">${description}</p></div><label class="switch"><input type="checkbox" data-setting="${id}" data-focus="setting-${id}" aria-labelledby="${id}-label" aria-describedby="${id}-description" ${checked?'checked':''}><span class="switch-track"></span></label></div>`;
  }
  function preferencesScreen() {
    return `${heading(`BOARD PREFERENCES · ${safe(state.activeProfile)}`,'A calmer way to communicate.','Make the board comfortable to see, touch and use. Change one thing at a time and explore it together.')}<div class="settings-card">${setting('leaf','Word suggestions','Three suggestions appear above the board. The main pictures stay in their familiar positions.','predictive',state.predictive)}${setting('play','Gentle motion','Small responses to taps help confirm a selection. Turn off motion for a still, calm board.','motion',state.motion)}${setting('more','Extra large pictures','Use fewer, larger pictures in each row for more room to see and touch.','larger',state.larger)}</div><p class="preference-note">Motion also respects this device’s reduced-motion preference.</p><div class="audio-setting">${glyph('speaker')}<div><h2>Voice is not ready yet.</h2><p>This design preview has no speech recordings. In the product, reviewed Kinyarwanda audio or a matching device voice is needed. Erekana can show the message without sound.</p></div></div><div class="dialog-footer"><span>Try the board after each change.</span><button class="button-primary" ${action('board')}>${glyph('back')}Back to the board</button></div>`;
  }
  function summaryScreen() {
    return `${heading(`LOCAL SUMMARY · ${safe(state.activeProfile)}`,'Small moments, understood.','A simple record of completed spoken messages on this device. No scores, targets or comparisons between children.')}<div class="summary-empty">${glyph('leaf')}<h2>Every conversation starts somewhere.</h2><p>No completed spoken messages are available in this preview. A real summary would show message counts, selections and time to Speak after use.</p><button class="button-outline" ${action('board')}>${glyph('back')}Back to the board</button></div><p class="summary-note">Showing a visual message is a valid way to communicate. It is kept separate from the count of spoken messages. Usage counts do not measure a child’s ability or communication progress.</p>`;
  }
  function modal() {
    if(!state.modal)return '';
    if(state.modal==='show')return `<div class="overlay"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="dialog-close" ${action('close-modal')} aria-label="Close message">×</button><p class="dialog-eyebrow">MY MESSAGE</p><h2 id="dialog-title">Ubutumwa bwanjye</h2><p class="dialog-subtitle">My pictures. My words.</p><div class="display-message">${state.message.map(id=>{const s=byId[id];return `<div class="display-chip" style="--chip:${colours[s.category]}">${rawGlyph(s.svg)}<b>${safe(s.label.toLowerCase())}</b></div>`;}).join('')}</div><div class="dialog-footer"><span>Share this screen with someone.</span><button class="button-primary" ${action('close-modal')}>${glyph('back')}Subira ku kibaho</button></div></section></div>`;
    if(state.modal==='audio')return `<div class="overlay"><section class="dialog audio-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="dialog-close" ${action('close-modal')} aria-label="Close notice">×</button><div class="notice-mark">${glyph('speaker')}</div><p class="dialog-eyebrow">YOUR MESSAGE IS STILL HERE</p><h2 id="dialog-title">Reka twerekane.</h2><p>Let’s show your message. Kinyarwanda audio is not available in this preview, but your pictures can still speak for you.</p><div class="audio-message">${state.message.map(id=>safe(byId[id].label.toLowerCase())).join(' &nbsp; / &nbsp; ')}</div><div class="dialog-footer"><button class="button-outline" ${action('close-modal')}>Back to board</button><button class="button-primary" ${action('show')}>${glyph('eye')}Erekana</button></div></section></div>`;
    return `<div class="overlay"><section class="dialog new-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="dialog-close" ${action('close-modal')} aria-label="Close form">×</button><p class="dialog-eyebrow">A NEW SPACE FOR THEIR WORDS</p><h2 id="dialog-title">Add a profile</h2><p class="dialog-subtitle">Use a participant code. Keep names and personal details off the board.</p><form id="new-profile-form"><label class="form-field">Participant code<input id="profile-code" name="code" placeholder="P-03" pattern="[A-Za-z]-[0-9]{2,3}" maxlength="5" autocomplete="off" required><small>One letter and 2–3 numbers, for example P-03.</small></label><label class="form-field">Age band <span style="font-weight:400;color:#7A8876">(optional)</span><select name="age"><option value="">Not specified</option><option>4–6</option><option>7–9</option><option>10–12</option><option>13+</option></select></label><p class="form-error" id="profile-error" role="alert"></p><div class="dialog-footer"><button class="button-outline" type="button" ${action('close-modal')}>Cancel</button><button class="button-primary" type="submit">Create profile <span aria-hidden="true">→</span></button></div></form></section></div>`;
  }
  function render({focusModal=false,keepFocus=true}={}) {
    const focused=keepFocus?document.activeElement?.dataset?.focus:null;
    const focusedAction=keepFocus?document.activeElement?.dataset?.action:null;
    const focusedValue=keepFocus?document.activeElement?.dataset?.value:null;
    const caret=focused==='vocabulary-search'?document.activeElement.selectionStart:null;
    app.className=`${state.motion?'':'no-motion'} ${state.larger?'larger':''}`;
    app.innerHTML=(state.view==='board'?childBoard():adultShell())+modal();
    if(state.fresh){const tray=app.querySelector('.message-tray');if(tray)tray.scrollLeft=tray.scrollWidth;}
    if(state.modal) {
      const background=[...app.children].filter(el=>!el.classList.contains('overlay'));
      background.forEach(el=>{el.inert=true;});
      if(focusModal)app.querySelector('[role="dialog"] input, [role="dialog"] button')?.focus({preventScroll:true});
    } else if(focused||focusedAction) {
      const target=focused?app.querySelector(`[data-focus="${CSS.escape(focused)}"]`):app.querySelector(`[data-action="${CSS.escape(focusedAction)}"]${focusedValue?`[data-value="${CSS.escape(focusedValue)}"]`:''}`);
      if(target&&!target.disabled)target.focus({preventScroll:true});
      else if(target?.disabled)(app.querySelector('.symbol-tile:not(:disabled)')||app.querySelector('.category-button:not(:disabled)')||app.querySelector('.button-soft:not(:disabled)'))?.focus({preventScroll:true});
      if(caret!==null&&target?.type==='search')target.setSelectionRange?.(caret,caret);
    }
    state.fresh=false;
    document.getElementById('preview-screen').value=state.screen;
  }
  function openModal(name) { returnFocus=document.activeElement;state.modal=name;render({focusModal:true,keepFocus:false}); }
  function closeModal() { state.modal=null;render({keepFocus:false});const selector=returnFocus?.dataset?.action;if(selector)app.querySelector(`[data-action="${selector}"]`)?.focus({preventScroll:true});returnFocus=null; }
  function show(name) {
    const valid=['board','compose','food','feelings','show','audio','empty-board','profiles','new-profile','vocabulary','preferences','summary'];
    if(!valid.includes(name))name='board';
    state.screen=name;state.modal=null;state.fresh=false;state.category='core';state.message=[];
    if(state.enabled.size===0&&name!=='empty-board')state.enabled=new Set(symbols.map(s=>s.id));
    state.view=['profiles','new-profile','vocabulary','preferences','summary'].includes(name)?(name==='new-profile'?'profiles':name):'board';
    if(['compose','food','show','audio'].includes(name))state.message=['I','WANT','WATER'];
    if(name==='food'||name==='feelings')state.category=name;
    if(name==='show'||name==='audio')state.modal=name;
    if(name==='new-profile')state.modal='new-profile';
    if(name==='empty-board')state.enabled.clear();
    state.search='';state.vocabularyCategory='all';render({keepFocus:false,focusModal:!!state.modal});
    return state.screen;
  }
  app.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
    const name=button.dataset.action,value=button.dataset.value;
    if(name==='select'){state.message.push(value);state.fresh=true;render();}
    else if(name==='category'){state.category=value;render();}
    else if(name==='delete'){state.message.pop();render();}
    else if(name==='clear'){state.message=[];render();}
    else if(name==='show'){if(state.message.length)openModal('show');}
    else if(name==='speak'){if(state.message.length)openModal('audio');}
    else if(name==='close-modal')closeModal();
    else if(name==='adult'){state.view='profiles';state.screen='profiles';render({keepFocus:false});}
    else if(name==='board'){state.view='board';state.modal=null;state.screen='board';render({keepFocus:false});}
    else if(name==='adult-tab'){state.view=value;state.screen=value;render({keepFocus:false});}
    else if(name==='profile'){selectProfile(value);render();}
    else if(name==='new-profile')openModal('new-profile');
    else if(name==='filter'){state.vocabularyCategory=value;render();}
    else if(name==='enable-all'){state.enabled=new Set(symbols.map(s=>s.id));render();}
    else if(name==='enable-none'){state.enabled.clear();render();}
  });
  app.addEventListener('input',event=>{
    if(event.target.id==='vocabulary-search'){state.search=event.target.value;render();}
  });
  app.addEventListener('change',event=>{
    const symbol=event.target.dataset.symbol,setting=event.target.dataset.setting;
    if(symbol){event.target.checked?state.enabled.add(symbol):state.enabled.delete(symbol);render();}
    if(setting){state[setting]=event.target.checked;render();}
  });
  app.addEventListener('submit',event=>{
    if(event.target.id!=='new-profile-form')return;event.preventDefault();
    const code=new FormData(event.target).get('code').toUpperCase();
    if(!/^[A-Z]-\d{2,3}$/.test(code)||state.profiles.includes(code)){document.getElementById('profile-error').textContent=state.profiles.includes(code)?'This code already exists. Choose another.':'Use a code such as P-03.';return;}
    state.profiles.push(code);selectProfile(code);state.modal=null;render({keepFocus:false});
  });
  document.addEventListener('keydown',event=>{
    if(!state.modal)return;
    if(event.key==='Escape'){event.preventDefault();closeModal();return;}
    if(event.key==='Tab'){
      const focusable=[...app.querySelectorAll('[role="dialog"] button:not(:disabled),[role="dialog"] input,[role="dialog"] select')];
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  document.getElementById('preview-screen').addEventListener('change',event=>{show(event.target.value);history.replaceState(null,'',`#${state.screen}`);});
  document.getElementById('reset-preview').addEventListener('click',()=>{profileSettings.clear();state.profiles=['P-01','P-02'];state.activeProfile='P-01';state.enabled=new Set(symbols.map(s=>s.id));state.predictive=true;state.larger=false;state.motion=!matchMedia('(prefers-reduced-motion: reduce)').matches;show('board');history.replaceState(null,'','#board');});
  addEventListener('hashchange',()=>show(location.hash.slice(1)));
  window.vugaPreview={show,snapshot:()=>({...state,enabled:[...state.enabled],symbols,categories,colours}),version:'1.0-design-concept'};
  show(location.hash.slice(1)||'board');
})();
