import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';

test('startup health is minimal, uncached and free of workspace/provider access without weakening API authentication',async t=>{
  const forbidden = new Proxy({}, {get(){throw Error('Health must not read workspace state or call a provider.');}});
  const server=createApp({service:forbidden,store:forbidden,accessToken:'test-project-token',serveStatic:false}).listen(0,'127.0.0.1');
  t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));
  const root='http://127.0.0.1:'+server.address().port;
  for(let i=0;i<2;i++){
    const response=await fetch(root+'/healthz');assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'ok'});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  }
  assert.equal((await fetch(root+'/api/businesses/allco')).status,401);
  assert.equal((await fetch(root+'/api/status')).status,401);
});

test('an HTTPS deployment sets Secure cookies even when TLS terminates before the Node listener',async t=>{
  const service={deliveryStatus:()=>({configured:false})};
  const server=createApp({service,store:{},accessToken:'fixture-only',secureCookies:true,serveStatic:false}).listen(0,'127.0.0.1');
  t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessToken:'fixture-only'})});
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/; Secure;/);assert.match(response.headers.get('set-cookie'),/; HttpOnly;/);assert.match(response.headers.get('set-cookie'),/SameSite=Strict/);
});
