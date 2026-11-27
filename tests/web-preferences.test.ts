import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolvePreferences} from '../src/client/prefs-resolve';

test('theme follows the system until the user chooses one',()=>{
 assert.equal(resolvePreferences({},true,true).theme,'light');
 assert.equal(resolvePreferences({},false,true).theme,'dark');
 assert.equal(resolvePreferences({locale:'en'},true,false).themeChosen,false);
 assert.equal(resolvePreferences({theme:'dark'},true,true).theme,'dark');
 assert.equal(resolvePreferences({theme:'dark'},true,true).themeChosen,true);
});
test('font size level renders 16px on desktop and 18px on phones by default',()=>{
 assert.equal(resolvePreferences({},false,true).rootPx,16);
 assert.equal(resolvePreferences({},false,false).rootPx,18);
 assert.equal(resolvePreferences({fontSize:22},false,true).rootPx,20);
 assert.equal(resolvePreferences({fontSize:22},false,false).rootPx,22);
 assert.equal(resolvePreferences({fontSize:17 as 18},false,false).fontSize,18);
 assert.equal(resolvePreferences({locale:'fr' as 'en'},false,false).locale,'zh-CN');
});
