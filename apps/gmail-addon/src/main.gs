/**
 * LeadLoop Gmail Add-on entry points.
 * Thin client -- all logic lives in the Worker API.
 */

// ─── Trigger handlers ───────────────────────────────────────────────────────

function onMessageOpen(e) {
  var t0 = Date.now();
  if (!getApiKey_()) return [buildSetupCard_()];

  try {
    var t1 = Date.now();
    var messageId = e.gmail.messageId;
    var token = ScriptApp.getOAuthToken();
    var resp = UrlFetchApp.fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + messageId + '?fields=threadId&format=minimal',
      { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
    );
    var threadId = null;
    if (resp.getResponseCode() === 200) {
      threadId = JSON.parse(resp.getContentText()).threadId;
    }
    if (!threadId) {
      threadId = GmailApp.getMessageById(messageId).getThread().getId();
      debugLog_('GmailApp fallback used');
    }
    debugLog_('threadId lookup: ' + (Date.now() - t1) + 'ms');

    var t2 = Date.now();
    var ctx = fetchContext(threadId, null);
    debugLog_('fetchContext: ' + (Date.now() - t2) + 'ms');

    debugLog_('onMessageOpen total: ' + (Date.now() - t0) + 'ms');
    return [buildMessageCard_(threadId, ctx)];
  } catch (err) {
    debugLog_('onMessageOpen error after ' + (Date.now() - t0) + 'ms: ' + err.message);
    return [buildErrorCard_(err.message)];
  }
}

// ─── Action handlers ────────────────────────────────────────────────────────

function onStartSequenceForm(e) {
  var variables = JSON.parse(e.parameters.variables || '[]');

  var section = CardService.newCardSection()
    .setHeader(e.parameters.sequence_name);

  if (variables.length === 0) {
    section.addWidget(
      CardService.newTextParagraph().setText('This sequence needs no variables.')
    );
  } else {
    section.addWidget(
      CardService.newTextParagraph().setText('Fill the sequence variables for this lead.')
    );
    variables.forEach(function(v) {
      section.addWidget(
        CardService.newTextInput()
          .setFieldName('var_' + v)
          .setTitle('{{' + v + '}}')
      );
    });
  }

  section.addWidget(
    CardService.newTextButton()
      .setText('Start sequence')
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('onStartSequenceSubmit')
          .setParameters({
            thread_id: e.parameters.thread_id,
            sequence_id: e.parameters.sequence_id,
            variables: e.parameters.variables
          })
      )
  );

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Start sequence'))
    .addSection(section);

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

function onStartSequenceSubmit(e) {
  var threadId = e.parameters.thread_id;
  var names = JSON.parse(e.parameters.variables || '[]');

  var variables = {};
  names.forEach(function(v) {
    variables[v] = (e.formInput && e.formInput['var_' + v]) || '';
  });

  try {
    var result = fetchStartSequence(e.parameters.sequence_id, threadId, variables);
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(err.message))
      .build();
  }

  var nextAt = result.next_draft_at
    ? new Date(result.next_draft_at).toLocaleDateString()
    : 'soon';

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText('Sequence started. Next draft ' + nextAt + '.')
    )
    .setNavigation(
      CardService.newNavigation()
        .popToRoot()
        .updateCard(buildMessageCard_(threadId, fetchContext(threadId, null)))
    )
    .build();
}

function onStopRun(e) {
  var threadId = e.parameters.thread_id;

  try {
    fetchStopRun(e.parameters.run_id);
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(err.message))
      .build();
  }

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('Run stopped.'))
    .setNavigation(
      CardService.newNavigation()
        .updateCard(buildMessageCard_(threadId, fetchContext(threadId, null)))
    )
    .build();
}

function onSaveExample(e) {
  try {
    fetchSaveExample(e.parameters.run_id);
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(err.message))
      .build();
  }

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText('Saved to Examples for the GTM team.')
    )
    .build();
}

// ─── Utility actions ────────────────────────────────────────────────────────

function saveApiKey(e) {
  var apiKey = ((e.formInput && e.formInput.api_key) || '').trim();
  if (!apiKey) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Please enter an API key.'))
      .build();
  }

  PropertiesService.getUserProperties().setProperty('ADDON_API_KEY', apiKey);

  // Verify immediately so the toast reports real success or the exact failure.
  var check = verifyApiKey_();
  var text = check.ok
    ? 'Connected (HTTP 200). Reopen a message to use LeadLoop.'
    : 'Key saved but rejected — HTTP ' + check.code + ': ' + check.message;
  if (!check.ok) {
    console.error('LeadLoop key verification failed: HTTP ' + check.code + ' — ' + check.message);
  }

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .setNavigation(CardService.newNavigation().updateCard(buildSetupCard_()))
    .build();
}

function showSettings(e) {
  return [buildSetupCard_()];
}
