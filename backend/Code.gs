/**
 * Code.gs — Main entry point for the Google Apps Script Web App.
 *
 * DEPLOY: Extensions → Apps Script → Deploy → New Deployment
 *   Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Set Script Properties (Project Settings → Script Properties):
 *   API_SECRET   — a long random string you also paste into the dashboard
 *   GEMINI_KEY   — your Gemini API key from aistudio.google.com
 *   SHEET_ID     — the ID of your Google Sheet (from the URL)
 */

// ── auth helper ───────────────────────────────────────────────
function _checkSecret(e) {
  const provided = (e.parameter && e.parameter.secret) || '';
  const stored   = PropertiesService.getScriptProperties().getProperty('API_SECRET') || '';
  if (!stored)   return true;   // Not yet configured — allow (first-time setup)
  return provided === stored;
}

function _cors(output) {
  return output
    .setMimeType(ContentService.MimeType.JSON);
}

function _json(data) {
  return _cors(ContentService.createTextOutput(JSON.stringify(data)));
}

function _err(msg, code) {
  return _json({ error: msg, code: code || 400 });
}

// ── GET router ────────────────────────────────────────────────
function doGet(e) {
  try {
    if (!_checkSecret(e)) return _err('Unauthorized', 401);

    const action = (e.parameter && e.parameter.action) || '';

    switch (action) {
      case 'ping':        return _json({ ok: true, ts: new Date().toISOString() });
      case 'getAll':      return _json(DB.getAll());
      case 'getTasks':    return _json({ tasks: DB.getTasks(e.parameter) });
      case 'getStats':    return _json(DB.getStats());
      case 'getEmployees':return _json({ employees: DB.getEmployees() });
      case 'triggerSync': {
        const full = e.parameter.fullSync === '1';
        EmailProcessor.run(full);
        return _json({ ok: true });
      }
      default:            return _err('Unknown action: ' + action);
    }
  } catch (err) {
    console.error(err);
    return _err(err.message || 'Internal error', 500);
  }
}

// ── POST router ───────────────────────────────────────────────
function doPost(e) {
  try {
    if (!_checkSecret(e)) return _err('Unauthorized', 401);

    const action = (e.parameter && e.parameter.action) || '';
    let body = {};
    try { body = JSON.parse(e.postData.contents); } catch (_) {}

    switch (action) {
      case 'createTask':     return _json(DB.createTask(body));
      case 'updateTask':     return _json(DB.updateTask(e.parameter.id, body));
      case 'deleteTask':     return _json(DB.deleteTask(e.parameter.id));
      case 'addEmployee':    return _json(DB.addEmployee(body.name));
      case 'removeEmployee': return _json(DB.removeEmployee(e.parameter.id));
      case 'reorderClients': return _json(DB.reorderClients(body.order));
      default:               return _err('Unknown action: ' + action);
    }
  } catch (err) {
    console.error(err);
    return _err(err.message || 'Internal error', 500);
  }
}

// ── time-based trigger ────────────────────────────────────────
/**
 * Run this function ONCE manually to set up the 10-minute trigger.
 * Extensions → Apps Script → Run → setupTrigger
 */
function setupTrigger() {
  // Remove existing triggers with same handler to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'runEmailSync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runEmailSync')
    .timeBased()
    .everyMinutes(10)
    .create();
  console.log('10-minute email sync trigger created.');
}

function runEmailSync() {
  try {
    EmailProcessor.run(false);
  } catch (err) {
    console.error('Email sync error:', err);
  }
}

/**
 * Run this ONCE manually to initialise the Google Sheet with all required tabs.
 * Extensions → Apps Script → Run → setupDatabase
 */
function setupDatabase() {
  DB.init();
  console.log('Database initialised.');
}
