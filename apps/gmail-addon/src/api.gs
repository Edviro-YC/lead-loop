/**
 * HTTP client for calling the LeadLoop Worker API.
 * All business logic lives in the backend; the add-on is a thin UI surface.
 */

var API_BASE = PropertiesService.getScriptProperties().getProperty('WORKER_URL');
if (!API_BASE) throw new Error('Set WORKER_URL in Script Properties (Extensions > Apps Script > Project Settings)');
var DEBUG_ = PropertiesService.getScriptProperties().getProperty('DEBUG') === 'true';

function debugLog_(msg) {
  if (DEBUG_) console.log('[debug] ' + msg);
}

function getApiKey_() {
  return PropertiesService.getUserProperties().getProperty('ADDON_API_KEY') || '';
}

function getUserEmail_() {
  return Session.getActiveUser().getEmail();
}

function apiRequest_(path, method, payload) {
  var options = {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Addon-Key': getApiKey_(),
      'X-User-Email': getUserEmail_()
    },
    muteHttpExceptions: true
  };

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  var response = UrlFetchApp.fetch(API_BASE + path, options);
  var code = response.getResponseCode();

  if (code >= 400) {
    var errorBody = {};
    try { errorBody = JSON.parse(response.getContentText()); } catch(e) {}
    throw new Error(errorBody.error || 'API error ' + code);
  }

  return JSON.parse(response.getContentText());
}

function fetchContext(gmailThreadId, toEmail) {
  return apiRequest_('/addon/context', 'POST', {
    gmail_thread_id: gmailThreadId || null,
    to_email: toEmail || null
  });
}

/**
 * Check the saved key against the Worker without throwing, so save/settings
 * can show an exact success-or-fail status. Returns {ok, code, message}.
 */
function verifyApiKey_() {
  try {
    var response = UrlFetchApp.fetch(API_BASE + '/addon/context', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Addon-Key': getApiKey_(),
        'X-User-Email': getUserEmail_()
      },
      payload: JSON.stringify({}),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    if (code === 200) return { ok: true, code: 200, message: 'Connected' };
    var message = 'API error';
    try { message = JSON.parse(response.getContentText()).error || message; } catch (ignored) {}
    return { ok: false, code: code, message: message };
  } catch (err) {
    // Network-level failure (bad WORKER_URL, DNS, timeout) — no HTTP code.
    return { ok: false, code: 0, message: err.message };
  }
}

function fetchStartSequence(sequenceId, gmailThreadId, variables) {
  return apiRequest_('/addon/start-sequence', 'POST', {
    sequence_id: sequenceId,
    gmail_thread_id: gmailThreadId,
    variables: variables || {}
  });
}

function fetchStopRun(runId) {
  return apiRequest_('/addon/stop-run', 'POST', { run_id: runId });
}

function fetchSaveExample(runId) {
  return apiRequest_('/addon/save-example', 'POST', { run_id: runId });
}
