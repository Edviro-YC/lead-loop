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
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('LeadLoop'))
    .addSection(
      CardService.newCardSection()
        .setHeader('Connect your account')
        .addWidget(CardService.newTextParagraph().setText(
          'Paste the API key from your LeadLoop dashboard to get started.'
        ))
        .addWidget(
          CardService.newTextInput()
            .setFieldName('api_key')
            .setTitle('API Key')
            .setHint('Found in Dashboard > Settings')
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
  var section = CardService.newCardSection().setHeader('Templates');

  if (!templates || templates.length === 0) {
    section.addWidget(
      CardService.newTextParagraph().setText('No templates yet. Create one in the dashboard.')
    );
    return section;
  }

  templates.forEach(function(t) {
    var icon = CardService.newIconImage().setIcon(CardService.Icon.BOOKMARK);
    var widget = CardService.newDecoratedText()
      .setText(t.name)
      .setStartIcon(icon)
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('onInsertTemplate')
          .setParameters({ template_id: t.id })
      );
    if (t.category) {
      widget.setTopLabel(t.category.replace(/_/g, ' '));
    }
    section.addWidget(widget);
  });

  return section;
}

function buildThreadActionsSection_(threadId, isWatched, subject) {
  var section = CardService.newCardSection().setHeader('Actions');

  if (!isWatched) {
    var addIcon = CardService.newIconImage().setIcon(CardService.Icon.STAR);
    section.addWidget(
      CardService.newDecoratedText()
        .setText('Add to LeadLoop')
        .setStartIcon(addIcon)
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onWatchThread')
            .setParameters({ thread_id: threadId, subject: subject || '' })
        )
    );
  } else {
    var trackedIcon = CardService.newIconImage().setIcon(CardService.Icon.STAR);
    section.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('STATUS')
        .setText('Tracked by LeadLoop')
        .setStartIcon(trackedIcon)
    );

    var clockIcon = CardService.newIconImage().setIcon(CardService.Icon.CLOCK);
    section.addWidget(
      CardService.newDecoratedText()
        .setText('Set Follow-up')
        .setStartIcon(clockIcon)
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onSetFollowUpForm')
            .setParameters({ thread_id: threadId })
        )
    );

    var emailIcon = CardService.newIconImage().setIcon(CardService.Icon.EMAIL);
    section.addWidget(
      CardService.newDecoratedText()
        .setText('Suggest Reply')
        .setStartIcon(emailIcon)
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

  var section = CardService.newCardSection().setHeader('Lead');
  var personIcon = CardService.newIconImage().setIcon(CardService.Icon.PERSON);
  var widget = CardService.newDecoratedText()
    .setText(lead.name || 'Unknown')
    .setStartIcon(personIcon);

  if (lead.company || lead.title) {
    widget.setTopLabel([lead.title, lead.company].filter(Boolean).join(' at '));
  }
  if (lead.status) {
    widget.setBottomLabel(lead.status);
  }

  section.addWidget(widget);
  return section;
}
