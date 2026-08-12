/**
 * fv_inv_head.js — standing invariants for the CDN tags in <head>.
 *
 * Contract (build deps-pin-sri, 2026-08-11): every third-party script/stylesheet
 * from a package CDN carries an EXACT version pin, an SRI integrity hash, and
 * crossorigin="anonymous". A floating tag (@2) plus the SW's cache-first CDN
 * policy meant different phones could run different library versions; a missing
 * integrity means a compromised CDN ships straight into the field. Google Fonts
 * is exempt from SRI/pin (its CSS varies per user-agent — unhashable) but is
 * the ONLY exemption. crossorigin also makes SW-cached responses CORS-type, so
 * sw.js cacheFirst's res.ok check actually sees failures instead of opaqueness.
 */
'use strict';
const fs = require('fs');
module.exports = (app, t) => {
  t.group('head: CDN tags pinned + SRI + crossorigin');
  const html = fs.readFileSync(app.file, 'utf8');
  const head = html.split('</head>')[0];
  const PKG_CDNS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
  const tags = (head.match(/<(script|link)\b[^>]*>/gi) || [])
    .filter((tag) => /\b(src|href)\s*=\s*"https:\/\//i.test(tag));
  const pkgTags = tags.filter((tag) => PKG_CDNS.some((h) => tag.includes(h)));
  t.ok(pkgTags.length >= 8, 'found the package-CDN tags (got ' + pkgTags.length + ')');
  for (const tag of pkgTags) {
    const url = (tag.match(/(?:src|href)\s*=\s*"([^"]+)"/i) || [])[1] || '';
    const short = url.replace(/^https:\/\//, '').slice(0, 60);
    t.ok(/@\d+\.\d+\.\d+\//.test(url) || /\/\d+\.\d+\.\d+\//.test(url),
      short + ' has an exact x.y.z version pin (no floating tags)');
    t.includes(tag, 'integrity="sha384-', short + ' carries an SRI hash');
    t.includes(tag, 'crossorigin="anonymous"', short + ' is crossorigin=anonymous');
  }
  const floating = tags.find((tag) => /@supabase\/supabase-js@2"/.test(tag));
  t.ok(!floating, 'supabase-js is never a floating @2 again');
  const fonts = tags.filter((tag) => tag.includes('fonts.googleapis.com/css'));
  t.ok(fonts.length <= 1, 'Google Fonts is the only SRI exemption, and there is one of it');

  t.group('document shell: pull-to-refresh stays dead (typed vitals survive the gesture)');
  const css = ((html.match(/<style>([\s\S]*?)<\/style>/i) || [])[1] || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => (css.match(new RegExp('(?:^|})\\s*' + sel + '\\{([^}]*)\\}')) || [])[1] || '';
  t.includes(rule('html'), 'overscroll-behavior-y:none', 'html forbids pull-to-refresh');
  t.includes(rule('body'), 'overscroll-behavior-y:none', 'body forbids pull-to-refresh');
  t.includes(css.match(/\.sheet\{([^}]*)\}/)[1], 'overscroll-behavior:contain',
    'sheets contain scroll-chaining — a sheet at its top edge never hands the gesture to the page');
};
