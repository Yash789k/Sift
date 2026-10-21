'use strict';
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
function buildNative(){
  if(process.platform!=='win32')return;
  const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  if(!fs.existsSync(compiler))throw Error('Windows .NET Framework C# compiler is required to build the Explorer context helper.');
  const source=path.resolve(__dirname,'../src/native/SelectionProbe.cs');
  const output=path.resolve(__dirname,'../src/native/SelectionProbe.exe');
  execFileSync(compiler,['/nologo','/target:exe','/optimize+','/r:Microsoft.CSharp.dll','/r:System.Web.Extensions.dll','/out:'+output,source],{windowsHide:true,stdio:'pipe'});
}
if(require.main===module)buildNative();
module.exports={buildNative};
