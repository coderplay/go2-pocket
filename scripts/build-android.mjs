import {existsSync,readdirSync,copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const tools=join(root,'output/android-tools');
const java=process.env.JAVA_HOME || (existsSync(tools)
  ? readdirSync(tools).filter(n=>n.startsWith('jdk-')).map(n=>join(tools,n,'Contents/Home')).find(p=>existsSync(join(p,'bin/java')))
  : undefined);
const sdk=process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  || [join(tools,'sdk'),join(homedir(),'Library/Android/sdk')].find(p=>existsSync(join(p,'platform-tools')));
if(!java || !sdk) {
  console.error('Install Java 21 and Android SDK 37.0, then set JAVA_HOME and ANDROID_HOME. See docs/android.md.');
  process.exit(1);
}
const result=spawnSync('./gradlew',['--no-daemon',':app:assembleDebug',':app:testDebugUnitTest'],{
  cwd:join(root,'android'),stdio:'inherit',env:{...process.env,JAVA_HOME:java,ANDROID_HOME:sdk,
    GRADLE_USER_HOME:process.env.GRADLE_USER_HOME||join(tools,'gradle')},
});
if(result.error) throw result.error;
if(result.status!==0) process.exit(result.status||1);
mkdirSync(join(root,'output/android'),{recursive:true});
const apk=join(root,'output/android/Go2Pocket-debug.apk');
copyFileSync(join(root,'android/app/build/outputs/apk/debug/app-debug.apk'),apk);
writeFileSync(`${apk}.sha256`,`${createHash('sha256').update(readFileSync(apk)).digest('hex')}  Go2Pocket-debug.apk\n`);
console.log(`APK: ${apk}`);
