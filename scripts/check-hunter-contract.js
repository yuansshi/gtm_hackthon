// Explicit manual check against Hunter's documented public test key. Never applies contacts.
import assert from 'node:assert/strict';
import { parseHunterSearch, parseHunterVerification, createHunterProvider } from '../server/hunter.js';

async function sample(endpoint,parameters) {
  const url=new URL(`https://api.hunter.io/v2/${endpoint}`);
  for(const [name,value] of Object.entries({...parameters,api_key:'test-api-key'}))url.searchParams.set(name,value);
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(25000),headers:{Accept:'application/json'}});
  assert.equal(response.status,200,`${endpoint} public test response`);
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;assert.ok(size<=300000,'Bounded public test response');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const domain='piedpiper.com';
const searchRaw=await sample('domain-search',{domain,limit:'10'});
const parsed=parseHunterSearch(searchRaw,domain);assert.ok(parsed.candidates.length>0,'Fictional test candidate is present');
const email=parsed.candidates[0].email;
const verificationRaw=await sample('email-verifier',{email});
const matchingAddress=verificationRaw.data?.email?.toLowerCase()===email;
if(matchingAddress)parseHunterVerification(verificationRaw,email);
else assert.throws(()=>parseHunterVerification(verificationRaw,email),{code:'invalid_enrichment_output'});
assert.throws(()=>parseHunterSearch(searchRaw,'unrelated-company.test'),{code:'invalid_enrichment_output'});
assert.equal(createHunterProvider({env:{PROJECT_HUNTER_ENABLED:'true',PROJECT_HUNTER_API_KEY:'test-api-key'}}).status().configured,false);
console.log(JSON.stringify({provider:'Hunter public test API',searchContract:'passed',verificationContract:matchingAddress?'matching address parsed':'mismatched dummy address rejected',wrongDomainGuard:'passed',liveAdapterWithPublicTestKey:'disabled',contactsApplied:0,liveContactVerification:'not established'},null,2));
