const date = (value) => new Date(value + "T12:00:00Z");
const iso = (value) => value.toISOString().slice(0,10);
export function calendarRange(mode, value) {
 const d=date(value), y=d.getUTCFullYear(), m=d.getUTCMonth();
 return {from:iso(new Date(Date.UTC(y,mode==="year"?0:m,1,12))),to:iso(new Date(Date.UTC(y,mode==="year"?12:m+1,0,12)))};
}
export function monthCells(value) {
 const {from,to}=calendarRange("month",value), first=date(from), last=date(to);
 first.setUTCDate(first.getUTCDate()-((first.getUTCDay()+6)%7));
 last.setUTCDate(last.getUTCDate()+(6-((last.getUTCDay()+6)%7)));
 const cells=[];for(let d=new Date(first);d<=last;d.setUTCDate(d.getUTCDate()+1))cells.push(iso(d));return cells;
}
export function shiftPeriod(value, mode, amount) {
 const d=date(value), wanted=d.getUTCDate();d.setUTCDate(1);
 if(mode==="year")d.setUTCFullYear(d.getUTCFullYear()+amount);else d.setUTCMonth(d.getUTCMonth()+amount);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(wanted,last));return iso(d);
}
const monthLabel=new Intl.DateTimeFormat("en-GB",{month:"long",year:"numeric",timeZone:"UTC"});
const dayLabel=new Intl.DateTimeFormat("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:"UTC"});
export function renderCalendar({container,mode,anchor,rows,clashes,closures,termStart,termEnd,onSelect}) {
 const doc=container.ownerDocument, make=(tag,text,cls)=>{const e=doc.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;}, byDate=new Map();
 for(const row of rows){if(!byDate.has(row.date))byDate.set(row.date,[]);byDate.get(row.date).push(row);}
 container.replaceChildren();container.className="diary-calendar diary-calendar-"+mode;
 for(let month=0;month<(mode==="year"?12:1);month++){
  const focus=mode==="year"?anchor.slice(0,4)+"-"+String(month+1).padStart(2,"0")+"-01":anchor;
  const section=make("section","","diary-calendar-month");section.append(make("h4",monthLabel.format(date(focus))));
  const grid=make("div","","diary-calendar-days");
  for(const name of ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"])grid.append(make("span",name,"diary-calendar-weekday"));
  for(const value of monthCells(focus)){
   const items=byDate.get(value)||[],closure=closures.find(c=>value>=c.start&&value<=c.end),active=value>=termStart&&value<=termEnd;
   const b=make("button","","diary-calendar-date");b.type="button";b.dataset.calendarDate=value;b.disabled=!active;
   b.classList.toggle("is-other-month",value.slice(0,7)!==focus.slice(0,7));b.classList.toggle("is-closed",!!closure);b.classList.toggle("has-clash",items.some(o=>clashes.has(o.id)));
   const description=dayLabel.format(date(value))+", "+items.length+" sessions"+(closure?", "+closure.label:"")+(active?". Open day":". Outside term");b.setAttribute("aria-label",description);b.title=description;
   b.append(make("strong",String(Number(value.slice(8)))));
   if(mode==="month"){
    if(closure)b.append(make("span",closure.label||"Closed","diary-calendar-closure"));
    for(const item of items.slice(0,3))b.append(make("span",item.startTime+" "+item.title,"diary-calendar-session"));
    if(items.length>3)b.append(make("span","+"+(items.length-3)+" more","diary-calendar-more"));
   }else if(items.length)b.append(make("span",String(items.length),"diary-calendar-count"));
   b.addEventListener("click",()=>onSelect(value));grid.append(b);
  }section.append(grid);container.append(section);
 }
}
