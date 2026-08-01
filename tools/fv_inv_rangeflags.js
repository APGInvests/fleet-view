/**
 * fv_inv_rangeflags.js — standing invariants for per-model range flags.
 *
 * Plate ranges (CAT XQ-500): fuel 75–122 psi; oil 40–87 running, 15–87 idle.
 * The contract: flags COMMENT on typed numbers, inline, while the tech is at the
 * machine. Oil's two floors share a ceiling, so only the 15–40 band needs load
 * state — flagged when load % ≥ 30, silent when load is unknown or light. No
 * flags unless status reads Running. Unknown model ⇒ silence (a miss can never
 * flag the wrong machine). Never prefills, proposes, blocks or recolors an input.
 */
'use strict';
module.exports = async (app, t) => {
  let seq = 0;
  const id = (p) => p + '-' + (++seq);
  const mkUnit = (o = {}) => Object.assign({ id: id('u'), serial: id('SER'), tagId: '', klass: 'big',
    make: 'CAT', model: 'XQ-500', kw: 625, opStatus: 'running',
    locationType: 'show', locationId: 'show-A', photos: [], jobMeta: {}, updatedAt: 1 }, o);
  const $v = (sel, v) => { app.document.querySelector(sel).value = v; };
  const openForm = (uid2) => { app.fn.logVitals(uid2); ['#v_op', '#v_fp', '#v_kw'].forEach((x) => $v(x, '')); };
  const flags = () => { app.fn.rangeFlags(); return app.document.querySelector('#v_rangeFlags').innerHTML; };

  t.group('range flags: spec lookup is normalized and miss-safe');
  app.setState({ units: [mkUnit({ id: 'u-a', model: 'XQ-500' }), mkUnit({ id: 'u-b', model: 'xq 500' }),
                         mkUnit({ id: 'u-c', model: 'XQ500' }), mkUnit({ id: 'u-x', model: '' })],
                 shows: [{ id: 'show-A', name: 'A' }] });
  t.ok(app.fn.specFor(app.S.units[0]), 'XQ-500 hits');
  t.ok(app.fn.specFor(app.S.units[1]), 'xq 500 hits (case/space normalized)');
  t.ok(app.fn.specFor(app.S.units[2]), 'XQ500 hits (separator normalized)');
  t.eq(app.fn.specFor(app.S.units[3]), null, 'blank model -> no spec, no comment ever');

  app.S.settings.techName = 'Mike R.';

  t.group('range flags: fuel psi against the plate range');
  openForm('u-a');
  $v('#v_fp', '60');  t.includes(flags(), 'below the CAT XQ-500 range (75–122)', '60 flags below');
  t.includes(flags(), 'racors', 'the plate diagnostic rides along on fuel-low');
  $v('#v_fp', '101'); t.eq(flags(), '', 'nominal 101 is silent');
  $v('#v_fp', '130'); t.includes(flags(), 'above the CAT XQ-500 range', '130 flags above');

  t.group('range flags: oil — 40 is the floor, 15 is the idle exception, bias to flagging');
  // A false flag at idle costs two seconds of "that's fine"; a missed flag under
  // load costs an engine. Below 40 while Running ALWAYS flags — load evidence only
  // changes the wording. The app must never be quietest when it knows least.
  openForm('u-a');
  $v('#v_op', '12');  t.includes(flags(), 'below the CAT XQ-500 floor even at idle (15)', '<15 always flags, strongest wording');
  $v('#v_op', '95');  t.includes(flags(), 'above the CAT XQ-500 ceiling (87)', '>87 always flags');
  $v('#v_op', '55');  t.eq(flags(), '', '40–87 stays silent');
  $v('#v_op', '30');  t.includes(flags(), 'below the CAT XQ-500 running floor (40)', '15–40 with load UNKNOWN flags — silence is not the reward for a skipped field');
  t.includes(flags(), 'idle floor is 15', 'and names the idle exception');
  $v('#v_kw', '50');  t.includes(flags(), 'may just be idling', '15–40 at 10% load still flags, wording softened');
  $v('#v_kw', '250'); t.includes(flags(), 'below the CAT XQ-500 running floor (40) at 50% load', '15–40 under known load flags hard with the load named');

  t.group('range flags: running-status guard and unknown-model silence');
  app.S.units.find((u) => u.id === 'u-a').opStatus = 'staged';
  openForm('u-a');                      // selector pre-selects staged
  $v('#v_op', '5'); $v('#v_fp', '10');
  t.eq(flags(), '', 'status not Running -> zero flags, 0 psi on a stopped engine is a true reading');
  openForm('u-x');                      // running but no model
  $v('#v_op', '5');
  t.eq(flags(), '', 'unknown model -> silence, never the wrong range');

  t.group('range flags: comments only — inputs untouched');
  app.S.units.find((u) => u.id === 'u-a').opStatus = 'running';
  openForm('u-a');
  $v('#v_op', '12');
  app.fn.rangeFlags();
  t.eq(app.document.querySelector('#v_op').value, '12', 'typed value never modified');
  t.eq(app.document.querySelector('#v_fp').value, '', 'empty field never filled');
  const html = app.document.querySelector('#v_rangeFlags').innerHTML;
  t.excludes(html, 'input', 'flag area renders text, no controls');
  t.excludes(html, 'onclick', 'flag area offers no actions — comment, not correction');
};
