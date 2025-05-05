import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { CommandModule } from 'yargs';
import { z } from 'zod';

import { IContext } from '../../context';
import { Project } from '../../project';

const ArgsSchema = z.object({
  name: z.string(),
  template: z.string(),
  ttk: z.string().optional(),
  start: z.boolean().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  ghUsername: z.string().optional(),
  ghToken: z.string().optional()
});

export function CSharp(_: IContext): CommandModule<{}, z.infer<typeof ArgsSchema>> {
  return {
    command: 'csharp <name>',
    aliases: ['cs'],
    describe: '⚠️BETA⚠️ create a new csharp app project',
    builder: async (b) => {
      const changeCase = await import('change-case');

      return b
        .positional('name', {
          alias: 'n',
          type: 'string',
          describe: 'the apps name',
          demandOption: true,
          coerce: (name: string) => {
            return changeCase.pascalCase(
              name.trim(),
              { delimiter: '.' }
            );
          },
        })
        .option('template', {
          alias: 't',
          type: 'string',
          describe: 'the app template to use',
          default: 'echo',
          choices: fs.readdirSync(
            path.resolve(url.fileURLToPath(import.meta.url), '../..', 'templates', 'csharp')
          ),
        })
        .option('start', {
          alias: 's',
          type: 'boolean',
          describe: 'start the project',
          default: false,
        })
        .option('toolkit', {
          alias: 'ttk',
          type: 'string',
          describe: 'include Teams Toolkit configuration',
          choices: fs.readdirSync(
            path.resolve(url.fileURLToPath(import.meta.url), '../..', 'configs', 'ttk')
          ),
        })
        .option('client-id', {
          type: 'string',
          describe: 'the apps client id (app id)',
          default: process.env.CLIENT_ID,
        })
        .option('client-secret', {
          type: 'string',
          describe: 'the apps client secret',
          default: process.env.CLIENT_SECRET,
        })
        .option('gh-username', {
          type: 'string',
          demandOption: false,
          describe: 'your github username',
          default: process.env.GH_USERNAME
        })
        .option('gh-token', {
          type: 'string',
          demandOption: false,
          describe: 'your github token with package read permissions to https://github.com/microsoft/teams.net',
          default: process.env.GH_TOKEN
        })
        .check(({ name }) => {
          if (fs.existsSync(path.join(process.cwd(), name))) {
            throw new Error(`"${name}" already exists!`);
          }

          return true;
        });
    },
    handler: async ({ name, template, start, ttk, clientId, clientSecret }) => {
      const projectDir = path.join(process.cwd(), name);
      const builder = Project.builder()
        .withPath(projectDir)
        .withName(name)
        .withLanguage('csharp')
        .addTemplate(template);

      if (ttk) {
        builder.addTeamsToolkit('basic');
      }

      if (clientId) {
        builder.addEnv('TEAMS_CLIENT_ID', clientId);
      }

      if (clientSecret) {
        builder.addEnv('TEAMS_CLIENT_SECRET', clientSecret);
      }

      if (process.env.OPENAI_API_KEY) {
        builder.addEnv('OPENAI_API_KEY', process.env.OPENAI_API_KEY);
      }

      if (process.env.AZURE_OPENAI_API_KEY) {
        builder.addEnv('OPENAI_API_KEY', process.env.AZURE_OPENAI_API_KEY);
      }

      if (process.env.AZURE_OPENAI_ENDPOINT) {
        builder.addEnv('OPENAI_ENDPOINT', process.env.AZURE_OPENAI_ENDPOINT);
      }

      const project = builder.build();
      await project.up();
      console.log(`✅ App "${name}" created successfully at ${projectDir}`);

      if (start) {
        console.log(`cd ${name} && dotnet run`);
        cp.spawnSync(`cd ${name} && dotnet run`, {
          stdio: 'inherit',
          shell: true,
        });
      } else {
        console.log('Next steps to start the app:');
        console.log(`cd ${name} && dotnet run`);
      }
    },
  };
}
