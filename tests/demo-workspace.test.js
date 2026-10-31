import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,symlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareRecordingWorkspace} from '../scripts/demo/recording-workspace.js';
test('recording setup refuses application data, symlinks and unrelated populated directories, and resumes only dedicated workspaces',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'gtm-recording-'));t.after(()=>rm(root,{recursive:true,force:true}));const main=path.join(root,'main'),other=path.join(root,'other');await mkdir(main);await writeFile(path.join(main,'workspace.sqlite'),'unchanged sentinel');await mkdir(other);await writeFile(path.join(other,'owner-file'),'preserve');await symlink(main,path.join(root,'alias'));
 for(const target of [main,path.join(main,'nested'),path.join(root,'alias'),path.join(root,'alias','nested'),root,other])await assert.rejects(prepareRecordingWorkspace(target,main));assert.equal(await readFile(path.join(main,'workspace.sqlite'),'utf8'),'unchanged sentinel');assert.deepEqual(await readdir(main),['workspace.sqlite']);assert.deepEqual(await readdir(other),['owner-file']);
 const demo=await prepareRecordingWorkspace(path.join(root,'demo'),main);await writeFile(path.join(demo,'workspace.sqlite'),'recording sentinel');assert.equal(await prepareRecordingWorkspace(demo,main),demo);assert.equal(await readFile(path.join(demo,'workspace.sqlite'),'utf8'),'recording sentinel');assert.ok((await readdir(demo)).includes('.gtm-demo-workspace'));
});
