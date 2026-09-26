let token=localStorage.getItem('campuslockToken');let me=JSON.parse(localStorage.getItem('campuslockMe')||'null');let role=localStorage.getItem('campuslockRole')||'student';
const $=id=>document.getElementById(id);const api=async(url,opt={})=>{opt.headers={...(opt.headers||{}),'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})};const r=await fetch(url,opt);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Something went wrong');return d};
function toast(m){$('toast').textContent=m;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2600)}
function page(id){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('on'));
  const target=$(id);
  if(!target)return;
  target.classList.add('on');
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  $('side').classList.remove('open');
  $('shade').classList.remove('show');
  window.scrollTo({top:0,behavior:'instant'});
  history.replaceState(null,'','#'+id);
  if(id==='travel'){loadGroups();loadJoinRequests()}
  if(id==='resources')loadResources();
  if(id==='locker')loadLockers();
  if(id==='admin')loadAdminResources();
}
function showLogin(){ $('registerPanel').hidden=true;$('loginPanel').hidden=false;$('authTitle').textContent='Student Login'}function showRegister(){ $('registerPanel').hidden=false;$('loginPanel').hidden=true;$('authTitle').textContent='Student Registration'}
$('showLogin').onclick=showLogin;$('showRegister').onclick=showRegister;$('showAdmin').onclick=()=>$('adminModal').classList.add('show');
$('registerForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/auth/register',{method:'POST',body:JSON.stringify({name:$('regName').value,studentId:$('regId').value,locality:$('regLocality').value,distanceKm:$('regDistance').value,password:$('regPassword').value})});$('loginId').value=$('regId').value;toast('Registration successful. Now login.');e.target.reset();showLogin()}catch(err){toast(err.message)}};
$('loginForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({studentId:$('loginId').value,password:$('loginPassword').value})});token=d.token;me=d.student;role='student';saveSession();openApp();toast(`Welcome, ${me.name}!`)}catch(err){toast(err.message)}};
function saveSession(){localStorage.setItem('campuslockToken',token);localStorage.setItem('campuslockMe',JSON.stringify(me));localStorage.setItem('campuslockRole',role)}function clearSession(){token=null;me=null;role='student';localStorage.removeItem('campuslockToken');localStorage.removeItem('campuslockMe');localStorage.removeItem('campuslockRole')}
function openApp(){
  $('auth').hidden=true;
  $('app').hidden=false;
  $('userName').textContent=me?.name||'College Admin';
  $('adminNav').hidden=role!=='admin';
  const requested=location.hash.slice(1);
  const allowed=role==='admin' ? ['admin'] : ['home','travel','resources','locker'];
  page(allowed.includes(requested)?requested:(role==='admin'?'admin':'home'));
}function logout(){clearSession();$('app').hidden=true;$('auth').hidden=false;showLogin();$('loginForm').reset()}$('logout').onclick=logout;
$('menu').onclick=()=>{$('side').classList.add('open');$('shade').classList.add('show')};$('close').onclick=$('shade').onclick=()=>{$('side').classList.remove('open');$('shade').classList.remove('show')};document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>page(b.dataset.page));
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>page(b.dataset.go));
window.onpopstate=()=>{
  if(!$('app').hidden){
    const id=location.hash.slice(1);
    const allowed=role==='admin' ? ['admin'] : ['home','travel','resources','locker'];
    if(allowed.includes(id)) page(id);
  }
};

async function loadGroups(){try{const groups=await api('/api/groups');const q=$('search').value.toLowerCase();const rows=groups.filter(g=>!q||g.locality.toLowerCase().includes(q));$('groups').innerHTML=rows.length?rows.map(g=>`<article class="group"><span>📍 ${g.locality}</span><h3>Group from ${g.locality}</h3><p>Driver: <b>${g.driver}</b></p><div class="meta"><div>👥 ${g.seats}/${g.max_passengers} seats</div><div>📍 ${g.meeting_point}</div><div>🕗 ${g.departure_time}</div></div><button class="join" onclick="joinGroup(${g.id})">${g.seats?'Request to Join':'Group Full'}</button></article>`).join(''):'<div class="group"><h3>No groups found</h3><p>Try another locality or create a group.</p></div>'}catch(e){toast(e.message)}}
async function joinGroup(id){try{const d=await api(`/api/groups/${id}/join`,{method:'POST'});toast(d.message);loadGroups();}catch(e){toast(e.message)}}$('search').oninput=loadGroups;$('refreshGroups').onclick=loadGroups;
$('newGroup').onclick=()=>{$('groupModal').classList.add('show')};$('saveGroup').onclick=async()=>{try{await api('/api/groups',{method:'POST',body:JSON.stringify({locality:$('groupLocality').value,meetingPoint:$('meetingPoint').value,departureTime:$('departureTime').value})});$('groupModal').classList.remove('show');$('groupLocality').value='';$('meetingPoint').value='';$('departureTime').value='';toast('Group created. Join requests will appear below.');loadGroups();loadJoinRequests()}catch(e){toast(e.message)}};
async function loadJoinRequests(){try{const rows=await api('/api/groups/my/requests');$('approvalBox').hidden=rows.length===0;$('requestCount').textContent=rows.filter(x=>x.status==='Pending').length+' Pending';$('joinRequests').innerHTML=rows.map(r=>`<div class="request-row"><div><b>${r.name}</b><div>${r.student_id} · ${r.locality} · ${r.group_locality}</div></div><div class="request-actions">${r.status==='Pending'?`<button class="primary" onclick="decideJoin(${r.id},'Approved')">Approve</button><button class="danger" onclick="decideJoin(${r.id},'Rejected')">Reject</button>`:`<span class="status ${r.status.toLowerCase()}">${r.status}</span>`}</div></div>`).join('')}catch(e){toast(e.message)}}
async function decideJoin(id,decision){try{const d=await api(`/api/join-requests/${id}/decision`,{method:'POST',body:JSON.stringify({decision})});toast(d.message);loadJoinRequests();loadGroups()}catch(e){toast(e.message)}}
$('newResource').onclick=()=>{$('resourceModal').classList.add('show')};$('submitResource').onclick=async()=>{try{await api('/api/resources',{method:'POST',body:JSON.stringify({resource:$('resource').value,purpose:$('purpose').value,requestDate:$('requestDate').value,studentsCount:$('studentCount').value,startTime:$('startTime').value,endTime:$('endTime').value})});$('resourceModal').classList.remove('show');$('purpose').value='';toast('Resource request submitted.');loadResources()}catch(e){toast(e.message)}};
async function loadResources(){try{const rows=await api('/api/resources');$('resourcesList').innerHTML=rows.length?rows.map(r=>`<article class="request"><div><h3>${r.resource}</h3><p>${r.purpose}</p><p>📅 ${new Date(r.request_date).toLocaleDateString()} · 👥 ${r.students_count} · 🕒 ${r.start_time||'--'} – ${r.end_time||'--'}</p>${r.admin_note?`<small>Admin: ${r.admin_note}</small>`:''}</div><span class="status ${r.status.toLowerCase()}">${r.status}</span></article>`).join(''):'<div class="card"><p>No resource requests yet.</p></div>'}catch(e){toast(e.message)}}
async function loadLockers(){try{const d=await api('/api/lockers');$('priorityText').textContent=`Your distance priority: ${d.priority}`;$('lockerList').innerHTML=d.lockers.map(l=>`<article class="locker"><div><h3>${l.locker_no}</h3><p>${l.size} · ${l.status}</p>${l.mine&&l.expiry_date?`<p>Expiry: ${new Date(l.expiry_date).toLocaleDateString()}</p>`:''}</div>${l.status==='Available'?`<button class="primary" onclick="bookLocker(${l.id})">Book</button>`:l.mine?`<button class="danger" onclick="cancelLocker(${l.id})">Cancel</button>`:''}</article>`).join('')}catch(e){toast(e.message)}}
async function bookLocker(id){const days=prompt('How many days do you need the locker?','7');if(!days)return;try{const d=await api(`/api/lockers/${id}/book`,{method:'POST',body:JSON.stringify({days})});toast(d.message);loadLockers()}catch(e){toast(e.message)}}async function cancelLocker(id){try{const d=await api(`/api/lockers/${id}/cancel`,{method:'POST'});toast(d.message);loadLockers()}catch(e){toast(e.message)}}$('refreshLockers').onclick=loadLockers;
async function loadAdminResources(){if(role!=='admin')return;try{const rows=await api('/api/admin/resources');$('adminResources').innerHTML=rows.map(r=>`<article class="request"><div><h3>${r.resource}</h3><p><b>${r.name}</b> · ${r.student_id} · ${r.locality}</p><p>${r.purpose}</p><p>📅 ${new Date(r.request_date).toLocaleDateString()} · 🕒 ${r.start_time||'--'} – ${r.end_time||'--'}</p></div><div class="request-actions">${r.status==='Pending'?`<button class="primary" onclick="adminDecision(${r.id},'Approved')">Approve</button><button class="danger" onclick="adminDecision(${r.id},'Rejected')">Reject</button>`:`<span class="status ${r.status.toLowerCase()}">${r.status}</span>`}</div></article>`).join('')||'<div class="card">No requests.</div>'}catch(e){toast(e.message)}}async function adminDecision(id,decision){try{await api(`/api/admin/resources/${id}/decision`,{method:'POST',body:JSON.stringify({decision})});toast('Request '+decision.toLowerCase());loadAdminResources()}catch(e){toast(e.message)}}$('adminRefresh').onclick=loadAdminResources;
$('adminNav').onclick=()=>{if(role==='admin')page('admin')};
$('adminForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/admin/login',{method:'POST',body:JSON.stringify({adminId:$('adminId').value,password:$('adminPassword').value})});token=d.token;me=d.admin;role='admin';saveSession();$('adminModal').classList.remove('show');openApp();page('admin');toast('Admin login successful.')}catch(e){toast(e.message)}};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).classList.remove('show'));window.onclick=e=>{if(e.target.classList.contains('modal'))e.target.classList.remove('show')};
if(token&&me){openApp();}
