let scheduledReminders = [];
let TASK_TIMER_MAP = {};

const FEEDBACK_COUNTS_KEY = 'taskapp_feedback_counts';
let feedbackCounts = JSON.parse(localStorage.getItem(FEEDBACK_COUNTS_KEY) || '{}');

let cameraStream = null;
let rafId = null;
let modelsLoaded = false;

let selectedLanguage = document.getElementById('language')
  ? document.getElementById('language').value
  : 'en';

const MEME_COOLDOWN_MS = 3000;
let lastMemeTime = 0;
let lastEmotion = null;

/* ---------------- JOKES ---------------- */

const jokes = {
  en:{ happy:["You're glowing!","Keep smiling!"], sad:["Better days are coming.","Take a breath."], angry:["Breathe...","Count to ten."], neutral:["Calm and steady.","Nice!"] },
  hi:{ happy:["खुश लग रहे हो!","मुस्कुराओ!"], sad:["सब ठीक होगा।","थोड़ा आराम करो।"], angry:["शांत हो जाओ।","एक गहरी सांस लो।"], neutral:["शांत हो।","ठीक है।"] },
  te:{ happy:["నవ్వు బాగుంది!","కొంచెం స్మైల్!"], sad:["రేపు బాగుంటుంది.","ఒక శ్వాస తీసుకో."], angry:["శాంతంగా ఉండు.","ఒక స్మైల్ పెట్టు."], neutral:["బాగా ఉంది.","శాంతంగా ఉండు."] },
  ta:{ happy:["சிரிக்கவும்!","நல்ல மனம்!"], sad:["எல்லாம் சரியாகும்.","ஒரு ஆழ்ந்த சுவாசம் எடு."], angry:["சாந்தியாய் இரு.","கணக்கிடு."], neutral:["நலமாக இரு.","அமைதி."] }
};

if(document.getElementById('language'))
  document.getElementById('language')
    .addEventListener('change', e => selectedLanguage = e.target.value || 'en');

/* ---------------- STORAGE ---------------- */

function loadScheduled(){
  const raw = localStorage.getItem('taskapp_schedules');
  scheduledReminders = raw ? JSON.parse(raw) : [];
}

function saveScheduled(){
  localStorage.setItem('taskapp_schedules', JSON.stringify(scheduledReminders));
}

loadScheduled();

/* ---------------- RENDER ---------------- */

function renderScheduled(){
  const block = document.getElementById('scheduledCard');
  const ul = document.getElementById('scheduledUl');
  if(!block || !ul) return;

  if(!scheduledReminders.length){
    block.classList.add('hidden');
    ul.innerHTML='';
    return;
  }

  block.classList.remove('hidden');
  ul.innerHTML='';

  scheduledReminders.forEach(s=>{
    const li=document.createElement('li');

    li.innerHTML=`<span>
      <strong>${s.name}</strong> (${s.type})
      — ${s.startTime} to ${s.endTime}
    </span>`;

    const del=document.createElement('button');
    del.textContent='Delete';
    del.onclick=()=>{
      clearTaskTimers(s.id);
      scheduledReminders=scheduledReminders.filter(x=>x.id!==s.id);
      saveScheduled();
      renderScheduled();
    };

    li.appendChild(del);
    ul.appendChild(li);
  });
}

renderScheduled();

/* ---------------- TASK SELECTION ---------------- */

function chooseTask(type){
  window.chosenTaskType=type;
  document.getElementById('timersBlock').classList.remove('hidden');
  document.getElementById('calendarBlock')
    .classList.toggle('hidden', type!=='selectiveDays');
}

/* ---------------- SAVE REMINDER (UPDATED) ---------------- */

function handleSaveReminders(){

  const taskNameInput = document.getElementById('taskName');
  const taskName = taskNameInput ? taskNameInput.value.trim() : '';

  if(!taskName){
    alert("Please enter a task name first.");
    return;
  }

  const s=document.getElementById('startTime').value;
  const e=document.getElementById('endTime').value;

  if(!s||!e) return alert('Set both times');

  const lang=document.getElementById('language').value||'en';

  const task={
    id:Date.now(),
    name: taskName,
    type: window.chosenTaskType||'daily',
    language:lang,
    dates:(window.chosenTaskType==='selectiveDays')?(window.chosenDates||[]):[],
    startTime:s,
    endTime:e
  };

  scheduledReminders.push(task);
  saveScheduled();
  scheduleTask(task);
  renderScheduled();

  taskNameInput.value='';
  alert('Scheduled');
}

/* ---------------- TIMER LOGIC ---------------- */

function msUntil(timeStr){
  const [hh,mm]=timeStr.split(':').map(Number);
  const now=new Date();

  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),hh,mm,0);

  if(today.getTime()-now.getTime()>1000)
    return today.getTime()-now.getTime();

  const tomorrow=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,hh,mm,0);
  return tomorrow.getTime()-now.getTime();
}

function clearTaskTimers(id){
  const rec=TASK_TIMER_MAP[id];
  if(!rec) return;
  if(rec.start) clearTimeout(rec.start);
  if(rec.end) clearTimeout(rec.end);
  delete TASK_TIMER_MAP[id];
}

function scheduleTask(task){
  clearTaskTimers(task.id);

  const delayStart = msUntil(task.startTime);
  const delayEnd   = msUntil(task.endTime);

  TASK_TIMER_MAP[task.id]={
    start:setTimeout(()=>onAlarmEvent(task,'start'),delayStart),
    end:setTimeout(()=>onAlarmEvent(task,'end'),delayEnd)
  };
}

/* ---------------- ALARM EVENTS ---------------- */

function onAlarmEvent(task,stage){
  playDing();

  if(stage==='start'){
    startCamera();
  }
  else if(stage==='end'){
    stopCamera();
    alert(`Task "${task.name}" completed!`);
  }
}

function playDing(){
  const a=document.getElementById('ding');
  if(a&&a.play){
    a.currentTime=0;
    a.play().catch(()=>{});
  }
}

/* ---------------- FACE API ---------------- */

async function loadModels(){
  try{
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('./models'),
      faceapi.nets.faceExpressionNet.loadFromUri('./models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('./models')
    ]);
    modelsLoaded=true;
  }catch(e){
    console.error('model load error', e);
    alert('Model load failed. Check ./models path and files.');
  }
}
loadModels();

async function startCamera(){
  if(!modelsLoaded) return;

  const section=document.getElementById('cameraSection');
  if(section) section.classList.remove('hidden');

  try{
    cameraStream=await navigator.mediaDevices.getUserMedia({ video:true });
    const v=document.getElementById('video');
    v.srcObject=cameraStream;
    v.play();
    startDetectionLoop();
  }catch(e){
    alert('Cannot access camera.');
  }
}

function stopCamera(){
  const section=document.getElementById('cameraSection');
  if(section) section.classList.add('hidden');

  if(cameraStream){
    cameraStream.getTracks().forEach(t=>t.stop());
    cameraStream=null;
  }

  if(rafId){
    cancelAnimationFrame(rafId);
    rafId=null;
  }
}

/* ---------------- EMOTION LOOP ---------------- */

function startDetectionLoop(){
  if(!modelsLoaded) return;

  const loop=async()=>{
    try{
      const v=document.getElementById('video');
      if(!v||v.readyState<2){
        rafId=requestAnimationFrame(loop);
        return;
      }

      const detections = await faceapi
        .detectAllFaces(v,new faceapi.TinyFaceDetectorOptions())
        .withFaceExpressions();

      if(detections.length){
        const exp=detections[0].expressions||{};
        const dominant=Object.entries(exp)
          .sort((a,b)=>b[1]-a[1])[0][0]||'neutral';

        const now=Date.now();
        const emoEl=document.getElementById('emotionText');
        if(emoEl)
          emoEl.innerText = dominant.charAt(0).toUpperCase()+dominant.slice(1);

        if((now-lastMemeTime)>MEME_COOLDOWN_MS || dominant!==lastEmotion){
          const pool = jokes[selectedLanguage]?.[dominant] 
            || jokes['en'][dominant] 
            || ["Keep going"];

          const pick = pool[Math.floor(Math.random()*pool.length)];
          const jEl=document.getElementById('jokeBox');
          if(jEl) jEl.innerText = pick;

          lastMemeTime=now;
          lastEmotion=dominant;
        }
      }
    }catch(e){
      console.error(e);
    }
    rafId=requestAnimationFrame(loop);
  };

  rafId=requestAnimationFrame(loop);
}

/* ---------------- INIT ---------------- */

scheduledReminders.forEach(t=>scheduleTask(t));

document.getElementById('saveRemindersBtn')
  ?.addEventListener('click', handleSaveReminders);

/* --------------- Cam Acess Buttons ----------*/

const stopBtn = document.getElementById('stopCamBtn');
if (stopBtn) stopBtn.addEventListener('click', () => stopCamera());

const startBtn = document.getElementById('startCamBtn');
if (startBtn) startBtn.addEventListener('click', () => startCamera());
