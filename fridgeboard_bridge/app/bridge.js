// FridgeBoard Bridge: a Home Assistant add-on that links a family's HA to their FridgeBoard.
//
// It holds two connections and passes a few things between them:
//   Home Assistant (its WebSocket API, with the Supervisor's token): the states of the entities the
//     family ticked, and fridgeboard events their automations fire; and it fires fridgeboard_event
//     when something happens on FridgeBoard (a chore ticked, a routine finished, a walk started).
//   FridgeBoard (wss://fridgeboard.me/api/bridge/socket): it calls out, so nothing in the home is
//     opened to the internet, and FridgeBoard never gets an HA address or token.
// Its own page, in HA's sidebar (ingress), takes the code from the FridgeBoard phone app and lists
// the entities to tick. Nothing is ticked at first, and nothing unticked ever leaves the house.
//
// No dependencies: Node 22 has WebSocket and fetch built in.
// Outside an add-on (testing on a laptop): HA_URL and HA_TOKEN (a long-lived token), FB_SERVER.
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');

var VERSION = '0.1.0';
var DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
var PORT = +process.env.PORT || 8099;
var FILE = path.join(DATA, 'bridge.json');
// What can be ticked: things that can start something on FridgeBoard (a contact sensor, a button, a
// switch). Locks, doors and alarms stay out until the board has tiles for them.
var PICKABLE = /^(binary_sensor|event|button|input_button|input_boolean|switch)\./;
var RECENT = 20;

function log() { console.log.apply(console, [new Date().toISOString().slice(11, 19)].concat([].slice.call(arguments))); }

// ---------- what's kept: /data/bridge.json (in HA's backups) ----------
var store = { token: '', household: '', ticked: [] };
try { Object.assign(store, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) {}
function save() {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(store)); fs.renameSync(FILE + '.tmp', FILE); }
  catch (e) { log('Could not save:', e.message); }
}
function server() {
  var s = process.env.FB_SERVER;
  if (!s) try { s = JSON.parse(fs.readFileSync(path.join(DATA, 'options.json'), 'utf8')).server; } catch (e) {}
  return String(s || 'https://fridgeboard.me').replace(/\/+$/, '');
}
var recent = []; // what came and went, for the page: { at, dir, type, data }
function note(dir, type, data) { recent.unshift({ at: Date.now(), dir: dir, type: type, data: data || {} }); if (recent.length > RECENT) recent.length = RECENT; }

// ---------- Home Assistant ----------
var ha = { ws: null, live: false, error: '', states: {}, areaOf: {}, location: '', nextId: 1, waits: {} };
function haUrl() {
  if (process.env.SUPERVISOR_TOKEN) return { url: 'ws://supervisor/core/websocket', token: process.env.SUPERVISOR_TOKEN };
  if (process.env.HA_URL && process.env.HA_TOKEN) return { url: process.env.HA_URL.replace(/\/+$/, '').replace(/^http/, 'ws') + '/api/websocket', token: process.env.HA_TOKEN };
  return null;
}
function haSend(type, extra, cb) {
  if (!ha.ws || ha.ws.readyState !== 1) return cb && cb(new Error('Home Assistant isn\'t connected'));
  var id = ha.nextId++, msg = Object.assign({ id: id, type: type }, extra || {});
  if (cb) ha.waits[id] = cb;
  ha.ws.send(JSON.stringify(msg));
  return id;
}
// An entity's state as FridgeBoard needs it: { id, state, ev (an event entity's event_type) }
function slim(s) { return { id: s.entity_id, state: s.state, ev: (s.attributes && s.attributes.event_type) || '' }; }
function haConnect() {
  var at = haUrl();
  if (!at) { ha.error = 'No Home Assistant to talk to (set HA_URL and HA_TOKEN outside an add-on)'; return; }
  var ws;
  try { ws = new WebSocket(at.url); } catch (e) { ha.error = e.message; return setTimeout(haConnect, 10000); }
  ha.ws = ws;
  ws.onmessage = function (m) {
    var msg;
    try { msg = JSON.parse(m.data); } catch (e) { return; }
    if (msg.type === 'auth_required') return ws.send(JSON.stringify({ type: 'auth', access_token: at.token }));
    if (msg.type === 'auth_invalid') { ha.error = 'Home Assistant refused the token'; return; }
    if (msg.type === 'auth_ok') return haReady();
    if (msg.type === 'result' && ha.waits[msg.id]) { var cb = ha.waits[msg.id]; delete ha.waits[msg.id]; return cb(msg.success ? null : new Error((msg.error && msg.error.message) || 'failed'), msg.result); }
    if (msg.type === 'event' && msg.event) haEvent(msg.event);
  };
  ws.onclose = function () {
    if (ha.live) log('Home Assistant connection closed; trying again');
    ha.live = false; ha.ws = null; ha.waits = {};
    setTimeout(haConnect, 5000);
  };
  ws.onerror = function () {};
}
function haReady() {
  ha.live = true; ha.error = '';
  log('Connected to Home Assistant');
  haSend('get_config', null, function (err, c) { if (!err && c) ha.location = c.location_name || ''; });
  haSend('get_states', null, function (err, list) {
    if (err) return;
    ha.states = {};
    list.forEach(function (s) { ha.states[s.entity_id] = s; });
    fbSendAll();
  });
  // area names, to group the list on the page: an entity's own area, or its device's
  haSend('config/area_registry/list', null, function (err, areas) {
    if (err) return;
    var names = {}, devArea = {};
    areas.forEach(function (a) { names[a.area_id] = a.name; });
    haSend('config/device_registry/list', null, function (err2, devs) {
      (devs || []).forEach(function (d) { if (d.area_id) devArea[d.id] = d.area_id; });
      haSend('config/entity_registry/list', null, function (err3, ents) {
        var out = {};
        (ents || []).forEach(function (e) { var a = e.area_id || devArea[e.device_id]; if (a && names[a]) out[e.entity_id] = names[a]; });
        ha.areaOf = out;
      });
    });
  });
  haSend('subscribe_events', { event_type: 'state_changed' });
  haSend('subscribe_events', { event_type: 'fridgeboard' });
}
function haEvent(ev) {
  if (ev.event_type === 'fridgeboard') { // the family's own automation, asking FridgeBoard to do something
    var call = ev.data || {};
    note('in', 'fridgeboard', call);
    return fbSend({ call: call });
  }
  if (ev.event_type !== 'state_changed') return;
  var d = ev.data || {}, cur = d.new_state, old = d.old_state;
  if (!cur) { delete ha.states[d.entity_id]; return; }
  ha.states[cur.entity_id] = cur;
  if (store.ticked.indexOf(cur.entity_id) < 0) return; // never sent: it wasn't ticked
  var a = slim(cur), b = old ? slim(old) : null;
  if (b && a.state === b.state && a.ev === b.ev) return; // just its attributes changed
  fbSend({ states: [a] });
}

// ---------- FridgeBoard ----------
var fb = { ws: null, live: false, error: '', wait: 5000, timer: null, beat: null };
function fbSend(o) { if (fb.ws && fb.live) fb.ws.send(JSON.stringify(o)); }
function entitiesOut() {
  return store.ticked.map(function (id) {
    var s = ha.states[id], at = (s && s.attributes) || {};
    var o = { id: id, name: at.friendly_name || id, area: ha.areaOf[id] || '' };
    if (at.device_class) o.kind = String(at.device_class); // door, window, motion: how the phone words a rule
    if (Array.isArray(at.event_types)) o.presses = at.event_types.map(String); // a remote's single_press, double_press
    return o;
  });
}
function fbSendAll() {
  if (!fb.live) return;
  fbSend({ entities: entitiesOut() });
  fbSend({ initial: true, states: store.ticked.filter(function (id) { return ha.states[id]; }).map(function (id) { return slim(ha.states[id]); }) });
}
function fbConnect() {
  clearTimeout(fb.timer);
  if (!store.token || fb.ws) return;
  var url = server().replace(/^http/, 'ws') + '/api/bridge/socket', ws;
  try { ws = new WebSocket(url); } catch (e) { fb.error = e.message; return fbRetry(); }
  fb.ws = ws;
  ws.onopen = function () { ws.send(JSON.stringify({ token: store.token, version: VERSION })); };
  ws.onmessage = function (m) {
    var msg;
    if (fb.ws !== ws) return; // an old connection, replaced by linking again
    try { msg = JSON.parse(m.data); } catch (e) { return; }
    if (msg.hello) {
      fb.live = true; fb.error = ''; fb.wait = 5000;
      if (msg.hello.household && msg.hello.household !== store.household) { store.household = msg.hello.household; save(); }
      log('Connected to FridgeBoard (' + store.household + ')');
      clearInterval(fb.beat);
      fb.beat = setInterval(function () { fbSend({ p: 1 }); }, 30000); // CloudFront closes a socket that's quiet for a minute
      return fbSendAll();
    }
    if (msg.fire) { // something happened on FridgeBoard: fired in HA for the family's automations
      var data = Object.assign({ type: msg.fire.type }, msg.fire.data || {});
      note('out', msg.fire.type, data);
      return haSend('fire_event', { event_type: 'fridgeboard_event', event_data: data });
    }
    if (msg.error) { note('in', 'error', { message: msg.error }); log('FridgeBoard said: ' + msg.error); }
  };
  ws.onclose = function (e) {
    if (fb.ws !== ws) return;
    clearInterval(fb.beat);
    var was = fb.live;
    fb.live = false; fb.ws = null;
    if (e.code === 4001) { // unlinked on the phone (or the token's no good): wait for a new code
      log('FridgeBoard says this bridge isn\'t linked any more');
      store.token = ''; save();
      fb.error = 'Unlinked from FridgeBoard. Get a new code on the phone to link again.';
      return;
    }
    if (e.code === 4000) { fb.error = 'Another bridge was linked to this household'; return; } // replaced: don't fight it
    if (was) log('FridgeBoard connection closed; trying again');
    fbRetry();
  };
  ws.onerror = function () { fb.error = 'Can\'t reach ' + server(); };
}
function fbRetry() { fb.timer = setTimeout(fbConnect, fb.wait); fb.wait = Math.min(fb.wait * 2, 60000); }

// ---------- the page in HA's sidebar (ingress) ----------
// Only HA's ingress proxy may open it (172.30.32.2): it's HA that checks who's signed in.
function allowed(req) {
  if (!process.env.SUPERVISOR_TOKEN) return true; // testing on a laptop
  return /^(::ffff:)?172\.30\.32\.2$/.test(req.socket.remoteAddress || '');
}
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req, cb) {
  var chunks = [], size = 0;
  req.on('data', function (c) { size += c.length; if (size < 64e3) chunks.push(c); });
  req.on('end', function () { try { cb(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { cb({}); } });
}
function stateOf() {
  var all = Object.keys(ha.states).filter(function (id) { return PICKABLE.test(id); }).map(function (id) {
    var s = ha.states[id];
    return { id: id, name: (s.attributes && s.attributes.friendly_name) || id, area: ha.areaOf[id] || '', state: s.state, ticked: store.ticked.indexOf(id) >= 0 };
  }).sort(function (a, b) { return (a.area || '~').localeCompare(b.area || '~') || a.name.localeCompare(b.name); });
  return { version: VERSION, server: server(), linked: !!store.token, household: store.household, online: fb.live, fbError: fb.error,
    ha: ha.live, haError: ha.error, entities: all, missing: store.ticked.filter(function (id) { return !ha.states[id]; }), recent: recent };
}
var PAGE = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
http.createServer(function (req, res) {
  if (!allowed(req)) return send(res, 403, { error: 'Open this from Home Assistant' });
  var p = req.url.split('?')[0].replace(/^.*\/api\//, '/api/');
  if (req.method === 'GET' && p === '/api/state') return send(res, 200, stateOf());
  if (req.method === 'POST' && p === '/api/link') {
    return readBody(req, function (a) {
      fetch(server() + '/api/bridge/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: String(a.code || ''), name: ha.location || 'Home Assistant', version: VERSION }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (r) {
          if (!r.ok) return send(res, 400, { error: r.j.error || 'That didn\'t work' });
          if (fb.ws) { try { fb.ws.close(); } catch (e) {} fb.ws = null; fb.live = false; }
          store.token = r.j.token; store.household = r.j.household || ''; fb.error = ''; fb.wait = 5000;
          save(); fbConnect();
          log('Linked to FridgeBoard (' + store.household + ')');
          send(res, 200, { ok: true, household: store.household });
        })
        .catch(function () { send(res, 502, { error: 'Can\'t reach ' + server() + '. Check this Home Assistant is online.' }); });
    });
  }
  if (req.method === 'POST' && p === '/api/ticked') {
    return readBody(req, function (a) {
      var ids = (Array.isArray(a.ids) ? a.ids : []).map(String).filter(function (id, i, all) { return PICKABLE.test(id) && all.indexOf(id) === i; }).slice(0, 300);
      store.ticked = ids; save();
      fbSendAll();
      send(res, 200, { ok: true });
    });
  }
  if (req.method === 'POST' && p === '/api/unlink') {
    fbSend({ unlink: 1 }); // FridgeBoard forgets this bridge too, and the phone sees it go
    setTimeout(function () { if (fb.ws) try { fb.ws.close(); } catch (e) {} }, 300);
    store.token = ''; store.household = ''; fb.error = ''; save();
    log('Unlinked from FridgeBoard');
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET') return send(res, 200, PAGE, 'text/html; charset=utf-8');
  send(res, 404, { error: 'Not found' });
}).listen(PORT, function () { log('FridgeBoard Bridge ' + VERSION + ' on port ' + PORT + ', talking to ' + server()); });

haConnect();
fbConnect();
