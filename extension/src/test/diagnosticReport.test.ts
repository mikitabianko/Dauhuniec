import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { DiagnosticRecorder, createRedactor, reportFiles, zipFiles, pathCharacteristics } from '../diagnosticReport';

test('redaction is consistent across files, preserves suffix spaces, umlauts, Cyrillic and brackets', () => {
 const redact=createRedactor(['ABCDEF1234'],'/Users/Müller','Müller');
 const source='/Users/Müller/Applications/STMicroelectronics/STM32CubeIDE 1.18 [ü] Кириллица.app';
 const events=[{time:'now',stage:'debug.configuration',data:{serverpath:source,serialNumber:'ABCDEF1234',command:['server', 'sn=ABCDEF1234']}}];
 const files=reportFiles({project:{collected:true,root:source}},events,redact);
 for(const text of Object.values(files)) {assert.ok(!text.includes('Müller'));assert.ok(!text.includes('ABCDEF1234'));}
 const data=JSON.parse(files['diagnostics.json']);assert.equal(data.events[0].data.serverpath,'<HOME>/Applications/STMicroelectronics/STM32CubeIDE 1.18 [ü] Кириллица.app');
 assert.equal(redact('C:\\Users\\Other\\Tools [ü]\\server.exe'), 'C:\\Users\\<USER>\\Tools [ü]\\server.exe');
 assert.equal(redact('sn=XYZ123456'), 'sn=<ID>');
 assert.equal(redact('Selected ST-LINK 0123456789 disconnected'),'Selected ST-LINK <ID> disconnected');
 assert.equal(redact('Serial number : 0123456789'),'Serial number : <ID>');
 assert.equal(redact('No ST-LINK connected'),'No ST-LINK connected');
});
test('bounded recording truncates large logs, retains failure, reports eviction', () => {
 const recorder=new DiagnosticRecorder();for(let i=0;i<100;i++)recorder.record('stdout','ü'.repeat(20000));
 recorder.record('process.error',{code:23,stderr:'failure'});const events=recorder.snapshot();assert.ok(recorder.dropped>0);assert.ok(Buffer.byteLength(JSON.stringify(events))<280000);assert.equal(events.at(-1)?.stage,'process.error');
 assert.ok(events.some(e=>String(e.data).includes('[truncated]')));
});
test('export without CLI/project produces standalone valid ZIP and explains missing data', () => {
 const files=reportFiles({cli:{collected:false,reason:'CLI unavailable'},logs:{collected:false,reason:'No launch yet'}},[],text=>text);
 assert.match(files['summary.txt'],/Unavailable/);assert.match(files['diagnostics.json'],/CLI unavailable/);
 const zip=zipFiles(files);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);assert.equal(zip.readUInt16LE(zip.length-12),3);
 // Walk all local entries and verify exact contents, including UTF-8 text.
 let offset=0;for(const [name,text] of Object.entries(files)){assert.equal(zip.readUInt32LE(offset),0x04034b50);const size=zip.readUInt32LE(offset+18),length=zip.readUInt16LE(offset+26);assert.equal(zip.subarray(offset+30,offset+30+length).toString(),name);assert.equal(zip.subarray(offset+30+length,offset+30+length+size).toString(),text);offset+=30+length+size;}
});
test('unrelated settings, source and complete environment are absent from basic report', () => {
 const recorder=new DiagnosticRecorder();recorder.record('process.start',{binary:'/tools/server',args:['-k'],cwd:'/project'});
 const files=reportFiles({host:{collected:true,language:'de'}},recorder.snapshot(),text=>text);
 const json=JSON.parse(files['diagnostics.json']);assert.equal(json.environment,undefined);assert.equal(json.source,undefined);assert.equal(json.settings,undefined);assert.match(files['summary.txt'],/excluded/);
});

test('redacted homes retain non-identifying Unicode and wildcard diagnostics',()=>{
 const home='/Users/Müller тест [dev]';const characteristics=pathCharacteristics(home);
 assert.equal(characteristics.spaces,true);assert.equal(characteristics.brackets,true);assert.ok(characteristics.unicodeCodePoints.includes('U+00FC'));
 assert.ok(!JSON.stringify(characteristics).includes('Müller'));assert.ok(!JSON.stringify(characteristics).includes('тест'));
});
