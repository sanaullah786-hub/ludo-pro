#!/usr/bin/env node
/*
 * Ludo Pro - web build step.
 * The game is plain HTML/CSS/JS served straight from www/, so there is nothing to bundle.
 * This step is the quality gate that runs before `cap sync`:
 *   1. every required file exists and is not empty
 *   2. every JavaScript file parses (node --check)
 *   3. every local file referenced by index.html exists
 * It exits with an error code if anything is wrong, so a broken build never reaches Gradle.
 * Developer: Sanaullah Khoso
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');

const WWW = path.join(__dirname, '..', 'www');
const REQUIRED = [
  'index.html', 'css/style.css',
  'js/ludo-engine.js', 'js/ludo-ai.js', 'js/ludo-board.js', 'js/game-controller.js',
  'js/storage.js', 'js/data.js', 'js/economy.js', 'js/audio.js', 'js/app.js',
  'assets/images/logo.png', 'assets/images/splash-screen.png', 'assets/images/bg-main.jpg',
  'assets/icons/app-icon.png', 'assets/icons/icon-192.png', 'assets/icons/coin.png',
  'assets/sounds/dice.mp3', 'assets/sounds/move.mp3', 'assets/sounds/capture.mp3', 'assets/sounds/home.mp3',
  'assets/sounds/win.mp3', 'assets/sounds/click.mp3', 'assets/sounds/coin.mp3', 'assets/sounds/music.mp3'
];

let problems = 0;
function bad(msg) { problems++; console.error('  x ' + msg); }

console.log('Ludo Pro web build check');

REQUIRED.forEach(f => {
  const p = path.join(WWW, f);
  if (!fs.existsSync(p)) bad('missing file: www/' + f);
  else if (fs.statSync(p).size === 0) bad('empty file: www/' + f);
});

(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    if (fs.statSync(p).size === 0) bad('empty file: ' + path.relative(WWW, p));
    if (e.name.endsWith('.js')) {
      const r = cp.spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
      if (r.status !== 0) bad('syntax error in ' + path.relative(WWW, p) + '\n' + r.stderr);
    }
  });
})(WWW);

const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const refs = [];
html.replace(/(?:src|href)="([^"#?]+)"/g, (m, u) => { if (!/^(https?:|data:|\/\/)/.test(u)) refs.push(u); return m; });
refs.forEach(u => { if (!fs.existsSync(path.join(WWW, u))) bad('index.html references missing file: ' + u); });

const css = fs.readFileSync(path.join(WWW, 'css/style.css'), 'utf8');
css.replace(/url\(([^)]+)\)/g, (m, u) => {
  u = u.replace(/['"]/g, '');
  if (!/^(https?:|data:)/.test(u) && !fs.existsSync(path.join(WWW, 'css', u))) bad('style.css references missing file: ' + u);
  return m;
});

if (problems) { console.error('\nBuild check FAILED with ' + problems + ' problem(s).'); process.exit(1); }
console.log('  ok  ' + REQUIRED.length + ' required files, JS syntax, ' + refs.length + ' index.html references');
console.log('Web assets are ready in www/ (Capacitor webDir).');
