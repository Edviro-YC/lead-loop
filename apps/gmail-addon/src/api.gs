/**
 * HTTP client for calling the LeadLoop Worker API.
 * All business logic lives in the backend; the add-on is a thin UI surface.
 */

var API_BASE = PropertiesService.getScriptProperties().getProperty('WORKER_URL') || 'https://leadloop-worker.tanujsiripurapu.workers.dev';

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

function fetchInsertTemplate(templateId, context) {
  return apiRequest_('/addon/insert-template', 'POST', {
    template_id: templateId,
    context: context || {}
  });
}

function fetchEnhance(draftText, leadContext) {
  return apiRequest_('/addon/enhance', 'POST', {
    draft_text: draftText,
    lead_context: leadContext || {}
  });
}

function fetchSuggestReply(gmailThreadId) {
  return apiRequest_('/addon/suggest-reply', 'POST', {
    gmail_thread_id: gmailThreadId
  });
}

function fetchWatch(gmailThreadId, subject) {
  return apiRequest_('/addon/watch', 'POST', {
    gmail_thread_id: gmailThreadId,
    subject: subject || ''
  });
}

function fetchSetFollowUp(gmailThreadId, delayDays, templateId) {
  return apiRequest_('/addon/set-followup', 'POST', {
    gmail_thread_id: gmailThreadId,
    delay_days: delayDays || 3,
    template_id: templateId || null
  });
}
