import { diaryAccountConfig as config } from "./diary-account-config.js?v=20261111-mml-auth1";
import { createCloudDiaryStore } from "./diary-cloud-store.js";
export function mountDiaryAccount({root,getDiary,replaceDiary,onSaved,onStatus}) {
 if(!config.enabled){for(const button of root.querySelectorAll("[data-account-open]"))button.hidden=true;const backup=root.querySelector("[data-diary-quick-backup]");backup?.classList.replace("diary-button-quiet","diary-button-primary");}
 const dialog=root.querySelector("[data-account-dialog]"),form=dialog.querySelector("form"),status=dialog.querySelector("[data-account-status]"),actions=dialog.querySelector("[data-account-actions]"),email=form.elements.email,password=form.elements.password;
 let client,user,store,revision=null,connected=false,busy=false,pending=null,generation=0,timer,remote=null,accountStatus="";
 const show=text=>{status.textContent=text;accountStatus=text;onStatus?.();};
 const controls=()=>{email.closest("label").hidden=false;password.autocomplete="current-password";form.querySelector('[value="login"]').textContent="Log in";for(const value of ["signup","reset"])form.querySelector(`[value="${value}"]`).hidden=false;for(const b of root.querySelectorAll("[data-account-open]"))b.textContent=user?"Your account":"Create account / log in";form.hidden=!!user;actions.hidden=!user;dialog.querySelector("[data-account-name]").textContent=user?.email||"Your school email account";};
 async function init(){
  if(client)return client;
  const {createClient}=await import("./supabase-client.js");
  client=createClient(config.url,config.publishableKey,{auth:{storage:sessionStorage,storageKey:"mml:school-music-auth:v1",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  client.auth.onAuthStateChange((event,session)=>{setTimeout(async()=>{
   if((user?.id||null)===(session?.user?.id||null)&&event!=="PASSWORD_RECOVERY")return;
   generation++;connected=false;pending=null;revision=null;remote=null;user=session?.user||null;store=user?createCloudDiaryStore(client,user.id):null;controls();
   if(event==="PASSWORD_RECOVERY"){email.value=user.email;password.autocomplete="new-password";form.querySelector('[value="login"]').textContent="Save new password";for(const value of ["signup","reset"])form.querySelector(`[value="${value}"]`).hidden=true;form.hidden=false;form.dataset.mode="password";email.closest("label").hidden=true;show("Choose your new password.");dialog.showModal();return;}
   if(store){try{const epoch=generation;remote=await store.load();if(epoch!==generation)return;show(remote?"Your saved diary is ready. Open it below to continue.":"Signed in. Save your current diary below to start account saving.");}catch(e){show("Could not load account diary: "+e.message);}}
   else show("Signed out. Your account diary stays saved online.");
  },0);});
  await client.auth.getSession();return client;
 }
 for(const b of root.querySelectorAll("[data-account-open]"))b.addEventListener("click",async()=>{dialog.showModal();if(!config.enabled){show("Account saving is being connected. Email verification is not active yet. Continue using this diary and keep a device copy or backup for now.");form.hidden=true;return;}try{await init();}catch(e){show("Account service unavailable: "+e.message);}});
 dialog.querySelector("[data-account-close]").addEventListener("click",()=>dialog.close());
 form.addEventListener("submit",async e=>{e.preventDefault();if(!config.enabled||busy)return;busy=true;const submit=e.submitter,mode=submit?.value||"login";submit.disabled=true;show("Please wait…");try{
  await init();let result;
  if(form.dataset.mode==="password"){result=await client.auth.updateUser({password:password.value});if(result.error)throw result.error;delete form.dataset.mode;password.value="";show("Password updated. Your saved My Music Lessons diary is ready below.");controls();return;}
  if(mode==="reset"){if(!email.value||!email.checkValidity())throw Error("Enter your school email address first.");result=await client.auth.resetPasswordForEmail(email.value,{redirectTo:config.authReturnUrl||location.origin+location.pathname});}
  else if(mode==="signup")result=await client.auth.signUp({email:email.value,password:password.value,options:{emailRedirectTo:config.authReturnUrl||location.origin+location.pathname}});
  else result=await client.auth.signInWithPassword({email:email.value,password:password.value});
  if(result.error)throw result.error;
  password.value="";if(mode==="signup")show("Check your school email for a confirmation link. It brings you back to this My Music Lessons diary so you can continue here.");if(mode==="reset")show("If an account exists for that address, a password reset email has been requested. The secure link brings you back to this My Music Lessons diary to choose a new password.");
 }catch(e){show("Could not complete that request. "+e.message);}finally{busy=false;submit.disabled=false;}});
 async function flush(){
  if(busy||!connected||!pending)return;busy=true;const epoch=generation;
  try{while(pending&&connected&&epoch===generation){const snapshot=pending;pending=null;show("Saving to your account…");const saved=await store.save(snapshot,revision);if(epoch!==generation)return;revision=saved.revision;remote=saved;onSaved?.(snapshot);show("Saved to your account at "+new Date(saved.updated_at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})+".");}}
  catch(e){connected=false;pending=null;show("Changes are not saved online. "+e.message+" Your open diary is still here; keep a backup before reloading.");}
  finally{busy=false;}
 }
 dialog.querySelector("[data-account-load]").addEventListener("click",async()=>{if(!store||busy)return;busy=true;const epoch=generation,source=JSON.stringify(getDiary());try{const saved=await store.load();if(epoch!==generation)return;if(!saved)throw Error("No saved account diary yet. Save your current diary first.");if(source!==JSON.stringify(getDiary()))throw Error("Your diary changed while loading. Try again.");if(!replaceDiary(saved.diary))return;remote=saved;revision=saved.revision;connected=true;onSaved?.(saved.diary);show("Account diary opened. Changes now save automatically.");dialog.close();}catch(e){show(e.message);}finally{busy=false;}});
 dialog.querySelector("[data-account-save]").addEventListener("click",async()=>{if(!store||busy)return;if(remote){show("This account already has a saved diary. Open it before editing; your current diary has not replaced it.");return;}connected=true;pending=structuredClone(getDiary());await flush();});
 dialog.querySelector("[data-account-signout]").addEventListener("click",async()=>{if(busy){show("Wait for the current save before signing out.");return;}if(pending){await flush();if(!connected)return;}if(!confirm("Sign out and clear the open diary from this tab? Keep a backup first if any changes are not saved."))return;const {error}=await client.auth.signOut({scope:"local"});if(error){show(error.message);return;}generation++;connected=false;pending=null;replaceDiary(null,true);dialog.close();});
 if(config.enabled)init().catch(e=>show("Account service unavailable: "+e.message));
 return {get connected(){return connected;},get signedIn(){return !!user;},get status(){return accountStatus;},changed(){if(!connected)return;pending=structuredClone(getDiary());clearTimeout(timer);show("Changes waiting to save…");timer=setTimeout(flush,600);}};
}
