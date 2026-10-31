export function validExpansionAdjustments(business,value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const allowed=new Set(business.expansions.map(item=>item.id));
  return Object.entries(value).every(([id,row])=>allowed.has(id)&&row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===2&&Object.keys(row).every(key=>['name','reason'].includes(key))&&typeof row.name==='string'&&!!row.name.trim()&&row.name.length<=120&&typeof row.reason==='string'&&!!row.reason.trim()&&row.reason.length<=600);
}
export function expansionOptions(business,state){
  return business.expansions.map(item=>{const adjusted=state.expansionAdjustments?.[item.id];return adjusted?{...item,name:adjusted.name,reason:adjusted.reason,adjusted:true,originalName:item.name,originalReason:item.reason}:item;});
}
export const acceptedExpansions=(business,state)=>expansionOptions(business,state).filter(item=>state.expansionDecisions?.[item.id]==='accepted');
