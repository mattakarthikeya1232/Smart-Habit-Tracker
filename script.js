let scheduledReminders = [];
let TASK_TIMER_MAP = {};
const FEEDBACK_COUNTS_KEY = 'taskapp_feedback_counts';
let feedbackCounts = JSON.parse(localStorage.getItem(FEEDBACK_COUNTS_KEY) || '{}');
let cameraStream = null;
let rafId = null;
let modelsLoaded = false;
let selectedLanguage = document.getElementById('language') ? document.getElementById('language').value : 'en';
const MEME_COOLDOWN_MS = 3000;
let lastMemeTime = 0;
let lastEmotion = null;

const jokes = {
  en:{ happy:["You're glowing!","Keep smiling!"], sad:["Better days are coming.","Take a breath."], angry:["Breathe...","Count to ten."], neutral:["Calm and steady.","Nice!"] },
  hi:{ happy:["खुश लग रहे हो!","मुस्कुराओ!"], sad:["सब ठीक होगा।","थोड़ा आराम करो।"], angry:["शांत हो जाओ।","एक गहरी सांस लो।"], neutral:["शांत हो।","ठीक है।"] },
  te:{ happy:["నవ్వు బాగుంది!","కొంచెం స్మైల్!"], sad:["రేపు బాగుంటుంది.","ఒక శ్వాస తీసుకో."], angry:["శాంతంగా ఉండు.","ఒక స్మైల్ పెట్టు."], neutral:["బాగా ఉంది.","శాంతంగా ఉండు."] },
  ta:{ happy:["சிரிக்கவும்!","நல்ல மனம்!"], sad:["எல்லாம் சரியgcc;டும்.","ஒரு ஆழ்ந்த சுவாசம் எடு."], angry:["சாந்தியாய் இரு.","கணக்கிடு."], neutral:["நலமாக இரு.","அமைதி."] }
};

if(document.getElementById('language')) document.getElementById('language').addEventListener('change', e=> selectedLanguage = e.target.value || 'en');

function loadScheduled(){ const raw = localStorage.getItem('taskapp_schedules'); scheduledReminders = raw ? JSON.parse(raw) : []; }
function saveScheduled(){ localStorage.setItem('taskapp_schedules', JSON.stringify(scheduledReminders)); }
loadScheduled();

function renderScheduled(){
  const block = document.getElementById('scheduledCard');
  const ul = document.getElementById('scheduledUl');
  if(!block || !ul) return;
  if(!scheduledReminders.length){ block.classList.add('hidden'); ul.innerHTML=''; return; }
  block.classList.remove('hidden'); ul.innerHTML='';
  scheduledReminders.forEach(s=>{
    const li=document.createElement('li');
    li.innerHTML=`<span><strong>${s.type}</strong> — ${s.startTime} to ${s.endTime}</span>`;
    const del=document.createElement('button'); del.textContent='Delete';
    del.onclick=()=>{ clearTaskTimers(s.id); scheduledReminders=scheduledReminders.filter(x=>x.id!==s.id); saveScheduled(); renderScheduled(); };
    li.appendChild(del); ul.appendChild(li);
  });
}
renderScheduled();

function chooseTask(type){ window.chosenTaskType=type; document.getElementById('timersBlock').classList.remove('hidden'); document.getElementById('calendarBlock').classList.toggle('hidden', type!=='selectiveDays'); }
function addDate(){ const d=document.getElementById('dateInput').value; if(!d) return; if(!window.chosenDates) window.chosenDates=[]; if(!window.chosenDates.includes(d)) window.chosenDates.push(d); renderDates(); }
function renderDates(){ const ul=document.getElementById('datesList'); if(!ul) return; ul.innerHTML=''; (window.chosenDates||[]).forEach(dateStr=>{ const li=document.createElement('li'); li.textContent=dateStr+' '; const btn=document.createElement('button'); btn.textContent='Remove'; btn.onclick=()=>{ window.chosenDates=window.chosenDates.filter(x=>x!==dateStr); renderDates(); }; li.appendChild(btn); ul.appendChild(li); }); }

function handleSaveReminders(){
  const s=document.getElementById('startTime').value; const e=document.getElementById('endTime').value;
  if(!s||!e) return alert('Set both times');
  const lang=document.getElementById('language').value||'en';
  const task={ id:Date.now(), type: window.chosenTaskType||'daily', language:lang, dates:(window.chosenTaskType==='selectiveDays')?(window.chosenDates||[]):[], startTime:s, endTime:e };
  scheduledReminders.push(task); saveScheduled(); scheduleTask(task); renderScheduled(); alert('Scheduled');
}

function msUntil(timeStr, allowedDates){
  const [hh,mm]=timeStr.split(':').map(Number); const now=new Date();
  function forDate(y,mo,da){ return new Date(y,mo-1,da,hh,mm,0).getTime()-now.getTime(); }
  if(allowedDates && allowedDates.length){ const sorted=allowedDates.slice().sort(); for(const d of sorted){ const [y,mo,da]=d.split('-').map(Number); const diff=forDate(y,mo,da); if(diff>1000) return diff; } return null; } else {
    const today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),hh,mm,0); if(today.getTime()-now.getTime()>1000) return today.getTime()-now.getTime(); const tomorrow=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,hh,mm,0); return tomorrow.getTime()-now.getTime();
  }
}

function clearTaskTimers(id){ const rec=TASK_TIMER_MAP[id]; if(!rec) return; if(rec.start) clearTimeout(rec.start); if(rec.end) clearTimeout(rec.end); delete TASK_TIMER_MAP[id]; }

function scheduleEvent(task,eventType){
  if(!TASK_TIMER_MAP[task.id]) TASK_TIMER_MAP[task.id]={start:null,end:null};
  const timeStr = eventType==='start'?task.startTime:task.endTime;
  const allowed = task.type==='selectiveDays'?task.dates:(task.type==='oneDay'?(task.dates&&task.dates.length?[task.dates[0]]:[]):null);
  const delay = msUntil(timeStr, allowed);
  const key = eventType==='start'?'start':'end';
  if(TASK_TIMER_MAP[task.id][key]) clearTimeout(TASK_TIMER_MAP[task.id][key]);
  if(delay==null||delay<=0) return;
  TASK_TIMER_MAP[task.id][key]=setTimeout(()=>{ onAlarmEvent(task,eventType); scheduleEvent(task,eventType); }, delay);
}

function scheduleTask(task){ clearTaskTimers(task.id); scheduleEvent(task,'start'); scheduleEvent(task,'end'); }

function findFirstAndLast(){ if(!scheduledReminders.length) return {first:null,last:null}; const flat=scheduledReminders.slice().sort((a,b)=>a.startTime.localeCompare(b.startTime)); return { first:flat[0], last:flat[flat.length-1] }; }

function onAlarmEvent(task,stage){ playDing(); if(stage==='start'){ const f=findFirstAndLast().first; if(f&&f.id===task.id) startCamera(); } else if(stage==='end'){ const l=findFirstAndLast().last; if(l&&l.id===task.id){ stopCamera(); promptFeedbackForTask(task); } } }

function promptFeedbackForTask(task){ const count=feedbackCounts[task.id]||0; if(count>=2) return; setTimeout(()=>{ const feedback=prompt('Task ended — privacy feedback (optional):'); const arr=JSON.parse(localStorage.getItem('taskapp_feedback')||'[]'); arr.push({ taskId:task.id, feedback, ts:new Date().toISOString() }); localStorage.setItem('taskapp_feedback', JSON.stringify(arr)); feedbackCounts[task.id]=(feedbackCounts[task.id]||0)+1; localStorage.setItem(FEEDBACK_COUNTS_KEY, JSON.stringify(feedbackCounts)); }, 1200); }

function playDing(){ const a=document.getElementById('ding'); if(a&&a.play){ a.currentTime=0; a.play().catch(()=>{}); } }

async function loadModels(){ try{ await Promise.all([ faceapi.nets.tinyFaceDetector.loadFromUri('./models'), faceapi.nets.faceExpressionNet.loadFromUri('./models'), faceapi.nets.faceLandmark68Net.loadFromUri('./models') ]); modelsLoaded=true; } catch(e){ console.error('model load error', e); alert('Model load failed. Check ./models path and files.'); } }
loadModels();

async function startCamera(){ if(!modelsLoaded) return; const section=document.getElementById('cameraSection'); if(section) section.classList.remove('hidden'); const startBtn=document.getElementById('startCamBtn'); const stopBtn=document.getElementById('stopCamBtn'); if(startBtn) startBtn.classList.add('hidden'); if(stopBtn) stopBtn.classList.remove('hidden'); if(cameraStream) return; try{ cameraStream=await navigator.mediaDevices.getUserMedia({ video:{ width:320, height:240 } }); const v=document.getElementById('video'); v.srcObject=cameraStream; v.play().catch(()=>{}); startDetectionLoop(); } catch(e){ console.error('camera error', e); alert('Cannot access camera. Serve over https or use http://localhost and allow permission.'); } }

function stopCamera(){ const section=document.getElementById('cameraSection'); if(section) section.classList.add('hidden'); const startBtn=document.getElementById('startCamBtn'); const stopBtn=document.getElementById('stopCamBtn'); if(startBtn) startBtn.classList.remove('hidden'); if(stopBtn) stopBtn.classList.add('hidden'); if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; } if(rafId){ cancelAnimationFrame(rafId); rafId=null; } const v=document.getElementById('video'); if(v) v.srcObject=null; const emo=document.getElementById('emotionText'); if(emo) emo.innerText='—'; const j=document.getElementById('jokeBox'); if(j) j.innerText=''; }

function startDetectionLoop(){ if(!modelsLoaded) return; if(rafId) cancelAnimationFrame(rafId); const loop=async()=>{ try{ const v=document.getElementById('video'); if(!v||v.readyState<2){ rafId=requestAnimationFrame(loop); return; } const detections = await faceapi.detectAllFaces(v, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions(); if(detections&&detections.length){ const exp=detections[0].expressions||{}; const dominant=Object.entries(exp).sort((a,b)=>b[1]-a[1])[0][0]||'neutral'; const now=Date.now(); const emoEl=document.getElementById('emotionText'); if(emoEl) emoEl.innerText = dominant.charAt(0).toUpperCase()+dominant.slice(1); if((now-lastMemeTime)>MEME_COOLDOWN_MS||dominant!==lastEmotion){ const pool = (jokes[selectedLanguage]&&jokes[selectedLanguage][dominant]) || (jokes['en'][dominant] || ["Keep going"]); const pick = pool[Math.floor(Math.random()*pool.length)]; const jEl=document.getElementById('jokeBox'); if(jEl) jEl.innerText = pick; lastMemeTime = now; lastEmotion = dominant; } } else { const emoEl=document.getElementById('emotionText'); if(emoEl) emoEl.innerText='No face'; } }catch(e){ console.error(e); } rafId=requestAnimationFrame(loop); }; rafId=requestAnimationFrame(loop); }

const stopBtn=document.getElementById('stopCamBtn'); if(stopBtn) stopBtn.addEventListener('click', ()=>stopCamera());
const startBtn=document.getElementById('startCamBtn'); if(startBtn) startBtn.addEventListener('click', ()=>startCamera());

scheduledReminders.forEach(t=> scheduleTask(t));
document.getElementById('saveRemindersBtn') && document.getElementById('saveRemindersBtn').addEventListener('click', handleSaveReminders);