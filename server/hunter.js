import { isIP } from 'node:net';
import { z } from 'zod';
import { AppError, digest, now } from './store.js';
import { validContactVerification } from '../src/contact-evidence.js';

const optionalText=z.string().max(2000).nullable().optional();
const providerSource=z.object({uri:z.string().max(2000),extracted_on:optionalText,last_seen_on:optionalText,still_on_page:z.boolean().optional()});
const searchSchema=z.object({data:z.object({domain:z.string().max(253),disposable:z.boolean(),webmail:z.boolean(),organization:optionalText,emails:z.array(z.object({value:z.string().max(320),type:optionalText,confidence:z.number().min(0).max(100).optional(),first_name:optionalText,last_name:optionalText,position:optionalText,seniority:optionalText,department:optionalText,linkedin:optionalText,sources:z.array(providerSource).max(30).optional(),verification:z.object({date:optionalText,status:optionalText}).nullable().optional()})).max(100)})});
const verifySchema=z.object({data:z.object({email:z.string().max(320),status:z.enum(['valid','invalid','accept_all','webmail','disposable','unknown']),score:z.number().min(0).max(100),regexp:z.boolean(),disposable:z.boolean(),webmail:z.boolean(),mx_records:z.boolean(),smtp_check:z.boolean(),accept_all:z.boolean(),block:z.boolean(),verification:z.object({date:optionalText}).nullable().optional(),sources:z.array(providerSource).max(30).optional()})});
const clean=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,200):'';
export const emailForDomain=(value,domain)=>typeof value==='string'&&/^[a-z0-9.!#$%&'+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)&&value.length<=320&&value.split('@')[0].length<=64&&value.split('@')[0].split('.').every(Boolean)&&value.split('@')[1].toLowerCase()===domain;
export function evidenceUrl(value) {
  try { const url=new URL(value);const host=url.hostname.toLowerCase();if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port||isIP(host.replace(/^\[|\]$/g,''))||!host.includes('.')||host.endsWith('.')||/\.(local|localhost|internal|lan|home|onion)$/.test(host)||[...url.searchParams.keys()].some(key=>/key|token|auth|secret|password/i.test(key))||value.length>2000)return null;return url.href; }catch{return null;}
}
export function linkedInProfile(value) {
  try {const url=new URL(value);return url.protocol==='https:'&&['linkedin.com','www.linkedin.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.port&&/^\/in\/[a-z0-9%._-]+\/?$/i.test(url.pathname)&&!url.search&&!url.hash?url.href:null;}catch{return null;}
}
function sourcesFor(sources=[]) {return sources.flatMap(source=>{const url=evidenceUrl(source.uri);return url?[{url,firstSeen:source.extracted_on||null,lastSeen:source.last_seen_on||null,stillPublished:source.still_on_page??null}]:[];}).slice(0,10);}
export function parseHunterSearch(raw,domain) {
  const parsed=searchSchema.safeParse(raw);if(!parsed.success||parsed.data.data.domain.toLowerCase()!==domain)throw new AppError(502,'Hunter returned an unexpected company or response structure. No contacts were applied.','invalid_enrichment_output');
  const data=parsed.data.data;if(data.disposable||data.webmail)throw new AppError(502,'Hunter identified a disposable or webmail domain. No contacts were applied.','unsupported_contact_domain');
  const seen=new Set();const candidates=data.emails.flatMap(email=>{
    const address=email.value.toLowerCase();if(!emailForDomain(address,domain)||seen.has(address))return [];seen.add(address);
    return [{id:digest({domain,email:address}).slice(0,24),email:address,name:[clean(email.first_name),clean(email.last_name)].filter(Boolean).join(' '),role:clean(email.position),seniority:clean(email.seniority),department:clean(email.department),addressType:clean(email.type)||'unknown',vendorScore:email.confidence??null,linkedIn:linkedInProfile(email.linkedin),sources:sourcesFor(email.sources),searchVerification:{status:clean(email.verification?.status)||'unknown',date:email.verification?.date||null},provenance:'hunter_domain_search'}];
  }).slice(0,10);
  return {provider:'Hunter',domain,organization:clean(data.organization),candidates,returnedCount:data.emails.length,retainedCount:candidates.length,checkedAt:now()};
}
export function parseHunterVerification(raw,email) {
  const parsed=verifySchema.safeParse(raw);if(!parsed.success||parsed.data.data.email.toLowerCase()!==email)throw new AppError(502,'Hunter returned an unexpected address or verification structure. No verification was applied.','invalid_enrichment_output');
  const data=parsed.data.data;const date=data.verification?.date||null;
  const result={provider:'Hunter',email,status:data.status,score:data.score,regexp:data.regexp,mxFound:data.mx_records,smtpCheck:data.smtp_check,acceptAll:data.accept_all,blocked:data.block,disposable:data.disposable,webmail:data.webmail,verificationDate:date,checkedAt:now(),sources:sourcesFor(data.sources)};
  return {...result,providerValid:validContactVerification(result)};
}
export function createHunterProvider({env=process.env,fetcher=fetch}={}) {
  const key=env.PROJECT_HUNTER_API_KEY;const configured=env.PROJECT_HUNTER_ENABLED==='true'&&typeof key==='string'&&key.length>=20&&!/dummy|placeholder|replace|changeme|example|test-api-key/i.test(key);
  let verifiedAt=null;
  const status=()=>({name:'Hunter contact research',configured,verifiedAt,status:!configured?'Not configured':verifiedAt?'Response verified':'Configured; not verified'});
  const requireConfigured=()=>{if(!configured)throw new AppError(503,'Hunter is not configured. Add an explicitly enabled project Hunter key on the server. Public contact and MX research remain available.','enrichment_not_configured');};
  const request=async(endpoint,params)=>{
    requireConfigured();const url=new URL(`https://api.hunter.io/v2/${endpoint}`);for(const [name,value] of Object.entries({...params,api_key:key}))url.searchParams.set(name,value);
    try {
      const response=await fetcher(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(25000),headers:{Accept:'application/json'}});
      if(response.status===202&&endpoint==='email-verifier'){await response.body?.cancel();return {pending:true};}
      if(response.status!==200){await response.body?.cancel();const code=response.status===451?'contact_processing_restricted':response.status===401||response.status===403?'enrichment_auth_failed':response.status===429?'enrichment_rate_limited':'enrichment_request_failed';throw new AppError(502,response.status===451?'Hunter restricts processing of this contact. It cannot be selected or requested again.':'Hunter could not complete the request. Check project access and provider limits; local credits were refunded where applicable.',code);}
      if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw new Error('Invalid type');}
      let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>300000)throw new Error('Oversized');chunks.push(chunk);}const raw=Buffer.concat(chunks).toString('utf8');if(raw.includes(key))throw new Error('Credential reflected in provider output');return JSON.parse(raw);
    }catch(error){if(error instanceof AppError)throw error;throw new AppError(502,'Hunter could not complete the secure request. No provider details or credentials were exposed. External billing may be unknown.','enrichment_request_failed');}
  };
  return {status,requireConfigured,
    async search(domain){const value=parseHunterSearch(await request('domain-search',{domain,limit:'10'}),domain);verifiedAt=now();return value;},
    async verify(email){const result=await request('email-verifier',{email});if(result.pending)return {pending:true};const value=parseHunterVerification(result,email);verifiedAt=now();return value;}
  };
}
