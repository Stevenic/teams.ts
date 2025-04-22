import {
  ActionSet,
  Card,
  ChoiceDataQuery,
  ChoiceSetInput,
  DateInput,
  ExecuteAction,
  ICard,
  TextBlock,
  TextInput,
  ToggleInput,
} from './';

describe('Building Adaptive Cards Documentation Tests', () => {
  test('basic card with text, toggle and action', () => {
    // :snippet-start: basic-card-building
    /**
     import {
      Card,
      TextBlock,
      ToggleInput,
      ExecuteAction,
      ActionSet,
    } from "@microsoft/teams.cards";
    */

    const card = new Card(
      new TextBlock(
        'Hello world',
        /** provide the options inline */ { wrap: true, weight: 'bolder' }
      ),
      new ToggleInput('Notify me')
        /** or build it */
        .withId('notify'),
      new ActionSet(new ExecuteAction({ title: 'Submit' }).withData({ action: 'submit_demo' }))
    );
    // :snippet-end:

    expect(card).toEqual({
      type: 'AdaptiveCard',
      version: '1.5',
      body: [
        {
          type: 'TextBlock',
          text: 'Hello world',
          wrap: true,
          weight: 'bolder',
        },
        {
          type: 'Input.Toggle',
          id: 'notify',
          label: 'Notify me',
        },
        {
          type: 'ActionSet',
          actions: [
            {
              type: 'Action.Execute',
              title: 'Submit',
              data: {
                action: 'submit_demo',
              },
            },
          ],
        },
      ],
    });
  });

  test('invalid TextBlock size should cause TypeScript error', () => {
    // :snippet-start: invalid-text-block
    // @ts-expect-error: "huge" is not a valid size for TextBlock
    const textBlock = new TextBlock('Valid', { size: 'huge' });
    // :snippet-end:
    expect(textBlock).toEqual({
      type: 'TextBlock',
      text: 'Valid',
      size: 'large',
    });
  });

  test('raw card JSON matches schema', () => {
    // :snippet-start: raw-card-json
    const rawCard: ICard = {
      type: 'AdaptiveCard',
      body: [
        {
          text: 'Please fill out the below form to send a game purchase request.',
          wrap: true,
          type: 'TextBlock',
          style: 'heading',
        },
        {
          columns: [
            {
              width: 'stretch',
              items: [
                {
                  choices: [
                    { title: 'Call of Duty', value: 'call_of_duty' },
                    { title: "Death's Door", value: 'deaths_door' },
                    { title: 'Grand Theft Auto V', value: 'grand_theft' },
                    { title: 'Minecraft', value: 'minecraft' },
                  ],
                  'choices.data': new ChoiceDataQuery('games'),
                  style: 'filtered',
                  placeholder: 'Search for a game',
                  id: 'choiceGameSingle',
                  type: 'Input.ChoiceSet',
                  label: 'Game:',
                },
              ],
              type: 'Column',
            },
          ],
          type: 'ColumnSet',
        },
      ],
      actions: [
        {
          title: 'Request purchase',
          type: 'Action.Submit',
        },
      ],
      version: '1.5',
    };

    // Test just verifies the type system accepts it
    expect(rawCard.type).toBe('AdaptiveCard');
    expect(rawCard.version).toBe('1.5');
    // :snippet-end:
  });

  test('task form card', () => {
    // :snippet-start: task-form-card
    function createTaskCard() {
      return new Card().withBody(
        new TextBlock('Create New Task', {
          size: 'large',
          weight: 'bolder',
        }),
        new TextInput({ id: 'title' }).withLabel('Task Title').withPlaceholder('Enter task title'),
        new TextInput({ id: 'description' })
          .withLabel('Description')
          .withPlaceholder('Enter task details')
          .withMultiLine(true),
        new ChoiceSetInput(
          { title: 'High', value: 'high' },
          { title: 'Medium', value: 'medium' },
          { title: 'Low', value: 'low' }
        )
          .withId('priority')
          .withLabel('Priority')
          .withValue('medium'),
        new DateInput({ id: 'due_date' })
          .withLabel('Due Date')
          .withValue(new Date().toISOString().split('T')[0]),
        new ActionSet(
          new ExecuteAction({ title: 'Create Task' })
            .withData({ action: 'create_task' })
            .withAssociatedInputs('auto')
            .withStyle('positive')
        )
      );
    }

    const card = createTaskCard();
    // :snippet-end:
    const today = new Date().toISOString().split('T')[0];

    expect(card).toEqual({
      type: 'AdaptiveCard',
      version: '1.5',
      body: [
        {
          type: 'TextBlock',
          text: 'Create New Task',
          size: 'large',
          weight: 'bolder',
        },
        {
          type: 'Input.Text',
          id: 'title',
          label: 'Task Title',
          placeholder: 'Enter task title',
        },
        {
          type: 'Input.Text',
          id: 'description',
          label: 'Description',
          placeholder: 'Enter task details',
          isMultiline: true,
        },
        {
          type: 'Input.ChoiceSet',
          id: 'priority',
          label: 'Priority',
          value: 'medium',
          choices: [
            { title: 'High', value: 'high' },
            { title: 'Medium', value: 'medium' },
            { title: 'Low', value: 'low' },
          ],
        },
        {
          type: 'Input.Date',
          id: 'due_date',
          label: 'Due Date',
          value: today,
        },
        {
          type: 'ActionSet',
          actions: [
            {
              type: 'Action.Execute',
              title: 'Create Task',
              data: {
                action: 'create_task',
              },
              associatedInputs: 'auto',
              style: 'positive',
            },
          ],
        },
      ],
    });
  });
});
