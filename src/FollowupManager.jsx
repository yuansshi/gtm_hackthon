import React,{useEffect,useRef,useState} from 'react';
import {CalendarClock,X} from 'lucide-react';
import {managementOf} from './followups.js';

const localTime=value=>value?new Date(Date.parse(value)-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
const date=value=>new Date(value).toLocaleString();
export default function FollowupManager({state,leadId,act,busy,close,saved}) {
  const lead=(state.leads||[]).find(lead=>lead.id===leadId),current=managementOf(lead),dialog=useRef(null),requestId=useRef(crypto.randomUUID());
  const[owner,setOwner]=useState(current.ownerName),[text,setText]=useState(current.nextAction?.text||''),[due,setDue]=useState(localTime(current.nextAction?.dueAt)),[completed,setCompleted]=useState(current.nextAction?.status==='completed');
  const[dueEdited,setDueEdited]=useState(false);
  const[opened,setOpened]=useState({revision:state.revision,version:current.version,dueAt:current.nextAction?.dueAt||null}),[error,setError]=useState('');
  useEffect(()=>{dialog.current?.showModal();},[]);
  const changed=()=>{requestId.current=crypto.randomUUID();setError('');};
  const reload=async()=>{const result=await act('',{},'GET',true,e=>setError(e.message));if(!result)return;const fresh=managementOf(result.leads.find(lead=>lead.id===leadId));setOwner(fresh.ownerName);setText(fresh.nextAction?.text||'');setDue(localTime(fresh.nextAction?.dueAt));setCompleted(fresh.nextAction?.status==='completed');setOpened({revision:result.revision,version:fresh.version,dueAt:fresh.nextAction?.dueAt||null});setDueEdited(false);changed();};
  const changeDue=e=>{setDue(e.currentTarget.value);setDueEdited(true);setCompleted(false);changed();};
  const submit=async event=>{event.preventDefault();if(busy)return;setError('');const nextAction=text.trim()?{text:text.trim(),dueAt:due?(dueEdited?new Date(due).toISOString():opened.dueAt):null,status:completed?'completed':'open'}:null;
    const result=await act(`/leads/${leadId}/management`,{requestId:requestId.current,revision:opened.revision,expectedVersion:opened.version,ownerName:owner,nextAction},'PATCH',true,e=>setError(e.message));if(result){saved?.();close();}};
  return <dialog ref={dialog} className="followup-dialog" aria-labelledby="followup-title" onCancel={event=>{event.preventDefault();if(!busy)close();}} onClick={event=>{if(event.target===event.currentTarget&&!busy)close();}}>
    <header><CalendarClock size={22}/><div><h2 id="followup-title">Manage follow-up</h2><p>{lead?.name}</p></div><button type="button" className="icon-button" aria-label="Close follow-up" disabled={busy} onClick={close}><X size={18}/></button></header>
    <form onSubmit={submit}><fieldset disabled={busy}><label>Sales owner<input autoFocus aria-label="Sales owner" maxLength={80} placeholder="Name, or leave unassigned" value={owner} onChange={e=>{setOwner(e.target.value);changed();}}/></label><p className="followup-help">A recorded assignment for this account. It does not grant access or verify who is signed in.</p>
      <label>Next action<textarea aria-label="Next action" maxLength={500} rows={3} placeholder="For example: review the customer’s qualification requirements" value={text} onChange={e=>{setText(e.target.value);setCompleted(false);changed();}}/></label>
      <div className="followup-options"><label>Due date & time<input aria-label="Follow-up due date" type="datetime-local" disabled={!text.trim()} value={due} onInput={changeDue} onChange={changeDue}/><small>Your local time; saved as a UTC instant.</small></label><label className="followup-complete"><input type="checkbox" disabled={!text.trim()} checked={completed} onChange={e=>{setCompleted(e.target.checked);changed();}}/>Mark next action completed</label></div>
      <p className="followup-help">Saving records a manual task. Completing it does not send outreach or change the pipeline stage. Clearing the action removes the current task; recent changes remain below.</p>
      {error&&<div className="followup-error" role="alert"><p>{error}</p><button type="button" className="button secondary" onClick={reload}>Reload latest · discard edits</button></div>}
      <footer><span>No credits charged</span><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" type="submit">{busy?'Saving…':'Save follow-up'}</button></footer>
    </fieldset></form>
    {!!current.history.length&&<details className="followup-history"><summary>Recent assignment & task history · {current.history.length}</summary><ol>{current.history.map(item=><li key={item.id}><strong>{item.ownerName||'Unassigned'}</strong><span>{item.nextAction?.text||'No next action'}</span><small>{item.nextAction?.status==='completed'?'Completed':item.nextAction?'Open':'Cleared'}{item.nextAction?.dueAt?` · Due ${date(item.nextAction.dueAt)}`:''}</small><small>{item.actor} · {date(item.at)}</small></li>)}</ol><p>Latest 20 saves. “You” identifies this shared project session, not an authenticated individual.</p></details>}
  </dialog>;
}
