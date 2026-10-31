import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeConfig} from '../server/runtime-config.js';
const token='fixture-project-token-'.repeat(3);

test('network binding requires a strong designated project token and an explicit browser origin',()=>{
  assert.throws(()=>runtimeConfig({HOST:'0.0.0.0'}),/PROJECT_ACCESS_TOKEN is required/);
  assert.throws(()=>runtimeConfig({HOST:'0.0.0.0',PROJECT_ACCESS_TOKEN:'dummy'}),/at least 32/);
  assert.throws(()=>runtimeConfig({HOST:'0.0.0.0',PROJECT_ACCESS_TOKEN:' '+token}),/whitespace/);
  assert.throws(()=>runtimeConfig({HOST:'0.0.0.0',PROJECT_ACCESS_TOKEN:token}),/PUBLIC_ORIGIN is required/);
  assert.equal(runtimeConfig({}).host,'127.0.0.1');
});
test('origin normalization supports TLS termination without trusting request proxy headers, and rejects ambiguous public URLs',()=>{
  const config=runtimeConfig({HOST:'0.0.0.0',PROJECT_ACCESS_TOKEN:token,PUBLIC_ORIGIN:'https://portal.fixture.test/'});assert.equal(config.publicOrigin,'https://portal.fixture.test');assert.equal(config.secureCookies,true);
  assert.equal(runtimeConfig({PUBLIC_ORIGIN:'http://127.0.0.1:3001'}).secureCookies,false);
  for(const PUBLIC_ORIGIN of ['http://portal.fixture.test','https://portal.fixture.test/path','https://user:pass@portal.fixture.test','https://portal.fixture.test/?x=1','https://portal.fixture.test/#fragment','*','file:///tmp/test'])assert.throws(()=>runtimeConfig({PUBLIC_ORIGIN}),/PUBLIC_ORIGIN/);
});
test('listening ports reject malformed values and retain ephemeral-port support for isolated rehearsals',()=>{
  for(const PORT of ['abc','-1','65536','1.5'])assert.throws(()=>runtimeConfig({PORT}),/PORT/);
  assert.equal(runtimeConfig({PORT:'0'}).port,0);assert.equal(runtimeConfig({PORT:'3001'}).port,3001);
});
