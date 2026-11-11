import { validateDiary } from "./diary-model.js";
export function createCloudDiaryStore(client, ownerId) {
 if(!ownerId) throw Error("Sign in before opening a saved diary.");
 const result=(r,required=false)=>{if(r.error)throw Error(r.error.message||"Account saving failed.");if(!r.data){if(required)throw Error("Another tab or device changed your saved diary. Reopen the saved version before continuing.");return null;}return {...r.data,diary:validateDiary(r.data.diary)};};
 return {
  async load(){return result(await client.from("mml_school_diaries").select("diary,revision,updated_at").eq("owner_id",ownerId).maybeSingle());},
  async save(diary,expectedRevision){
   const row={owner_id:ownerId,diary:validateDiary(diary),revision:crypto.randomUUID(),updated_at:new Date().toISOString()};
   if(JSON.stringify(row.diary).length>1048576)throw Error("This diary exceeds the account storage limit.");
   let q=expectedRevision?client.from("mml_school_diaries").update(row).eq("owner_id",ownerId).eq("revision",expectedRevision):client.from("mml_school_diaries").insert(row);
   return result(await q.select("diary,revision,updated_at").maybeSingle(),true);
  }
 };
}
