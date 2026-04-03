/**
 * Card Service UI builders for the LeadLoop Gmail add-on.
 */

function buildErrorCard_(message) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('LeadLoop'))
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('⚠ ' + message)
      )
    )
    .build();
}

function buildSetupCard_() {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('LeadLoop Setup'))
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph().setText(
          'Enter your API key from the LeadLoop dashboard (Settings page) to connect.'
        ))
        .addWidget(
          CardService.newTextInput()
            .setFieldName('api_key')
            .setTitle('API Key')
            .setHint('Paste your LeadLoop API key')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('Save Key')
            .setOnClickAction(CardService.newAction().setFunctionName('saveApiKey'))
        )
    )
    .build();
}

function buildTemplatePickerSection_(templates) {
  var section = CardService.newCardSection().setHeader('Insert Template');

  if (!templates || templates.length === 0) {
    section.addWidget(
      CardService.newTextParagraph().setText('No templates found. Create templates in the dashboard.')
    );
    return section;
  }

  templates.forEach(function(t) {
    section.addWidget(
      CardService.newDecoratedText()
        .setText(t.name)
        .setBottomLabel(t.category || '')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onInsertTemplate')
            .setParameters({ template_id: t.id })
        )
    );
  });

  return section;
}

function buildThreadActionsSection_(threadId, isWatched) {
  var section = CardService.newCardSection().setHeader('Thread Actions');

  if (!isWatched) {
    section.addWidget(
      CardService.newTextButton()
        .setText('👁 Watch Thread')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onWatchThread')
            .setParameters({ thread_id: threadId })
        )
    );
  } else {
    section.addWidget(
      CardService.newTextParagraph().setText('✓ Thread is being watched')
    );

    section.addWidget(
      CardService.newTextButton()
        .setText('⏰ Set Follow-up')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onSetFollowUpForm')
            .setParameters({ thread_id: threadId })
        )
    );

    section.addWidget(
      CardService.newTextButton()
        .setText('💡 Suggest Reply')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onSuggestReply')
            .setParameters({ thread_id: threadId })
        )
    );
  }

  return section;
}

function buildLeadInfoSection_(lead) {
  if (!lead) return null;

  var section = CardService.newCardSection().setHeader('Lead Info');
  section.addWidget(
    CardService.newDecoratedText()
      .setText(lead.name || lead.email || 'Unknown')
      .setBottomLabel(
        [lead.company, lead.title, lead.status].filter(Boolean).join(' · ')
      )
  );
  return section;
}
