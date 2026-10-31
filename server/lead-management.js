import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError,addActivity,digest,now} from './store.js';
import {managementOf} from '../src/followups.js';

export const managementSchema=z.object({requestId:z.string().uuid(),revision:z.number().int().nonnegative(),expectedVersion:z.number().int().nonnegative(),ownerName:z.string().max(80),nextAction:z.object({text:z.string().trim().min(1).max(500),dueAt:z.string().datetime().nullable(),status:z.enum(['open','completed'])}).strict().nullable()}).strict();
const fail=(status,message,code)=>{throw new AppError(status,message,code);};
export function createLeadManagement({store,snapshot}) {
  return (id,leadId,raw)=>{
    const parsed=managementSchema.safeParse(raw);if(!parsed.success)fail(400,'Use a valid owner, next action, due date and current version.','invalid_lead_management');
    const input=parsed.data,ownerName=input.ownerName.trim(),task=input.nextAction;
    if(task?.dueAt && (!Number.isFinite(Date.parse(task.dueAt)) || new Date(task.dueAt).toISOString()!==task.dueAt))fail(400,'Use an exact UTC due timestamp.','invalid_lead_management');
    const lead=store.read(id).leads.find(lead=>lead.id===leadId);if(!lead)fail(404,'Account not found in this business.','lead_not_found');
    const requestHash=digest({leadId,ownerName,nextAction:task});
    const previous=managementOf(lead).history.find(item=>item.id===input.requestId);
    if(previous){if(previous.requestHash!==requestHash)fail(409,'This request ID already saved a different follow-up.','management_request_conflict');return snapshot(id);}
    store.mutate(id,state=>{
      const account=state.leads.find(lead=>lead.id===leadId),current=managementOf(account);
      if(current.version!==input.expectedVersion)fail(409,'This account’s follow-up changed. Reopen it before saving.','stale_lead_management');
      const at=now(),sameTask=task && current.nextAction?.text===task.text && current.nextAction?.dueAt===task.dueAt;
      const nextAction=task?{...task,id:sameTask?current.nextAction.id:randomUUID(),completedAt:task.status==='completed'?(sameTask&&current.nextAction.status==='completed'?current.nextAction.completedAt:at):null}:null;
      const entry={id:input.requestId,requestHash,at,actor:'You',ownerName,nextAction};
      account.management={version:current.version+1,ownerName,nextAction,updatedAt:at,updatedBy:'You',history:[entry,...current.history].slice(0,20)};
      addActivity(state,'Account follow-up updated',`${account.name}; ${ownerName?'owner assigned':'unassigned'}; ${!task?'no next action':task.status==='completed'?'next action completed':'next action open'}.`,'You',{leadId,managementVersion:account.management.version,mode:'user_reported'});
    },input.revision);
    return snapshot(id);
  };
}
