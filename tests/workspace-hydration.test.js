import test from 'node:test';
import assert from 'node:assert/strict';
import { canImportLegacyProfile } from '../src/workspace-hydration.js';
test('an actual existing browser backup can seed an untouched server workspace only',()=>{assert.equal(canImportLegacyProfile({},true),true);assert.equal(canImportLegacyProfile({},false),false);assert.equal(canImportLegacyProfile({profileImported:true},true),false);});
test('reviewed profiles and existing server campaign work cannot be overwritten by stale browser backups',()=>{for(const state of [{approved:true},{leads:[{id:'account'}]},{drafts:[{id:'draft'}]},{activity:[{title:'Profile reviewed'}]}])assert.equal(canImportLegacyProfile(state,true),false);});
