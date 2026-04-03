/**
 * LeadLoop Gmail Add-on entry points.
 * Thin client -- all logic lives in the Worker API.
 */

// ─── Trigger handlers ───────────────────────────────────────────────────────

function onMessageOpen(e) {
  if (!getApiKey_()) return [buildSetupCard_()];

  try {
    var messageId = e.gmail.messageId;
    var message = GmailApp.getMessageById(messageId);
    var threadId = message.getThread().getId();
    var subject = message.getThread().getFirstMessageSubject();
    var from = message.getFrom();

    var ctx = fetchContext(threadId, null);

    var card = CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle('LeadLoop'));

    // Lead info
    var leadSection = buildLeadInfoSection_(ctx.lead);
    if (leadSection) card.addSection(leadSection);

    // Thread actions
    var isWatched = !!(ctx.watched_thread && ctx.watched_thread.id);
    card.addSection(buildThreadActionsSection_(threadId, isWatched));

    return [card.build()];
  } catch (err) {
    return [buildErrorCard_(err.message)];
  }
}

function onCompose(e) {
  if (!getApiKey_()) return [buildSetupCard_()];

  try {
    var toRecipients = e.draftMetadata
      ? e.draftMetadata.toRecipients || []
      : [];
    var toEmail = toRecipients.length > 0 ? toRecipients[0] : '';

    var ctx = fetchContext(null, toEmail);

    var card = CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle('LeadLoop'));

    // Lead info
    var leadSection = buildLeadInfoSection_(ctx.lead);
    if (leadSection) card.addSection(leadSection);

    // Template picker
    card.addSection(buildTemplatePickerSection_(ctx.templates));

    // Enhance action
    var enhanceSection = CardService.newCardSection().setHeader('AI Tools');
    enhanceSection.addWidget(
      CardService.newTextButton()
        .setText('✨ Enhance Draft')
        .setOnClickAction(
          CardService.newAction().setFunctionName('onEnhanceDraft')
        )
    );
    card.addSection(enhanceSection);

    return [card.build()];
  } catch (err) {
    return [buildErrorCard_(err.message)];
  }
}

// ─── Action handlers ────────────────────────────────────────────────────────

function onInsertTemplate(e) {
  var templateId = e.parameters.template_id;

  // Build context from lead data if available
  var toRecipients = (e.draftMetadata && e.draftMetadata.toRecipients) || [];
  var toEmail = toRecipients.length > 0 ? toRecipients[0] : '';
  var leadContext = {};

  if (toEmail) {
    try {
      var ctx = fetchContext(null, toEmail);
      if (ctx.lead) {
        leadContext.first_name = (ctx.lead.name || '').split(' ')[0];
        leadContext.name = ctx.lead.name || '';
        leadContext.company = ctx.lead.company || '';
        leadContext.title = ctx.lead.title || '';
        leadContext.email = toEmail;
      }
    } catch(err) { /* proceed without context */ }
  }

  var result = fetchInsertTemplate(templateId, leadContext);

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
  // Note: Apps Script compose add-ons cannot read the current draft body.
  // We show a form for the user to paste their draft text.
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Enhance Draft'))
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextInput()
            .setFieldName('draft_text')
            .setTitle('Paste your draft')
            .setMultiline(true)
            .setHint('Paste the email text you want to enhance')
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
        .addWidget(CardService.newTextParagraph().setText(result.enhanced))
        .addWidget(
          CardService.newTextButton()
            .setText('📋 Copy to clipboard')
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
    .setHeader(CardService.newCardHeader().setTitle('Suggested Reply'));

  if (result.suggestion) {
    card.addSection(
      CardService.newCardSection()
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
  var thread = GmailApp.getThreadById(threadId);
  var subject = thread ? thread.getFirstMessageSubject() : '';

  var result = fetchWatch(threadId, subject);

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText(result.message || 'Thread is now being watched.')
    )
    .build();
}

function onSetFollowUpForm(e) {
  var threadId = e.parameters.thread_id;

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Set Follow-up'))
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextInput()
            .setFieldName('delay_days')
            .setTitle('Follow up in (days)')
            .setValue('3')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('Schedule Follow-up')
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
    .setNotification(CardService.newNotification().setText('API key saved! Reload the add-on.'))
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
