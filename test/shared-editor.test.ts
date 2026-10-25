import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {sharedEditorForServer} from '../scripts/shared-editor.js';
test('shared editor adaptation keeps actual upstream forms and supplies server-owned brief copy semantics',()=>{
 const base=new URL('../vendor/butchr/dashboard-app/src/components/rules-targeting/',import.meta.url);
 const editor=readFileSync(new URL('RuleEditor.tsx',base),'utf8'),adapted=sharedEditorForServer(editor,'/vendor/butchr/dashboard-app/RuleEditor.tsx');
 expect(adapted).toContain('Remote brief:');expect(adapted).toContain('saved ? saved.text');expect(adapted).not.toContain('Change them in rules.json after saving.');expect(adapted).toContain('Stored in the server definition.');expect(()=>sharedEditorForServer('changed source','/RuleEditor.tsx')).toThrow('Shared rule editor changed');
 const review=readFileSync(new URL('ReviewSaveModal.tsx',base),'utf8');expect(sharedEditorForServer(review,'/ReviewSaveModal.tsx')).toContain('Stored for this authorization');
});

test('server deletion review describes scoped storage without promising nonexistent file backups',()=>{
 const source=readFileSync(new URL('../vendor/butchr/dashboard-app/src/view-model/rules-save.ts',import.meta.url),'utf8');
 const adapted=sharedEditorForServer(source,'/vendor/butchr/dashboard-app/src/view-model/rules-save.ts');expect(adapted).not.toContain('butchr keeps a backup of the file.');expect(adapted).toContain('Removes the disabled rule from this authorization.');
});
