/**
 * Card Service UI builders for the LeadLoop Gmail add-on.
 */

function buildErrorCard_(message) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('LeadLoop'))
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('Error: ' + message)
      )
    )
    .build();
}

function buildSetupCard_() {
  var section = CardService.newCardSection().setHeader('Connect your account');

  // A saved key never redisplays (it's a secret), so show its live status
  // instead — this is how you know whether the add-on is connected.
  if (getApiKey_()) {
    var check = verifyApiKey_();
    section.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Saved key status')
        .setText(check.ok
          ? '<font color="#137333">Connected as ' + getUserEmail_() + '</font>'
          : '<font color="#c5221f">Rejected — HTTP ' + check.code + ': ' + check.message + '</font>')
        .setWrapText(true)
    );
  } else {
    section.addWidget(CardService.newTextParagraph().setText(
      'Paste the ADDON_API_KEY secret you set on the Worker to get started.'
    ));
  }

  section
    .addWidget(
      CardService.newTextInput()
        .setFieldName('api_key')
        .setTitle(getApiKey_() ? 'Replace API Key' : 'API Key')
        .setHint('The Worker\'s ADDON_API_KEY secret (wrangler secret put ADDON_API_KEY)')
    )
    .addWidget(
      CardService.newTextButton()
        .setText('Save Key')
        .setOnClickAction(CardService.newAction().setFunctionName('saveApiKey'))
    );

  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('LeadLoop'))
    .addSection(section)
    .build();
}

/**
 * The message-open card: run status + actions when the thread is
 * enrolled, otherwise a "Start sequence" picker.
 */
function buildMessageCard_(threadId, ctx) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('LeadLoop'));

  var run = ctx.run;
  if (run && run.id) {
    var totalSteps = 0;
    (ctx.sequences || []).forEach(function(s) {
      if (s.id === run.sequence_id) totalSteps = s.step_count;
    });
    var sequenceName = run.sequences && run.sequences.name ? run.sequences.name : 'Sequence';
    var step = totalSteps > 0 ? Math.min(run.sequence_step, totalSteps) : run.sequence_step;

    var section = CardService.newCardSection().setHeader('Run');
    var statusIcon = CardService.newIconImage().setIcon(CardService.Icon.STAR);
    section.addWidget(
      CardService.newDecoratedText()
        .setTopLabel(sequenceName)
        .setText('Step ' + step + (totalSteps ? ' of ' + totalSteps : ''))
        .setBottomLabel(run.status)
        .setStartIcon(statusIcon)
    );

    if (run.status === 'active') {
      var stopIcon = CardService.newIconImage().setIcon(CardService.Icon.CLOCK);
      section.addWidget(
        CardService.newDecoratedText()
          .setText('Stop run')
          .setStartIcon(stopIcon)
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onStopRun')
              .setParameters({ run_id: run.id, thread_id: threadId })
          )
      );
    }

    var saveIcon = CardService.newIconImage().setIcon(CardService.Icon.BOOKMARK);
    section.addWidget(
      CardService.newDecoratedText()
        .setText('Save as example')
        .setBottomLabel('Tag this thread for the GTM team')
        .setStartIcon(saveIcon)
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onSaveExample')
            .setParameters({ run_id: run.id })
        )
    );

    card.addSection(section);
    return card.build();
  }

  var startSection = CardService.newCardSection().setHeader('Start sequence');
  var sequences = ctx.sequences || [];

  if (sequences.length === 0) {
    startSection.addWidget(
      CardService.newTextParagraph().setText(
        'No sequences yet. Create one in the dashboard first.'
      )
    );
  } else {
    startSection.addWidget(
      CardService.newTextParagraph().setText(
        'Enroll this sent thread — follow-ups appear as drafts on schedule.'
      )
    );
    sequences.forEach(function(s) {
      if (!s.step_count) return;
      var icon = CardService.newIconImage().setIcon(CardService.Icon.EMAIL);
      startSection.addWidget(
        CardService.newDecoratedText()
          .setText(s.name)
          .setBottomLabel(s.step_count + ' step' + (s.step_count === 1 ? '' : 's'))
          .setStartIcon(icon)
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onStartSequenceForm')
              .setParameters({
                thread_id: threadId,
                sequence_id: s.id,
                sequence_name: s.name,
                variables: JSON.stringify(s.variables || [])
              })
          )
      );
    });
  }

  card.addSection(startSection);
  return card.build();
}
