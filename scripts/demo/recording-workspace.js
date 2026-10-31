import path from 'node:path';
import {mkdir,readdir,realpath,writeFile} from 'node:fs/promises';
export async function prepareRecordingWorkspace(directory,protectedDirectory){
  const requested=path.resolve(directory),protectedPath=path.resolve(protectedDirectory);
  const overlaps=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);
  if(overlaps(requested,protectedPath))throw Error('The application data directory cannot be used for recording.');
  const reserved=await realpath(protectedPath).catch(()=>protectedPath);
  // Resolve an existing ancestor before creating anything through a symlink.
  let ancestor=requested,resolved;
  while(!resolved){
    try{resolved=path.join(await realpath(ancestor),path.relative(ancestor,requested));}
    catch(error){if(error.code!=='ENOENT'||ancestor===path.dirname(ancestor))throw error;ancestor=path.dirname(ancestor);}
  }
  if(overlaps(resolved,reserved))throw Error('The application data directory cannot be used for recording.');
  await mkdir(requested,{recursive:true});
  const actual=await realpath(requested);
  if(overlaps(actual,reserved))throw Error('The application data directory cannot be used for recording.');
  const entries=await readdir(actual),marker='.gtm-demo-workspace';
  if(entries.length&&!entries.includes(marker))throw Error('Use an empty dedicated directory, or a previously marked demo workspace.');
  if(!entries.includes(marker))await writeFile(path.join(actual,marker),'Dedicated GTM demonstration workspace. Never move this marker to application data.\n',{flag:'wx'});
  return actual;
}
