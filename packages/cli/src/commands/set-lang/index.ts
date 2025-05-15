import { CommandModule } from 'yargs';

import { z } from 'zod';

import { IContext } from '../../context';
import { Settings } from '../../settings';


const ArgsSchema = z.object({
    language: z.string(),
  });
  

export function SetLang(_: IContext): CommandModule<{}, z.infer<typeof ArgsSchema>> {
  return {
    command: 'set-lang <language>',
    describe: 'set the programming language for the project (typescript or csharp)',
    builder: (b) => {
      return b
        .positional('language', {
          describe: 'programming language to use (typescript or csharp)',
          type: 'string',
          choices: ['ts', 'cs'],
          demandOption: true,
        });
    },
    handler: async ({ language }) => {
      const settings = Settings.load();
      settings.language = language === 'ts' ? 'typescript' : 'csharp';
      settings.save();
      console.log(`Language set to ${settings.language}`);
    },
  };
} 