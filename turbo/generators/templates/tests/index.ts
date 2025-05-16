import { App } from '@microsoft/teams.apps';
import { DevtoolsPlugin } from '@microsoft/teams.dev';

const app = new App({
  plugins: [new DevtoolsPlugin()],
});

app.on('message', async ({ send, activity }) => {
  await send({ type: 'typing' });

  await send(`You said "${activity.text}"`);
});

(async () => {
  await app.start(+(process.env.PORT || 3000));
})();
