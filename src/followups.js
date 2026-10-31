export function managementOf(lead) {
  const base={version:0,ownerName:typeof lead?.owner==='string'?lead.owner:'',nextAction:null,history:[]};
  return lead?.management?{...base,...lead.management,history:lead.management.history||[]}:base;
}
export function followupState(lead, clock=Date.now()) {
  const task=managementOf(lead).nextAction;
  if(!task)return 'none';
  if(task.status==='completed')return 'completed';
  return task.dueAt && Date.parse(task.dueAt)<clock ? 'overdue' : 'open';
}
export function matchesFollowup(lead, owner='all', status='all', clock=Date.now()) {
  const name=managementOf(lead).ownerName;
  const ownerMatches=owner==='all'||(owner==='unassigned'?!name:owner==='name:'+name);
  const current=followupState(lead,clock);
  return ownerMatches && (status==='all'||(status==='open'?['open','overdue'].includes(current):status===current));
}
