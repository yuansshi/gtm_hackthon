import { z } from 'zod';
import { AppError, now } from './store.js';
import { publicSourceUrl } from './public-source.js';

const schema=z.object({query:z.string().max(1000).optional(),request_id:z.string().max(200).optional(),usage:z.object({credits:z.number().min(0).max(1000000)}).optional(),results:z.array(z.object({title:z.string().max(1000),url:z.string().max(5000),content:z.string().max(30000),score:z.number().min(0).max(1).optional(),published_date:z.string().max(100).nullable().optional()})).max(40)});
export const searchSourceUrl=value=>{
  try {const url=publicSourceUrl(value);if([...url.searchParams.keys()].some(key=>/^(?:api[-_]?key|token|access[-_]?token|auth|authorization|secret|password|signature|x-amz-credential|x-amz-signature)$/i.test(key)))return null;return url.href;}catch{return null;}
};
export function parseProspectSearch(raw,query) {
  const parsed=schema.safeParse(raw);if(!parsed.success||(parsed.data.query&&parsed.data.query.toLowerCase().replace(/\s+/g,' ').trim()!==query.toLowerCase().replace(/\s+/g,' ').trim()))throw new AppError(502,'The search provider returned an unexpected response. No candidates were admitted.','invalid_search_output');
  const response=parsed.data;let unsafeCount=0;const results=response.results.slice(0,8).flatMap(result=>{const url=searchSourceUrl(result.url);if(!url){unsafeCount++;return [];}return [{title:result.title.slice(0,250),url,snippet:result.content.slice(0,700),searchRelevance:result.score??null,publishedDate:result.published_date||null}];});
  return {provider:'Tavily',query,requestId:response.request_id||null,usage:response.usage||null,results,unsafeCount,checkedAt:now()};
}
export function createProspectSearchProvider({env=process.env,fetcher=fetch}={}) {
  const key=env.PROJECT_TAVILY_API_KEY;const configured=env.PROJECT_TAVILY_ENABLED==='true'&&typeof key==='string'&&key.length>=20&&!/\s/.test(key)&&!/dummy|placeholder|replace|changeme|example/i.test(key);let verifiedAt=null;
  const status=()=>({name:'Tavily prospect search',configured,verifiedAt,status:!configured?'Not configured':verifiedAt?'Response verified':'Configured; not verified'});
  const requireConfigured=()=>{if(!configured)throw new AppError(503,'Prospect search is not configured. Enable a project-specific Tavily key on the server. Website intake and collection refresh remain available.','search_not_configured');};
  const search=async query=>{
    requireConfigured();let response;
    try {
      response=await fetcher('https://api.tavily.com/search',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({query,search_depth:'basic',topic:'general',max_results:8,include_answer:false,include_raw_content:false,include_images:false,include_usage:true,auto_parameters:false})});
      if(response.status!==200){await response.body?.cancel();const code=[401,403].includes(response.status)?'search_auth_failed':[429,432,433].includes(response.status)?'search_rate_limited':'search_request_failed';throw new AppError(502,'Tavily could not complete this search. Check project access and provider limits. No accounts were admitted; provider billing may be unknown.',code);}
      if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw new Error('Unsupported response');}
      let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>500000)throw new Error('Oversized response');chunks.push(chunk);}const raw=Buffer.concat(chunks).toString('utf8');if(raw.includes(key))throw new Error('Reflected credential');const result=parseProspectSearch(JSON.parse(raw),query);verifiedAt=now();return result;
    }catch(error){if(error instanceof AppError)throw error;throw new AppError(502,'The secure search request failed. Provider details and credentials were not exposed; external billing may be unknown.','search_request_failed');}
  };
  return {status,requireConfigured,search};
}
