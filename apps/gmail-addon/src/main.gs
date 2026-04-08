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
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + messageId + '?fields=threadId,payload/headers&format=metadata&metadataHeaders=Subject',
      { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
    );
    var threadId = null;
    var subject = '';
    if (resp.getResponseCode() === 200) {
      var msgData = JSON.parse(resp.getContentText());
      threadId = msgData.threadId;
      if (msgData.payload && msgData.payload.headers) {
        for (var i = 0; i < msgData.payload.headers.length; i++) {
          if (msgData.payload.headers[i].name === 'Subject') {
            subject = msgData.payload.headers[i].value;
            break;
          }
        }
      }
    }
    if (!threadId) {
      var message = GmailApp.getMessageById(messageId);
      threadId = message.getThread().getId();
      subject = message.getSubject();
      debugLog_('GmailApp fallback used');
    }
    debugLog_('threadId+subject lookup: ' + (Date.now() - t1) + 'ms');

    var t2 = Date.now();
    var ctx = fetchContext(threadId, null);
    debugLog_('fetchContext: ' + (Date.now() - t2) + 'ms');

    var card = CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle('LeadLoop'));

    var leadSection = buildLeadInfoSection_(ctx.lead);
    if (leadSection) card.addSection(leadSection);

    var isWatched = !!(ctx.watched_thread && ctx.watched_thread.id);
    card.addSection(buildThreadActionsSection_(threadId, isWatched, subject));

    debugLog_('onMessageOpen total: ' + (Date.now() - t0) + 'ms');
    return [card.build()];
  } catch (err) {
    debugLog_('onMessageOpen error after ' + (Date.now() - t0) + 'ms: ' + err.message);
    return [buildErrorCard_(err.message)];
  }
}

function onCompose(e) {
  var t0 = Date.now();
  if (!getApiKey_()) return [buildSetupCard_()];

  try {
    var toRecipients = e.draftMetadata
      ? e.draftMetadata.toRecipients || []
      : [];
    var toEmail = toRecipients.length > 0 ? toRecipients[0] : '';

    var t1 = Date.now();
    var ctx = fetchContext(null, toEmail);
    debugLog_('fetchContext: ' + (Date.now() - t1) + 'ms');

    var card = CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle('LeadLoop'));

    var leadSection = buildLeadInfoSection_(ctx.lead);
    if (leadSection) card.addSection(leadSection);

    card.addSection(buildTemplatePickerSection_(ctx.templates));

    var aiSection = CardService.newCardSection().setHeader('AI Tools');
    var descIcon = CardService.newIconImage().setIcon(CardService.Icon.DESCRIPTION);
    aiSection.addWidget(
      CardService.newDecoratedText()
        .setText('Enhance Draft')
        .setStartIcon(descIcon)
        .setOnClickAction(
          CardService.newAction().setFunctionName('onEnhanceDraft')
        )
    );
    card.addSection(aiSection);

    debugLog_('onCompose total: ' + (Date.now() - t0) + 'ms');
    return [card.build()];
  } catch (err) {
    return [buildErrorCard_(err.message)];
  }
}

// ─── Action handlers ────────────────────────────────────────────────────────

function onInsertTemplate(e) {
  var t0 = Date.now();
  var templateId = e.parameters.template_id;

  var toRecipients = (e.draftMetadata && e.draftMetadata.toRecipients) || [];
  var toEmail = toRecipients.length > 0 ? toRecipients[0] : '';

  var result = fetchInsertTemplate(templateId, toEmail);
  debugLog_('fetchInsertTemplate: ' + (Date.now() - t0) + 'ms');

  var response = CardService.newUpdateDraftActionResponseBuilder();

  if (result.subject) {
    response.setUpdateDraftSubjectAction(
      CardService.newUpdateDraftSubjectAction().addUpdateSubject(result.subject)
    );
  }

  if (result.body) {
    response.setUpdateDraftBodyAction(
      CardService.newUpdateDraftBodyAction()
        .addUpdateContent(result.body, CardService.ContentType.MUTABLE_HTML)
        .setUpdateType(CardService.UpdateDraftBodyType.INSERT_AT_START)
    );
  }

  return response.build();
}

function onEnhanceDraft(e) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Enhance Draft'))
    .addSection(
      CardService.newCardSection()
        .setHeader('Paste your draft below')
        .addWidget(
          CardService.newTextInput()
            .setFieldName('draft_text')
            .setTitle('Draft text')
            .setMultiline(true)
            .setHint('The email body you want to improve')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('Enhance')
            .setOnClickAction(
              CardService.newAction().setFunctionName('onEnhanceSubmit')
            )
        )
    );

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

function onEnhanceSubmit(e) {
  var draftText = e.formInput.draft_text;
  if (!draftText) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Please paste your draft text.'))
      .build();
  }

  var result = fetchEnhance(draftText);

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Enhanced Draft'))
    .addSection(
      CardService.newCardSection()
        .setHeader('Result')
        .addWidget(CardService.newTextParagraph().setText(result.enhanced))
        .addWidget(
          CardService.newTextButton()
            .setText('Copy to clipboard')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('showCopyNotification')
            )
        )
    );

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

function onSuggestReply(e) {
  var threadId = e.parameters.thread_id;
  var result = fetchSuggestReply(threadId);

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Suggest Reply'));

  if (result.suggestion) {
    card.addSection(
      CardService.newCardSection()
        .setHeader('Suggested reply')
        .addWidget(CardService.newTextParagraph().setText(result.suggestion))
    );
  } else {
    card.addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph().setText(result.message || 'No suggestion available.'))
    );
  }

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

function onWatchThread(e) {
  var threadId = e.parameters.thread_id;
  var subject = e.parameters.subject || '';

  var result = fetchWatch(threadId, subject);

  var ctx = fetchContext(threadId, null);

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('LeadLoop'));

  var leadSection = buildLeadInfoSection_(ctx.lead);
  if (leadSection) card.addSection(leadSection);

  card.addSection(buildThreadActionsSection_(threadId, true, subject));

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText(result.message || 'Thread added to LeadLoop.')
    )
    .setNavigation(CardService.newNavigation().updateCard(card.build()))
    .build();
}

function onSetFollowUpForm(e) {
  var threadId = e.parameters.thread_id;

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Schedule Follow-up'))
    .addSection(
      CardService.newCardSection()
        .setHeader('Timing')
        .addWidget(
          CardService.newTextInput()
            .setFieldName('delay_days')
            .setTitle('Days until follow-up')
            .setValue('3')
            .setHint('e.g. 3 for three days from now')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('Schedule')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onSetFollowUpSubmit')
                .setParameters({ thread_id: threadId })
            )
        )
    );

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

function onSetFollowUpSubmit(e) {
  var threadId = e.parameters.thread_id;
  var delayDays = parseInt(e.formInput.delay_days) || 3;

  var result = fetchSetFollowUp(threadId, delayDays);

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText(result.message || 'Follow-up scheduled.')
    )
    .setNavigation(CardService.newNavigation().popCard())
    .build();
}

// ─── Utility actions ────────────────────────────────────────────────────────

function saveApiKey(e) {
  var apiKey = e.formInput.api_key;
  if (!apiKey) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Please enter an API key.'))
      .build();
  }

  PropertiesService.getUserProperties().setProperty('ADDON_API_KEY', apiKey);

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText('API key saved. Reload the add-on.'))
    .build();
}

function showSettings(e) {
  return [buildSetupCard_()];
}

function showCopyNotification(e) {
  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText('Copy the text above and paste into your draft.')
    )
    .build();
}
