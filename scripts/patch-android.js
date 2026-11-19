#!/usr/bin/env node
/*
 * Ludo Pro - post-sync tweaks to the generated Android project.
 *  - locks the game to portrait orientation
 *  - sets versionName / versionCode from package.json
 * Safe to run repeatedly; it only warns (never fails) if the template changes.
 * Developer: Sanaullah Khoso
 */
'use strict';
const fs = require('fs'), path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const manifest = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const gradle = path.join(root, 'android', 'app', 'build.gradle');

function warn(m) { console.warn('patch-android: ' + m); }

if (!fs.existsSync(manifest)) {
  warn('android project not found - run `npx cap add android` first.');
  process.exit(0);
}

let xml = fs.readFileSync(manifest, 'utf8');
if (!/android:screenOrientation=/.test(xml)) {
  const next = xml.replace(/<activity\b/, '<activity\n            android:screenOrientation="portrait"');
  if (next === xml) warn('could not find <activity> in AndroidManifest.xml'); else { xml = next; console.log('patch-android: portrait orientation set'); }
}
fs.writeFileSync(manifest, xml);

if (fs.existsSync(gradle)) {
  let g = fs.readFileSync(gradle, 'utf8');
  const parts = pkg.version.split('.').map(Number);
  const code = (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
  const before = g;
  g = g.replace(/versionCode\s+\d+/, 'versionCode ' + code).replace(/versionName\s+"[^"]*"/, 'versionName "' + pkg.version + '"');
  if (g !== before) { fs.writeFileSync(gradle, g); console.log('patch-android: version ' + pkg.version + ' (' + code + ')'); }
  else warn('versionCode/versionName lines not found in app/build.gradle (left unchanged)');
} else warn('app/build.gradle not found');
