// Exercise the real VS Code API in an isolated profile, never the user's profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const project = process.argv[2];
if (!project) throw new Error('Usage: pnpm run test:host /path/to/configured/CubeMX/project');
const candidates = [process.env.DAUHUNIEC_VSCODE_EXECUTABLE,
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron', '/usr/share/code/code',
  path.join(process.env.LOCALAPPDATA || '', 'Programs/Microsoft VS Code/Code.exe'),
  path.join(process.env.ProgramFiles || '', 'Microsoft VS Code/Code.exe')].filter(Boolean);
const executable = candidates.find(candidate => fs.existsSync(candidate));
if (!executable) throw new Error('Set DAUHUNIEC_VSCODE_EXECUTABLE to the VS Code application executable.');
const extension = path.resolve(__dirname, '..');
// macOS IPC sockets have a short path limit; its default TMPDIR is too long.
const profile = process.env.DAUHUNIEC_TEST_PROFILE || fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'cr-vsc-'));
const userData = path.join(profile, 'user-data');
fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({
  'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none',
  'window.restoreWindows': 'none', 'update.mode': 'none',
  ...((process.argv.includes('--clangd') || process.argv.includes('--navigation')) ? { 'clangd.path': process.env.DAUHUNIEC_CLANGD || 'clangd', 'C_Cpp.intelliSenseEngine': 'default' } : {}),
  'chat.disableAIFeatures': true, 'extensions.ignoreRecommendations': true,
  'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false, 'telemetry.telemetryLevel': 'off'
}));
if (process.argv.includes('--clangd') || process.argv.includes('--navigation')) {
  const clangd = process.env.DAUHUNIEC_CLANGD_EXTENSION;
  if (!clangd || !fs.existsSync(path.join(clangd, 'package.json'))) throw new Error('Set DAUHUNIEC_CLANGD_EXTENSION to an installed official clangd extension for this isolated host test.');
  fs.mkdirSync(path.join(profile, 'extensions'), {recursive:true});
  fs.cpSync(clangd, path.join(profile, 'extensions', path.basename(clangd)), {recursive:true});
}
if (process.argv.includes('--tool-debug')) {
  const cortex = process.env.DAUHUNIEC_CORTEX_DEBUG_EXTENSION;
  if (!cortex || !fs.existsSync(path.join(cortex, 'package.json'))) throw new Error('Set DAUHUNIEC_CORTEX_DEBUG_EXTENSION to an installed Cortex-Debug extension for this host test.');
  fs.mkdirSync(path.join(profile, 'extensions'), { recursive: true });
  const copied=new Set();
  const copyExtension=source=>{
    const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
    const id=pkg.publisher+'.'+pkg.name;if(copied.has(id))return;copied.add(id);
    fs.cpSync(source,path.join(profile,'extensions',path.basename(source)),{recursive:true});
    for(const dependency of pkg.extensionDependencies || []) {
      const parent=path.dirname(cortex);
      const found=fs.readdirSync(parent).filter(name=>name.startsWith(dependency+'-')).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))[0];
      if(!found)throw new Error('Missing installed test dependency: '+dependency);
      copyExtension(path.join(parent,found));
    }
  };
  copyExtension(cortex);
}
if (process.argv.includes('--persist-history')) {
  fs.rmSync(path.join(profile,'history-result.json'),{force:true});
  const driver = path.join(profile, 'extensions', 'dauhuniec-history-driver');
  fs.mkdirSync(driver, {recursive:true});
  fs.writeFileSync(path.join(driver,'package.json'),JSON.stringify({name:'history-driver',publisher:'dauhuniec-tests',version:'1.0.0',engines:{vscode:'^1.95.0'},activationEvents:['onStartupFinished'],main:'./index.js'}));
  fs.writeFileSync(path.join(driver,'index.js'),`exports.activate=async()=>{const vscode=require('vscode');try{await require(${JSON.stringify(path.join(extension,'dist/test/toolHistoryRestartHost.js'))}).run();require('fs').writeFileSync(${JSON.stringify(path.join(profile,'history-result.json'))},JSON.stringify({passed:true,phase:process.env.DAUHUNIEC_VERIFY_HISTORY}));}catch(e){require('fs').writeFileSync(${JSON.stringify(path.join(profile,'history-result.json'))},JSON.stringify({passed:false,error:String(e),stack:e.stack}));}await vscode.commands.executeCommand('workbench.action.quit');};`);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
console.log('Isolated VS Code profile:', profile);
const child = spawn(executable, ['--user-data-dir', userData, '--extensions-dir', path.join(profile, 'extensions'),
  '--extensionDevelopmentPath', extension, ...(process.argv.includes('--persist-history') ? [] : ['--extensionTestsPath', path.join(extension, process.argv.includes('--navigation') ? 'dist/test/navigationHost.js' : process.argv.includes('--presets') ? 'dist/test/buildPresetsHost.js' : process.argv.includes('--clangd') ? 'dist/test/clangdHost.js' : process.argv.includes('--tool-isolation') ? 'dist/test/toolIsolationHost.js' : process.argv.includes('--tool-managed') ? 'dist/test/toolManagedRecoveryHost.js' : process.argv.includes('--tool-debug') ? 'dist/test/toolDebugHost.js' : process.argv.includes('--tool-recovery') ? 'dist/test/toolRecoveryHost.js' : process.argv.includes('--targets-startup') ? 'dist/test/targetBoardStartupHost.js' : process.argv.includes('--targets') ? 'dist/test/targetBoardHost.js' : process.argv.includes('--serial') ? 'dist/test/serialMonitorHost.js' : process.argv.includes('--cubemx') ? 'dist/test/cubeMXHost.js' : process.argv.includes('--focus') ? 'dist/test/userCodeHost.js' : 'dist/test/host.js')]),
  '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu', '--new-window', path.resolve(project)],
  { env, stdio: 'inherit' });
const timeout = setTimeout(() => { console.error('Extension Host test timed out.'); child.kill(); }, 120000);
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { clearTimeout(timeout); if (signal) console.error('VS Code exited with signal', signal); process.exitCode = code ?? 1;
  if(process.argv.includes('--persist-history')) {
    try { const result=JSON.parse(fs.readFileSync(path.join(profile,'history-result.json'),'utf8'));
      if(!result.passed || result.phase!==process.env.DAUHUNIEC_VERIFY_HISTORY) {console.error(result);process.exitCode=1;}
      else console.log(process.env.DAUHUNIEC_VERIFY_HISTORY==='1'?'DAUHUNIEC_HISTORY_RESTART_PASS':'DAUHUNIEC_HISTORY_SAVED_PASS');
    }catch(error){console.error(error);process.exitCode=1;}
  }
});
