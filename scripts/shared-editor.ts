/** Small server-specific presentation/catalog adaptation of the pinned public editor.
 * The upstream checkout stays unchanged. Anchors fail closed on dependency drift. */
export function sharedEditorForServer(source:string,id:string):string {
 if(id.endsWith('/ReviewSaveModal.tsx')){
  const from="Written to rules.json one step at a time, with a backup before each write.";
  if(!source.includes(from))throw Error('Shared review copy changed; review the pinned integration.');
  return source.replace(from,'Stored for this authorization one change at a time. Clients receive the definitions on their next sync.');
 }
 if(id.endsWith('/rules-save.ts')){
  const from='Removes the rule from rules.json. butchr keeps a backup of the file.';
  if(!source.includes(from))throw Error('Shared deletion copy changed; review the pinned integration.');
  return source.replace(from,'Removes the disabled rule from this authorization. Clients remove it on their next sync.');
 }
 if(!id.endsWith('/RuleEditor.tsx'))return source;
 const replacements:[string,string][]=[
 ['const names = known.map((b) => b.name);','const names = known.filter((b) => !b.customId).map((b) => b.name);'],
 ['const options = [...names.map((n) => ({ id: n, label: `Built-in: ${n}` })), { id: CUSTOM_BRIEF_KEY, label: "Custom" }];','const options = [...names.map((n) => ({ id: n, label: `Built-in: ${n}` })), ...known.filter((b) => b.customId).map((b) => ({id:b.customId, label:`Remote brief: ${b.name}`})), {id:CUSTOM_BRIEF_KEY,label:"Custom text"}];'],
 ['onChange({ brief: `${BUILTIN_BRIEF_PREFIX}${v}` });','const saved = known.find((b) => b.customId === v); onChange({ brief: saved ? saved.text : `${BUILTIN_BRIEF_PREFIX}${v}` });'],
 ['Change them in rules.json after saving.','These fields retain their defaults in the control panel.'],
 ['Set in rules.json.','Stored in the server definition.'],
 ];
 for(const [from,to] of replacements){if(!source.includes(from))throw Error('Shared rule editor changed; review the pinned integration.');source=source.replace(from,to);}
 return source;
}
