import { CommandModule } from 'yargs';

import { IContext } from '../../context';

import { CSharp } from './csharp';
import { Typescript } from './typescript';

export function New(context: IContext): CommandModule<{}, {}> {
  return {
    command: 'new',
    aliases: 'n',
    describe: 'create a new app project',
    builder: (b) => {
      return b
        .command(Typescript(context))
        .command(CSharp(context));
    },
    handler: () => { },
  };
}
